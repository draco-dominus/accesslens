"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/session/api";
import { buildChatRequest, completedTurns, type ChatMessage, type ChatTurn } from "@/lib/session/chat-context";

export type { ChatMessage } from "@/lib/session/chat-context";
import { answerQuestion, LUMI_QUESTIONS, type LumiQuestionId } from "@/lib/session/lumi";
import type { Session } from "@/lib/session/types";

/**
 * Ask Lumi conversations, one thread per (inspection, finding).
 *
 * - Typed questions go to /api/chat (Gemini, grounded in this inspection's records; no photos).
 * - Suggested questions are answered instantly from the records (no AI call) and labeled as such.
 * - A reply is written to the thread it was asked in (captured key), so switching findings or starting a
 *   new inspection can never show it in the wrong place. A new inspection aborts in-flight requests.
 * - Nothing is retried automatically; a failed answer offers one manual "Try again".
 */

const BOUNDARY_REPLY =
  "That’s something photos can’t settle. I can’t confirm compliance, exact measurements or safety — those need an on-site check, ideally by a qualified assessor. I can tell you what this inspection recorded, why it could matter, and what might help.";

let seq = 0;
const nextId = () => `m${Date.now().toString(36)}${(++seq).toString(36)}`;
const threadKey = (sessionId: string, findingId: string) => `${sessionId}:${findingId}`;

export function useLumiChat(session: Session | null) {
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const sessionId = session?.id ?? null;
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // A different inspection: cancel everything and forget old threads.
  const lastSession = useRef(sessionId);
  useEffect(() => {
    if (lastSession.current === sessionId) return;
    lastSession.current = sessionId;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setThreads({});
  }, [sessionId]);
  useEffect(() => {
    const map = controllers.current;
    return () => map.forEach((c) => c.abort());
  }, []);

  const thread = useCallback((findingId: string | null) => (sessionId && findingId ? (threads[threadKey(sessionId, findingId)] ?? []) : []), [threads, sessionId]);

  const patch = useCallback(
    (key: string, id: string, next: ChatMessage) => setThreads((t) => (t[key] ? { ...t, [key]: t[key].map((m) => (m.id === id ? next : m)) } : t)),
    [],
  );

  /** Run the AI request for `question` into the pending bubble `pendingId` of thread `key`. */
  const run = useCallback((key: string, findingId: string, question: string, pendingId: string, history: ChatTurn[]) => {
    const s = sessionRef.current;
    const body = s ? buildChatRequest(s, findingId, question, history) : null;
    if (!body) {
      patch(key, pendingId, { id: pendingId, role: "lumi", kind: "ai", text: "", question, error: { message: "There are no findings to talk about yet.", retryable: false } });
      return;
    }
    controllers.current.get(key)?.abort();
    const ctrl = new AbortController();
    controllers.current.set(key, ctrl);
    api
      .askLumi(body, ctrl.signal)
      .then((reply) => {
        if (ctrl.signal.aborted) return;
        // Links back to findings that exist in this inspection only (per the API contract).
        const known = new Set(sessionRef.current?.findings.map((f) => f.id) ?? []);
        if (reply.groundedFindingIds.some((id) => !known.has(id))) {
          patch(key, pendingId, { id: pendingId, role: "lumi", kind: "ai", text: "", question, error: { message: "That answer referred to something outside this inspection, so I discarded it. Please ask again.", retryable: true } });
          return;
        }
        patch(key, pendingId, {
          id: pendingId,
          role: "lumi",
          kind: "ai",
          text: reply.answer,
          question,
          groundedFindingIds: reply.groundedFindingIds,
          needsOnSiteVerification: reply.needsOnSiteVerification,
        });
      })
      .catch((err) => {
        if (ctrl.signal.aborted || api.isAbort(err)) return;
        const e = err instanceof api.ApiClientError ? err : null;
        if (e?.code === "UNSAFE_MODEL_OUTPUT") {
          // The server discarded an answer that strayed into compliance, measurements or guarantees.
          // Say plainly what photos can't settle (a fixed reply, not presented as AI output).
          patch(key, pendingId, { id: pendingId, role: "lumi", kind: "records", text: BOUNDARY_REPLY, sourceLabel: "What AccessLens can’t determine from photos", question });
          return;
        }
        patch(key, pendingId, {
          id: pendingId,
          role: "lumi",
          kind: "ai",
          text: "",
          question,
          error: { message: e?.message ?? "Lumi couldn’t answer just now.", retryable: !e || !["CHAT_INVALID_INPUT", "CHAT_TOO_LARGE", "CHAT_CONTENT_TYPE", "CONFIG"].includes(e.code) },
        });
      })
      .finally(() => {
        if (controllers.current.get(key) === ctrl) controllers.current.delete(key);
      });
  }, [patch]);

  /** Ask a free-text question about `findingId` (with the rest of the inspection as context). */
  const ask = useCallback(
    (findingId: string, question: string) => {
      const q = question.trim();
      if (!sessionId || !q) return;
      const key = threadKey(sessionId, findingId);
      const pendingId = nextId();
      const history = completedTurns(threads[key] ?? []);
      setThreads((t) => ({
        ...t,
        [key]: [...(t[key] ?? []), { id: nextId(), role: "user", text: q }, { id: pendingId, role: "lumi", kind: "ai", text: "", question: q, pending: true }],
      }));
      run(key, findingId, q, pendingId, history);
    },
    [sessionId, threads, run],
  );

  /** Re-send a failed question (manual only). */
  const retry = useCallback(
    (findingId: string, messageId: string) => {
      if (!sessionId) return;
      const key = threadKey(sessionId, findingId);
      const list = threads[key] ?? [];
      const idx = list.findIndex((m) => m.id === messageId);
      const msg = list[idx];
      if (!msg || msg.role !== "lumi" || !msg.error) return;
      patch(key, messageId, { ...msg, pending: true, error: undefined });
      run(key, findingId, msg.question, messageId, completedTurns(list.slice(0, Math.max(0, idx - 1))));
    },
    [sessionId, threads, run, patch],
  );

  /** A suggested question, answered from the recorded data (no AI call). */
  const askRecorded = useCallback(
    (findingId: string, q: LumiQuestionId) => {
      const s = sessionRef.current;
      const finding = s?.findings.find((f) => f.id === findingId);
      if (!s || !finding) return;
      const label = LUMI_QUESTIONS.find((x) => x.id === q)!.label;
      const a = answerQuestion(s, finding, q);
      const key = threadKey(s.id, findingId);
      setThreads((t) => ({
        ...t,
        [key]: [...(t[key] ?? []), { id: nextId(), role: "user", text: label }, { id: nextId(), role: "lumi", kind: "records", text: a.text, sourceLabel: a.source, question: label }],
      }));
    },
    [],
  );

  const busy = useCallback((findingId: string | null) => thread(findingId).some((m) => m.role === "lumi" && m.pending), [thread]);

  return { thread, ask, retry, askRecorded, busy };
}

export type LumiChat = ReturnType<typeof useLumiChat>;

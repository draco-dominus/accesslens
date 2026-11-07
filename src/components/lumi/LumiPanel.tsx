"use client";

import { useEffect, useRef, useState } from "react";
import { answerQuestion, LUMI_QUESTIONS, type LumiQuestionId } from "@/lib/session/lumi";
import { isOpen, type Session, type TrackedFinding } from "@/lib/session/types";
import { Sidekick } from "./Sidekick";
import { Arrow, ChevronLeft, ChevronRight, History, Info, List, People, Question, Scan, Wrench } from "../ui/Icons";
import { Button } from "../ui/primitives";
import { StatusTag } from "../ui/Tags";

/**
 * Ask Lumi — a full-screen conversation about the inspection.
 *
 * Today every reply comes from recorded data (answerQuestion): the suggested questions are answered with
 * the analysis fields and comparison history, each labeled with its source. Nothing is generated.
 *
 * The free-text composer appears only when a real conversation backend is connected through the
 * `conversation` prop (being built separately); this screen never fakes an AI reply.
 */

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "lumi"; text: string; source: string; pending?: boolean; error?: boolean };

/** Contract for the future conversation backend (server-side model call behind our own API route). */
export type LumiConversation = {
  send: (input: { question: string; findingId: string | null; history: ChatMessage[] }, signal: AbortSignal) => Promise<{ text: string; source: string }>;
};

let seq = 0;
const nextId = () => `m${++seq}`;

export function AskLumiScreen({
  session,
  findingId,
  onFindingChange,
  onBack,
  onOpenFinding,
  onScan,
  conversation,
}: {
  session: Session | null;
  findingId: string | null;
  onFindingChange: (id: string) => void;
  onBack: () => void;
  onOpenFinding: (finding: TrackedFinding) => void;
  onScan: () => void;
  conversation?: LumiConversation;
}) {
  const findings = session?.findings ?? [];
  const finding = findings.find((item) => item.id === findingId) ?? [...findings].reverse().find((item) => isOpen(item.status)) ?? findings.at(-1);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 pt-[calc(var(--safe-top)+4px)] pb-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="pressable grid size-11 shrink-0 place-items-center rounded-full border border-glass-line bg-glass shadow-[var(--shadow-soft)] backdrop-blur-xl"
        >
          <ChevronLeft size={19} />
        </button>
        <Sidekick mood={finding ? "ready" : "welcome"} size={38} halo={false} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] leading-tight font-semibold tracking-[-0.02em]">Ask Lumi</h1>
          <p className="text-[12px] leading-tight text-muted">{conversation ? "About this inspection" : "Answers from this inspection’s records"}</p>
        </div>
      </header>

      {finding && session ? (
        <Conversation key={finding.id} session={session} finding={finding} findings={findings} onFindingChange={onFindingChange} onOpenFinding={() => onOpenFinding(finding)} conversation={conversation} />
      ) : (
        <div className="overflow-y-auto px-5 pt-6 pb-[calc(var(--safe-bottom)+18px)]">
          <p className="text-[20px] leading-snug font-semibold">I’m ready when you are.</p>
          <p className="mt-2 text-[16px] leading-relaxed text-muted">Scan an entrance, walkway or room. Once there’s a finding, ask me why it could matter, what might help and what the photo can’t show.</p>
          <Button className="mt-6 w-full" onClick={onScan} icon={<Scan size={19} />}>
            Scan an area
          </Button>
        </div>
      )}
    </div>
  );
}

function Conversation({
  session,
  finding,
  findings,
  onFindingChange,
  onOpenFinding,
  conversation,
}: {
  session: Session;
  finding: TrackedFinding;
  findings: TrackedFinding[];
  onFindingChange: (id: string) => void;
  onOpenFinding: () => void;
  conversation?: LumiConversation;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [asked, setAsked] = useState<LumiQuestionId[]>([]);
  const [draft, setDraft] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => () => inflight.current?.abort(), []);
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [messages.length]);

  const askRecorded = (id: LumiQuestionId) => {
    const q = LUMI_QUESTIONS.find((x) => x.id === id)!;
    const a = answerQuestion(session, finding, id);
    setAsked((v) => [...v, id]);
    setMessages((m) => [...m, { id: nextId(), role: "user", text: q.label }, { id: nextId(), role: "lumi", text: a.text, source: a.source }]);
  };

  const send = async () => {
    const question = draft.trim();
    if (!conversation || !question) return;
    setDraft("");
    const pendingId = nextId();
    const history = messages;
    setMessages((m) => [...m, { id: nextId(), role: "user", text: question }, { id: pendingId, role: "lumi", text: "", source: "", pending: true }]);
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const reply = await conversation.send({ question, findingId: finding.id, history }, ctrl.signal);
      setMessages((m) => m.map((x) => (x.id === pendingId ? { id: pendingId, role: "lumi", text: reply.text, source: reply.source } : x)));
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setMessages((m) => m.map((x) => (x.id === pendingId ? { id: pendingId, role: "lumi", text: "I couldn’t answer that just now. Please try again.", source: "", error: true } : x)));
    }
  };

  const remaining = LUMI_QUESTIONS.filter((q) => !asked.includes(q.id));

  return (
    <>
      <div ref={thread} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
        {findings.length > 1 && (
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-3" role="tablist" aria-label="Choose a finding">
            {findings.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={item.id === finding.id} onClick={() => onFindingChange(item.id)} className={`pressable min-h-10 shrink-0 rounded-full px-3.5 text-[14px] font-semibold ${item.id === finding.id ? "bg-primary text-on-primary" : "bg-surface-2"}`}>
                #{item.number}
              </button>
            ))}
          </div>
        )}

        {/* What we're talking about. */}
        <button type="button" onClick={onOpenFinding} className="pressable flex w-full items-center gap-3 rounded-[20px] bg-surface px-4 py-3 text-left shadow-[var(--shadow-soft)]" aria-label={`Finding ${finding.number}: ${finding.details.title}. Open details`}>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] leading-snug font-semibold">
              #{finding.number} {finding.details.title}
            </span>
            <span className="mt-1 block">
              <StatusTag status={finding.status} />
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-muted" />
        </button>

        <ol className="mt-4 space-y-3" aria-live="polite" aria-label="Conversation">
          <li className="flex items-end gap-2">
            <span aria-hidden className="shrink-0">
              <Sidekick mood="ready" size={28} halo={false} float={false} />
            </span>
            <p className="max-w-[85%] rounded-[20px] rounded-bl-md bg-surface px-4 py-3 text-[16px] leading-relaxed shadow-[var(--shadow-soft)]">
              What would you like to know about this one?
            </p>
          </li>
          {messages.map((m) =>
            m.role === "user" ? (
              <li key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-[20px] rounded-br-md bg-primary px-4 py-2.5 text-[16px] leading-snug text-on-primary">{m.text}</p>
              </li>
            ) : (
              <li key={m.id} className="animate-rise-in flex items-end gap-2">
                <span aria-hidden className="shrink-0">
                  <Sidekick mood={m.pending ? "thinking" : m.error ? "unsure" : "speaking"} size={28} halo={false} float={false} />
                </span>
                <div className="max-w-[85%] rounded-[20px] rounded-bl-md bg-surface px-4 py-3 text-[16px] leading-relaxed shadow-[var(--shadow-soft)]">
                  {m.pending ? <p className="text-muted">Thinking…</p> : <p>{m.text}</p>}
                  {m.source && <p className="mt-1.5 text-[12px] text-muted">{m.source}</p>}
                </div>
              </li>
            ),
          )}
        </ol>
      </div>

      {/* Suggested questions (answered from records) and, when connected, the composer. */}
      <div className="shrink-0 border-t border-line bg-bg px-4 pt-2.5 pb-[calc(var(--safe-bottom)+10px)]">
        {remaining.length > 0 && (
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2" role="group" aria-label="Suggested questions">
            {remaining.map((q) => (
              <button key={q.id} type="button" onClick={() => askRecorded(q.id)} className="pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[14px] font-medium">
                <QuestionIcon name={q.icon} /> {q.label}
              </button>
            ))}
          </div>
        )}
        {conversation && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="lumi-input">
              Ask Lumi a question
            </label>
            <textarea
              id="lumi-input"
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about this inspection…"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-[22px] border border-line bg-surface px-4 py-2.5 text-[16px] leading-snug outline-none focus:border-fg"
            />
            <button type="submit" disabled={!draft.trim()} aria-label="Send" className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-primary text-on-primary disabled:opacity-40">
              <Arrow size={18} />
            </button>
          </form>
        )}
      </div>
    </>
  );
}

function QuestionIcon({ name }: { name: (typeof LUMI_QUESTIONS)[number]["icon"] }) {
  const Icon = name === "people" ? People : name === "wrench" ? Wrench : name === "question" ? Question : name === "history" ? History : name === "list" ? List : Info;
  return <Icon size={15} className="text-muted" />;
}

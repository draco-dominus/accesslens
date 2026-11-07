import { MAX_CHAT_FINDINGS, MAX_CHAT_HISTORY_MESSAGES, MAX_CHAT_QUESTION_LENGTH, type ChatRequest } from "../chat-schema";
import { isOpen, type Session, type TrackedFinding } from "./types";

/**
 * Builds the narrow, bounded /api/chat request from the current session (see docs/chat-api.md).
 * Only validated text fields go out: no photos, scan objects, timestamps, model names or comparison blobs.
 */

/** One finished exchange in the client-side thread. */
export type ChatTurn = { question: string; answer: string };

/** A message in an Ask Lumi thread (see hooks/useLumiChat). */
export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "lumi";
      kind: "ai" | "records";
      text: string;
      /** For records answers: where the text came from. */
      sourceLabel?: string;
      groundedFindingIds?: string[];
      needsOnSiteVerification?: boolean;
      pending?: boolean;
      error?: { message: string; retryable: boolean };
      /** The question this answers (for "Try again"). */
      question: string;
    };

/** Completed question → answer pairs, oldest first, for the bounded history sent with the next question. */
export function completedTurns(thread: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  thread.forEach((m, i) => {
    const prev = thread[i - 1];
    if (m.role === "lumi" && !m.pending && !m.error && prev?.role === "user") turns.push({ question: prev.text, answer: m.text });
  });
  return turns;
}


const clip = (text: string, max: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  return !t ? "Not recorded." : t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

function toChatFinding(f: TrackedFinding): ChatRequest["findings"][number] {
  const d = f.details;
  const who = d.whoMayBeAffected.map((w) => clip(w, 120)).slice(0, 6);
  return {
    id: f.id,
    barrierType: d.barrierType,
    title: clip(d.title, 200),
    visualEvidence: clip(d.visualEvidence, 500),
    whoMayBeAffected: who.length ? who : ["Not recorded."],
    potentialImpact: clip(d.potentialImpact, 500),
    suggestedImprovement: clip(d.suggestedImprovement, 500),
    uncertainty: clip(d.uncertainty, 500),
    confidence: d.confidence,
    status: f.status,
    history: f.history.slice(-6).map((h) => ({ status: h.status, source: h.source, note: clip(h.note, 300) })),
  };
}

/** Which findings to include: the selected one first, then open ones, then the rest — newest first, capped. */
export function chatFindings(s: Session, selectedId: string | null): TrackedFinding[] {
  const rank = (f: TrackedFinding) => (f.id === selectedId ? 0 : isOpen(f.status) ? 1 : 2);
  return [...s.findings].sort((a, b) => rank(a) - rank(b) || b.number - a.number).slice(0, MAX_CHAT_FINDINGS);
}

export function buildChatRequest(s: Session, selectedId: string | null, question: string, turns: ChatTurn[]): ChatRequest | null {
  const findings = chatFindings(s, selectedId);
  if (!findings.length) return null;
  const history = turns
    .slice(-(MAX_CHAT_HISTORY_MESSAGES / 2))
    .flatMap((t) => [
      { role: "user" as const, content: clip(t.question, 600) },
      { role: "assistant" as const, content: clip(t.answer, 600) },
    ]);
  return {
    question: clip(question, MAX_CHAT_QUESTION_LENGTH),
    selectedFindingId: findings.some((f) => f.id === selectedId) ? selectedId! : undefined,
    findings: findings.map(toChatFinding),
    history,
  };
}

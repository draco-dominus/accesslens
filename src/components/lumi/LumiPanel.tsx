"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, LumiChat } from "@/hooks/useLumiChat";
import { MAX_CHAT_QUESTION_LENGTH } from "@/lib/chat-schema";
import { LUMI_QUESTIONS } from "@/lib/session/lumi";
import { isOpen, type Session, type TrackedFinding } from "@/lib/session/types";
import { Sidekick } from "./Sidekick";
import { Arrow, ChevronLeft, ChevronRight, History, Info, List, People, Question, Rescan, Scan, Wrench } from "../ui/Icons";
import { Button } from "../ui/primitives";
import { StatusTag } from "../ui/Tags";

/**
 * Ask Lumi — a full-screen conversation about the inspection.
 *
 * Typed questions are answered by Gemini through /api/chat, grounded only in this inspection's recorded
 * findings (text only; photos are never sent). Suggested questions are answered instantly from the records.
 * Conversations live in useLumiChat (one thread per inspection + finding), so a reply can never land
 * under a different finding or inspection.
 */
export function AskLumiScreen({
  session,
  findingId,
  chat,
  onFindingChange,
  onBack,
  onOpenFinding,
  onScan,
}: {
  session: Session | null;
  findingId: string | null;
  chat: LumiChat;
  onFindingChange: (id: string) => void;
  onBack: () => void;
  onOpenFinding: (finding: TrackedFinding) => void;
  onScan: () => void;
}) {
  const findings = session?.findings ?? [];
  const finding = findings.find((item) => item.id === findingId) ?? [...findings].reverse().find((item) => isOpen(item.status)) ?? findings.at(-1);
  const keyboard = useKeyboardInset();

  return (
    <div className="flex h-full flex-col bg-bg text-fg" style={{ paddingBottom: keyboard }}>
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 pt-[calc(var(--safe-top)+4px)] pb-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="pressable grid size-11 shrink-0 place-items-center rounded-full border border-glass-line bg-glass shadow-[var(--shadow-soft)] backdrop-blur-xl"
        >
          <ChevronLeft size={19} />
        </button>
        <Sidekick mood={finding && chat.busy(finding.id) ? "thinking" : "ready"} size={38} halo={false} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] leading-tight font-semibold tracking-[-0.02em]">Ask Lumi</h1>
          <p className="text-[12px] leading-tight text-muted">Grounded in this inspection</p>
        </div>
      </header>

      {finding && session ? (
        <Conversation
          key={`${session.id}:${finding.id}`}
          session={session}
          finding={finding}
          findings={findings}
          chat={chat}
          keyboardOpen={keyboard > 0}
          onFindingChange={onFindingChange}
          onOpenFinding={onOpenFinding}
        />
      ) : (
        <div className="overflow-y-auto px-5 pt-6 pb-[calc(var(--safe-bottom)+18px)]">
          <p className="text-[20px] leading-snug font-semibold">I’m ready when you are.</p>
          <p className="mt-2 text-[16px] leading-relaxed text-muted">Scan an entrance, walkway or room. Once there’s a finding, ask me anything about it.</p>
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
  chat,
  keyboardOpen,
  onFindingChange,
  onOpenFinding,
}: {
  session: Session;
  finding: TrackedFinding;
  findings: TrackedFinding[];
  chat: LumiChat;
  keyboardOpen: boolean;
  onFindingChange: (id: string) => void;
  onOpenFinding: (finding: TrackedFinding) => void;
}) {
  const messages = chat.thread(finding.id);
  const busy = chat.busy(finding.id);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const asked = new Set(messages.filter((m) => m.role === "user").map((m) => m.text));
  const suggestions = LUMI_QUESTIONS.filter((q) => !asked.has(q.label));
  const last = messages.at(-1);
  const waiting = last?.role === "lumi" && Boolean(last.pending);

  // Keep the newest message in view (new messages, an answer arriving, the keyboard opening).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [messages.length, waiting, keyboardOpen]);

  // Grow the composer with its text (up to its max height).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  const send = () => {
    const q = draft.trim();
    if (!q || busy) return;
    chat.ask(finding.id, q);
    setDraft("");
  };

  return (
    <>
      <div ref={scroller} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
        {findings.length > 1 && (
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-3" role="tablist" aria-label="Choose a finding">
            {findings.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === finding.id}
                aria-label={`Finding ${item.number}: ${item.details.title}`}
                onClick={() => onFindingChange(item.id)}
                className={`pressable min-h-10 shrink-0 rounded-full px-3.5 text-[14px] font-semibold ${item.id === finding.id ? "bg-primary text-on-primary" : "bg-surface-2"}`}
              >
                #{item.number}
              </button>
            ))}
          </div>
        )}

        {/* What we're talking about. */}
        <button type="button" onClick={() => onOpenFinding(finding)} className="pressable flex w-full items-center gap-3 rounded-[20px] bg-surface px-4 py-3 text-left shadow-[var(--shadow-soft)]" aria-label={`Finding ${finding.number}: ${finding.details.title}. Open details`}>
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

        <ol className="mt-5 space-y-4" aria-label="Conversation" aria-live="polite" aria-relevant="additions text">
          <LumiBubble>
            <p>Ask me anything about this finding — why it matters, who it affects, or what to change. I’ll answer from what this inspection recorded.</p>
          </LumiBubble>
          {messages.map((m) =>
            m.role === "user" ? (
              <li key={m.id} className="flex justify-end pl-10">
                <p className="rounded-[22px] rounded-br-md bg-primary px-4 py-2.5 text-[16px] leading-snug break-words whitespace-pre-wrap text-on-primary">{m.text}</p>
              </li>
            ) : (
              <LumiReply key={m.id} m={m} session={session} onRetry={() => chat.retry(finding.id, m.id)} onOpenFinding={onOpenFinding} />
            ),
          )}
        </ol>
      </div>

      {/* Suggested questions (instant, from the records) and the composer. */}
      <div className={`shrink-0 border-t border-line bg-bg px-4 pt-2.5 ${keyboardOpen ? "pb-2.5" : "pb-[calc(var(--safe-bottom)+10px)]"}`}>
        {suggestions.length > 0 && !keyboardOpen && (
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2.5" role="group" aria-label="Suggested questions">
            {suggestions.map((q) => (
              <button key={q.id} type="button" onClick={() => chat.askRecorded(finding.id, q.id)} className="pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[14px] font-medium">
                <QuestionIcon name={q.icon} /> {q.label}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label className="sr-only" htmlFor="lumi-input">
            Ask Lumi a question
          </label>
          <textarea
            id="lumi-input"
            ref={input}
            rows={1}
            value={draft}
            maxLength={MAX_CHAT_QUESTION_LENGTH}
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`Ask about #${finding.number}…`}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-[22px] border border-line bg-surface px-4 py-[10px] text-[16px] leading-snug outline-none placeholder:text-muted focus:border-fg"
          />
          <button type="submit" disabled={!draft.trim() || busy} aria-label={busy ? "Lumi is answering" : "Send"} className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-primary text-on-primary disabled:opacity-35">
            <Arrow size={18} />
          </button>
        </form>
        {draft.length > MAX_CHAT_QUESTION_LENGTH - 80 && (
          <p className="mt-1 text-right text-[12px] text-muted tabular-nums">
            {draft.length}/{MAX_CHAT_QUESTION_LENGTH}
          </p>
        )}
      </div>
    </>
  );
}

function LumiBubble({ children, mood = "ready" }: { children: React.ReactNode; mood?: "ready" | "thinking" | "speaking" | "unsure" }) {
  return (
    <li className="flex items-end gap-2 pr-6">
      <span aria-hidden className="mb-0.5 shrink-0">
        <Sidekick mood={mood} size={28} halo={false} float={false} />
      </span>
      <div className="min-w-0 rounded-[22px] rounded-bl-md bg-surface px-4 py-3 text-[16px] leading-relaxed shadow-[var(--shadow-soft)]">{children}</div>
    </li>
  );
}

function LumiReply({ m, session, onRetry, onOpenFinding }: { m: Extract<ChatMessage, { role: "lumi" }>; session: Session; onRetry: () => void; onOpenFinding: (f: TrackedFinding) => void }) {
  if (m.pending) {
    return (
      <LumiBubble mood="thinking">
        <span className="flex items-center gap-1.5 py-1.5" role="status" aria-label="Lumi is thinking">
          {[0, 1, 2].map((i) => (
            <span key={i} className="typing-dot size-2 rounded-full bg-muted" style={{ animationDelay: `${i * 160}ms` }} />
          ))}
        </span>
      </LumiBubble>
    );
  }
  if (m.error) {
    return (
      <LumiBubble mood="unsure">
        <p>{m.error.message}</p>
        {m.error.retryable && (
          <button type="button" onClick={onRetry} className="pressable mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[14px] font-semibold">
            <Rescan size={15} /> Try again
          </button>
        )}
      </LumiBubble>
    );
  }
  const sources = (m.groundedFindingIds ?? []).map((id) => session.findings.find((f) => f.id === id)).filter((f): f is TrackedFinding => Boolean(f));
  return (
    <LumiBubble mood="speaking">
      <p className="break-words whitespace-pre-wrap">{m.text}</p>
      {m.kind === "records" && m.sourceLabel && <p className="mt-1.5 text-[12px] text-muted">{m.sourceLabel}</p>}
      {m.kind === "ai" && (sources.length > 0 || m.needsOnSiteVerification) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {sources.map((f) => (
            <button key={f.id} type="button" onClick={() => onOpenFinding(f)} className="pressable inline-flex min-h-8 max-w-full items-center rounded-full bg-surface-2 px-2.5 text-[12px] font-semibold" aria-label={`Based on finding ${f.number}: ${f.details.title}. Open details`}>
              <span className="truncate">Based on #{f.number}</span>
            </button>
          ))}
          {m.needsOnSiteVerification && <span className="text-[12px] text-muted">Worth confirming on site</span>}
        </div>
      )}
    </LumiBubble>
  );
}

function QuestionIcon({ name }: { name: (typeof LUMI_QUESTIONS)[number]["icon"] }) {
  const Icon = name === "people" ? People : name === "wrench" ? Wrench : name === "question" ? Question : name === "history" ? History : name === "list" ? List : Info;
  return <Icon size={15} className="text-muted" />;
}

/**
 * Height of the on-screen keyboard (iOS Safari keeps the layout viewport and shrinks the visual one),
 * so the composer stays above it. 0 when no keyboard or no VisualViewport support.
 */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(covered > 80 ? Math.round(covered) : 0); // ignore toolbar wobble
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

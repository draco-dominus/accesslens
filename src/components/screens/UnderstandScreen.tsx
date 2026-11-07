"use client";

import { useEffect, useRef, useState } from "react";
import type { useWalkthrough } from "@/hooks/useWalkthrough";
import { progressLine, STATUS_LABEL } from "@/lib/session/lumi";
import { isOpen, type Session, type TrackedFinding } from "@/lib/session/types";
import { Sidekick } from "../lumi/Sidekick";
import { Pin } from "../ui/Icons";
import { StatusTag } from "../ui/Tags";

type Walkthrough = ReturnType<typeof useWalkthrough>;
type Msg = { id: number; from: "lumi" | "you"; text: string };

/**
 * Understand (adapted from the prototype's Ask screen). Lumi answers ONLY from what's recorded for this
 * finding — the AI analysis fields and the comparison history. There is no free-form chat yet, so
 * nothing here is generated on the fly or invented.
 */
const QUESTIONS = [
  { id: "why", label: "Why could it matter?" },
  { id: "who", label: "Who might be affected?" },
  { id: "fix", label: "What could help?" },
  { id: "unknown", label: "What can’t you tell?" },
  { id: "changed", label: "Has it changed?" },
  { id: "next", label: "What’s still open?" },
] as const;
type QuestionId = (typeof QUESTIONS)[number]["id"];

function scanNo(s: Session, id: string) {
  return s.scans.find((sc) => sc.id === id)?.number ?? "?";
}

function answer(s: Session, f: TrackedFinding, q: QuestionId): string {
  const d = f.details;
  switch (q) {
    case "why":
      return d.potentialImpact;
    case "who":
      return `It could affect ${d.whoMayBeAffected.join(", ")}.`;
    case "fix":
      return d.suggestedImprovement;
    case "unknown": {
      const scan = s.scans.find((sc) => sc.id === f.firstScanId);
      return `${d.uncertainty}${scan?.analysis?.limitations ? ` More generally: ${scan.analysis.limitations}` : ""}`;
    }
    case "changed": {
      if (f.history.length < 2)
        return `I’ve only seen this in scan ${scanNo(s, f.firstScanId)} so far. Take another photo from the same spot and I’ll compare the two.`;
      const steps = f.history.slice(1).map((h) => `Scan ${scanNo(s, h.scanId)}: ${STATUS_LABEL[h.status].toLowerCase()}. ${h.note}`);
      return `${steps.join(" ")}${f.status === "appears_improved" ? " Please confirm it in person." : ""}`;
    }
    case "next": {
      const open = s.findings.filter((x) => isOpen(x.status) && x.id !== f.id);
      return open.length
        ? `${progressLine(s)} Other open concerns: ${open.map((x) => `#${x.number} ${x.details.title}`).join("; ")}.`
        : `${progressLine(s)} There are no other open concerns right now.`;
    }
  }
}

export function UnderstandScreen({
  wt,
  findingId,
  onOpenScan,
  onPickFinding,
}: {
  wt: Walkthrough;
  findingId: string;
  onOpenScan: (scanId: string, findingId?: string) => void;
  onPickFinding: (id: string) => void;
}) {
  const session = wt.session!;
  const finding = session.findings.find((f) => f.id === findingId) ?? session.findings[0];
  const d = finding.details;
  const thumb = wt.media[finding.lastSeenScanId]?.thumbUrl ?? wt.media[finding.lastSeenScanId]?.imageUrl;
  const nextId = useRef(2);
  const [messages, setMessages] = useState<Msg[]>(() => [
    {
      id: 1,
      from: "lumi",
      text: `In scan ${scanNo(session, finding.firstScanId)}, I noticed ${d.title.charAt(0).toLowerCase()}${d.title.slice(1)} (${d.locationInImage}). ${d.visualEvidence}`,
    },
  ]);
  const [asked, setAsked] = useState<QuestionId[]>([]);
  const [talking, setTalking] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
    const t = setTimeout(() => setTalking(false), 1600);
    return () => clearTimeout(t);
  }, [messages]);

  const ask = (q: (typeof QUESTIONS)[number]) => {
    setAsked((a) => [...a, q.id]);
    setTalking(true);
    setMessages((m) => [
      ...m,
      { id: nextId.current++, from: "you", text: q.label },
      { id: nextId.current++, from: "lumi", text: answer(session, finding, q.id) },
    ]);
  };

  return (
    <div className="flex h-full flex-col bg-bg pt-[calc(var(--safe-top)+62px)] text-fg">
      {/* Finding header */}
      <div className="px-4">
        <button
          type="button"
          onClick={() => onOpenScan(finding.lastSeenScanId, finding.id)}
          className="pressable flex w-full items-center gap-3 rounded-[22px] bg-surface p-2.5 pr-4 text-left shadow-[var(--shadow-soft)]"
        >
          <span className="relative size-14 shrink-0 overflow-hidden rounded-[16px] bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
            {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : <Pin size={20} className="m-auto mt-4 text-muted" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold tracking-[-0.01em]">
              #{finding.number} {d.title}
            </span>
            <span className="mt-1 flex">
              <StatusTag status={finding.status} />
            </span>
          </span>
        </button>
        {session.findings.length > 1 && (
          <div className="no-scrollbar -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Choose a finding">
            {session.findings.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={f.id === finding.id}
                onClick={() => onPickFinding(f.id)}
                className={`pressable min-h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold ${f.id === finding.id ? "bg-primary text-on-primary" : "bg-surface-2 text-fg"}`}
              >
                #{f.number}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Conversation */}
      <div ref={scroller} className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.map((m, i) =>
          m.from === "lumi" ? (
            <div key={m.id} className="animate-rise-in flex items-end gap-2.5">
              <Sidekick mood={talking && i === messages.length - 1 ? "speaking" : "idle"} size={34} halo={false} />
              <p className="max-w-[82%] rounded-[22px] rounded-bl-[8px] bg-surface px-4 py-3 text-[16px] leading-[1.45] shadow-[var(--shadow-soft)]">{m.text}</p>
            </div>
          ) : (
            <div key={m.id} className="animate-rise-in flex justify-end">
              <p className="max-w-[80%] rounded-[22px] rounded-br-[8px] bg-primary px-4 py-2.5 text-[16px] leading-snug text-on-primary">{m.text}</p>
            </div>
          ),
        )}
      </div>

      {/* Questions */}
      <div className="border-t border-line bg-[var(--sheet)] px-4 pt-3 pb-[calc(var(--safe-bottom)+10px)] backdrop-blur-2xl">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ask Lumi">
          {QUESTIONS.filter((q) => !asked.includes(q.id)).map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => ask(q)}
              className="pressable min-h-11 rounded-full border border-line bg-surface-2 px-4 text-[15px] font-medium text-fg"
            >
              {q.label}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-center text-[12px] leading-snug text-muted">Lumi answers from its notes on your scans. Check details in person.</p>
      </div>
    </div>
  );
}

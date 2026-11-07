"use client";

import { useEffect, useRef, useState } from "react";
import { answerQuestion, LUMI_QUESTIONS, progressLine, type LumiQuestionId } from "@/lib/session/lumi";
import { isOpen, type Session, type TrackedFinding } from "@/lib/session/types";
import { Sidekick } from "./Sidekick";
import { Close, History, Info, List, People, Pin, Question, Scan, Wrench } from "../ui/Icons";
import { Button, IridescentEdge } from "../ui/primitives";
import { StatusTag } from "../ui/Tags";

export function LumiPanel({
  open,
  session,
  findingId,
  onFindingChange,
  onClose,
  onOpenFinding,
  onScan,
}: {
  open: boolean;
  session: Session | null;
  findingId: string | null;
  onFindingChange: (id: string) => void;
  onClose: () => void;
  onOpenFinding: (finding: TrackedFinding) => void;
  onScan: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const findings = session?.findings ?? [];
  const finding = findings.find((item) => item.id === findingId) ?? [...findings].reverse().find((item) => isOpen(item.status)) ?? findings.at(-1);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  return (
    <>
      <div aria-hidden onClick={onClose} className={`absolute inset-0 z-[70] bg-black/40 transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Ask Lumi"
        tabIndex={-1}
        inert={!open}
        className={`absolute inset-x-2 bottom-2 z-[71] flex max-h-[88%] flex-col overflow-hidden rounded-[34px] border border-glass-line bg-[var(--sheet)] text-fg shadow-[var(--shadow-float)] outline-none transition-[transform,opacity] duration-[480ms] ease-[var(--ease-ios)] ${open ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-0"}`}
      >
        <div className="relative flex shrink-0 items-center gap-3 px-4 pt-4 pb-3">
          <IridescentEdge active={open} ring={1.25} bloom={8} speed={7} />
          <Sidekick mood={finding ? "ready" : "welcome"} size={46} halo={Boolean(finding)} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Ask Lumi</h2>
            <p className="text-[13px] leading-snug text-muted">Grounded in this inspection—nothing new is generated.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Ask Lumi" className="pressable grid size-11 place-items-center rounded-full bg-surface-2 text-muted">
            <Close size={18} />
          </button>
        </div>

        {finding && session ? (
          <AskFinding key={finding.id} session={session} finding={finding} findings={findings} onFindingChange={onFindingChange} onOpenFinding={() => onOpenFinding(finding)} />
        ) : (
          <div className="overflow-y-auto px-5 pt-3 pb-[calc(var(--safe-bottom)+18px)]">
            <p className="text-[18px] leading-snug font-semibold">I’m ready when you are.</p>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">Take a photo of an entrance, walkway or room. Once there’s a finding, I can explain why it could matter, what might help and what the photo cannot confirm.</p>
            <Button className="mt-5 w-full" onClick={onScan} icon={<Scan size={19} />}>
              Start scanning
            </Button>
          </div>
        )}
      </section>
    </>
  );
}

function AskFinding({
  session,
  finding,
  findings,
  onFindingChange,
  onOpenFinding,
}: {
  session: Session;
  finding: TrackedFinding;
  findings: TrackedFinding[];
  onFindingChange: (id: string) => void;
  onOpenFinding: () => void;
}) {
  const [asked, setAsked] = useState<LumiQuestionId[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const firstScan = session.scans.find((scan) => scan.id === finding.firstScanId)?.number ?? "?";
  const nextStep = finding.status === "appears_improved"
    ? "The photos suggest an improvement. Confirm the change and the surrounding route in person."
    : finding.status === "needs_verification"
      ? "The photos were not conclusive. Re-check from the same position or verify the concern in person."
      : finding.details.suggestedImprovement;

  useEffect(() => {
    if (!speaking) return;
    const timer = window.setTimeout(() => setSpeaking(false), 1200);
    return () => window.clearTimeout(timer);
  }, [speaking]);

  return (
    <div className="no-scrollbar min-h-0 overflow-y-auto overscroll-contain px-4 pb-[calc(var(--safe-bottom)+16px)] [-webkit-overflow-scrolling:touch]">
      {findings.length > 1 && (
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2" role="tablist" aria-label="Choose a finding">
          {findings.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={item.id === finding.id} onClick={() => onFindingChange(item.id)} className={`pressable min-h-10 shrink-0 rounded-full px-3.5 text-[14px] font-semibold ${item.id === finding.id ? "bg-primary text-on-primary" : "bg-surface-2"}`}>
              #{item.number}
            </button>
          ))}
        </div>
      )}

      <div className="mt-1 rounded-[22px] bg-surface p-4 shadow-[var(--shadow-soft)]">
        <div className="flex items-start gap-3">
          <Sidekick mood={speaking ? "speaking" : finding.status === "appears_improved" ? "happy" : finding.status === "needs_verification" ? "unsure" : "ready"} size={38} halo={speaking} />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold">#{finding.number} {finding.details.title}</p>
            <div className="mt-1"><StatusTag status={finding.status} /></div>
          </div>
          <button type="button" onClick={onOpenFinding} aria-label={`View finding ${finding.number} in its photo`} className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
            <Pin size={18} />
          </button>
        </div>
        <p className="mt-3 text-[12px] font-semibold text-muted">Original observation from scan {firstScan}</p>
        <p className="mt-1 text-[15px] leading-relaxed">{finding.details.visualEvidence}</p>
        <p className="mt-3 text-[13px] font-semibold text-muted">Suggested next step</p>
        <p className="mt-1 text-[15px] leading-relaxed">{nextStep}</p>
        <p className="mt-2 text-[12px] text-muted">{progressLine(session)}</p>
      </div>

      <ol className="mt-3 space-y-2.5" aria-live="polite">
        {asked.map((id) => {
          const question = LUMI_QUESTIONS.find((item) => item.id === id)!;
          const answer = answerQuestion(session, finding, id);
          return (
            <li key={id} className="animate-rise-in">
              <p className="text-right text-[13px] font-semibold text-muted">{question.label}</p>
              <div className="mt-1 rounded-[18px] bg-surface px-4 py-3 text-[15px] leading-relaxed shadow-[var(--shadow-soft)]">
                <p>{answer.text}</p>
                <p className="mt-1.5 text-[12px] text-muted">{answer.source}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Questions for Lumi">
        {LUMI_QUESTIONS.filter((question) => !asked.includes(question.id)).map((question) => (
          <button key={question.id} type="button" onClick={() => { setAsked((value) => [...value, question.id]); setSpeaking(true); }} className="pressable inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[14px] font-medium">
            <QuestionIcon name={question.icon} /> {question.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuestionIcon({ name }: { name: (typeof LUMI_QUESTIONS)[number]["icon"] }) {
  const Icon = name === "people" ? People : name === "wrench" ? Wrench : name === "question" ? Question : name === "history" ? History : name === "list" ? List : Info;
  return <Icon size={15} className="text-muted" />;
}

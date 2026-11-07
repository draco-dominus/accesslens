"use client";

import { useEffect, useState } from "react";
import { answerQuestion, LUMI_QUESTIONS, progressLine, type LumiQuestionId } from "@/lib/session/lumi";
import { isOpen, type Session, type TrackedFinding } from "@/lib/session/types";
import { Sidekick } from "./Sidekick";
import { ChevronLeft, History, Info, List, People, Pin, Question, Scan, Wrench } from "../ui/Icons";
import { Button, IridescentEdge } from "../ui/primitives";
import { StatusTag } from "../ui/Tags";

/**
 * Ask Lumi — its own destination (not a sheet). Answers come only from recorded finding data via
 * answerQuestion(); nothing new is generated. Back returns to wherever the user came from.
 */
export function AskLumiScreen({
  session,
  findingId,
  onFindingChange,
  onBack,
  onOpenFinding,
  onScan,
}: {
  session: Session | null;
  findingId: string | null;
  onFindingChange: (id: string) => void;
  onBack: () => void;
  onOpenFinding: (finding: TrackedFinding) => void;
  onScan: () => void;
}) {
  const findings = session?.findings ?? [];
  const finding = findings.find((item) => item.id === findingId) ?? [...findings].reverse().find((item) => isOpen(item.status)) ?? findings.at(-1);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <header className="relative flex shrink-0 items-center gap-3 px-4 pt-[calc(var(--safe-top)+4px)] pb-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="pressable grid size-11 shrink-0 place-items-center rounded-full border border-glass-line bg-glass shadow-[var(--shadow-soft)] backdrop-blur-xl"
        >
          <ChevronLeft size={19} />
        </button>
        <div className="relative">
          <Sidekick mood={finding ? "ready" : "welcome"} size={42} halo={Boolean(finding)} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Ask Lumi</h1>
          <p className="text-[13px] leading-snug text-muted">Grounded in this inspection. Nothing new is generated.</p>
        </div>
      </header>
      <div className="relative mx-4 h-px shrink-0 overflow-hidden rounded-full">
        <IridescentEdge active ring={1} bloom={6} speed={8} inner={false} />
      </div>

      {finding && session ? (
        <AskFinding key={finding.id} session={session} finding={finding} findings={findings} onFindingChange={onFindingChange} onOpenFinding={() => onOpenFinding(finding)} />
      ) : (
        <div className="overflow-y-auto px-5 pt-5 pb-[calc(var(--safe-bottom)+18px)]">
          <p className="text-[18px] leading-snug font-semibold">I’m ready when you are.</p>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">Take a photo of an entrance, walkway or room. Once there’s a finding, I can explain why it could matter, what might help and what the photo can’t confirm.</p>
          <Button className="mt-5 w-full" onClick={onScan} icon={<Scan size={19} />}>
            Start scanning
          </Button>
        </div>
      )}
    </div>
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
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[calc(var(--safe-bottom)+16px)] [-webkit-overflow-scrolling:touch]">
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
          <button type="button" onClick={onOpenFinding} aria-label={`Open finding ${finding.number} details`} className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
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

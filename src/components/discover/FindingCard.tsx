"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { useWalkthrough } from "@/hooks/useWalkthrough";
import { answerQuestion, findingCaptionForScan, LUMI_QUESTIONS, STATUS_LABEL, type LumiQuestionId } from "@/lib/session/lumi";
import type { FindingEvent, TrackedFinding } from "@/lib/session/types";
import { firstSentence, isWhole } from "@/lib/text";
import { Sidekick, type LumiMood } from "../lumi/Sidekick";
import { BeforeAfter } from "../ui/BeforeAfter";
import { Chat, ChevronDown, Close, Compare, Eye, History as HistoryIcon, Info, Layers, List, People, Question, Scan, Wrench } from "../ui/Icons";
import { activeMood, IridescentEdge } from "../ui/primitives";
import { barrierTypeLabel, StatusTag } from "../ui/Tags";

type Walkthrough = ReturnType<typeof useWalkthrough>;

/**
 * A finding with progressive disclosure, built only from validated AI output and recorded history:
 *   1. summary row — number, title, where, status
 *   2. key facts — what Lumi saw (+ Show in photo), who may be affected, what could help, actions
 *   3. detail rows — full text, what a photo can't tell, status across scans, comparison evidence
 * Ask Lumi opens inside the card, so the photo and the evidence stay in context.
 */
export function FindingCard({
  wt,
  finding,
  role,
  scanId,
  open,
  asking,
  onToggle,
  onAskChange,
  onShowInPhoto,
  onRecheck,
}: {
  wt: Walkthrough;
  finding: TrackedFinding;
  role: "new" | "updated";
  scanId: string;
  open: boolean;
  asking: boolean;
  onToggle: () => void;
  onAskChange: (on: boolean) => void;
  onShowInPhoto?: () => void;
  /** Present when the finding is open and its latest photo is available for Line up. */
  onRecheck?: () => void;
}) {
  const d = finding.details;
  const regionId = useId();
  const event = finding.history.filter((h) => h.scanId === scanId).at(-1);
  const comparison = event?.comparison ? event : undefined;
  const subtitle = role === "updated" && event ? firstSentence(event.note) : d.locationInImage;
  const photoEvidence = findingCaptionForScan(wt.session!, scanId, finding);

  return (
    <article className={`overflow-hidden rounded-[24px] bg-surface transition-shadow duration-300 ${open ? "shadow-[var(--shadow-float)]" : "shadow-[var(--shadow-soft)]"}`}>
      {/* Level 1 */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={regionId}
        className="flex min-h-[64px] w-full items-start gap-3 px-4 py-3.5 text-left"
      >
        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-[15px] font-bold transition-colors ${open ? "bg-primary text-on-primary" : "bg-surface-2 text-fg"}`}>
          {finding.number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] leading-snug font-semibold tracking-[-0.015em]">{d.title}</span>
          <span className="mt-0.5 line-clamp-1 block text-[14px] leading-snug text-muted">{subtitle}</span>
          <span className="mt-2 flex flex-wrap gap-1.5">
            <StatusTag status={finding.status} />
          </span>
        </span>
        <ChevronDown size={20} className={`mt-1.5 shrink-0 text-muted transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>

      {role === "new" && <DuplicatePrompt wt={wt} scanId={scanId} findingId={finding.id} />}

      <div
        id={regionId}
        role="region"
        aria-label={`Finding ${finding.number} details`}
        className={`grid transition-[grid-template-rows] duration-[480ms] ease-[var(--ease-ios)] ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mx-4 border-t border-line pt-3.5 pb-4">
            {/* Level 2: key facts */}
            {comparison && <ComparisonSummary wt={wt} finding={finding} event={comparison} />}

            <Fact icon={<Eye size={17} />} label={role === "updated" ? "Evidence in this photo" : "What Lumi saw"}>
              <p>{photoEvidence?.text ?? firstSentence(d.visualEvidence)}</p>
              {onShowInPhoto && (
                <button
                  type="button"
                  onClick={onShowInPhoto}
                  className="pressable mt-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-semibold"
                >
                  <Scan size={15} /> Show in photo
                </button>
              )}
            </Fact>

            <Fact icon={<People size={17} />} label="Who may be affected">
              <ul className="mt-0.5 flex flex-wrap gap-1.5">
                {d.whoMayBeAffected.map((w) => (
                  <li key={w} className="rounded-full bg-surface-2 px-2.5 py-1 text-[13px] leading-none font-medium">
                    {w}
                  </li>
                ))}
              </ul>
            </Fact>

            <Fact icon={<Wrench size={17} />} label="What could help">
              <p>{firstSentence(d.suggestedImprovement)}</p>
            </Fact>

            {/* Actions */}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => onAskChange(!asking)}
                aria-expanded={asking}
                className="pressable relative flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-on-primary"
              >
                <Chat size={17} /> Ask Lumi
              </button>
              {onRecheck && (
                <button
                  type="button"
                  onClick={onRecheck}
                  className="pressable flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-surface-2 text-[15px] font-semibold"
                >
                  <Layers size={17} /> Re-check spot
                </button>
              )}
            </div>

            {asking && <AskLumi wt={wt} finding={finding} onClose={() => onAskChange(false)} />}

            {/* Level 3: detail rows */}
            <div className="mt-3 divide-y divide-line rounded-[18px] bg-surface-2/60">
              {comparison && (
                <Disclosure icon={<Compare size={17} />} label="Comparison details">
                  <ComparisonDetails wt={wt} finding={finding} event={comparison} />
                </Disclosure>
              )}
              {!isWhole(d.visualEvidence) && (
                <Disclosure icon={<Eye size={17} />} label={role === "updated" ? "Original observation" : "Everything Lumi saw"}>
                  {role === "updated" && <p className="mb-1 text-[13px] font-semibold text-muted">From scan {wt.session!.scans.find((sc) => sc.id === finding.firstScanId)?.number ?? "?"}</p>}
                  <p>{d.visualEvidence}</p>
                </Disclosure>
              )}
              <Disclosure icon={<Info size={17} />} label="Why it matters">
                <p>{d.potentialImpact}</p>
              </Disclosure>
              {!isWhole(d.suggestedImprovement) && (
                <Disclosure icon={<Wrench size={17} />} label="Suggested actions">
                  <p>{d.suggestedImprovement}</p>
                </Disclosure>
              )}
              <Disclosure icon={<Question size={17} />} label="What a photo can’t tell">
                <p>{d.uncertainty}</p>
              </Disclosure>
              {finding.history.length > 1 && (
                <Disclosure icon={<HistoryIcon size={17} />} label="Across your scans">
                  <History wt={wt} finding={finding} />
                </Disclosure>
              )}
            </div>
            <p className="mt-2.5 px-1 text-[12px] leading-snug text-muted">
              {barrierTypeLabel(d.barrierType)} · Lumi rated its own confidence {d.confidence}. AI observations: please check in person.
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="mt-2.5 flex gap-3 first:mt-0">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-[15px] leading-snug">
        <p className="text-[13px] font-semibold text-muted">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function Disclosure({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-12 w-full items-center gap-3 px-3.5 text-left text-[15px] font-semibold"
      >
        <span className="text-muted" aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronDown size={18} className={`shrink-0 text-muted transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={id} className={`grid transition-[grid-template-rows] duration-[420ms] ease-[var(--ease-ios)] ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} inert={!open}>
        <div className="min-h-0 overflow-hidden">
          <div className="px-3.5 pb-3.5 text-[15px] leading-[1.5]">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Ask Lumi (inline, grounded) ---------- */

const QUESTION_ICON: Record<(typeof LUMI_QUESTIONS)[number]["icon"], ReactNode> = {
  spark: <Info size={15} />,
  people: <People size={15} />,
  wrench: <Wrench size={15} />,
  question: <Question size={15} />,
  history: <HistoryIcon size={15} />,
  list: <List size={15} />,
};

function AskLumi({ wt, finding, onClose }: { wt: Walkthrough; finding: TrackedFinding; onClose: () => void }) {
  const session = wt.session!;
  const [asked, setAsked] = useState<LumiQuestionId[]>([]);
  const firstChip = useRef<HTMLButtonElement>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    firstChip.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!speaking) return;
    const t = setTimeout(() => setSpeaking(false), 1400);
    return () => clearTimeout(t);
  }, [speaking]);

  const remaining = LUMI_QUESTIONS.filter((q) => !asked.includes(q.id));
  return (
    <section aria-label={`Ask Lumi about finding ${finding.number}`} className="animate-rise-in relative mt-3 rounded-[22px]">
      <IridescentEdge active ring={1} bloom={8} speed={7} />
      <div className="relative rounded-[22px] border border-glass-line bg-glass-strong p-3 backdrop-blur-2xl">
        <div className="flex items-center gap-2">
          <Sidekick mood={speaking ? "speaking" : "ready"} size={30} halo={false} />
          <p className="min-w-0 flex-1 text-[14px] font-semibold">Ask Lumi about #{finding.number}</p>
          <button type="button" onClick={onClose} aria-label="Close Ask Lumi" className="pressable grid size-11 place-items-center rounded-full text-muted">
            <Close size={17} />
          </button>
        </div>

        <ol className="mt-1 space-y-2.5" aria-live="polite">
          {asked.map((id) => {
            const q = LUMI_QUESTIONS.find((x) => x.id === id)!;
            const a = answerQuestion(session, finding, id);
            return (
              <li key={id} className="animate-rise-in">
                <p className="text-right text-[13px] font-semibold text-muted">{q.label}</p>
                <div className="mt-1 rounded-[16px] bg-surface px-3.5 py-2.5 text-[15px] leading-[1.45] shadow-[var(--shadow-soft)]">
                  <p>{a.text}</p>
                  <p className="mt-1.5 text-[12px] text-muted">{a.source}</p>
                </div>
              </li>
            );
          })}
        </ol>

        {remaining.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Questions">
            {remaining.map((q, i) => (
              <button
                key={q.id}
                ref={i === 0 ? firstChip : undefined}
                type="button"
                onClick={() => {
                  setAsked((a) => [...a, q.id]);
                  setSpeaking(true);
                }}
                className="pressable inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[14px] font-medium"
              >
                <span className="text-muted" aria-hidden>
                  {QUESTION_ICON[q.icon]}
                </span>
                {q.label}
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11.5px] leading-snug text-muted">Answers come from Lumi’s notes on your scans. Nothing new is generated.</p>
      </div>
    </section>
  );
}

/* ---------- Comparison evidence ---------- */

function comparisonPhotos(wt: Walkthrough, finding: TrackedFinding, event: FindingEvent) {
  const session = wt.session!;
  const recorded = session.scans.find((s) => s.id === event.scanId)?.events.find((e) => e.kind === "status_change" && e.findingId === finding.id);
  const previous = [...finding.history].reverse().find((h) => h.scanId !== event.scanId && h.status !== "appears_improved");
  const beforeScanId =
    event.referenceScanId ?? (recorded && recorded.kind === "status_change" ? recorded.referenceScanId : (previous?.scanId ?? finding.firstScanId));
  return {
    beforeScan: session.scans.find((s) => s.id === beforeScanId),
    nowScan: session.scans.find((s) => s.id === event.scanId),
    beforeUrl: wt.media[beforeScanId]?.imageUrl ?? wt.media[beforeScanId]?.thumbUrl,
    nowUrl: wt.media[event.scanId]?.imageUrl ?? wt.media[event.scanId]?.thumbUrl,
  };
}

/** Level 2: one line on what the comparison found, with Lumi's matching mood. */
function ComparisonSummary({ wt, finding, event }: { wt: Walkthrough; finding: TrackedFinding; event: FindingEvent }) {
  const { beforeScan } = comparisonPhotos(wt, finding, event);
  const mood: LumiMood = event.status === "appears_improved" ? "happy" : event.status === "needs_verification" ? "unsure" : "concerned";
  return (
    <div className="mb-3 flex gap-3 rounded-[18px] bg-surface-2/70 p-3">
      <Sidekick mood={mood} size={36} halo={activeMood(mood)} />
      <div className="min-w-0 flex-1 text-[15px] leading-snug">
        <p className="text-[13px] font-semibold text-muted">
          Compared with scan {beforeScan?.number ?? "?"} · {STATUS_LABEL[event.status]}
        </p>
        <p className="mt-0.5">{firstSentence(event.comparison!.observedChange)}</p>
        {event.guardrail && <p className="mt-1 text-[13px] text-muted">Why I’m not sure: {event.guardrail.reasons[0]}</p>}
      </div>
    </div>
  );
}

/** Level 3: the full comparison evidence and the before/after slider. */
function ComparisonDetails({ wt, finding, event }: { wt: Walkthrough; finding: TrackedFinding; event: FindingEvent }) {
  const c = event.comparison!;
  const { beforeScan, nowScan, beforeUrl, nowUrl } = comparisonPhotos(wt, finding, event);
  return (
    <div>
      <p>{c.observedChange}</p>
      {event.guardrail && (
        <div className="mt-2 rounded-2xl bg-[color-mix(in_srgb,var(--color-caution)_12%,transparent)] px-3 py-2 text-[14px] leading-snug">
          <p className="font-semibold">Why I’m not sure</p>
          <ul className="mt-1 list-disc pl-5">
            {event.guardrail.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[14px] font-semibold">What the photos show</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[15px] leading-snug">
        {c.visualEvidence.map((v) => (
          <li key={v}>{v}</li>
        ))}
      </ul>
      <p className="mt-3 text-[14px] font-semibold">Still uncertain</p>
      <p className="mt-1 text-[15px] leading-snug">{c.remainingUncertainty}</p>
      {event.status === "appears_improved" && (
        <p className="mt-2 text-[13px] leading-snug text-muted">This barrier looks better in these photos. Confirm it in person; it doesn’t mean the whole space is accessible.</p>
      )}
      {beforeUrl && nowUrl && (
        <div className="mt-4">
          <BeforeAfter earlier={beforeUrl} later={nowUrl} earlierLabel={`Scan ${beforeScan?.number}, earlier`} laterLabel={`Scan ${nowScan?.number}, now`} />
        </div>
      )}
    </div>
  );
}

/** Status across scans, from the finding's recorded history. */
export function History({ wt, finding }: { wt: Walkthrough; finding: TrackedFinding }) {
  const session = wt.session!;
  return (
    <ol className="space-y-2 border-l border-line pl-4">
      {finding.history.map((h, i) => {
        const sc = session.scans.find((s) => s.id === h.scanId);
        return (
          <li key={i} className="relative text-[14px] leading-snug">
            <span aria-hidden className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface bg-fg" />
            <span className="font-semibold">Scan {sc?.number}</span> · <StatusTag status={h.status} />
            {i > 0 && <span className="mt-1 block text-muted">{h.note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Explicit, per-finding duplicate confirmation. Offered only for pairs the engine considers plausible
 * (same type as an earlier finding that a comparison in this scan found still present); never automatic.
 */
function DuplicatePrompt({ wt, scanId, findingId }: { wt: Walkthrough; scanId: string; findingId: string }) {
  const session = wt.session!;
  const pairs = wt.duplicateSuggestions(scanId).filter((p) => p.newFindingId === findingId);
  if (!pairs.length) return null;
  return (
    <div className="mx-4 mb-3 rounded-2xl bg-surface-2 px-3 py-2.5" role="group" aria-label="Possible duplicate">
      <p className="text-[14px] leading-snug">Could this be a barrier we already recorded?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {pairs.map((p) => {
          const existing = session.findings.find((f) => f.id === p.existingFindingId);
          if (!existing) return null;
          return (
            <button
              key={p.existingFindingId}
              type="button"
              onClick={() => wt.confirmDuplicate(scanId, findingId, p.existingFindingId)}
              className="pressable min-h-11 rounded-full border border-line bg-surface px-4 text-[14px] font-semibold"
            >
              Same as #{existing.number} {existing.details.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

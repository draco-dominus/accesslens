"use client";

import { useEffect, useRef, useState } from "react";
import type { useWalkthrough } from "@/hooks/useWalkthrough";
import { accessibilityNeeds, NEED_LABEL } from "@/lib/session/categories";
import { isOpen, type TrackedFinding } from "@/lib/session/types";
import { firstSentence, isWhole } from "@/lib/text";
import { ComparisonEvidence, Disclosure, DuplicatePrompt, History, latestComparison } from "../discover/FindingParts";
import { Sidekick } from "../lumi/Sidekick";
import { TrustSheet } from "../trust/TrustPanel";
import { areaOf } from "@/lib/session/areas";
import { spatialBoxes } from "@/lib/spatial";
import { PhotoViewer, ScanPhoto } from "../discover/PhotoStage";
import { Chat, ChevronLeft, Compare, Eye, History as HistoryIcon, Info, Layers, Question, Wrench } from "../ui/Icons";
import { BarrierIcon, NeedIcon } from "../ui/Needs";
import { Button, GlassIconButton } from "../ui/primitives";
import { barrierTypeLabel, StatusTag } from "../ui/Tags";

type Walkthrough = ReturnType<typeof useWalkthrough>;

/**
 * Finding Details, visual-first: the photo, the issue, who it may affect, and ONE suggested action up front.
 * Everything else (evidence, impact, uncertainty, before/after, history) sits in clearly labeled
 * sections that start collapsed. Every line comes from recorded data; nothing is generated to fill space.
 */
export function FindingDetailScreen({
  wt,
  finding,
  scanId,
  section,
  onBack,
  onAsk,
  onRecheck,
}: {
  wt: Walkthrough;
  finding: TrackedFinding;
  /** The scan whose photo the user came from (its photo heads this page). */
  scanId: string;
  /** Open with this section expanded and in view (after a re-check: the before/after comparison). */
  section?: "compare";
  onBack: () => void;
  onAsk: () => void;
  onRecheck?: () => void;
}) {
  const session = wt.session!;
  const d = finding.details;
  const scan = session.scans.find((s) => s.id === scanId);
  const photo = wt.media[scanId]?.imageUrl ?? wt.media[scanId]?.thumbUrl;
  const comparison = latestComparison(finding);
  const here = finding.history.filter((h) => h.scanId === scanId).at(-1);
  const scanNo = (id: string) => session.scans.find((s) => s.id === id)?.number ?? "?";
  const needs = accessibilityNeeds(d.whoMayBeAffected);
  const action = firstSentence(d.suggestedImprovement);
  const [trustOpen, setTrustOpen] = useState(false);
  const [viewer, setViewer] = useState(false);
  const area = areaOf(session, scanId);
  const markers = spatialBoxes(d).map((box) => ({ number: finding.number, box }));
  const alt = `Area ${area?.number ?? "?"}, scan ${scan?.number ?? "?"}${scan?.analysis ? `: ${scan.analysis.sceneSummary}` : ""}`;
  const scroller = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);

  // Arriving from a re-check: bring the (already expanded) before/after into view — this page only.
  useEffect(() => {
    if (section !== "compare") return;
    const t = window.setTimeout(() => {
      const box = scroller.current, target = compareRef.current;
      if (!box || !target) return;
      const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 72;
      box.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, 350);
    return () => window.clearTimeout(t);
  }, [section]);

  return (
    <div className="relative h-full bg-bg text-fg">
      <div ref={scroller} className="no-scrollbar h-full overflow-y-auto overscroll-contain pb-[calc(var(--safe-bottom)+96px)]">
        <header className="sticky top-0 z-10 flex items-center gap-2 bg-[linear-gradient(to_bottom,var(--bg)_70%,transparent)] px-4 pt-[calc(var(--safe-top)+4px)] pb-3">
          <button
            type="button"
            onClick={onBack}
            className="pressable flex h-11 items-center gap-1 rounded-full border border-glass-line bg-glass pr-4 pl-2.5 text-[15px] font-semibold shadow-[var(--shadow-soft)] backdrop-blur-xl"
          >
            <ChevronLeft size={19} /> {area ? `Area ${area.number}` : "Back"}
          </button>
          <span className="flex-1" />
          <GlassIconButton onClick={onAsk} aria-label={`Ask Lumi about finding ${finding.number}`}>
            <Chat size={19} />
          </GlassIconButton>
        </header>

        {/* The photo, unobstructed; tap for full screen and zoom. */}
        <div className="px-4">
          <ScanPhoto photo={photo} alt={alt} emptyText="This photo isn’t available on this device." markers={markers} maxHeight="36cqh" onOpen={photo ? () => setViewer(true) : undefined} />
        </div>

        {/* 1 · The issue */}
        <div className="px-5 pt-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-[14px] font-bold text-on-primary">{finding.number}</span>
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
              <BarrierIcon type={d.barrierType} size={16} />
              {barrierTypeLabel(d.barrierType)}
            </span>
          </div>
          <h1 className="mt-2 text-[26px] leading-[1.15] font-semibold tracking-[-0.03em] text-balance">{d.title}</h1>
          <div className="mt-3">
            <StatusTag status={finding.status} />
          </div>
        </div>

        {/* 2 · Who it may affect */}
        {needs.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2 px-5" aria-label="Accessibility needs">
            {needs.map((n) => (
              <li key={n.category} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[14px] font-semibold">
                <NeedIcon category={n.category} size={16} />
                {NEED_LABEL[n.category]}
              </li>
            ))}
          </ul>
        )}

        {/* 3 · One suggested action */}
        <div className="mx-4 mt-5 rounded-[24px] bg-surface p-4 shadow-[var(--shadow-soft)]">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-muted">
            <Wrench size={16} /> Suggested action
          </p>
          <p className="mt-1.5 text-[18px] leading-snug font-semibold tracking-[-0.01em]">{action}</p>
        </div>

        {finding.firstScanId === scanId && (
          <div className="px-4 pt-3">
            <DuplicatePrompt wt={wt} scanId={scanId} findingId={finding.id} />
          </div>
        )}

        {/* Supporting information, on demand */}
        <div className="space-y-2.5 px-4 pt-5">
          {comparison?.comparison && (
            <Disclosure
              sectionRef={compareRef}
              icon={<Compare size={17} />}
              label="Before & after"
              summary={<StatusTag status={comparison.status} />}
              defaultOpen
            >
              <ComparisonEvidence wt={wt} finding={finding} event={comparison} />
            </Disclosure>
          )}

          <Disclosure icon={<Eye size={17} />} label="Evidence">
            <dl className="space-y-3">
              <div>
                <dt className="text-[13px] font-semibold text-muted">Where, as Lumi described it (scan {scanNo(finding.firstScanId)})</dt>
                <dd className="mt-0.5">{d.locationInImage}</dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold text-muted">What Lumi saw</dt>
                <dd className="mt-0.5">{d.visualEvidence}</dd>
              </div>
              {here?.comparison && (
                <div>
                  <dt className="text-[13px] font-semibold text-muted">In this photo, compared with scan {here.referenceScanId ? scanNo(here.referenceScanId) : "?"}</dt>
                  <dd className="mt-0.5">
                    <ul className="list-disc space-y-1 pl-5">
                      {here.comparison.visualEvidence.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
            {!markers.length && <p className="mt-3 text-[12px] leading-snug text-muted">Locations are described in words; nothing is marked on the photo without verified positions.</p>}
          </Disclosure>

          <Disclosure icon={<Info size={17} />} label="Why it matters">
            <p>{d.potentialImpact}</p>
            <p className="mt-3 text-[13px] font-semibold text-muted">Who Lumi said may be affected</p>
            <p className="mt-0.5">{d.whoMayBeAffected.join(", ")}</p>
            {!isWhole(d.suggestedImprovement) && (
              <>
                <p className="mt-3 text-[13px] font-semibold text-muted">Full suggestion</p>
                <p className="mt-0.5">{d.suggestedImprovement}</p>
              </>
            )}
          </Disclosure>

          <Disclosure icon={<Question size={17} />} label="Uncertainty" summary={comparison?.guardrail ? <span className="rounded-full bg-[color-mix(in_srgb,var(--color-caution)_16%,transparent)] px-2 py-0.5 text-[12px] font-semibold">Lumi held back</span> : undefined}>
            <p>{d.uncertainty}</p>
            {comparison?.comparison && <p className="mt-2">{comparison.comparison.remainingUncertainty}</p>}
            {comparison?.guardrail && (
              <ul className="mt-2 list-disc pl-5 text-[15px]">
                {comparison.guardrail.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[12px] text-muted">Lumi rated its own confidence in this finding as {d.confidence}.</p>
          </Disclosure>

          {finding.history.length > 1 && (
            <Disclosure icon={<HistoryIcon size={17} />} label="Across your scans" summary={<span className="text-[13px] text-muted">{finding.history.length} scans</span>}>
              <History wt={wt} finding={finding} />
            </Disclosure>
          )}
        </div>

        <div className="px-7 pt-5 text-center">
          <button type="button" onClick={() => setTrustOpen(true)} className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted">
            <Info size={15} /> About these results
          </button>
        </div>
      </div>

      {/* Primary actions */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex gap-2 border-t border-glass-line bg-glass-strong px-4 pt-3 pb-[calc(var(--safe-bottom)+10px)] backdrop-blur-2xl">
        {onRecheck && (
          <Button variant="secondary" size="md" className="h-12 flex-1" icon={<Layers size={17} />} onClick={onRecheck}>
            Re-check
          </Button>
        )}
        <button type="button" onClick={onAsk} className="pressable flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-on-primary">
          <span aria-hidden>
            <Sidekick mood="ready" size={24} halo={false} float={false} />
          </span>
          Ask Lumi
        </button>
      </div>

      {viewer && photo && <PhotoViewer photo={photo} alt={alt} markers={markers} onClose={() => setViewer(false)} />}
      <TrustSheet open={trustOpen} onClose={() => setTrustOpen(false)} />
    </div>
  );
}

/** A finding can be re-checked with Line up while it's open and its latest photo is still available. */
export function isRecheckable(wt: Walkthrough, f: TrackedFinding) {
  return isOpen(f.status) && wt.hasImage(f.lastSeenScanId);
}

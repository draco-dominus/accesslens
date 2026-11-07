"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { useWalkthrough } from "@/hooks/useWalkthrough";
import { accessibilityNeeds, NEED_LABEL } from "@/lib/session/categories";
import { findingCaptionForScan } from "@/lib/session/lumi";
import { isOpen, type TrackedFinding } from "@/lib/session/types";
import { ComparisonEvidence, DuplicatePrompt, History, latestComparison } from "../discover/FindingParts";
import { Sidekick } from "../lumi/Sidekick";
import { TrustSheet } from "../trust/TrustPanel";
import { Chat, ChevronLeft, Compare, Eye, History as HistoryIcon, Info, Layers, People, Question, Scan, Wrench } from "../ui/Icons";
import { BarrierIcon, NeedChips, NeedIcon } from "../ui/Needs";
import { Button, GlassIconButton } from "../ui/primitives";
import { barrierTypeLabel, StatusTag } from "../ui/Tags";

type Walkthrough = ReturnType<typeof useWalkthrough>;

/**
 * Finding Details: one finding, given room to breathe. Every line comes from recorded data — the
 * analysis fields, the comparison results and the finding's history. Nothing is generated to fill space.
 */
export function FindingDetailScreen({
  wt,
  finding,
  scanId,
  section,
  onBack,
  onShowInPhoto,
  onAsk,
  onRecheck,
}: {
  wt: Walkthrough;
  finding: TrackedFinding;
  /** The scan whose photo the user came from (its photo heads this page). */
  scanId: string;
  /** Open scrolled to a section (after a re-check: the before/after comparison). */
  section?: "compare";
  onBack: () => void;
  onShowInPhoto: () => void;
  onAsk: () => void;
  onRecheck?: () => void;
}) {
  const session = wt.session!;
  const d = finding.details;
  const scan = session.scans.find((s) => s.id === scanId);
  const photo = wt.media[scanId]?.imageUrl ?? wt.media[scanId]?.thumbUrl;
  const caption = findingCaptionForScan(session, scanId, finding);
  const comparison = latestComparison(finding);
  const hereComparison = finding.history.filter((h) => h.scanId === scanId).at(-1)?.comparison ? finding.history.filter((h) => h.scanId === scanId).at(-1) : undefined;
  const scanNo = (id: string) => session.scans.find((s) => s.id === id)?.number ?? "?";
  const needs = accessibilityNeeds(d.whoMayBeAffected);
  const [trustOpen, setTrustOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);

  // Arriving from a re-check: bring the before/after into view (scrolls this page only).
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
        {/* Header */}
        <header className="sticky top-0 z-10 flex items-center gap-2 bg-[linear-gradient(to_bottom,var(--bg)_70%,transparent)] px-4 pt-[calc(var(--safe-top)+4px)] pb-3">
          <button
            type="button"
            onClick={onBack}
            className="pressable flex h-11 items-center gap-1 rounded-full border border-glass-line bg-glass pr-4 pl-2.5 text-[15px] font-semibold shadow-[var(--shadow-soft)] backdrop-blur-xl"
          >
            <ChevronLeft size={19} /> {scan ? `Scan ${scan.number} photo` : "Photo"}
          </button>
          <span className="flex-1" />
          <GlassIconButton onClick={onAsk} aria-label={`Ask Lumi about finding ${finding.number}`}>
            <Chat size={19} />
          </GlassIconButton>
        </header>

        {/* Photo with this finding's reference */}
        {photo && (
          <button
            type="button"
            onClick={onShowInPhoto}
            aria-label={`Show finding ${finding.number} on the scan ${scan?.number} photo`}
            className="pressable relative mx-4 block w-[calc(100%-2rem)] overflow-hidden rounded-[28px] bg-black"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
            <img src={photo} alt={`Scan ${scan?.number}${scan?.analysis ? `: ${scan.analysis.sceneSummary}` : ""}`} className="max-h-[38cqh] w-full object-contain" style={{ viewTransitionName: "scan-photo" }} />
            <span className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full bg-white py-1 pr-3 pl-1 text-[14px] font-semibold text-black shadow-[0_4px_14px_rgba(0,0,0,0.35)]">
              <span className="grid size-7 place-items-center rounded-full bg-black text-[13px] font-bold text-white">{finding.number}</span>
              Show in photo
            </span>
          </button>
        )}

        {/* Title block */}
        <div className="px-5 pt-5">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
            <BarrierIcon type={d.barrierType} size={17} />
            {barrierTypeLabel(d.barrierType)} · Finding #{finding.number}
          </div>
          <h1 className="mt-1.5 text-[26px] leading-[1.15] font-semibold tracking-[-0.03em] text-balance">{d.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusTag status={finding.status} />
            <span className="text-[13px] text-muted">
              First noticed in scan {scanNo(finding.firstScanId)}
              {finding.lastSeenScanId !== finding.firstScanId ? ` · last seen in scan ${scanNo(finding.lastSeenScanId)}` : ""}
            </span>
          </div>
          {needs.length > 0 && (
            <div className="mt-3">
              <NeedChips who={d.whoMayBeAffected} />
            </div>
          )}
        </div>

        {finding.firstScanId === scanId && (
          <div className="px-4 pt-4">
            <DuplicatePrompt wt={wt} scanId={scanId} findingId={finding.id} />
          </div>
        )}

        <div className="space-y-3 px-4 pt-5">
          <Section icon={<Eye size={18} />} title="Observation">
            <p>{caption ? caption.text : d.visualEvidence}</p>
            {caption && <p className="mt-2 text-[13px] text-muted">{caption.label.replace(/^#\d+ · /, "")}</p>}
          </Section>

          <Section icon={<Scan size={18} />} title="Visual evidence">
            <dl className="space-y-3">
              <div>
                <dt className="text-[13px] font-semibold text-muted">Where, as Lumi described it (scan {scanNo(finding.firstScanId)})</dt>
                <dd className="mt-0.5">{d.locationInImage}</dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold text-muted">What Lumi saw</dt>
                <dd className="mt-0.5">{d.visualEvidence}</dd>
              </div>
              {hereComparison?.comparison && (
                <div>
                  <dt className="text-[13px] font-semibold text-muted">In this photo, compared with scan {hereComparison.referenceScanId ? scanNo(hereComparison.referenceScanId) : "?"}</dt>
                  <dd className="mt-0.5">
                    <ul className="list-disc space-y-1 pl-5">
                      {hereComparison.comparison.visualEvidence.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-[12px] leading-snug text-muted">Locations are described in words. AccessLens doesn’t draw detection boxes on photos.</p>
          </Section>

          <Section icon={<Info size={18} />} title="Impact">
            <p>{d.potentialImpact}</p>
          </Section>

          <Section icon={<People size={18} />} title="Accessibility needs">
            {needs.length > 0 && (
              <ul className="mb-3 space-y-2">
                {needs.map((n) => (
                  <li key={n.category} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2">
                      <NeedIcon category={n.category} size={16} />
                    </span>
                    <span>
                      <span className="font-semibold">{NEED_LABEL[n.category]}</span>
                      <span className="text-muted"> · {n.groups.join(", ")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[13px] text-muted">Who Lumi said may be affected</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {d.whoMayBeAffected.map((w) => (
                <li key={w} className="rounded-full bg-surface-2 px-3 py-1.5 text-[14px] leading-none font-medium">
                  {w}
                </li>
              ))}
            </ul>
          </Section>

          <Section icon={<Wrench size={18} />} title="Suggested action">
            <p>{d.suggestedImprovement}</p>
            {finding.status === "appears_improved" && <p className="mt-2 text-[14px] text-muted">The photos suggest an improvement. Confirm the change in person.</p>}
            {finding.status === "needs_verification" && <p className="mt-2 text-[14px] text-muted">The photos weren’t conclusive. Re-check from the same spot, or verify in person.</p>}
            {onRecheck && (
              <Button size="md" variant="secondary" className="mt-3" icon={<Layers size={17} />} onClick={onRecheck}>
                Re-check this spot
              </Button>
            )}
          </Section>

          <Section icon={<Question size={18} />} title="Uncertainty">
            <p>{d.uncertainty}</p>
            {comparison?.comparison && <p className="mt-2">{comparison.comparison.remainingUncertainty}</p>}
            {comparison?.guardrail && (
              <div className="mt-3 rounded-2xl bg-[color-mix(in_srgb,var(--color-caution)_12%,transparent)] px-3 py-2.5 text-[14px] leading-snug">
                <p className="font-semibold">Why Lumi held back</p>
                <ul className="mt-1 list-disc pl-5">
                  {comparison.guardrail.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-[12px] text-muted">Lumi rated its own confidence in this finding as {d.confidence}.</p>
          </Section>

          {comparison?.comparison && (
            <div ref={compareRef}>
              <Section icon={<Compare size={18} />} title="Before and after">
                <ComparisonEvidence wt={wt} finding={finding} event={comparison} />
              </Section>
            </div>
          )}

          {finding.history.length > 1 && (
            <Section icon={<HistoryIcon size={18} />} title="Across your scans">
              <History wt={wt} finding={finding} />
            </Section>
          )}
        </div>

        <div className="px-7 pt-6 text-center">
          <button type="button" onClick={() => setTrustOpen(true)} className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted">
            <Info size={15} /> About these results
          </button>
          <p className="text-[12px] leading-relaxed text-muted">AI observations from photos. Not an accessibility assessment or certification.</p>
        </div>
      </div>

      {/* Primary actions */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex gap-2 border-t border-glass-line bg-glass-strong px-4 pt-3 pb-[calc(var(--safe-bottom)+10px)] backdrop-blur-2xl">
        <Button variant="secondary" size="md" className="h-12 flex-1" icon={<Scan size={17} />} onClick={onShowInPhoto} disabled={!photo}>
          Show in photo
        </Button>
        <button
          type="button"
          onClick={onAsk}
          className="pressable relative flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-on-primary"
        >
          <span aria-hidden>
            <Sidekick mood="ready" size={24} halo={false} float={false} />
          </span>
          Ask Lumi
        </button>
      </div>

      <TrustSheet open={trustOpen} onClose={() => setTrustOpen(false)} />
    </div>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[24px] bg-surface p-4 shadow-[var(--shadow-soft)]" aria-label={title}>
      <h2 className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]">
        <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden>
          {icon}
        </span>
        {title}
      </h2>
      <div className="mt-3 text-[16px] leading-[1.55]">{children}</div>
    </section>
  );
}

/** A finding can be re-checked with Line up while it's open and its latest photo is still available. */
export function isRecheckable(wt: Walkthrough, f: TrackedFinding) {
  return isOpen(f.status) && wt.hasImage(f.lastSeenScanId);
}

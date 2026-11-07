"use client";

import { useState } from "react";
import { retryKey, type useWalkthrough } from "@/hooks/useWalkthrough";
import { areaOf, recheckOutcome, recheckTarget } from "@/lib/session/areas";
import { findingsForScan, recheckHeadline, scanActivity, STATUS_LABEL } from "@/lib/session/lumi";
import type { Scan, TrackedFinding } from "@/lib/session/types";
import { spatialBoxes } from "@/lib/spatial";
import { comparisonPhotos } from "../discover/FindingParts";
import { PhotoViewer, ScanPhoto, type PhotoMarker } from "../discover/PhotoStage";
import { StageChecklist, TimingBreakdown } from "../lumi/ScanProgress";
import { TrustSheet } from "../trust/TrustPanel";
import { BeforeAfter } from "../ui/BeforeAfter";
import { Alert, Chat, Check, ChevronRight, Compare, Document, Home, Info, Layers, List, Question, Rescan, Scan as ScanIcon } from "../ui/Icons";
import { BarrierIcon, NeedMarks } from "../ui/Needs";
import { Button, GlassIconButton } from "../ui/primitives";
import { AiBadge, StatusTag } from "../ui/Tags";

type Walkthrough = ReturnType<typeof useWalkthrough>;

/**
 * One area's photo and findings, as a plain scrolling page: header, the photo (nothing drawn over it),
 * a re-check's before/after when there is one, then one list of findings. Tapping a finding opens its
 * Details page. The two operations stay separate and explicit: "Scan new area" never compares anything;
 * "Re-check this area" lines up with this area's photo.
 */
export function DiscoverScreen({
  wt,
  scan,
  onOpenFinding,
  onOpenScan,
  onScanNewArea,
  onRecheck,
  onReview,
  onAsk,
  onHome,
  onReport,
}: {
  wt: Walkthrough;
  scan: Scan;
  onOpenFinding: (findingId: string, section?: "compare") => void;
  onOpenScan: (scanId: string) => void;
  onScanNewArea: () => void;
  /** Open the camera lined up with this earlier scan's photo. */
  onRecheck: (scanId: string) => void;
  onReview: () => void;
  /** Ask Lumi, about this photo's first finding when there is one. */
  onAsk: (findingId?: string) => void;
  onHome: () => void;
  onReport: () => void;
}) {
  const session = wt.session!;
  const processing = scan.step !== "done" && scan.step !== "error";
  const checking = Boolean(wt.checking[scan.id]);
  const photo = wt.media[scan.id]?.imageUrl ?? wt.media[scan.id]?.thumbUrl;
  const area = areaOf(session, scan.id);
  const items = findingsForScan(session, scan.id);
  const target = !processing && !checking ? recheckTarget(session, scan.id, wt.hasImage) : null;
  const outcome = recheckOutcome(scan);
  const isRecheck = outcome === "pending" || outcome === "matched";
  const recheckOf = scan.lineUpScanId ? session.scans.find((s) => s.id === scan.lineUpScanId) : undefined;
  const recheckOfArea = recheckOf ? areaOf(session, recheckOf.id)?.number : undefined;
  const notices = scan.step === "done" ? scan.events.flatMap((e) => (e.kind === "notice" ? [e.message] : [])) : [];
  const [viewer, setViewer] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const [showTiming] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("timing"));

  // Findings compared in THIS scan: the before/after is the headline result of a re-check.
  const compared = items
    .map((i) => ({ finding: i.finding, event: i.finding.history.filter((h) => h.scanId === scan.id && h.comparison).at(-1) }))
    .filter((x): x is { finding: TrackedFinding; event: NonNullable<typeof x.event> } => Boolean(x.event));
  const listed = items.filter((i) => !compared.some((c) => c.finding.id === i.finding.id));
  const markers: PhotoMarker[] = items.flatMap((i) => spatialBoxes(i.finding.details).map((box) => ({ number: i.finding.number, box })));

  const alt = `Area ${area?.number ?? "?"}, scan ${scan.number}${scan.analysis ? `: ${scan.analysis.sceneSummary}` : ""}`;
  const emptyText = wt.photoRestore === "loading" ? "Restoring this photo from your device…" : wt.restored ? "This photo couldn’t be restored. The findings are still here." : "Preparing photo…";

  return (
    <div className="relative h-full bg-bg text-fg">
      <div className="no-scrollbar h-full overflow-y-auto overscroll-contain pb-[calc(var(--safe-bottom)+96px)]">
        <header className="sticky top-0 z-10 flex items-center gap-2 bg-[linear-gradient(to_bottom,var(--bg)_72%,transparent)] px-4 pt-[calc(var(--safe-top)+4px)] pb-3">
          <GlassIconButton onClick={onHome} aria-label="Home">
            <Home size={19} />
          </GlassIconButton>
          <div className="min-w-0 flex-1 px-1">
            <h1 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">Area {area?.number ?? "?"}</h1>
            <p className="text-[13px] leading-tight text-muted">
              {isRecheck ? `Re-check · scan ${scan.number}` : outcome === "rejected" ? `Scan ${scan.number} · didn’t match Area ${recheckOfArea ?? "?"}` : `Scan ${scan.number}`}
            </p>
          </div>
          <GlassIconButton onClick={() => onAsk(items[0]?.finding.id)} aria-label="Ask Lumi">
            <Chat size={19} />
          </GlassIconButton>
          <GlassIconButton onClick={onReview} aria-label="Review all areas">
            <List size={19} />
          </GlassIconButton>
        </header>

        {/* A finished re-check leads with its before/after; otherwise the photo leads. */}
        {scan.step === "done" && compared.length > 0 ? (
          <RecheckResult wt={wt} compared={compared} onOpenFinding={onOpenFinding} onReport={onReport} />
        ) : (
          <div className="px-4">
            <ScanPhoto photo={photo} alt={alt} emptyText={emptyText} processing={processing || checking} markers={markers} maxHeight="52cqh" onOpen={photo ? () => setViewer(true) : undefined} />
          </div>
        )}

        {/* Status while working, or what went wrong. */}
        {(processing || checking) && (
          <section className="mx-4 mt-4 rounded-[22px] bg-surface px-4 py-3.5 shadow-[var(--shadow-soft)]" aria-live="polite">
            <p className="text-[16px] font-semibold text-thinking">
              {checking ? `Comparing with the earlier photo…` : `${scanActivity(scan).title}…`}
            </p>
            {processing && <StageChecklist scan={scan} />}
            <p className="mt-2 text-[13px] text-muted">You can scan another area meanwhile.</p>
          </section>
        )}
        {scan.step === "error" && (
          <section className="mx-4 mt-4 rounded-[22px] bg-surface px-4 py-3.5 shadow-[var(--shadow-soft)]" role="alert">
            <p className="text-[16px] font-semibold">I couldn’t finish this scan.</p>
            <p className="mt-1 text-[14px] leading-snug text-muted">{scan.error}</p>
            <StageChecklist scan={scan} />
            {!wt.canRetry(scan.id) && <p className="mt-2 text-[13px] leading-snug text-muted">Trying again won’t help with this photo. Please take a new one.</p>}
            {wt.canRetry(scan.id) && (
              <Button size="md" className="mt-3" onClick={() => wt.retryScan(scan.id)} icon={<Rescan size={17} />}>
                Try again
              </Button>
            )}
          </section>
        )}

        {scan.step === "done" && notices.length > 0 && (
          <div className="mx-4 mt-4 space-y-1.5 rounded-[20px] bg-surface-2 px-4 py-3 text-[14px] leading-snug" aria-live="polite">
            {notices.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        )}
        {isRecheck && recheckOf && scan.step === "done" && compared.length === 0 && notices.length === 0 && (
          <p className="mx-5 mt-4 text-[14px] leading-snug text-muted">Nothing open was left to compare with scan {recheckOf.number}.</p>
        )}

        {/* "Looks like Area N": a suggestion the user may take or dismiss. Never automatic. */}
        {scan.step === "done" &&
          scan.pendingRevisit.map((earlierId) => (
            <RevisitSuggestion key={earlierId} wt={wt} scanId={scan.id} earlierId={earlierId} busy={checking} onOpenScan={onOpenScan} />
          ))}

        {scan.step === "done" &&
          (scan.failedComparisons ?? []).map((f) => (
            <FailedComparisonCard key={`${f.findingId}|${f.referenceScanId}`} wt={wt} scanId={scan.id} findingId={f.findingId} referenceScanId={f.referenceScanId} />
          ))}

        {/* Findings */}
        {scan.step === "done" && (
          <section className="mt-6 px-4" aria-labelledby="findings-heading">
            <div className="mb-2.5 flex items-center gap-2 px-1">
              <h2 id="findings-heading" className="text-[17px] font-semibold tracking-[-0.015em]">
                {compared.length ? "Also in this photo" : "Findings"}
              </h2>
              <span className="text-[15px] text-muted tabular-nums">{listed.length}</span>
              <span className="flex-1" />
              {listed.length > 0 && <AiBadge />}
            </div>
            {listed.length > 0 ? (
              <ul className="overflow-hidden rounded-[22px] bg-surface shadow-[var(--shadow-soft)]" aria-label="Findings in this photo">
                {listed.map(({ finding }) => (
                  <li key={finding.id} className="border-b border-line last:border-b-0">
                    <FindingRow finding={finding} onOpen={() => onOpenFinding(finding.id)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-[20px] bg-surface-2 px-4 py-3.5 text-[15px] leading-snug">
                {scan.analysis && !scan.analysis.imageUsable
                  ? `I couldn’t assess this photo: ${scan.analysis.limitations}`
                  : compared.length
                    ? "No other potential barriers spotted."
                    : "No potential barriers spotted in this photo."}
              </p>
            )}
          </section>
        )}

        {showTiming && <TimingBreakdown scan={scan} />}

        <div className="px-7 pt-5 text-center">
          {wt.photoStorageWarning && <p className="mb-2 rounded-2xl bg-surface-2 px-3 py-2 text-[12px] leading-snug text-muted">{wt.photoStorageWarning}</p>}
          <button type="button" onClick={() => setTrustOpen(true)} className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted">
            <Info size={15} /> About these results
          </button>
        </div>
      </div>

      {/* The two explicit operations. */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex gap-2 border-t border-glass-line bg-glass-strong px-4 pt-3 pb-[calc(var(--safe-bottom)+10px)] backdrop-blur-2xl">
        <Button size="md" className="h-12 min-w-0 flex-1 px-3 whitespace-nowrap" icon={<ScanIcon size={18} />} onClick={onScanNewArea}>
          Scan new area
        </Button>
        {target && (
          <Button size="md" variant="secondary" className="h-12 min-w-0 flex-1 px-3 whitespace-nowrap" icon={<Layers size={17} />} onClick={() => onRecheck(target)}>
            Re-check area
          </Button>
        )}
      </div>

      {viewer && photo && <PhotoViewer photo={photo} alt={alt} markers={markers} onClose={() => setViewer(false)} />}
      <TrustSheet open={trustOpen} onClose={() => setTrustOpen(false)} />
    </div>
  );
}

/** Number, full title (wraps, never truncated), need icons, status. Tap → Details. */
function FindingRow({ finding, onOpen }: { finding: TrackedFinding; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Finding ${finding.number}: ${finding.details.title}. ${STATUS_LABEL[finding.status]}. Open details`}
      className="pressable flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[14px] font-bold">{finding.number}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-1.5 text-[16px] leading-snug font-semibold tracking-[-0.01em]">
          <BarrierIcon type={finding.details.barrierType} size={17} className="mt-0.5 shrink-0 text-muted" />
          <span>{finding.details.title}</span>
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusTag status={finding.status} />
          <NeedMarks who={finding.details.whoMayBeAffected} />
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted" />
    </button>
  );
}

/** Re-checks whose reveal animation already played (once per page load is enough). */
const revealed = new Set<string>();

/**
 * The re-check result — the signature moment. An evidence-gated one-line result, the comparison's own
 * description of the change, then the before/after photos (the after wipes in once). Next steps follow.
 */
function RecheckResult({
  wt,
  compared,
  onOpenFinding,
  onReport,
}: {
  wt: Walkthrough;
  compared: { finding: TrackedFinding; event: TrackedFinding["history"][number] }[];
  onOpenFinding: (id: string, section?: "compare") => void;
  onReport: () => void;
}) {
  const { finding, event } = compared[0];
  const { beforeScan, nowScan, beforeUrl, nowUrl } = comparisonPhotos(wt, finding, event);
  const head = recheckHeadline(finding, event);
  const [reveal] = useState(() => {
    const first = !revealed.has(event.scanId);
    revealed.add(event.scanId);
    return first;
  });
  const others = compared.slice(1);
  return (
    <section className="animate-rise-in mx-4 rounded-[26px] bg-surface p-4 shadow-[var(--shadow-float)]" aria-labelledby="recheck-heading">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        <Compare size={15} /> Before & after · scan {beforeScan?.number ?? "?"} → {nowScan?.number ?? "?"}
      </p>
      <div className="mt-2 flex items-start gap-3" aria-live="polite">
        <span
          aria-hidden
          className={`result-pop mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${head.tone === "improved" ? "bg-success text-white" : head.tone === "still" ? "bg-[color-mix(in_srgb,var(--color-caution)_22%,transparent)]" : "bg-surface-2"}`}
        >
          {head.tone === "improved" ? <Check size={18} strokeWidth={3} /> : head.tone === "still" ? <Alert size={17} /> : <Question size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="recheck-heading" className="text-[21px] leading-tight font-semibold tracking-[-0.02em]">
            {head.text}
          </h2>
          <p className="mt-1 text-[15px] leading-snug text-muted">
            #{finding.number} {finding.details.title}
          </p>
        </div>
      </div>
      {head.detail && <p className="mt-3 text-[16px] leading-snug">{head.detail}</p>}
      {beforeUrl && nowUrl && (
        <div className="mt-3">
          <BeforeAfter earlier={beforeUrl} later={nowUrl} reveal={reveal} earlierLabel={`Scan ${beforeScan?.number}, before`} laterLabel={`Scan ${nowScan?.number}, after`} />
        </div>
      )}
      {head.tone === "improved" && <p className="mt-2.5 text-[13px] leading-snug text-muted">Based on these two photos. Confirm it in person; it doesn’t mean the whole space is accessible.</p>}
      {others.length > 0 && (
        <ul className="mt-3 space-y-2">
          {others.map(({ finding: f, event: e }) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onOpenFinding(f.id, "compare")}
                className="pressable flex min-h-14 w-full items-center gap-3 rounded-[18px] bg-surface-2 px-3.5 py-2.5 text-left"
                aria-label={`Finding ${f.number}: ${f.details.title}. ${STATUS_LABEL[e.status]}. Open the comparison`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-snug font-semibold">
                    #{f.number} {f.details.title}
                  </span>
                  <span className="mt-1 block">
                    <StatusTag status={e.status} />
                  </span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex gap-2">
        <Button size="md" variant="secondary" className="min-w-0 flex-1 px-3 whitespace-nowrap" onClick={() => onOpenFinding(finding.id, "compare")}>
          Details
        </Button>
        <Button size="md" variant="secondary" className="min-w-0 flex-1 px-3 whitespace-nowrap" icon={<Document size={17} />} onClick={onReport}>
          Report
        </Button>
      </div>
    </section>
  );
}

/** Non-blocking: the scene looked like an earlier area. Re-check it, or keep it as a new area. */
function RevisitSuggestion({ wt, scanId, earlierId, busy, onOpenScan }: { wt: Walkthrough; scanId: string; earlierId: string; busy: boolean; onOpenScan: (id: string) => void }) {
  const session = wt.session!;
  const earlier = session.scans.find((s) => s.id === earlierId);
  if (!earlier) return null;
  const n = areaOf(session, earlierId)?.number ?? earlier.number;
  const thumb = wt.media[earlierId]?.thumbUrl ?? wt.media[earlierId]?.imageUrl;
  const canCompare = wt.hasImage(earlierId) && wt.hasImage(scanId);
  return (
    <section className="mx-4 mt-4 rounded-[22px] bg-surface p-3.5 shadow-[var(--shadow-soft)]" aria-label={`This may be Area ${n}`}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onOpenScan(earlierId)} className="size-14 shrink-0 overflow-hidden rounded-[14px] bg-surface-2" aria-label={`View Area ${n}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
          {thumb && <img src={thumb} alt="" className="size-full object-cover" />}
        </button>
        <p className="min-w-0 flex-1 text-[15px] leading-snug">
          <span className="font-semibold">This looks like Area {n}.</span>
          <span className="text-muted"> Compare the photos, or keep this as a new area.</span>
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        {canCompare && (
          <Button size="md" disabled={busy} onClick={() => wt.confirmRevisit(scanId, earlierId)} className="flex-1">
            Compare
          </Button>
        )}
        <Button size="md" variant="secondary" disabled={busy} onClick={() => wt.declineRevisit(scanId, earlierId)} className="flex-1">
          It’s new
        </Button>
      </div>
    </section>
  );
}

/** A comparison that failed: retry just that comparison with the photos already prepared. */
function FailedComparisonCard({ wt, scanId, findingId, referenceScanId }: { wt: Walkthrough; scanId: string; findingId: string; referenceScanId: string }) {
  const session = wt.session!;
  const finding = session.findings.find((f) => f.id === findingId);
  const earlier = session.scans.find((s) => s.id === referenceScanId);
  if (!finding || !earlier) return null;
  const state = wt.comparisonRetries[retryKey(scanId, findingId, referenceScanId)];
  const photosAvailable = wt.hasImage(scanId) && wt.hasImage(referenceScanId);
  return (
    <div className="mx-4 mt-3 rounded-[20px] bg-surface px-4 py-3 shadow-[var(--shadow-soft)]" role="group" aria-label={`Comparison for finding ${finding.number} didn't finish`}>
      <p className="text-[15px] leading-snug">
        <span className="font-semibold">I couldn’t compare #{finding.number} {finding.details.title}</span>
        <span className="text-muted"> with scan {earlier.number}. Its status hasn’t changed.</span>
      </p>
      <div aria-live="polite">{state?.error && <p className="mt-1 text-[13px] leading-snug text-muted">Still didn’t work: {state.error}</p>}</div>
      {photosAvailable ? (
        <Button size="md" className="mt-2" disabled={state?.busy} onClick={() => wt.retryComparison(scanId, findingId, referenceScanId)} icon={<Rescan size={17} />}>
          {state?.busy ? "Comparing…" : "Try comparison again"}
        </Button>
      ) : (
        <p className="mt-1 text-[13px] leading-snug text-muted">The photos are no longer available. Use Re-check area instead.</p>
      )}
    </div>
  );
}

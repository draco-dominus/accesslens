"use client";

import type { useWalkthrough } from "@/hooks/useWalkthrough";
import { STATUS_LABEL } from "@/lib/session/lumi";
import type { FindingEvent, TrackedFinding } from "@/lib/session/types";
import { BeforeAfter } from "../ui/BeforeAfter";
import { StatusTag } from "../ui/Tags";

type Walkthrough = ReturnType<typeof useWalkthrough>;

/** The most recent comparison recorded for a finding (any scan), if any. */
export function latestComparison(finding: TrackedFinding): FindingEvent | undefined {
  return [...finding.history].reverse().find((h) => h.comparison);
}

/** The two photos a comparison actually used: the reference scan and the scan it was made in. */
export function comparisonPhotos(wt: Walkthrough, finding: TrackedFinding, event: FindingEvent) {
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

/** The full comparison evidence with the before/after slider. */
export function ComparisonEvidence({ wt, finding, event }: { wt: Walkthrough; finding: TrackedFinding; event: FindingEvent }) {
  const c = event.comparison!;
  const { beforeScan, nowScan, beforeUrl, nowUrl } = comparisonPhotos(wt, finding, event);
  return (
    <div>
      <p className="text-[13px] font-semibold text-muted">
        Scan {beforeScan?.number ?? "?"} → scan {nowScan?.number ?? "?"} · {STATUS_LABEL[event.status]}
      </p>
      <p className="mt-1.5 text-[16px] leading-[1.5]">{c.observedChange}</p>
      {beforeUrl && nowUrl && (
        <div className="mt-4">
          <BeforeAfter earlier={beforeUrl} later={nowUrl} earlierLabel={`Scan ${beforeScan?.number}, earlier`} laterLabel={`Scan ${nowScan?.number}, now`} />
        </div>
      )}
      <p className="mt-4 text-[14px] font-semibold">What the photos show</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-snug">
        {c.visualEvidence.map((v) => (
          <li key={v}>{v}</li>
        ))}
      </ul>
      {event.status === "appears_improved" && (
        <p className="mt-3 text-[13px] leading-snug text-muted">This barrier looks better in these photos. Confirm it in person; it doesn’t mean the whole space is accessible.</p>
      )}
    </div>
  );
}

/** Status across scans, from the finding's recorded history. */
export function History({ wt, finding }: { wt: Walkthrough; finding: TrackedFinding }) {
  const session = wt.session!;
  return (
    <ol className="space-y-3 border-l border-line pl-4">
      {finding.history.map((h, i) => {
        const sc = session.scans.find((s) => s.id === h.scanId);
        return (
          <li key={i} className="relative text-[15px] leading-snug">
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
export function DuplicatePrompt({ wt, scanId, findingId }: { wt: Walkthrough; scanId: string; findingId: string }) {
  const session = wt.session!;
  const pairs = wt.duplicateSuggestions(scanId).filter((p) => p.newFindingId === findingId);
  if (!pairs.length) return null;
  return (
    <div className="rounded-[22px] bg-surface-2 px-4 py-3" role="group" aria-label="Possible duplicate">
      <p className="text-[15px] leading-snug">Could this be a barrier we already recorded?</p>
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

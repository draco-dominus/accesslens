import { openFindingsLastSeenIn } from "./engine";
import type { Scan, Session } from "./types";

/**
 * Areas as the user thinks of them. Every "Scan new area" starts an area; a re-check (Line up) belongs to
 * the area it re-checks; a suggestion the user accepted ("same place as Area N") joins that area.
 * Derived only from recorded data — the user's intent and confirmed relations, never a guess.
 */

export type Area = { key: string; number: number; scans: Scan[] };

/**
 * How a re-check (Line up) turned out, from its recorded relation to the scan it lined up with:
 *  - "pending": still processing, or no comparison finished yet (failed ones can be retried);
 *  - "matched": the comparisons didn't contradict the place ("yes" or "likely");
 *  - "rejected": comparison evidence says a different spot, or the comparisons disagreed.
 * A rejected re-check is never grouped with, or described as, that area.
 */
export function recheckOutcome(scan: Scan): "pending" | "matched" | "rejected" | null {
  if (!scan.lineUpScanId) return null;
  const r = scan.relations.find((x) => x.scanId === scan.lineUpScanId && x.decidedBy === "lineup");
  if (scan.step !== "done" || !r || !(r.comparisonVerdicts?.length)) return "pending";
  return r.sameArea === "yes" || r.sameArea === "likely" ? "matched" : "rejected";
}

/** The first scan of the area `scan` belongs to. */
function areaRoot(s: Session, scan: Scan, depth = 0): Scan {
  if (depth > s.scans.length) return scan; // defensive: no cycles in valid data
  const lined = scan.lineUpScanId && recheckOutcome(scan) !== "rejected" ? s.scans.find((x) => x.id === scan.lineUpScanId) : undefined;
  if (lined) return areaRoot(s, lined, depth + 1);
  if (scan.areaId && scan.areaId !== `area-${scan.id}`) {
    const owner = s.scans.find((x) => x.id !== scan.id && `area-${x.id}` === scan.areaId);
    if (owner) return areaRoot(s, owner, depth + 1);
  }
  return scan;
}

export function areas(s: Session): Area[] {
  const byKey = new Map<string, Scan[]>();
  for (const scan of s.scans) {
    const key = areaRoot(s, scan).id;
    byKey.set(key, [...(byKey.get(key) ?? []), scan]);
  }
  return [...byKey.entries()].map(([key, scans], i) => ({ key, number: i + 1, scans }));
}

export function areaOf(s: Session, scanId: string): Area | undefined {
  return areas(s).find((a) => a.scans.some((x) => x.id === scanId));
}

/** True when this scan was taken to re-check an earlier photo and is filed with that area. */
export const isRecheckScan = (scan: Scan) => Boolean(scan.lineUpScanId) && recheckOutcome(scan) !== "rejected";

/**
 * The photo to line up with for "Re-check this area": the latest scan in this area that is still the
 * latest view of an open finding and whose photo is available. Null when there's nothing to re-check.
 */
export function recheckTarget(s: Session, scanId: string, hasImage: (id: string) => boolean): string | null {
  const area = areaOf(s, scanId);
  if (!area) return null;
  const target = [...area.scans]
    .reverse()
    .find((sc) => sc.step === "done" && hasImage(sc.id) && openFindingsLastSeenIn(s, sc.id).length > 0);
  return target?.id ?? null;
}

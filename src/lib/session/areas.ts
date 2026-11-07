import { openFindingsLastSeenIn } from "./engine";
import type { Scan, Session } from "./types";

/**
 * Areas as the user thinks of them. Every "Scan new area" starts an area; a re-check (Line up) belongs to
 * the area it re-checks; a suggestion the user accepted ("same place as Area N") joins that area.
 * Derived only from recorded data — the user's intent and confirmed relations, never a guess.
 */

export type Area = { key: string; number: number; scans: Scan[] };

/** The first scan of the area `scan` belongs to. */
function areaRoot(s: Session, scan: Scan, depth = 0): Scan {
  if (depth > s.scans.length) return scan; // defensive: no cycles in valid data
  const lined = scan.lineUpScanId ? s.scans.find((x) => x.id === scan.lineUpScanId) : undefined;
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

/** True when this scan was taken to re-check an earlier photo. */
export const isRecheckScan = (scan: Scan) => Boolean(scan.lineUpScanId);

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

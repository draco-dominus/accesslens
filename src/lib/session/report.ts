import type { Session, TrackedFinding } from "./types";

/** Photos a finding's report entry shows: where it was first observed and its latest recorded scan. */
export function reportPhotoIds(f: TrackedFinding): string[] {
  const latest = f.history.at(-1)?.scanId;
  return [...new Set([f.firstScanId, latest].filter((id): id is string => Boolean(id)))];
}

/**
 * Readiness of the report's photos. While photos are still being restored from this device the report
 * must not be exported; afterwards, any expected photo that isn't available is listed (by scan number)
 * so the user is warned and the PDF says so, instead of silently omitting it.
 */
export function reportPhotoStatus(
  s: Session,
  hasPhoto: (scanId: string) => boolean,
  restore: "idle" | "loading" | "ready" | "unavailable",
): { state: "restoring" | "complete" | "missing"; missingScanNumbers: number[] } {
  const expected = new Set(s.findings.flatMap(reportPhotoIds));
  const missingScanNumbers = s.scans.filter((sc) => expected.has(sc.id) && !hasPhoto(sc.id)).map((sc) => sc.number);
  if (restore === "loading") return { state: "restoring", missingScanNumbers };
  return { state: missingScanNumbers.length ? "missing" : "complete", missingScanNumbers };
}

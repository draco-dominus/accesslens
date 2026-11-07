import type { FindingStatus, Scan, ScanEvent, Session, TrackedFinding } from "./types";
import { isOpen } from "./types";

/**
 * Lumi's words, generated only from real session data. No findings are invented here: every
 * sentence refers to a finding, comparison, or scan recorded in the session.
 * `lumiContext` exposes the same data in structured form for a future conversational Lumi.
 */

export const STATUS_LABEL: Record<FindingStatus, string> = {
  observed: "Observed",
  appears_improved: "Appears improved",
  still_observed: "Still observed",
  needs_verification: "Needs verification",
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => NUMBER_WORDS[n] ?? String(n);
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/** "Chair placed in a walking path" → "chair placed in a walking path" (keeps acronyms like "ATM"). */
function lowerFirst(text: string): string {
  const t = text.trim().replace(/[.]+$/, "");
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

const findingName = (f: TrackedFinding) => lowerFirst(f.details.title);

function scanLabel(s: Session, scanId: string): string {
  const sc = s.scans.find((x) => x.id === scanId);
  return sc ? `scan ${sc.number}` : "an earlier scan";
}

function eventText(s: Session, scan: Scan, e: ScanEvent, isFirstFindingOfSession: (id: string) => boolean): string | null {
  const finding = "findingId" in e ? s.findings.find((f) => f.id === e.findingId) : undefined;
  if ("findingId" in e && !finding) return null; // e.g. merged away

  switch (e.kind) {
    case "new_finding":
      return isFirstFindingOfSession(finding!.id)
        ? `I noticed a potential barrier: ${findingName(finding!)} (${finding!.details.locationInImage}).`
        : `We've also found ${findingName(finding!)} (${finding!.details.locationInImage}).`;
    case "seen_again":
      return `The ${findingName(finding!)} I noticed earlier still appears in this photo.`;
    case "status_change": {
      const last = finding!.history.filter((h) => h.scanId === scan.id).at(-1);
      const where = scanLabel(s, e.referenceScanId);
      switch (e.to) {
        case "appears_improved":
          return `Compared with ${where}, the ${findingName(finding!)} looks improved: ${lowerFirst(last?.note ?? "")}. Please confirm it in person.`;
        case "still_observed":
          return `The ${findingName(finding!)} I noticed earlier still appears in this photo.`;
        case "needs_verification": {
          const reason = last?.guardrail?.reasons[0] ?? last?.comparison?.remainingUncertainty ?? last?.note;
          return `I couldn't confirm whether the ${findingName(finding!)} changed${reason ? `: ${lowerFirst(reason)}` : "."}`;
        }
        default:
          return null;
      }
    }
    case "revisit":
      if (e.decidedBy === "lineup")
        return e.sameArea === "yes"
          ? `You lined this up with ${scanLabel(s, e.scanId)}, and it looks like the same spot.`
          : `You lined this up with ${scanLabel(s, e.scanId)}, and it looks like it might be the same spot.`;
      return e.decidedBy === "user"
        ? `Thanks, I'll treat this as the same area as ${scanLabel(s, e.scanId)}.`
        : e.sameArea === "yes"
          ? `This looks like the same area as ${scanLabel(s, e.scanId)}.`
          : `This might be the same area as ${scanLabel(s, e.scanId)}, so I re-checked what we found there.`;
    case "revisit_declined":
      return `Got it, this is a different area from ${scanLabel(s, e.scanId)}. Earlier findings there stay as they were.`;
    case "revisit_question":
      return `I'm not sure whether this is the same area as ${e.scanIds.map((id) => scanLabel(s, id)).join(" or ")}. Let me know below, and I'll check the earlier findings.`;
    case "no_findings":
      return scan.events.some((x) => x.kind === "revisit" || x.kind === "status_change")
        ? "I didn't spot any new barriers in this photo."
        : "I didn't spot steps, obstructions, or protruding objects in this photo. That doesn't mean the area is accessible: a photo can't show everything.";
    case "image_unusable":
      return `I couldn't assess this photo well: ${lowerFirst(e.reason)}`;
    case "notice":
      return e.message;
  }
}

/** Lumi's messages about one scan, in the order things happened, plus a session-progress line. */
export function lumiMessagesForScan(s: Session, scanId: string): string[] {
  const scan = s.scans.find((sc) => sc.id === scanId);
  if (!scan) return [];
  const firstFindingId = s.findings.reduce<TrackedFinding | null>((a, f) => (!a || f.number < a.number ? f : a), null)?.id;
  const messages = scan.events
    .map((e) => eventText(s, scan, e, (id) => id === firstFindingId))
    .filter((m): m is string => Boolean(m));

  const doneScans = s.scans.filter((sc) => sc.step === "done").length;
  if (doneScans > 1 && scan.step === "done") {
    messages.push(
      s.areaCount > 1
        ? `We've looked at ${plural(s.areaCount, "area", "areas")} so far.`
        : `We've scanned this area ${count(doneScans)} times so far.`,
    );
  }
  return messages;
}

export type WalkthroughSummary = {
  scans: number;
  areas: number;
  improved: TrackedFinding[];
  unresolved: TrackedFinding[]; // observed + still_observed
  needsVerification: TrackedFinding[];
  lines: string[];
};

export function walkthroughSummary(s: Session): WalkthroughSummary {
  const done = s.scans.filter((sc) => sc.step === "done");
  const improved = s.findings.filter((f) => f.status === "appears_improved");
  const unresolved = s.findings.filter((f) => f.status === "observed" || f.status === "still_observed");
  const needsVerification = s.findings.filter((f) => f.status === "needs_verification");

  const lines: string[] = [];
  if (done.length === 0) {
    lines.push("We haven't completed any scans yet.");
  } else {
    lines.push(
      `We completed ${plural(done.length, "scan", "scans")} across ${plural(s.areaCount, "area", "areas")} and noted ${plural(s.findings.length, "potential barrier", "potential barriers")}.`,
    );
    if (improved.length) lines.push(`${cap(plural(improved.length, "concern appears", "concerns appear"))} improved: ${improved.map(findingName).join("; ")}.`);
    if (unresolved.length) lines.push(`${cap(plural(unresolved.length, "concern is", "concerns are"))} still open: ${unresolved.map(findingName).join("; ")}.`);
    if (needsVerification.length) lines.push(`${cap(plural(needsVerification.length, "concern needs", "concerns need"))} an in-person check: ${needsVerification.map(findingName).join("; ")}.`);
    if (s.findings.length === 0) lines.push("I didn't spot any of the barriers I look for, but photos can't show everything.");
  }
  lines.push("This walkthrough flags potential barriers from photos. It isn't a compliance assessment, and it can't confirm that a space is accessible.");
  return { scans: done.length, areas: s.areaCount, improved, unresolved, needsVerification, lines };
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** Structured, image-free snapshot of the walkthrough for a future conversational Lumi. */
export function lumiContext(s: Session) {
  return {
    scans: s.scans
      .filter((sc) => sc.step === "done")
      .map((sc) => ({
        number: sc.number,
        area: sc.areaId,
        scene: sc.analysis?.sceneSummary,
        relatedTo: sc.relations.filter((r) => r.sameArea === "yes" || r.decidedBy === "user").map((r) => scanLabel(s, r.scanId)),
      })),
    findings: s.findings.map((f) => ({
      number: f.number,
      title: f.details.title,
      type: f.details.barrierType,
      status: f.status,
      open: isOpen(f.status),
      firstSeen: scanLabel(s, f.firstScanId),
      lastSeen: scanLabel(s, f.lastSeenScanId),
      latestNote: f.history.at(-1)?.note,
      suggestedImprovement: f.details.suggestedImprovement,
    })),
    summary: walkthroughSummary(s).lines,
  };
}

/* ---------- Lumi's state for the UI (all derived from session data) ---------- */

/** Visual moods for the Lumi character; see components/lumi/Sidekick.tsx. */
export type LumiMood =
  | "idle"
  | "welcome"
  | "ready"
  | "thinking"
  | "speaking"
  | "discovery"
  | "happy"
  | "unsure"
  | "concerned"
  | "celebrate";

/** Plain-language progress for a scan. These are the real pipeline steps, not decoration. */
export function stepLabel(step: Scan["step"]): string {
  switch (step) {
    case "queued":
      return "Waiting for the previous scan to finish";
    case "preparing":
      return "Getting your photo ready";
    case "analyzing":
      return "Looking for barriers";
    case "matching":
      return "Checking whether we've been here before";
    case "comparing":
      return "Re-checking what we found earlier";
    case "done":
      return "Done";
    case "error":
      return "Something went wrong";
  }
}

/** Lumi's mood after a scan, from what actually happened in it. */
export function scanMood(scan: Scan): LumiMood {
  if (scan.step === "error") return "concerned";
  if (scan.step !== "done") return "thinking";
  const ev = scan.events;
  if (ev.some((e) => e.kind === "status_change" && e.to === "appears_improved")) return "happy";
  if (ev.some((e) => e.kind === "new_finding")) return "discovery";
  if (
    ev.some(
      (e) =>
        e.kind === "revisit_question" ||
        e.kind === "image_unusable" ||
        (e.kind === "status_change" && e.to === "needs_verification"),
    )
  )
    return "unsure";
  if (ev.some((e) => e.kind === "seen_again" || (e.kind === "status_change" && e.to === "still_observed"))) return "concerned";
  return "idle";
}

/** Findings this scan touched: updated earlier ones first, then new ones. */
export function findingsForScan(s: Session, scanId: string): { finding: TrackedFinding; role: "new" | "updated" }[] {
  const scan = s.scans.find((sc) => sc.id === scanId);
  if (!scan) return [];
  const out: { finding: TrackedFinding; role: "new" | "updated" }[] = [];
  const seen = new Set<string>();
  for (const role of ["updated", "new"] as const) {
    for (const e of scan.events) {
      if (!("findingId" in e) || seen.has(e.findingId)) continue;
      const isNew = e.kind === "new_finding";
      if ((role === "new") !== isNew) continue;
      const f = s.findings.find((x) => x.id === e.findingId);
      if (!f) continue;
      seen.add(f.id);
      out.push({ finding: f, role });
    }
  }
  return out;
}

/** Short progress line for the walkthrough, from real counts. */
export function progressLine(s: Session): string {
  const done = s.scans.filter((sc) => sc.step === "done").length;
  const open = s.findings.filter((f) => isOpen(f.status)).length;
  if (done === 0) return "Let's start exploring together.";
  const areas = `We've looked at ${plural(s.areaCount, "area", "areas")} so far`;
  return open ? `${areas}, with ${plural(open, "concern", "concerns")} still open.` : `${areas}.`;
}

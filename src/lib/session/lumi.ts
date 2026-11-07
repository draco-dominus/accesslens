import type { FindingEvent, FindingStatus, Scan, ScanEvent, Session, TrackedFinding } from "./types";
import { isOpen } from "./types";
import { firstSentence } from "../text";
import { areas } from "./areas";

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
    case "rechecked":
      return e.status === "needs_verification"
        ? `I compared the ${findingName(finding!)} with ${scanLabel(s, e.referenceScanId)} again, and still couldn't confirm a change.`
        : `I compared the ${findingName(finding!)} with ${scanLabel(s, e.referenceScanId)} again: ${STATUS_LABEL[e.status].toLowerCase()}.`;
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
      areas(s).length > 1
        ? `We've looked at ${plural(areas(s).length, "area", "areas")} so far.`
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
      `We completed ${plural(done.length, "scan", "scans")} across ${plural(areas(s).length, "area", "areas")} and noted ${plural(s.findings.length, "potential barrier", "potential barriers")}.`,
    );
    if (improved.length) lines.push(`${cap(plural(improved.length, "concern appears", "concerns appear"))} improved: ${improved.map(findingName).join("; ")}.`);
    if (unresolved.length) lines.push(`${cap(plural(unresolved.length, "concern is", "concerns are"))} still open: ${unresolved.map(findingName).join("; ")}.`);
    if (needsVerification.length) lines.push(`${cap(plural(needsVerification.length, "concern needs", "concerns need"))} an in-person check: ${needsVerification.map(findingName).join("; ")}.`);
    if (s.findings.length === 0) lines.push("I didn't spot any of the barriers I look for, but photos can't show everything.");
  }
  lines.push("This walkthrough flags potential barriers from photos. It isn't a compliance assessment, and it can't confirm that a space is accessible.");
  return { scans: done.length, areas: areas(s).length, improved, unresolved, needsVerification, lines };
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
  const looked = `We've looked at ${plural(areas(s).length, "area", "areas")} so far`;
  return open ? `${looked}, with ${plural(open, "concern", "concerns")} still open.` : `${looked}.`;
}

/**
 * Contextual nudge to re-check a spot with Line up, after a scan whose photo is the latest view of at
 * least one open concern. Returns null when there's nothing to re-check here. Never forces anything:
 * the UI shows it as an optional action.
 */
export function lineUpSuggestion(s: Session, scanId: string): { scanId: string; text: string } | null {
  const scan = s.scans.find((sc) => sc.id === scanId);
  if (!scan || scan.step !== "done") return null;
  const open = s.findings.filter((f) => isOpen(f.status) && f.lastSeenScanId === scanId);
  if (!open.length) return null;
  const first = open[0];
  const name = findingName(first);
  const text =
    first.status === "needs_verification"
      ? `To settle the ${name}, re-check it from the same spot: tap Re-check and line up with this photo.`
      : open.length > 1
        ? `Once things here are moved or fixed, tap Re-check and line up with this photo, so I compare from the same spot.`
        : `Once the ${name} is moved or fixed, tap Re-check and line up with this photo, so I compare from the same spot.`;
  return { scanId, text };
}

/**
 * What Lumi is doing for a scan right now, derived only from the pipeline's real stages (never from a
 * timer). Several stages can be active at once (analysis runs alongside the revisit check).
 */
export function scanActivity(scan: Scan): { title: string; detail?: string } {
  const stages = scan.stages ?? [];
  const active = stages.filter((st) => st.state === "active");
  if (scan.step === "done") return { title: "Done" };
  if (scan.step === "error") return { title: "Couldn't finish this scan" };
  if (active.length) {
    const [first, ...rest] = active;
    return { title: first.label, detail: rest.length ? `Also: ${rest.map((st) => st.label.toLowerCase()).join("; ")}` : undefined };
  }
  if (scan.step === "queued") {
    return stages.some((st) => st.id === "prepare" && st.state === "done")
      ? { title: "Photo ready, waiting for the previous scan to finish" }
      : { title: "Waiting for the previous scan to finish" };
  }
  if (scan.step === "preparing") return { title: "Getting your photo ready" };
  // Between stages (e.g. all requests answered, results being combined).
  return stages.some((st) => st.state === "done" && st.id !== "prepare")
    ? { title: "Putting the results together" }
    : { title: "Starting the analysis" };
}

/* ---------- Ask Lumi: answers grounded in recorded data only ---------- */

export const LUMI_QUESTIONS = [
  { id: "why", label: "Why could it matter?", icon: "spark" },
  { id: "who", label: "Who might be affected?", icon: "people" },
  { id: "fix", label: "What could help?", icon: "wrench" },
  { id: "unknown", label: "What can’t you tell?", icon: "question" },
  { id: "changed", label: "Has it changed?", icon: "history" },
  { id: "next", label: "What’s still open?", icon: "list" },
] as const;
export type LumiQuestionId = (typeof LUMI_QUESTIONS)[number]["id"];

/**
 * Lumi's answer to a question about one finding, built ONLY from what's recorded: the AI analysis fields
 * and the comparison history. No new AI call, nothing generated. `source` says where it came from.
 */
export function answerQuestion(s: Session, f: TrackedFinding, q: LumiQuestionId): { text: string; source: string } {
  const d = f.details;
  const first = `From scan ${scanNumber(s, f.firstScanId)}’s analysis`;
  switch (q) {
    case "why":
      return { text: d.potentialImpact, source: first };
    case "who":
      return { text: `It could affect ${d.whoMayBeAffected.join(", ")}.`, source: first };
    case "fix":
      return { text: d.suggestedImprovement, source: first };
    case "unknown": {
      const scan = s.scans.find((sc) => sc.id === f.firstScanId);
      return {
        text: `${d.uncertainty}${scan?.analysis?.limitations ? ` More generally: ${scan.analysis.limitations}` : ""}`,
        source: first,
      };
    }
    case "changed": {
      if (f.history.length < 2) {
        return {
          text: `I’ve only seen this in scan ${scanNumber(s, f.firstScanId)} so far. Use Re-check this area from the same spot and I’ll compare the two photos.`,
          source: "From your scan history",
        };
      }
      const steps = f.history.slice(1).map((h) => `Scan ${scanNumber(s, h.scanId)}: ${STATUS_LABEL[h.status].toLowerCase()}. ${h.note}`);
      return {
        text: `${steps.join(" ")}${f.status === "appears_improved" ? " Please confirm it in person." : ""}`,
        source: "From the comparisons in your scan history",
      };
    }
    case "next": {
      const open = s.findings.filter((x) => isOpen(x.status) && x.id !== f.id);
      return {
        text: open.length
          ? `${progressLine(s)} Other open concerns: ${open.map((x) => `#${x.number} ${x.details.title}`).join("; ")}.`
          : `${progressLine(s)} There are no other open concerns right now.`,
        source: "From this walkthrough",
      };
    }
  }
}

function scanNumber(s: Session, id: string) {
  return s.scans.find((sc) => sc.id === id)?.number ?? "?";
}

/**
 * What to say about a finding ON a given scan's photo. A caption must describe the photo it sits on:
 * on a later scan, the original "what I saw" text describes a different photo, so it's not reused there.
 *  - first seen in this scan → Lumi's described location + what it saw;
 *  - compared in this scan → the comparison's observed change;
 *  - seen again here (duplicate) → that note;
 *  - otherwise (not part of this photo's results) → null.
 */
export function findingCaptionForScan(s: Session, scanId: string, f: TrackedFinding): { label: string; text: string } | null {
  if (f.firstScanId === scanId) {
    return { label: `#${f.number} · Where, as described by Lumi: ${f.details.locationInImage}`, text: firstSentence(f.details.visualEvidence) };
  }
  const here = f.history.filter((h) => h.scanId === scanId).at(-1);
  if (!here) return null;
  if (here.comparison) {
    const ref = here.referenceScanId ? scanNumber(s, here.referenceScanId) : "?";
    return { label: `#${f.number} · Compared with scan ${ref}: ${STATUS_LABEL[here.status].toLowerCase()}`, text: firstSentence(here.comparison.observedChange) };
  }
  return { label: `#${f.number} · ${STATUS_LABEL[here.status]} in this photo`, text: firstSentence(here.note) };
}

/* ---------- Re-check result headline ---------- */

const IMPROVED_HEADLINE: Record<TrackedFinding["details"]["barrierType"], string> = {
  obstructed_walkway: "Obstruction appears removed",
  protruding_obstacle: "Protruding object appears removed",
  steps: "Step barrier appears improved",
  other: "Barrier appears improved",
};

/**
 * One line summarizing a re-check, derived only from the recorded comparison. The specific "appears
 * removed" wording needs every piece of evidence to agree: the final (guarded) status is "appears
 * improved", the comparison itself said "improved", it judged the photos to be the same place, and the
 * area was clearly visible afterwards. Otherwise the line stays generic or says what's uncertain.
 * `detail` is the comparison's own description of the change.
 */
export function recheckHeadline(f: TrackedFinding, event: FindingEvent): { text: string; tone: "improved" | "still" | "unsure"; detail?: string } {
  const c = event.comparison;
  const detail = c ? firstSentence(c.observedChange) : undefined;
  if (event.status === "appears_improved") {
    const supported = c?.status === "improved" && c.sameLocation === "yes" && c.afterAreaVisible === "yes";
    return { text: supported ? IMPROVED_HEADLINE[f.details.barrierType] : "Appears improved", tone: "improved", detail };
  }
  if (event.status === "still_observed") return { text: "Still present in the new photo", tone: "still", detail };
  if (event.status === "needs_verification") return { text: "Couldn’t confirm a change — check on site", tone: "unsure", detail };
  return { text: "No change recorded", tone: "unsure", detail };
}

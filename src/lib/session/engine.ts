import type { Analysis } from "../analysis-schema";
import type { CompareSuccess, ComparisonStatus } from "../comparison-schema";
import { MAX_MATCH_CANDIDATES, type MatchSuccess, type SameArea } from "../match-schema";
import {
  isOpen,
  type FindingStatus,
  type Scan,
  type ScanEvent,
  type ScanRelation,
  type ScanStage,
  type Session,
  type TrackedFinding,
} from "./types";

/**
 * Pure walkthrough logic. Every function returns a new Session; nothing here calls the network.
 *
 * Safety rules enforced here:
 *  - A finding only becomes "appears_improved" from an /api/compare result of "improved"
 *    (which already passed the server's comparison guardrails). Absence from a new photo,
 *    a scene match, or a missing finding never resolves anything.
 *  - Scene matches come from /api/match; "unclear" (or a failed match) asks the user instead of guessing.
 *  - A new finding is merged into an existing one only when /api/match marked it a duplicate,
 *    which requires a confident same-area match and the same barrier type.
 */

export const MAX_COMPARISONS_PER_SCAN = 3;

export type CompareOutcome =
  | { findingId: string; referenceScanId: string; result: CompareSuccess }
  | { findingId: string; referenceScanId: string; error: string };

const COMPARE_TO_STATUS: Record<ComparisonStatus, FindingStatus> = {
  improved: "appears_improved",
  still_present: "still_observed",
  uncertain: "needs_verification",
};

export function createSession(id: string, now: number): Session {
  return { id, startedAt: now, finishedAt: null, scans: [], findings: [], areaCount: 0 };
}

export function addScan(s: Session, scanId: string, now: number, opts: { lineUpScanId?: string } = {}): Session {
  const scan: Scan = {
    id: scanId,
    lineUpScanId: opts.lineUpScanId,
    stages: [],
    number: s.scans.length + 1,
    createdAt: now,
    step: "queued",
    areaId: null,
    analysis: null,
    relations: [],
    pendingRevisit: [],
    comparedWith: [],
    events: [],
  };
  return { ...s, finishedAt: null, scans: [...s.scans, scan] };
}

function updateScan(s: Session, scanId: string, fn: (scan: Scan) => Scan): Session {
  return { ...s, scans: s.scans.map((sc) => (sc.id === scanId ? fn(sc) : sc)) };
}

export function setStep(s: Session, scanId: string, step: Scan["step"], error?: string, errorRetryable?: boolean): Session {
  return updateScan(s, scanId, (sc) => ({ ...sc, step, error, errorRetryable: step === "error" ? errorRetryable : undefined }));
}

/** Insert or update one processing stage (matched by id). */
export function setStage(s: Session, scanId: string, stage: Pick<ScanStage, "id"> & Partial<ScanStage>): Session {
  return updateScan(s, scanId, (sc) => {
    const stages = sc.stages ?? [];
    const i = stages.findIndex((x) => x.id === stage.id);
    const merged = { ...(i >= 0 ? stages[i] : { label: stage.id, state: "active" as const, startedAt: stage.startedAt ?? 0 }), ...stage } as ScanStage;
    return { ...sc, stages: i >= 0 ? stages.map((x, j) => (j === i ? merged : x)) : [...stages, merged] };
  });
}

/** Drop previous stages before a retry, so timings describe the attempt the user is waiting on. */
export function clearStages(s: Session, scanId: string): Session {
  return updateScan(s, scanId, (sc) => ({ ...sc, stages: [], doneAt: undefined }));
}

export function setAnalysis(s: Session, scanId: string, analysis: Analysis, model: string): Session {
  return updateScan(s, scanId, (sc) => ({ ...sc, analysis, analysisModel: model }));
}

export function getScan(s: Session, scanId: string): Scan | undefined {
  return s.scans.find((sc) => sc.id === scanId);
}

export function openFindingsLastSeenIn(s: Session, scanId: string): TrackedFinding[] {
  return s.findings.filter((f) => isOpen(f.status) && f.lastSeenScanId === scanId);
}

/**
 * Earlier scans worth checking against a new scan: only those that are the latest photo of at least
 * one OPEN finding and whose image is still available. Most recent first, capped.
 */
export function selectCandidates(
  s: Session,
  newScanId: string,
  hasImage: (scanId: string) => boolean,
): { scanId: string; findings: TrackedFinding[] }[] {
  return s.scans
    .filter((sc) => sc.id !== newScanId && sc.step === "done" && hasImage(sc.id))
    .map((sc) => ({ scanId: sc.id, number: sc.number, findings: openFindingsLastSeenIn(s, sc.id) }))
    .filter((c) => c.findings.length > 0)
    .sort((a, b) => b.number - a.number)
    .slice(0, MAX_MATCH_CANDIDATES)
    .map(({ scanId, findings }) => ({ scanId, findings }));
}

/** Open findings to re-check with /api/compare, for earlier scans judged to be the same area. Capped. */
export function comparisonTargets(s: Session, earlierScanIds: string[], cap = MAX_COMPARISONS_PER_SCAN) {
  const order = new Map(s.scans.map((sc) => [sc.id, sc.number]));
  return [...earlierScanIds]
    .sort((a, b) => (order.get(b) ?? 0) - (order.get(a) ?? 0))
    .flatMap((scanId) => openFindingsLastSeenIn(s, scanId).map((f) => ({ finding: f, referenceScanId: scanId })))
    .slice(0, cap);
}

/** Text describing a finding for /api/compare, built from stored data (never re-typed by the user). */
export function concernText(f: TrackedFinding): string {
  const d = f.details;
  return `${d.title}. ${d.locationInImage}. ${d.visualEvidence}`.slice(0, 500);
}

function areaCount(scans: Scan[]): number {
  return new Set(scans.map((sc) => sc.areaId).filter(Boolean)).size;
}

type StatusUpdate = {
  findingId: string;
  status: FindingStatus;
  source: "duplicate" | "comparison";
  note: string;
  seenInNewScan: boolean;
  outcome?: CompareOutcome;
  referenceScanId: string;
};

/** Combine a comparison result and/or a duplicate sighting into one status update. */
/** Same-place verdicts from successful comparisons against one earlier scan. */
function comparisonVerdicts(comparisons: CompareOutcome[], earlierScanId: string): SameArea[] {
  return comparisons.flatMap((c) => (c.referenceScanId === earlierScanId && "result" in c ? [c.result.comparison.sameLocation] : []));
}

/**
 * Combine the scene match's verdict with the comparisons' closer, evidence-first verdicts.
 * No comparison evidence → keep the scene match's verdict (it wasn't contradicted).
 * Any comparison sees the same place → "yes". All say different → "no". Otherwise the strongest remaining.
 */
export function reconcileArea(sceneMatch: SameArea, verdicts: SameArea[]): SameArea {
  if (!verdicts.length) return sceneMatch;
  if (verdicts.includes("yes")) return "yes";
  if (verdicts.every((v) => v === "no")) return "no";
  if (verdicts.includes("likely")) return "likely";
  return "unclear";
}

/** The comparison concluded the two photos don't (clearly) show the same place. */
function differentPlace(outcome: CompareOutcome | undefined): boolean {
  return Boolean(outcome && "result" in outcome && ["no", "unclear"].includes(outcome.result.comparison.sameLocation));
}

function decideUpdate(
  findingId: string,
  outcome: CompareOutcome | undefined,
  duplicate: boolean,
  referenceScanId: string,
  userConfirmed = false,
): StatusUpdate | null {
  const compared = outcome && "result" in outcome ? outcome.result : null;
  const compareStatus = compared ? COMPARE_TO_STATUS[compared.comparison.status] : null;

  // An automatic "likely" scene match can be wrong. If the comparison then finds the photos show a
  // different place, this wasn't a revisit: leave the finding exactly as it was. (If the USER said it's
  // the same spot, the disagreement is real and surfaces as needs_verification below.)
  if (!duplicate && !userConfirmed && differentPlace(outcome)) return null;

  if (duplicate) {
    if (compareStatus === "appears_improved") {
      // The comparison says improved, but analysis of the new photo still flagged the same barrier.
      return {
        findingId,
        status: "needs_verification",
        source: "comparison",
        note: "The comparison suggested an improvement, but the new photo still shows a similar barrier at the same spot.",
        seenInNewScan: true,
        outcome,
        referenceScanId,
      };
    }
    return {
      findingId,
      status: "still_observed",
      source: compareStatus === "still_observed" ? "comparison" : "duplicate",
      note:
        compareStatus === "still_observed"
          ? compared!.comparison.observedChange
          : "Seen again at the same spot in this scan.",
      seenInNewScan: true,
      outcome,
      referenceScanId,
    };
  }

  if (!compared || !compareStatus) return null; // failed comparison and no sighting: leave unchanged
  return {
    findingId,
    status: compareStatus,
    source: "comparison",
    note: compared.comparison.observedChange,
    seenInNewScan: compareStatus === "still_observed",
    outcome,
    referenceScanId,
  };
}

function applyUpdates(s: Session, scanId: string, updates: StatusUpdate[], now: number): { session: Session; events: ScanEvent[] } {
  const events: ScanEvent[] = [];
  const findings = s.findings.map((f) => {
    const u = updates.find((x) => x.findingId === f.id);
    if (!u) return f;
    const compared = u.outcome && "result" in u.outcome ? u.outcome.result : null;
    if (u.status !== f.status) {
      events.push({ kind: "status_change", findingId: f.id, from: f.status, to: u.status, referenceScanId: u.referenceScanId });
    } else if (u.seenInNewScan) {
      events.push({ kind: "seen_again", findingId: f.id });
    }
    return {
      ...f,
      status: u.status,
      lastSeenScanId: u.seenInNewScan ? scanId : f.lastSeenScanId,
      history: [
        ...f.history,
        {
          scanId,
          at: now,
          status: u.status,
          source: u.source,
          note: u.note,
          comparison: compared?.comparison,
          guardrail: compared?.guardrail ?? null,
          model: compared?.model,
        },
      ],
    };
  });
  return { session: { ...s, findings }, events };
}

/**
 * Fold one scan's results into the session: scene relations, comparisons, duplicate merges,
 * new findings, and the events Lumi will narrate.
 */
export function integrateScan(
  s: Session,
  scanId: string,
  input: {
    candidateScanIds: string[];
    match: MatchSuccess | null; // null = not run (no candidates) or failed
    matchFailed: boolean;
    comparisons: CompareOutcome[];
    newFindingIds: string[]; // pre-generated IDs, one per analysis finding
    /**
     * The user lined this photo up with this earlier scan, so its open findings were compared directly
     * (no scene-match request). It is NOT treated as confirmation: the comparisons decide whether it's the
     * same spot, and "different place" leaves the earlier findings untouched.
     */
    lineUpScanId?: string;
  },
  now: number,
): Session {
  const scan = getScan(s, scanId);
  if (!scan?.analysis) return s;
  const analysis = scan.analysis;
  const events: ScanEvent[] = [];
  const lineUp = input.lineUpScanId && getScan(s, input.lineUpScanId) ? input.lineUpScanId : undefined;

  // 1. Scene relations and area.
  const relations: ScanRelation[] = (input.match?.candidates ?? [])
    .filter((c) => c.scanId !== lineUp)
    .map((c) => ({ scanId: c.scanId, sameArea: c.sameArea, decidedBy: "auto" as const, evidence: c.evidence }));
  if (lineUp) {
    const verdicts = input.comparisons
      .filter((c) => c.referenceScanId === lineUp && "result" in c)
      .map((c) => ("result" in c ? c.result.comparison.sameLocation : "unclear"));
    const sameArea = verdicts.includes("yes") ? "yes" : verdicts.includes("likely") ? "likely" : verdicts.includes("no") ? "no" : "unclear";
    relations.push({ scanId: lineUp, sameArea, decidedBy: "lineup", evidence: "You lined this photo up with this scan; the comparison checked the fixed features." });
    if (sameArea === "yes" || sameArea === "likely") {
      events.push({ kind: "revisit", scanId: lineUp, sameArea, decidedBy: "lineup" });
    } else if (verdicts.length) {
      const n = getScan(s, lineUp)!.number;
      events.push({ kind: "notice", message: `This doesn't look like the same spot as scan ${n}, so I left its findings as they were.` });
    }
  }
  // Reconcile the quick scene match with the evidence-first comparisons before saying anything about
  // the location: a comparison looks closely at both photos, so where they disagree it wins.
  const contradicted: string[] = [];
  relations.forEach((r, i) => {
    if (r.decidedBy !== "auto") return;
    const verdict = reconcileArea(r.sameArea, comparisonVerdicts(input.comparisons, r.scanId));
    if (verdict !== r.sameArea) {
      if (verdict === "no") contradicted.push(r.scanId);
      relations[i] = { ...r, sameArea: verdict, evidence: `${r.evidence} (Updated after comparing the photos closely: ${verdict}.)` };
    }
  });
  for (const r of relations) {
    if (r.decidedBy !== "auto") continue;
    if (r.sameArea === "yes" || r.sameArea === "likely") {
      events.push({ kind: "revisit", scanId: r.scanId, sameArea: r.sameArea, decidedBy: "auto" });
    }
  }
  for (const id of contradicted) {
    events.push({
      kind: "notice",
      message: `At first this looked like scan ${getScan(s, id)!.number}, but a closer comparison found a different spot, so I left its findings as they were.`,
    });
  }
  const pendingRevisit = input.matchFailed
    ? input.candidateScanIds
    : relations.filter((r) => r.decidedBy === "auto" && r.sameArea === "unclear").map((r) => r.scanId);
  if (input.matchFailed && pendingRevisit.length) {
    events.push({ kind: "notice", message: "I couldn't automatically check whether this is an area we've already scanned." });
  }

  const confirmed = relations.filter((r) => r.sameArea === "yes").map((r) => getScan(s, r.scanId)!);
  const areaId =
    confirmed.sort((a, b) => b.number - a.number)[0]?.areaId ?? `area-${scanId}`;

  // 2. Updates to existing findings from comparisons and duplicate sightings.
  const duplicates = new Map((input.match?.duplicates ?? []).map((d) => [d.findingId, d.newFindingIndex]));
  const touched = new Set([...input.comparisons.map((c) => c.findingId), ...duplicates.keys()]);
  const updates: StatusUpdate[] = [];
  for (const findingId of touched) {
    const finding = s.findings.find((f) => f.id === findingId);
    if (!finding) continue;
    const outcome = input.comparisons.find((c) => c.findingId === findingId);
    const u = decideUpdate(findingId, outcome, duplicates.has(findingId), outcome?.referenceScanId ?? finding.lastSeenScanId);
    if (u) updates.push(u);
    if (outcome && "error" in outcome) {
      events.push({ kind: "notice", message: `I couldn't compare finding #${finding.number} with the earlier photo this time.` });
    }
  }
  const applied = applyUpdates(s, scanId, updates, now);
  events.push(...applied.events);
  let next = applied.session;

  // 3. New findings (excluding duplicates of existing ones).
  const duplicateIndexes = new Set(duplicates.values());
  const added: TrackedFinding[] = [];
  const maxNumber = next.findings.reduce((m, f) => Math.max(m, f.number), 0);
  analysis.findings.forEach((details, i) => {
    if (duplicateIndexes.has(i)) return;
    const id = input.newFindingIds[i];
    added.push({
      id,
      number: maxNumber + added.length + 1,
      details,
      status: "observed",
      firstScanId: scanId,
      lastSeenScanId: scanId,
      history: [{ scanId, at: now, status: "observed", source: "analysis", note: details.visualEvidence, model: scan.analysisModel }],
    });
    events.push({ kind: "new_finding", findingId: id });
  });
  next = { ...next, findings: [...next.findings, ...added] };

  if (!analysis.imageUsable) events.push({ kind: "image_unusable", reason: analysis.limitations });
  else if (analysis.findings.length === 0) events.push({ kind: "no_findings" });
  if (pendingRevisit.length) events.push({ kind: "revisit_question", scanIds: pendingRevisit });

  next = updateScan(next, scanId, (sc) => ({
    ...sc,
    step: "done",
    error: undefined,
    areaId,
    relations,
    pendingRevisit,
    comparedWith: [...new Set(input.comparisons.map((c) => c.referenceScanId))],
    events,
    doneAt: now,
  }));
  return { ...next, areaCount: areaCount(next.scans) };
}

/**
 * The user confirmed that `scanId` revisits `earlierScanId`. Comparisons for that scan's open findings
 * have been run; apply them. Even with the user's confirmation, "improved" still requires the
 * comparison (and its server-side guardrails) to say so.
 */
export function applyUserRevisit(
  s: Session,
  scanId: string,
  earlierScanId: string,
  comparisons: CompareOutcome[],
  now: number,
): Session {
  const scan = getScan(s, scanId);
  const earlier = getScan(s, earlierScanId);
  if (!scan || !earlier) return s;
  const events: ScanEvent[] = [{ kind: "revisit", scanId: earlierScanId, sameArea: "yes", decidedBy: "user" }];

  const updates: StatusUpdate[] = [];
  for (const outcome of comparisons) {
    const u = decideUpdate(outcome.findingId, outcome, false, earlierScanId, true);
    if (u) updates.push(u);
    else events.push({ kind: "notice", message: "I couldn't compare one of the earlier findings this time." });
  }
  const applied = applyUpdates(s, scanId, updates, now);
  events.push(...applied.events);
  // No automatic merging here: two different barriers can share a type (e.g. two chairs). Possible
  // duplicates are offered via duplicateSuggestions() and merged only after explicit confirmation.

  const next = updateScan(applied.session, scanId, (sc) => ({
    ...sc,
    areaId: earlier.areaId ?? sc.areaId,
    relations: [
      ...sc.relations.filter((r) => r.scanId !== earlierScanId),
      { scanId: earlierScanId, sameArea: "yes", decidedBy: "user", evidence: "Confirmed by you." },
    ],
    pendingRevisit: sc.pendingRevisit.filter((id) => id !== earlierScanId),
    comparedWith: [...new Set([...sc.comparedWith, earlierScanId])],
    events: [...sc.events, ...events],
  }));
  return { ...next, areaCount: areaCount(next.scans) };
}

/**
 * Possible duplicates the user may confirm, one specific pair at a time: a finding first recorded in
 * `scanId` with the same barrier type as an earlier finding that a comparison in this same scan found
 * still present. These are only suggestions; nothing is merged without confirmDuplicate().
 */
export function duplicateSuggestions(s: Session, scanId: string): { newFindingId: string; existingFindingId: string }[] {
  const rechecked = s.findings.filter(
    (f) =>
      f.firstScanId !== scanId &&
      f.status === "still_observed" &&
      f.history.some((h) => h.scanId === scanId && h.source === "comparison" && h.status === "still_observed"),
  );
  const fresh = s.findings.filter((f) => f.firstScanId === scanId && f.history.length === 1);
  return fresh.flatMap((n) =>
    rechecked
      .filter((e) => e.details.barrierType === n.details.barrierType)
      .map((e) => ({ newFindingId: n.id, existingFindingId: e.id })),
  );
}

/**
 * The user confirmed that `newFindingId` (recorded in `scanId`) is the same barrier as `existingFindingId`.
 * Only pairs offered by duplicateSuggestions() are accepted. The new finding is removed and every event
 * that referenced it is dropped, so no event points at a deleted finding.
 */
export function confirmDuplicate(s: Session, scanId: string, newFindingId: string, existingFindingId: string, now: number): Session {
  const allowed = duplicateSuggestions(s, scanId).some((p) => p.newFindingId === newFindingId && p.existingFindingId === existingFindingId);
  if (!allowed) return s;
  const dup = s.findings.find((f) => f.id === newFindingId)!;
  const existing = s.findings.find((f) => f.id === existingFindingId)!;
  const findings = s.findings
    .filter((f) => f.id !== newFindingId)
    .map((f) =>
      f.id === existingFindingId
        ? {
            ...f,
            lastSeenScanId: scanId,
            history: [
              ...f.history,
              { scanId, at: now, status: f.status, source: "duplicate" as const, note: `You confirmed finding #${dup.number} was the same barrier, so it was merged into this one.` },
            ],
          }
        : f,
    );
  const scans = s.scans.map((sc) => {
    const events = sc.events.filter((e) => !("findingId" in e && e.findingId === newFindingId));
    if (sc.id === scanId) {
      events.push({ kind: "notice", message: `You confirmed finding #${dup.number} is the same barrier as #${existing.number}, so I merged them.` });
    }
    return { ...sc, events };
  });
  return { ...s, findings, scans };
}

export function declineRevisit(s: Session, scanId: string, earlierScanId: string): Session {
  const next = updateScan(s, scanId, (sc) => ({
    ...sc,
    relations: [
      ...sc.relations.filter((r) => r.scanId !== earlierScanId),
      { scanId: earlierScanId, sameArea: "no", decidedBy: "user", evidence: "You said this is a different area." },
    ],
    pendingRevisit: sc.pendingRevisit.filter((id) => id !== earlierScanId),
    events: [...sc.events, { kind: "revisit_declined", scanId: earlierScanId }],
  }));
  return next;
}

/** Earlier scans the user could manually say they're revisiting from `scanId` (open findings, image kept, not yet compared). */
export function manualRevisitOptions(s: Session, scanId: string, hasImage: (id: string) => boolean): Scan[] {
  const scan = getScan(s, scanId);
  if (!scan) return [];
  return s.scans.filter(
    (sc) =>
      sc.number < scan.number &&
      hasImage(sc.id) &&
      !scan.comparedWith.includes(sc.id) &&
      openFindingsLastSeenIn(s, sc.id).length > 0,
  );
}

/**
 * Scans whose full image must be kept: the latest photo of an open finding, scans in progress or
 * failed (retry), scans with an unanswered revisit question, and the newest scan.
 */
export function scansNeedingImages(s: Session): Set<string> {
  const keep = new Set(s.findings.filter((f) => isOpen(f.status)).map((f) => f.lastSeenScanId));
  for (const sc of s.scans) {
    if (sc.step !== "done") keep.add(sc.id); // in progress, or failed and may be retried
    if (sc.pendingRevisit.length) {
      keep.add(sc.id); // the user may still confirm a revisit, which compares against these
      sc.pendingRevisit.forEach((id) => keep.add(id));
    }
  }
  // Keep the newest scan so the user can still manually link it to an earlier area.
  const last = s.scans[s.scans.length - 1];
  if (last) keep.add(last.id);
  return keep;
}

export function finishSession(s: Session, now: number): Session {
  return { ...s, finishedAt: now };
}

import type { Analysis } from "../analysis-schema";
import type { CompareSuccess } from "../comparison-schema";
import type { MatchRequestContext, MatchSuccess } from "../match-schema";
import { concernText, MAX_COMPARISONS_PER_SCAN, openFindingsLastSeenIn, selectCandidates, type CompareOutcome } from "./engine";
import type { ScanStage, Session, TrackedFinding } from "./types";

/**
 * The AI part of one scan, as a pure async function with injected API calls (tested deterministically in
 * tests/scan-pipeline.test.ts). It decides WHICH requests run and in WHAT ORDER; the session engine
 * decides what the results mean.
 *
 * Two explicit intents (the user chooses, never the pipeline):
 *  - "new_area" (Scan new area, the default): analysis, plus — when earlier areas have open findings —
 *    the scene-match request, concurrently. The match is ONLY used to suggest "this looks like Area N"
 *    (the user decides whether to re-check). No comparison runs and nothing is merged automatically, so
 *    scanning A → B → C never silently turns into a before/after.
 *  - "recheck" (Re-check this area, via Line up): the chosen earlier photo's open findings are compared
 *    directly with the new photo, alongside analysis — no scene-match request. The comparison's own
 *    evidence-first same-place check (and its guardrails) still decides; "different place" changes nothing.
 *
 * Duplicate detection needs the new findings, so it's a follow-up match request that runs ONLY for a
 * re-check whose place was confirmed and where a new finding has the same barrier type as an open one.
 * If analysis fails, the concurrent requests are aborted so they don't spend quota.
 */

export type StageUpdate = Pick<ScanStage, "id"> & Partial<ScanStage>;

type Timed = { timing?: ScanStage["timing"] };
export type PipelineDeps = {
  session: () => Session;
  blobOf: (scanId: string) => Blob | undefined;
  analyze: (blob: Blob, signal: AbortSignal) => Promise<{ analysis: Analysis; model: string } & Timed>;
  match: (blob: Blob, ctx: MatchRequestContext, images: Map<string, Blob>, signal: AbortSignal) => Promise<MatchSuccess & Timed>;
  compare: (before: Blob, after: Blob, concern: string, signal: AbortSignal) => Promise<{ result: CompareSuccess } & Timed>;
  stage?: (u: StageUpdate) => void;
  now?: () => number;
};

export type PipelineResult = {
  analysis: Analysis;
  model: string;
  candidateScanIds: string[];
  match: MatchSuccess | null;
  matchFailed: boolean;
  comparisons: CompareOutcome[];
  lineUpScanId?: string;
  /** What the user asked for: a new area, or a re-check of `lineUpScanId`. */
  intent: "new_area" | "recheck";
};

const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === "AbortError";
const findingRef = (f: TrackedFinding) => ({ id: f.id, barrierType: f.details.barrierType, title: f.details.title, locationInImage: f.details.locationInImage });

export async function runScanPipeline(
  deps: PipelineDeps,
  scanId: string,
  blob: Blob,
  opts: { signal: AbortSignal; lineUpScanId?: string },
): Promise<PipelineResult> {
  const now = deps.now ?? Date.now;
  const stage = deps.stage ?? (() => {});
  // Local controller: aborting it stops this scan's sibling requests (e.g. after analysis fails).
  const local = new AbortController();
  const onParentAbort = () => local.abort();
  if (opts.signal.aborted) local.abort();
  opts.signal.addEventListener("abort", onParentAbort);
  const signal = local.signal;
  // Why sibling requests were cancelled, for an honest stage note.
  let cancelReason = "Cancelled";

  const tracked = async <T extends Timed>(id: string, label: string, fn: () => Promise<T>): Promise<T> => {
    stage({ id, label, state: "active", startedAt: now() });
    try {
      const out = await fn();
      stage({ id, state: "done", endedAt: now(), timing: out.timing });
      return out;
    } catch (err) {
      stage({ id, state: isAbort(err) ? "skipped" : "failed", endedAt: now(), note: isAbort(err) ? cancelReason : undefined });
      throw err;
    }
  };

  const compareOne = async (f: TrackedFinding, referenceScanId: string): Promise<CompareOutcome> => {
    const before = deps.blobOf(referenceScanId);
    if (!before) return { findingId: f.id, referenceScanId, error: "Photo no longer available." };
    try {
      const { result } = await tracked(`compare:${f.id}`, `Re-checking #${f.number} ${f.details.title}`, () =>
        deps.compare(before, blob, concernText(f), signal),
      );
      return { findingId: f.id, referenceScanId, result };
    } catch (err) {
      if (isAbort(err)) throw err;
      return { findingId: f.id, referenceScanId, error: err instanceof Error ? err.message : "Comparison failed." };
    }
  };

  try {
    const session = deps.session();
    const lineUpFindings = opts.lineUpScanId && deps.blobOf(opts.lineUpScanId) ? openFindingsLastSeenIn(session, opts.lineUpScanId) : [];
    const lineUp = lineUpFindings.length ? opts.lineUpScanId : undefined;

    const analysisP = tracked("analyze", "Looking for barriers", () => deps.analyze(blob, signal));
    analysisP.catch(() => local.abort()); // analysis is required: stop the siblings if it fails

    // Revisit check, concurrently with analysis.
    let revisitP: Promise<{ candidateScanIds: string[]; match: MatchSuccess | null; matchFailed: boolean; comparisons: CompareOutcome[] }>;
    if (lineUp) {
      const targets = lineUpFindings.slice(0, MAX_COMPARISONS_PER_SCAN);
      revisitP = Promise.all(targets.map((f) => compareOne(f, lineUp))).then((comparisons) => ({
        candidateScanIds: [],
        match: null,
        matchFailed: false,
        comparisons,
      }));
    } else {
      const candidates = selectCandidates(session, scanId, (id) => Boolean(deps.blobOf(id)));
      revisitP = !candidates.length
        ? Promise.resolve({ candidateScanIds: [], match: null, matchFailed: false, comparisons: [] })
        : (async () => {
            const candidateScanIds = candidates.map((c) => c.scanId);
            let match: MatchSuccess | null = null;
            try {
              match = await tracked("match", "Checking whether we've been here before", () =>
                deps.match(
                  blob,
                  { newFindings: [], candidates: candidates.map((c) => ({ scanId: c.scanId, findings: c.findings.map(findingRef) })) },
                  new Map(candidates.map((c) => [c.scanId, deps.blobOf(c.scanId)!])),
                  signal,
                ),
              );
            } catch (err) {
              if (isAbort(err)) throw err;
              return { candidateScanIds, match: null, matchFailed: true, comparisons: [] }; // engine asks the user
            }
            // New area: a match is only a suggestion for the user. No automatic comparison.
            return { candidateScanIds, match, matchFailed: false, comparisons: [] as CompareOutcome[] };
          })();
    }
    revisitP.catch(() => {}); // awaited below; avoid an unhandled rejection if analysis fails first

    const { analysis, model } = await analysisP;

    // An unusable photo (too dark/blurry, not a place) can't support any revisit conclusion: stop the
    // revisit requests still in flight instead of waiting for results we'd discard.
    if (!analysis.imageUsable) {
      cancelReason = "Not needed: the photo couldn't be assessed";
      local.abort();
      return { analysis, model, candidateScanIds: [], match: null, matchFailed: false, comparisons: [], lineUpScanId: undefined, intent: lineUp ? "recheck" : "new_area" };
    }
    const revisit = await revisitP;

    // Follow-up duplicate check, only for a re-check whose place was confirmed (never for a new area).
    const sameAreaIds =
      lineUp && revisit.comparisons.some((c) => "result" in c && c.result.comparison.sameLocation === "yes") ? [lineUp] : [];
    const openInSameArea = sameAreaIds.flatMap((id) => openFindingsLastSeenIn(session, id));
    const possible = analysis.findings.some((nf) => openInSameArea.some((f) => f.details.barrierType === nf.barrierType));
    let match = revisit.match;
    if (possible) {
      try {
        const dedupe = await tracked("dedupe", "Checking for repeats of earlier findings", () =>
          deps.match(
            blob,
            {
              newFindings: analysis.findings.map(({ barrierType, title, locationInImage }) => ({ barrierType, title, locationInImage })),
              candidates: sameAreaIds.map((id) => ({ scanId: id, findings: openFindingsLastSeenIn(session, id).map(findingRef) })),
            },
            new Map(sameAreaIds.map((id) => [id, deps.blobOf(id)!])),
            signal,
          ),
        );
        // Keep the first scene verdicts; take duplicates from the follow-up (already guarded server-side:
        // same area "yes" again + same barrier type + one-to-one).
        match = { ...(match ?? { ok: true, model: dedupe.model, candidates: [] }), duplicates: dedupe.duplicates };
      } catch (err) {
        if (isAbort(err)) throw err;
        // No duplicate merge; the user can still confirm a specific duplicate explicitly.
      }
    }

    return { analysis, model, ...revisit, match, lineUpScanId: lineUp, intent: lineUp ? "recheck" : "new_area" };
  } finally {
    opts.signal.removeEventListener("abort", onParentAbort);
  }
}

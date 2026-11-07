import type { Analysis } from "../analysis-schema";
import type { CompareSuccess } from "../comparison-schema";
import type { MatchRequestContext, MatchSuccess } from "../match-schema";
import { comparisonTargets, concernText, MAX_COMPARISONS_PER_SCAN, openFindingsLastSeenIn, selectCandidates, type CompareOutcome } from "./engine";
import type { ScanStage, Session, TrackedFinding } from "./types";

/**
 * The AI part of one scan, as a pure async function with injected API calls (tested deterministically in
 * tests/scan-pipeline.test.ts). It decides WHICH requests run and in WHAT ORDER; the session engine
 * decides what the results mean.
 *
 * Latency design (rescans used to run analyze → match → compare strictly in sequence):
 *  - Analysis (new barriers) and the revisit check (scene match → comparisons) don't depend on each
 *    other, so they run concurrently. Wall time ≈ max(analyze, match + compare) instead of the sum.
 *  - Line up: when the user lined the photo up with an earlier scan in the camera, that scan's open
 *    findings are compared directly — no scene-match request. The comparison's own evidence-first
 *    same-place check (and its guardrails) still decides; a "different place" verdict changes nothing.
 *  - Duplicate detection needs the new findings, so it's a follow-up match request that runs ONLY when a
 *    duplicate is actually possible (a new finding has the same barrier type as an open finding in an
 *    area confirmed as the same). In the common case there's no extra request.
 *  - If analysis fails, the concurrent requests are aborted so they don't spend quota.
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

  const tracked = async <T extends Timed>(id: string, label: string, fn: () => Promise<T>): Promise<T> => {
    stage({ id, label, state: "active", startedAt: now() });
    try {
      const out = await fn();
      stage({ id, state: "done", endedAt: now(), timing: out.timing });
      return out;
    } catch (err) {
      stage({ id, state: isAbort(err) ? "skipped" : "failed", endedAt: now(), note: isAbort(err) ? "Cancelled" : undefined });
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
            const same = match.candidates.filter((c) => c.sameArea === "yes" || c.sameArea === "likely").map((c) => c.scanId);
            const targets = comparisonTargets(session, same);
            const comparisons = await Promise.all(targets.map((t) => compareOne(t.finding, t.referenceScanId)));
            return { candidateScanIds, match, matchFailed: false, comparisons };
          })();
    }
    revisitP.catch(() => {}); // awaited below; avoid an unhandled rejection if analysis fails first

    const { analysis, model } = await analysisP;
    const revisit = await revisitP;

    // An unusable photo (too dark/blurry, not a place) can't support any revisit conclusion.
    if (!analysis.imageUsable) {
      return { analysis, model, candidateScanIds: [], match: null, matchFailed: false, comparisons: [], lineUpScanId: undefined };
    }

    // Follow-up duplicate check, only when a duplicate is possible.
    const sameAreaIds = lineUp
      ? revisit.comparisons.some((c) => "result" in c && c.result.comparison.sameLocation === "yes")
        ? [lineUp]
        : []
      : (revisit.match?.candidates ?? []).filter((c) => c.sameArea === "yes").map((c) => c.scanId);
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

    return { analysis, model, ...revisit, match, lineUpScanId: lineUp };
  } finally {
    opts.signal.removeEventListener("abort", onParentAbort);
  }
}

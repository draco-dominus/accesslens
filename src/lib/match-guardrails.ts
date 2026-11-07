import type { MatchModelOutput, MatchRequestContext, MatchSuccess, SameArea } from "./match-schema";

/**
 * Deterministic post-processing of the model's scene-match answer:
 *  - aliases (C1, F1, N1) are mapped back to client IDs; unknown aliases are ignored,
 *  - an earlier scan the model didn't answer for is treated as "unclear" (never as a match),
 *  - a new finding is merged into an existing one ONLY if that earlier scan is the same area with
 *    "yes" confidence, the barrier types match, and each finding is used at most once.
 * A wrong merge would hide a new barrier, so anything less certain stays a separate finding.
 */
export function resolveMatch(
  ctx: MatchRequestContext,
  out: MatchModelOutput,
  model: string,
): MatchSuccess {
  const byRef = new Map(out.candidates.map((c) => [c.ref.trim().toUpperCase(), c]));
  const candidates = ctx.candidates.map((cand, i) => {
    const answer = byRef.get(`C${i + 1}`);
    return {
      scanId: cand.scanId,
      sameArea: (answer?.sameArea ?? "unclear") as SameArea,
      evidence: answer?.locationEvidence ?? "The AI didn't assess this earlier scan.",
    };
  });

  // F-aliases are numbered across all candidates in order.
  const findingByAlias = new Map<string, { id: string; barrierType: string; candidateIndex: number }>();
  let n = 0;
  ctx.candidates.forEach((cand, ci) =>
    cand.findings.forEach((f) => findingByAlias.set(`F${++n}`, { id: f.id, barrierType: f.barrierType, candidateIndex: ci })),
  );

  const usedNew = new Set<number>();
  const usedExisting = new Set<string>();
  const duplicates: MatchSuccess["duplicates"] = [];
  for (const d of out.duplicates) {
    const newIndex = Number(d.newFinding.trim().toUpperCase().replace(/^N/, "")) - 1;
    const existing = findingByAlias.get(d.earlierFinding.trim().toUpperCase());
    const newFinding = ctx.newFindings[newIndex];
    if (!newFinding || !existing) continue;
    if (candidates[existing.candidateIndex].sameArea !== "yes") continue;
    if (existing.barrierType !== newFinding.barrierType) continue;
    if (usedNew.has(newIndex) || usedExisting.has(existing.id)) continue;
    usedNew.add(newIndex);
    usedExisting.add(existing.id);
    duplicates.push({ newFindingIndex: newIndex, findingId: existing.id });
  }

  return { ok: true, model, candidates, duplicates };
}

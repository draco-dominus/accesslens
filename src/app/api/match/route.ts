import { guardRequest } from "@/lib/request-guard.server";
import { errorResponse, fail, readForm } from "@/lib/api-errors.server";
import { matchScene } from "@/lib/gemini.server";
import { readImageField } from "@/lib/image.server";
import { resolveMatch } from "@/lib/match-guardrails";
import { MatchRequestContextSchema } from "@/lib/match-schema";

export const runtime = "nodejs";
export const maxDuration = 120;

// Earlier photos only need to show the scene's layout; a smaller size keeps the request light.
const CANDIDATE_MAX_EDGE = 1024;

/**
 * Walkthrough scene matching. Form fields:
 *   image              the new scan
 *   context            JSON: { newFindings, candidates: [{ scanId, findings }] }
 *   candidate:<scanId> one earlier scan image per candidate
 * Returns which earlier scans show the same area and which new findings duplicate recorded ones.
 * It never changes a finding's status: improvements are only judged by /api/compare.
 */
export async function POST(request: Request) {
  const blocked = guardRequest(request, "match");
  if (blocked) return blocked;
  const form = await readForm(request);
  if (form instanceof Response) return form;

  let ctx;
  try {
    const raw = form.get("context");
    ctx = MatchRequestContextSchema.parse(JSON.parse(typeof raw === "string" ? raw : ""));
  } catch {
    return fail(400, "BAD_CONTEXT", "Missing or invalid 'context' field.");
  }

  try {
    const [newImage, ...candidateImages] = await Promise.all([
      readImageField(form, "image", "new scan"),
      ...ctx.candidates.map((c) =>
        readImageField(form, `candidate:${c.scanId}`, "earlier scan", { maxEdge: CANDIDATE_MAX_EDGE }),
      ),
    ]);
    const { model, output } = await matchScene(newImage, candidateImages, ctx);
    const result = resolveMatch(ctx, output, model);
    // Counts only: no scan or session identifiers in logs.
    console.info("[match]", JSON.stringify({ model, candidates: result.candidates.map((c) => c.sameArea), duplicates: result.duplicates.length }));
    return Response.json(result);
  } catch (err) {
    return errorResponse(err, "match");
  }
}

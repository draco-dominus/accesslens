import { guardRequest } from "@/lib/request-guard.server";
import { errorResponse, fail, readForm } from "@/lib/api-errors.server";
import { applyComparisonGuardrails } from "@/lib/comparison-guardrails";
import { MAX_CONCERN_LENGTH, type CompareSuccess } from "@/lib/comparison-schema";
import { compareImages } from "@/lib/gemini.server";
import { readImageField } from "@/lib/image.server";

export const runtime = "nodejs";
export const maxDuration = 120;

const DISCLAIMER =
  "AI-generated comparison of two photos for one specific barrier. An \"improved\" result means this barrier looks " +
  "better in these photos. It does not mean the space is accessible or meets any standard. Confirm on site.";

export async function POST(request: Request) {
  const blocked = guardRequest(request, "compare");
  if (blocked) return blocked;
  const form = await readForm(request);
  if (form instanceof Response) return form;

  const rawConcern = form.get("concern");
  // Collapse control characters/whitespace; the text is user data embedded in the prompt.
  const concern = typeof rawConcern === "string" ? rawConcern.replace(/\s+/g, " ").trim() : "";
  if (!concern) {
    return fail(400, "NO_CONCERN", "Describe the barrier to check (e.g. 'Chair blocking the walkway by the counter').");
  }
  if (concern.length > MAX_CONCERN_LENGTH) {
    return fail(400, "CONCERN_TOO_LONG", `Keep the barrier description under ${MAX_CONCERN_LENGTH} characters.`);
  }

  try {
    const [before, after] = await Promise.all([
      readImageField(form, "before", "BEFORE"),
      readImageField(form, "after", "AFTER"),
    ]);
    const { model, comparison: raw } = await compareImages(before, after, concern);
    const { comparison, guardrail } = applyComparisonGuardrails(raw);
    if (guardrail) console.info("[compare]", JSON.stringify({ model, guardrail: guardrail.modelStatus, reasons: guardrail.reasons.length }));

    return Response.json({
      ok: true,
      model,
      concern,
      comparison,
      guardrail,
      disclaimer: DISCLAIMER,
    } satisfies CompareSuccess);
  } catch (err) {
    return errorResponse(err, "compare");
  }
}

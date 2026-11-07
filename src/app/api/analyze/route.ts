import { errorResponse, readForm } from "@/lib/api-errors.server";
import { analyzeImage } from "@/lib/gemini.server";
import { readImageField } from "@/lib/image.server";
import type { AnalyzeSuccess } from "@/lib/analysis-schema";

export const runtime = "nodejs";
export const maxDuration = 120;

const DISCLAIMER =
  "AI-generated observations from a single photo. These are potential barriers to review, not a compliance assessment. " +
  "A photo cannot confirm that a space is accessible; measurements and an on-site review are needed.";

export async function POST(request: Request) {
  const form = await readForm(request);
  if (form instanceof Response) return form;

  try {
    // Format is detected from file bytes, then re-encoded as a clean JPEG (HEIC supported).
    const image = await readImageField(form, "image", "photo");
    const { model, analysis } = await analyzeImage(image);
    return Response.json({ ok: true, model, analysis, disclaimer: DISCLAIMER } satisfies AnalyzeSuccess);
  } catch (err) {
    return errorResponse(err, "analyze");
  }
}

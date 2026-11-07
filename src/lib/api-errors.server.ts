import "server-only";

import { AnalysisError } from "./gemini.server";
import { ImageError } from "./image.server";

export function fail(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

/** Map known errors to safe client responses; never leak config or internal details. */
export function errorResponse(err: unknown, label: string) {
  if (err instanceof ImageError) return fail(err.httpStatus, err.code, err.message);
  if (err instanceof AnalysisError) {
    if (err.code === "CONFIG") {
      console.error(`[${label}]`, err.message);
      return fail(err.httpStatus, err.code, "The server is not configured correctly.");
    }
    return fail(err.httpStatus, err.code, err.message);
  }
  // No request data in logs: just the error type and a short message.
  console.error(`[${label}] unexpected error`, err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : typeof err);
  return fail(500, "INTERNAL", "Something went wrong while processing the request.");
}

export async function readForm(request: Request): Promise<FormData | Response> {
  try {
    return await request.formData();
  } catch {
    return fail(400, "BAD_REQUEST", "Expected multipart/form-data.");
  }
}

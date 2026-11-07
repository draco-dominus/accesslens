"use client";

import type { Analysis, AnalyzeResponse } from "../analysis-schema";
import type { CompareResponse, CompareSuccess } from "../comparison-schema";
import type { MatchRequestContext, MatchResponse, MatchSuccess } from "../match-schema";

/**
 * Browser-side calls to the AccessLens API routes. The API key never leaves the server:
 * these only talk to our own /api/* endpoints. All images sent are the normalized JPEGs
 * returned by /api/preview (HEIC already converted, metadata stripped).
 */

async function postForm<T>(url: string, body: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!data || data.ok === false) {
    throw new Error(data?.error?.message ?? `The server returned an error (HTTP ${res.status}).`);
  }
  return data as T;
}

export type PreparedImage = { blob: Blob; width: number; height: number; sourceFormat: string };

export async function prepareImage(file: File): Promise<PreparedImage> {
  const body = new FormData();
  body.append("image", file);
  let res: Response;
  try {
    res = await fetch("/api/preview", { method: "POST", body });
  } catch {
    throw new Error("Couldn't reach the server to prepare this photo.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error?.message ?? `Couldn't prepare this photo (HTTP ${res.status}).`);
  }
  return {
    blob: await res.blob(),
    width: Number(res.headers.get("X-Image-Width")) || 0,
    height: Number(res.headers.get("X-Image-Height")) || 0,
    sourceFormat: res.headers.get("X-Source-Format") ?? "unknown",
  };
}

export async function analyze(image: Blob): Promise<{ analysis: Analysis; model: string }> {
  const body = new FormData();
  body.append("image", image, "scan.jpg");
  const data = await postForm<Extract<AnalyzeResponse, { ok: true }>>("/api/analyze", body);
  return { analysis: data.analysis, model: data.model };
}

export async function matchScene(
  image: Blob,
  ctx: MatchRequestContext,
  candidateImages: Map<string, Blob>,
): Promise<MatchSuccess> {
  const body = new FormData();
  body.append("image", image, "scan.jpg");
  body.append("context", JSON.stringify(ctx));
  for (const c of ctx.candidates) {
    const blob = candidateImages.get(c.scanId);
    if (blob) body.append(`candidate:${c.scanId}`, blob, `${c.scanId}.jpg`);
  }
  return postForm<Extract<MatchResponse, { ok: true }>>("/api/match", body);
}

export async function compare(before: Blob, after: Blob, concern: string): Promise<CompareSuccess> {
  const body = new FormData();
  body.append("before", before, "before.jpg");
  body.append("after", after, "after.jpg");
  body.append("concern", concern);
  return postForm<Extract<CompareResponse, { ok: true }>>("/api/compare", body);
}

/** Small JPEG for the scan timeline, so full-size images can be released once no longer needed. */
export async function makeThumbnail(blob: Blob, maxEdge = 320): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("thumbnail failed"))), "image/jpeg", 0.75),
    );
  } finally {
    bitmap.close();
  }
}

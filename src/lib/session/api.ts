"use client";

import type { Analysis, AnalyzeResponse } from "../analysis-schema";
import type { ChatRequest, ChatSuccess } from "../chat-schema";
import type { CompareResponse, CompareSuccess } from "../comparison-schema";
import type { MatchRequestContext, MatchResponse, MatchSuccess } from "../match-schema";

/**
 * Browser-side calls to the AccessLens API routes. The API key never leaves the server: these only
 * talk to our own /api/* endpoints. Images sent for analysis are the normalized JPEGs returned by
 * /api/preview (HEIC converted, metadata stripped).
 */

/** Error from an API call, keeping the server's structured code so the UI can react to it. */
export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number, // 0 = network failure
  ) {
    super(message);
    this.name = "ApiClientError";
  }
  /** Worth offering "Try again" for. Bad input (wrong file type, too large, blocked) won't change on retry. */
  get retryable(): boolean {
    return !["UNSUPPORTED_TYPE", "IMAGE_TOO_LARGE", "REQUEST_TOO_LARGE", "EMPTY_IMAGE", "BLOCKED", "DECODE_FAILED", "FORBIDDEN_ORIGIN", "CONFIG"].includes(this.code);
  }
}

export const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === "AbortError";

async function request(url: string, body: FormData, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { method: "POST", body, signal });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiClientError("NETWORK", "Couldn't reach the server. Check your connection and try again.", 0);
  }
}

async function toError(res: Response): Promise<ApiClientError> {
  const data = await res.json().catch(() => null);
  const code = typeof data?.error?.code === "string" ? data.error.code : `HTTP_${res.status}`;
  const message =
    typeof data?.error?.message === "string"
      ? data.error.message
      : res.status === 413
        ? "This photo is too large to upload. Please use a smaller photo."
        : `The server returned an error (HTTP ${res.status}).`;
  return new ApiClientError(code, message, res.status);
}

/* ---------- Timing ---------- */

/**
 * Where a request's time went: `clientMs` is the full round trip seen by the browser; the rest comes from
 * the server's Server-Timing header. clientMs − serverTotalMs ≈ network + upload/download time.
 */
export type CallTiming = {
  clientMs: number;
  serverTotalMs?: number;
  imageMs?: number;
  aiMs?: number;
  /** e.g. "gemma-4-26b-a4b-it a2 fallback" — model, attempt count, whether the fallback answered. */
  ai?: string;
};

export function parseServerTiming(header: string | null): Omit<CallTiming, "clientMs"> {
  const out: Omit<CallTiming, "clientMs"> = {};
  for (const part of (header ?? "").split(",")) {
    const [name, ...params] = part.trim().split(";");
    const dur = Number(params.find((p) => p.trim().startsWith("dur="))?.split("=")[1]);
    const desc = params.find((p) => p.trim().startsWith("desc="))?.split("=")[1]?.replace(/"/g, "");
    if (!Number.isFinite(dur)) continue;
    if (name === "total") out.serverTotalMs = dur;
    else if (name === "img") out.imageMs = dur;
    else if (name === "ai") {
      out.aiMs = dur;
      if (desc) out.ai = desc;
    }
  }
  return out;
}

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

async function postJson<T>(url: string, body: FormData, signal?: AbortSignal): Promise<T & { timing: CallTiming }> {
  const started = clock();
  const res = await request(url, body, signal);
  if (!res.ok) throw await toError(res);
  const data = await res.json().catch(() => null);
  if (!data || data.ok !== true) throw new ApiClientError("BAD_RESPONSE", "The server returned an unexpected response.", res.status);
  const timing: CallTiming = { clientMs: Math.round(clock() - started), ...parseServerTiming(res.headers.get("server-timing")) };
  return { ...(data as T), timing };
}

/* ---------- Upload size ---------- */

/** Stay under hosting body limits (Vercel functions: 4.5 MB) with room for form overhead. */
const MAX_DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024;
const SHRINK_MAX_EDGE = 2560;

/**
 * Large photos are downscaled in the browser before upload. createImageBitmap applies EXIF orientation
 * and the canvas drops metadata. Browsers that can't decode the file (e.g. HEIC outside Safari) get it
 * sent as-is if it fits, or a clear error if it doesn't.
 */
async function fitForUpload(file: File): Promise<Blob> {
  if (file.size <= MAX_DIRECT_UPLOAD_BYTES) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ApiClientError(
      "IMAGE_TOO_LARGE",
      "This photo is too large to upload from this browser. Try taking the photo in the app, or choose a smaller one.",
      413,
    );
  }
  try {
    const scale = Math.min(1, SHRINK_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.7]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
      if (blob && blob.size <= MAX_DIRECT_UPLOAD_BYTES) return blob;
    }
    throw new ApiClientError("IMAGE_TOO_LARGE", "This photo is too large to upload. Please choose a smaller one.", 413);
  } finally {
    bitmap.close();
  }
}

/* ---------- Endpoints ---------- */

export type PreparedImage = {
  blob: Blob;
  width: number;
  height: number;
  sourceFormat: string;
  /** "browser": decoded and re-encoded on the device (no upload). "server": via /api/preview (e.g. HEIC on non-Safari). */
  via: "browser" | "server";
  timing: CallTiming;
};

/** Same size the server normalizes to, so the AI sees an equivalent image either way. */
const PREPARED_MAX_EDGE = 1600;

/**
 * Turn a picked/captured photo into a ≤1600px JPEG for display and analysis.
 *
 * Fast path: the browser decodes it (JPEG/PNG/WebP everywhere, HEIC in Safari), applies EXIF
 * orientation and re-encodes it. The canvas carries no metadata (GPS is dropped) and nothing is
 * uploaded. The server still re-validates and re-normalizes every image it receives for analysis.
 * Fallback: /api/preview converts what the browser can't decode (e.g. HEIC in Chrome).
 */
export async function prepareImage(file: File, signal?: AbortSignal): Promise<PreparedImage> {
  const started = clock();
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const { blob, width, height } = await encodeJpeg(bitmap, PREPARED_MAX_EDGE, 0.85);
      return { blob, width, height, sourceFormat: file.type.replace("image/", "") || "image", via: "browser", timing: { clientMs: Math.round(clock() - started) } };
    } finally {
      bitmap.close();
    }
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // fall through to the server
  }
  const body = new FormData();
  body.append("image", await fitForUpload(file), file.name || "photo");
  const res = await request("/api/preview", body, signal);
  if (!res.ok) throw await toError(res);
  const blob = await res.blob();
  return {
    blob,
    width: Number(res.headers.get("X-Image-Width")) || 0,
    height: Number(res.headers.get("X-Image-Height")) || 0,
    sourceFormat: res.headers.get("X-Source-Format") ?? "unknown",
    via: "server",
    timing: { clientMs: Math.round(clock() - started), ...parseServerTiming(res.headers.get("server-timing")) },
  };
}

async function encodeJpeg(bitmap: ImageBitmap, maxEdge: number, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error("encode failed");
  return { blob, width: canvas.width, height: canvas.height };
}

export async function analyze(image: Blob, signal?: AbortSignal): Promise<{ analysis: Analysis; model: string; timing: CallTiming }> {
  const body = new FormData();
  body.append("image", image, "scan.jpg");
  const data = await postJson<Extract<AnalyzeResponse, { ok: true }>>("/api/analyze", body, signal);
  return { analysis: data.analysis, model: data.model, timing: data.timing };
}

/** Earlier photos only need the scene layout; the server reduces them to 1024px anyway. */
const CANDIDATE_MAX_EDGE = 1024;

export async function matchScene(
  image: Blob,
  ctx: MatchRequestContext,
  candidateImages: Map<string, Blob>,
  signal?: AbortSignal,
): Promise<MatchSuccess & { timing: CallTiming }> {
  const body = new FormData();
  body.append("image", image, "scan.jpg");
  body.append("context", JSON.stringify(ctx));
  for (const c of ctx.candidates) {
    const blob = candidateImages.get(c.scanId);
    if (!blob) continue;
    const small = await makeThumbnail(blob, CANDIDATE_MAX_EDGE, 0.85).catch(() => blob);
    body.append(`candidate:${c.scanId}`, small, `${c.scanId}.jpg`);
  }
  return postJson<Extract<MatchResponse, { ok: true }>>("/api/match", body, signal);
}

export async function compare(
  before: Blob,
  after: Blob,
  concern: string,
  signal?: AbortSignal,
): Promise<{ result: CompareSuccess; timing: CallTiming }> {
  const body = new FormData();
  body.append("before", before, "before.jpg");
  body.append("after", after, "after.jpg");
  body.append("concern", concern);
  const { timing, ...result } = await postJson<Extract<CompareResponse, { ok: true }>>("/api/compare", body, signal);
  return { result, timing };
}

/** Smaller JPEG copy (timeline thumbnails, match candidates). */
export async function makeThumbnail(blob: Blob, maxEdge = 320, quality = 0.75): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("thumbnail failed"))), "image/jpeg", quality),
    );
  } finally {
    bitmap.close();
  }
}

/* ---------- Ask Lumi ---------- */

/** Client wait limit: the server gives the model ≤18 s; this only guards against a hung connection. */
const CHAT_CLIENT_TIMEOUT_MS = 30_000;

/**
 * Ask Lumi a free-text question (POST /api/chat, JSON, text only — no photos). One request per call:
 * never retried automatically. On 429 the error message includes the wait the server asked for.
 */
export async function askLumi(body: ChatRequest, signal?: AbortSignal): Promise<ChatSuccess> {
  const timeout = AbortSignal.timeout(CHAT_CLIENT_TIMEOUT_MS);
  const combined = signal ? anySignal(signal, timeout) : timeout;
  let res: Response;
  try {
    res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: combined });
  } catch (err) {
    if (signal?.aborted) throw err; // the caller cancelled (finding/inspection changed)
    if (timeout.aborted) throw new ApiClientError("AI_TIMEOUT", "Lumi took too long to answer. Please try again.", 0);
    throw new ApiClientError("NETWORK", "Couldn't reach Lumi. Check your connection and try again.", 0);
  }
  if (!res.ok) {
    const error = await toError(res);
    const wait = Number(res.headers.get("retry-after"));
    if (res.status === 429 && Number.isFinite(wait) && wait > 0) {
      throw new ApiClientError(error.code, `${error.message} (about ${Math.ceil(wait)} s)`, res.status);
    }
    throw error;
  }
  const data = (await res.json().catch(() => null)) as ChatSuccess | null;
  if (!data || data.ok !== true || typeof data.answer !== "string") throw new ApiClientError("BAD_RESPONSE", "Lumi sent an answer we couldn't read. Please try again.", res.status);
  return data;
}

/** AbortSignal.any with a fallback for older Safari (< 17.4). */
function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  if (a.aborted || b.aborted) ctrl.abort();
  a.addEventListener("abort", stop, { once: true });
  b.addEventListener("abort", stop, { once: true });
  return ctrl.signal;
}

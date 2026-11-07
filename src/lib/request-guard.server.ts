import "server-only";

import { fail } from "./api-errors.server";
import { FixedWindowLimiter } from "./rate-limit";

/**
 * Cheap checks that run BEFORE a request body is parsed or any AI call is made.
 *
 *  1. Size: reject requests whose Content-Length exceeds the route's cap (no body is buffered).
 *     Note: on Vercel, function request bodies are capped at 4.5 MB by the platform regardless.
 *  2. Origin: browsers send an Origin header on cross-site POSTs; reject ones from other sites so
 *     other web pages can't spend this app's AI quota from their visitors' browsers. (Scripts can
 *     omit/forge Origin, so this is not authentication.)
 *  3. Rate limit per client IP, per minute and per hour. Per-instance only — see rate-limit.ts.
 *     Defaults leave room for a brisk walkthrough (each scan = 1 preview + 1 analyze + ≤1 match + ≤3 compares).
 */

export type GuardedRoute = "preview" | "analyze" | "match" | "compare";

const MB = 1024 * 1024;
const MAX_BODY_BYTES: Record<GuardedRoute, number> = {
  preview: 21 * MB, // original photo (≤ 20 MB) + form overhead
  analyze: 8 * MB, // the app sends a normalized JPEG (~0.2–1 MB)
  match: 12 * MB, // new image + up to 4 smaller earlier images
  compare: 12 * MB, // two normalized JPEGs
};

const PER_MINUTE: Record<GuardedRoute, number> = { preview: 20, analyze: 10, match: 10, compare: 20 };
const PER_HOUR: Record<GuardedRoute, number> = { preview: 200, analyze: 120, match: 120, compare: 240 };

const limiters = Object.fromEntries(
  (Object.keys(PER_MINUTE) as GuardedRoute[]).map((r) => [
    r,
    { minute: new FixedWindowLimiter(PER_MINUTE[r], 60_000), hour: new FixedWindowLimiter(PER_HOUR[r], 3_600_000) },
  ]),
) as Record<GuardedRoute, { minute: FixedWindowLimiter; hour: FixedWindowLimiter }>;

/** Client IP as reported by the platform proxy. Used only as an in-memory key; never logged. */
function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches may omit it; non-browser clients usually do
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Returns an error Response to send, or null if the request may proceed. */
export function guardRequest(request: Request, route: GuardedRoute): Response | null {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES[route]) {
    return fail(413, "REQUEST_TOO_LARGE", "This upload is too large. Please use a smaller photo.");
  }
  if (!sameOrigin(request)) {
    return fail(403, "FORBIDDEN_ORIGIN", "Requests from other websites aren't allowed.");
  }
  if (process.env.ACCESSLENS_DISABLE_RATE_LIMIT !== "1") {
    const key = clientKey(request);
    const { minute, hour } = limiters[route];
    const perMinute = minute.check(key);
    const verdict = perMinute.allowed ? hour.check(key) : perMinute; // don't charge the hour for refused requests
    if (!verdict.allowed) {
      const seconds = Math.max(1, Math.ceil(verdict.retryAfterMs / 1000));
      console.warn("[guard]", JSON.stringify({ route, event: "rate_limited", retryAfterSeconds: seconds }));
      const res = fail(429, "RATE_LIMITED", "You're scanning faster than Lumi can keep up. Please wait a moment and try again.");
      res.headers.set("Retry-After", String(seconds));
      return res;
    }
  }
  return null;
}

import "server-only";

import type { AiDiagnostics } from "./gemini.server";

/**
 * Per-request timing, exposed as a standard Server-Timing header (readable by our own client, shown in
 * browser devtools) and one structured log line. Contains durations, model name, attempt count and
 * failure kinds only — never images, prompts, keys, IPs, or scan/session identifiers.
 */
export class RequestTimer {
  private readonly start = Date.now();
  private marks: { name: string; ms: number; desc?: string }[] = [];

  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      this.marks.push({ name, ms: Date.now() - t });
    }
  }

  ai(diag: AiDiagnostics) {
    this.marks.push({ name: "ai", ms: diag.aiMs, desc: `${diag.model} a${diag.attempts}${diag.fallbackUsed ? " fallback" : ""}` });
  }

  header(): string {
    const parts = [...this.marks, { name: "total", ms: Date.now() - this.start }];
    return parts
      .map((p) => `${p.name};dur=${p.ms}${p.desc ? `;desc="${p.desc.replace(/["\\]/g, "")}"` : ""}`)
      .join(", ");
  }

  log(route: string, diag?: AiDiagnostics) {
    const timings = Object.fromEntries(this.marks.map((m) => [m.name, m.ms]));
    console.info(
      "[timing]",
      JSON.stringify({
        route,
        totalMs: Date.now() - this.start,
        ...timings,
        ...(diag && { model: diag.model, attempts: diag.attempts, fallbackUsed: diag.fallbackUsed, failures: diag.failures }),
      }),
    );
  }

  /** Attach the Server-Timing header and log. */
  finish<R extends Response>(route: string, res: R, diag?: AiDiagnostics): R {
    res.headers.set("Server-Timing", this.header());
    this.log(route, diag);
    return res;
  }
}

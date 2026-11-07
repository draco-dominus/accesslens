/**
 * Fixed-window rate limiter held in memory. Pure and deterministic (injectable clock) for tests.
 *
 * IMPORTANT: on serverless platforms (Vercel) each function instance has its own memory, instances
 * come and go, and requests are spread across them. This limiter therefore only bounds traffic per
 * instance — a useful brake on accidental loops and casual abuse, NOT a global guarantee. Global limits
 * need a shared store or the platform firewall (see the deployment notes in the report / README).
 */
export class FixedWindowLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      if (!w && this.windows.size >= this.maxKeys) this.prune(t);
      w = { start: t, count: 0 };
      this.windows.set(key, w);
    }
    if (w.count >= this.limit) return { allowed: false, retryAfterMs: w.start + this.windowMs - t };
    w.count++;
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Drop expired windows; if still full, drop the oldest so memory stays bounded. */
  private prune(t: number) {
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}

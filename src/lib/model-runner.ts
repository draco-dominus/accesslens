/**
 * Provider-agnostic retry/fallback runner for model calls. Pure (no SDK, no env), with an injectable
 * clock and sleep, so its timing behaviour is unit-tested deterministically (tests/model-runner.test.ts).
 *
 * Budget rules:
 *  - The whole call has one overall deadline (`budgetMs`), sized to fit inside the route's maxDuration.
 *  - When a usable fallback exists, the primary model must stop early enough to leave `fallbackReserveMs`
 *    for the fallback: primary retries can never starve the fallback (the bug this module fixes).
 *  - A timeout moves straight to the next model; a hang is not retried.
 *  - A long quota error (e.g. a free-tier daily cap) puts that model on cooldown and moves on, so later
 *    requests don't spend requests or time re-hitting it.
 *  - Non-retryable provider errors (bad request, model not found) move straight to the next model.
 */

export type FailureKind =
  | "timeout" // the attempt exceeded its time limit
  | "quota_exhausted" // 429 with a long retry delay (daily cap): cool the model down
  | "rate_limited" // 429 with a short retry delay: worth one short wait
  | "provider_error" // 5xx / overloaded: retryable
  | "provider_rejected" // other 4xx: retrying won't help
  | "invalid_output" // response failed JSON/Zod validation: retryable
  | "network"; // connection failure: retryable

export type Classified = { kind: FailureKind; retryable: boolean; status?: number; retryAfterMs?: number };

export type RunnerLogEvent =
  | { type: "attempt_failed"; label: string; model: string; attempt: number; kind: FailureKind; status?: number; elapsedMs: number; detail?: unknown }
  | { type: "model_skipped"; label: string; model: string; reason: "cooldown"; cooldownMinutes: number }
  | { type: "model_cooldown"; label: string; model: string; cooldownMinutes: number }
  | { type: "fallback_used"; label: string; model: string };

export type RunnerOptions<T> = {
  label: string;
  /** Primary first, then fallbacks. Empty strings and duplicates are ignored. */
  models: string[];
  attempt: (model: string, timeoutMs: number) => Promise<T>;
  /** Classify a failure, or return "fatal" to rethrow it immediately (e.g. content blocked, misconfiguration). */
  classify: (err: unknown) => Classified | "fatal";
  budgetMs: number;
  attemptTimeoutMs: number;
  minAttemptMs: number;
  maxAttemptsPerModel: number;
  fallbackReserveMs: number;
  /** Per-model cooldown expiry timestamps (ms). Shared across calls by the caller. */
  cooldowns: Map<string, number>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (e: RunnerLogEvent) => void;
};

export type Failure = { model: string; attempt: number; kind: FailureKind; status?: number };
export type RunnerResult<T> =
  | { ok: true; model: string; value: T; failures: Failure[]; attempts: number }
  | { ok: false; failures: Failure[]; skipped: string[] };

const BACKOFF_BASE_MS = 500;

export async function runWithFallback<T>(o: RunnerOptions<T>): Promise<RunnerResult<T>> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = o.log ?? (() => {});
  const failures: Failure[] = [];
  const skipped: string[] = [];
  const start = now();
  const deadline = start + o.budgetMs;

  const ordered = [...new Set(o.models.filter(Boolean))];
  const usable = ordered.filter((m) => {
    const until = o.cooldowns.get(m);
    if (until && until > now()) {
      skipped.push(m);
      log({ type: "model_skipped", label: o.label, model: m, reason: "cooldown", cooldownMinutes: Math.ceil((until - now()) / 60_000) });
      return false;
    }
    return true;
  });

  for (let i = 0; i < usable.length; i++) {
    const model = usable[i];
    if (i > 0) log({ type: "fallback_used", label: o.label, model });
    // Leave room for one full attempt of every remaining model.
    const laterModels = usable.length - 1 - i;
    const modelDeadline = deadline - laterModels * o.fallbackReserveMs;

    for (let attempt = 1; attempt <= o.maxAttemptsPerModel; attempt++) {
      const remaining = modelDeadline - now();
      if (remaining < o.minAttemptMs) break;
      const attemptStart = now();
      try {
        const value = await o.attempt(model, Math.min(o.attemptTimeoutMs, remaining));
        return { ok: true, model, value, failures, attempts: failures.length + 1 };
      } catch (err) {
        const c = o.classify(err);
        if (c === "fatal") throw err;
        failures.push({ model, attempt, kind: c.kind, status: c.status });
        log({ type: "attempt_failed", label: o.label, model, attempt, kind: c.kind, status: c.status, elapsedMs: now() - attemptStart, detail: err });

        // Don't wait on a hanging model twice when another model can take over. With no fallback left
        // (none configured, or it's cooling down), one more try beats failing outright.
        if (c.kind === "timeout" && (laterModels > 0 || attempt >= 2)) break;
        if (c.kind === "timeout") continue;
        if (c.kind === "quota_exhausted") {
          const ms = c.retryAfterMs ?? 60_000;
          o.cooldowns.set(model, now() + ms);
          log({ type: "model_cooldown", label: o.label, model, cooldownMinutes: Math.ceil(ms / 60_000) });
          break;
        }
        if (!c.retryable || attempt === o.maxAttemptsPerModel) break;

        const delay = c.kind === "rate_limited" ? (c.retryAfterMs ?? 1_000) : BACKOFF_BASE_MS * 2 ** (attempt - 1);
        if (modelDeadline - now() - delay < o.minAttemptMs) break; // no time for another useful attempt
        await sleep(delay);
      }
    }
  }
  return { ok: false, failures, skipped };
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runWithFallback, type Classified, type FailureKind } from "../src/lib/model-runner";

/**
 * Deterministic tests for the retry/fallback runner: a fake clock plus a scripted "provider".
 * No network, no API quota.
 */

// Same constants as gemini.server.ts.
const CONFIG = { budgetMs: 100_000, attemptTimeoutMs: 35_000, minAttemptMs: 10_000, maxAttemptsPerModel: 3, fallbackReserveMs: 35_000 };

type Step = { ms: number; ok: true } | { ms: number; fail: FailureKind; retryAfterMs?: number } | { hang: true } | { fatal: true };
class Scripted extends Error {
  constructor(public c: Classified) {
    super(c.kind);
  }
}
class Fatal extends Error {}

function harness(script: Record<string, Step[]>, cooldowns = new Map<string, number>()) {
  let t = 0;
  const calls: { model: string; at: number; timeoutMs: number }[] = [];
  const cursor: Record<string, number> = {};
  const run = (models: string[]) =>
    runWithFallback<string>({
      ...CONFIG,
      label: "test",
      models,
      cooldowns,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      classify: (err) => (err instanceof Fatal ? "fatal" : (err as Scripted).c),
      attempt: async (model, timeoutMs) => {
        calls.push({ model, at: t, timeoutMs });
        const steps = script[model] ?? [];
        const step = steps[Math.min(cursor[model] ?? 0, steps.length - 1)];
        cursor[model] = (cursor[model] ?? 0) + 1;
        if (!step) throw new Error(`no script for ${model}`);
        if ("fatal" in step) throw new Fatal("blocked");
        if ("hang" in step || step.ms > timeoutMs) {
          t += timeoutMs;
          throw new Scripted({ kind: "timeout", retryable: false });
        }
        t += step.ms;
        if ("ok" in step) return `${model}:ok`;
        const retryable = ["provider_error", "invalid_output", "network", "rate_limited"].includes(step.fail);
        throw new Scripted({ kind: step.fail, retryable, retryAfterMs: step.retryAfterMs });
      },
    });
  return { run, calls, time: () => t, cooldowns };
}

describe("model runner: fallback starvation (regression)", () => {
  it("slow primary 5xx errors cannot consume the fallback's time", async () => {
    // Each primary failure takes 30s. Without a reserve, 3 attempts + backoff ≈ 91.5s would leave
    // < 10s and the fallback would be skipped (the reported "AI service is unavailable" failure).
    const h = harness({ primary: [{ ms: 30_000, fail: "provider_error" }], fallback: [{ ms: 5_000, ok: true }] });
    const r = await h.run(["primary", "fallback"]);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.model, "fallback");
    const primaryCalls = h.calls.filter((c) => c.model === "primary");
    assert.ok(primaryCalls.length <= 2, `primary attempts: ${primaryCalls.length}`);
    const fb = h.calls.find((c) => c.model === "fallback")!;
    assert.ok(100_000 - fb.at >= CONFIG.fallbackReserveMs, `fallback started with ${100_000 - fb.at}ms left`);
    assert.ok(h.time() <= CONFIG.budgetMs);
  });

  it("slow invalid model output on the primary still leaves the fallback a full attempt", async () => {
    const h = harness({ primary: [{ ms: 28_000, fail: "invalid_output" }], fallback: [{ ms: 8_000, ok: true }] });
    const r = await h.run(["primary", "fallback"]);
    assert.equal(r.ok && r.model, "fallback");
    assert.equal(h.calls.find((c) => c.model === "fallback")!.timeoutMs, CONFIG.attemptTimeoutMs);
  });

  it("the whole call never exceeds the budget, even when everything fails slowly", async () => {
    const h = harness({ primary: [{ ms: 34_000, fail: "provider_error" }], fallback: [{ ms: 34_000, fail: "provider_error" }] });
    const r = await h.run(["primary", "fallback"]);
    assert.equal(r.ok, false);
    assert.ok(h.time() <= CONFIG.budgetMs, `elapsed ${h.time()}`);
    assert.ok(h.calls.some((c) => c.model === "fallback"));
  });
});

describe("model runner: retry policy", () => {
  it("a primary timeout goes straight to the fallback (no second wait on a hang)", async () => {
    const h = harness({ primary: [{ hang: true }], fallback: [{ ms: 4_000, ok: true }] });
    const r = await h.run(["primary", "fallback"]);
    assert.equal(r.ok && r.model, "fallback");
    assert.equal(h.calls.filter((c) => c.model === "primary").length, 1);
  });

  it("a timeout with no fallback available retries the same model once (instead of failing outright)", async () => {
    const h = harness({ only: [{ hang: true }, { ms: 4_000, ok: true }] });
    const r = await h.run(["only"]);
    assert.equal(r.ok && r.model, "only");
    assert.equal(h.calls.length, 2);
  });

  it("…but never more than one retry after timeouts", async () => {
    const h = harness({ only: [{ hang: true }] });
    const r = await h.run(["only"]);
    assert.equal(r.ok, false);
    assert.equal(h.calls.length, 2);
  });

  it("a fallback that is cooling down counts as unavailable, so the primary gets its one retry", async () => {
    const h = harness({ primary: [{ hang: true }, { ms: 3_000, ok: true }], fallback: [{ ms: 1, ok: true }] }, new Map([["fallback", 10 ** 12]]));
    const r = await h.run(["primary", "fallback"]);
    assert.equal(r.ok && r.model, "primary");
    assert.deepEqual(h.calls.map((c) => c.model), ["primary", "primary"]);
  });

  it("success on the first try makes exactly one request", async () => {
    const h = harness({ primary: [{ ms: 6_000, ok: true }], fallback: [{ ms: 1, ok: true }] });
    const r = await h.run(["primary", "fallback"]);
    assert.equal(r.ok && r.model, "primary");
    assert.equal(h.calls.length, 1);
  });

  it("transient primary errors are retried with backoff before falling back", async () => {
    const h = harness({ primary: [{ ms: 1_000, fail: "provider_error" }, { ms: 5_000, ok: true }], fallback: [{ ms: 1, ok: true }] });
    const r = await h.run(["primary", "fallback"]);
    assert.equal(r.ok && r.model, "primary");
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].at - h.calls[0].at, 1_000 + 500); // attempt time + first backoff
  });

  it("non-retryable rejections (e.g. bad request) skip straight to the fallback", async () => {
    const h = harness({ primary: [{ ms: 300, fail: "provider_rejected" }], fallback: [{ ms: 3_000, ok: true }] });
    await h.run(["primary", "fallback"]);
    assert.equal(h.calls.filter((c) => c.model === "primary").length, 1);
  });

  it("a short rate limit waits the requested delay and retries the same model", async () => {
    const h = harness({ primary: [{ ms: 200, fail: "rate_limited", retryAfterMs: 2_000 }, { ms: 3_000, ok: true }] });
    const r = await h.run(["primary"]);
    assert.equal(r.ok && r.model, "primary");
    assert.equal(h.calls[1].at, 200 + 2_000);
  });

  it("exhausted quota puts the model on cooldown; the next call doesn't spend a request on it", async () => {
    const cooldowns = new Map<string, number>();
    const h = harness({ primary: [{ ms: 300, fail: "quota_exhausted", retryAfterMs: 3_600_000 }], fallback: [{ ms: 3_000, ok: true }] }, cooldowns);
    await h.run(["primary", "fallback"]);
    assert.ok((cooldowns.get("primary") ?? 0) > h.time());
    const before = h.calls.length;
    const r2 = await h.run(["primary", "fallback"]);
    assert.equal(r2.ok && r2.model, "fallback");
    assert.deepEqual(h.calls.slice(before).map((c) => c.model), ["fallback"]);
  });

  it("when every model is cooling down, no requests are made", async () => {
    const h = harness({ primary: [{ ms: 1, ok: true }] }, new Map([["primary", 10 ** 12]]));
    const r = await h.run(["primary"]);
    assert.equal(r.ok, false);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(!r.ok && r.skipped, ["primary"]);
  });

  it("without a distinct fallback, the primary may use the whole budget", async () => {
    const h = harness({ only: [{ ms: 30_000, fail: "provider_error" }, { ms: 30_000, fail: "provider_error" }, { ms: 5_000, ok: true }] });
    const r = await h.run(["only", "only", ""]);
    assert.equal(r.ok && r.model, "only");
    assert.equal(h.calls.length, 3);
  });

  it("fatal errors (blocked content, misconfiguration) are rethrown immediately", async () => {
    const h = harness({ primary: [{ fatal: true }], fallback: [{ ms: 1, ok: true }] });
    await assert.rejects(h.run(["primary", "fallback"]), Fatal);
    assert.equal(h.calls.length, 1);
  });

  it("never exceeds 3 attempts per model", async () => {
    const h = harness({ primary: [{ ms: 100, fail: "network" }], fallback: [{ ms: 100, fail: "network" }] });
    await h.run(["primary", "fallback"]);
    assert.equal(h.calls.filter((c) => c.model === "primary").length, 3);
    assert.equal(h.calls.filter((c) => c.model === "fallback").length, 3);
  });
});

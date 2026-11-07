import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as E from "../src/lib/session/engine";
import { runScanPipeline, type PipelineDeps } from "../src/lib/session/pipeline";
import type { Session } from "../src/lib/session/types";

/**
 * Request ordering / concurrency tests for the scan pipeline. The fake API resolves only when the test
 * says so, and records the order in which requests start. No network, no quota.
 */

const chair = {
  barrierType: "obstructed_walkway",
  title: "Chair in the walkway",
  locationInImage: "center",
  visualEvidence: "A chair.",
  whoMayBeAffected: ["wheelchair users"],
  potentialImpact: "x",
  suggestedImprovement: "x",
  uncertainty: "x",
  confidence: "high",
} as const;
const stairs = { ...chair, barrierType: "steps", title: "Stairs" } as const;
const analysis = (findings: object[], imageUsable = true) => ({ imageUsable, sceneSummary: "s", findings, limitations: "l" }) as never;
const cmpResult = (status: string, sameLocation = "yes") =>
  ({
    ok: true,
    model: "m",
    concern: "c",
    guardrail: null,
    disclaimer: "d",
    comparison: { beforeScene: "", afterScene: "", locationEvidence: "", sameLocation, viewpoint: "similar", originalBarrier: "", beforeBarrierVisible: "yes", afterAreaVisible: "yes", observedChange: "changed", status, visualEvidence: ["e"], remainingUncertainty: "u", suggestedNextAction: "", confidence: "medium" },
  }) as never;
const matchResult = (cands: [string, string][], dups: [number, string][] = []) =>
  ({ ok: true, model: "m", candidates: cands.map(([scanId, sameArea]) => ({ scanId, sameArea, evidence: "e" })), duplicates: dups.map(([newFindingIndex, findingId]) => ({ newFindingIndex, findingId })) }) as never;

/** A session with completed scans: s1 (chair), and optionally s2 (stairs, different area). */
function session(withStairs = false): Session {
  let s = E.createSession("w", 0);
  const add = (id: string, findings: object[]) => {
    s = E.addScan(s, id, 1);
    s = E.setAnalysis(s, id, analysis(findings), "g");
    s = E.integrateScan(s, id, { candidateScanIds: [], match: null, matchFailed: false, comparisons: [], newFindingIds: findings.map((_, i) => `${id}-f${i}`) }, 2);
  };
  add("s1", [chair]);
  if (withStairs) add("s2", [stairs]);
  return E.addScan(s, "new", 3);
}

type Call = { kind: "analyze" | "match" | "compare"; signal: AbortSignal; ctx?: { newFindings: unknown[]; candidates: { scanId: string }[] }; resolve: (v: unknown) => void; reject: (e: unknown) => void };

function fakeApi(s: Session, images = ["s1", "s2", "new"]) {
  const calls: Call[] = [];
  const log: string[] = [];
  const pending = (kind: Call["kind"], signal: AbortSignal, ctx?: Call["ctx"]) =>
    new Promise<never>((resolve, reject) => {
      log.push(kind + (kind === "match" && ctx?.newFindings.length ? "(dedupe)" : ""));
      const call: Call = { kind, signal, ctx, resolve: resolve as (v: unknown) => void, reject };
      calls.push(call);
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  const deps: PipelineDeps = {
    session: () => s,
    blobOf: (id) => (images.includes(id) ? new Blob([id]) : undefined),
    analyze: (_b, signal) => pending("analyze", signal),
    match: (_b, ctx, _m, signal) => pending("match", signal, ctx as never),
    compare: (_b, _a, _c, signal) => pending("compare", signal),
  };
  const next = (kind: Call["kind"], i = 0) => calls.filter((c) => c.kind === kind)[i];
  return { deps, calls, log, next };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const signal = () => new AbortController().signal;

describe("scan pipeline: concurrency", () => {
  it("new area: runs scene matching concurrently with analysis, and NEVER compares automatically", async () => {
    const s = session();
    const api = fakeApi(s);
    const p = runScanPipeline(api.deps, "new", new Blob(["x"]), { signal: signal() });
    await tick();
    assert.deepEqual(api.log, ["analyze", "match"], "both start before either finishes");
    assert.deepEqual(api.next("match").ctx!.newFindings, [], "the scene check doesn't wait for findings");

    api.next("match").resolve(matchResult([["s1", "yes"]]));
    await tick();
    api.next("analyze").resolve({ analysis: analysis([chair]), model: "g" });
    const r = await p;
    assert.equal(r.intent, "new_area");
    assert.deepEqual(r.comparisons, [], "even a confident 'same area' match doesn't start a comparison");
    assert.deepEqual(api.log, ["analyze", "match"], "no compare, no duplicate follow-up");
    assert.equal(r.match!.candidates[0].sameArea, "yes", "the match is kept, to suggest a re-check");
  });

  it("with no open findings anywhere, only analysis runs", async () => {
    let s = E.createSession("w", 0);
    s = E.addScan(s, "new", 1);
    const api = fakeApi(s);
    const p = runScanPipeline(api.deps, "new", new Blob(["x"]), { signal: signal() });
    await tick();
    api.next("analyze").resolve({ analysis: analysis([chair]), model: "g" });
    await p;
    assert.deepEqual(api.log, ["analyze"]);
  });

  it("a failed scene match asks the user later and skips comparisons", async () => {
    const api = fakeApi(session());
    const p = runScanPipeline(api.deps, "new", new Blob(["x"]), { signal: signal() });
    await tick();
    api.next("match").reject(new Error("503"));
    api.next("analyze").resolve({ analysis: analysis([]), model: "g" });
    const r = await p;
    assert.equal(r.matchFailed, true);
    assert.deepEqual(r.candidateScanIds, ["s1"]);
    assert.ok(!api.log.includes("compare"));
  });
});

describe("scan pipeline: line up", () => {
  it("skips scene matching and compares the lined-up scan immediately, alongside analysis", async () => {
    const api = fakeApi(session(true));
    const p = runScanPipeline(api.deps, "new", new Blob(["x"]), { signal: signal(), lineUpScanId: "s1" });
    await tick();
    assert.deepEqual(api.log, ["analyze", "compare"], "no match request");
    api.next("compare").resolve({ result: cmpResult("improved") });
    api.next("analyze").resolve({ analysis: analysis([]), model: "g" });
    const r = await p;
    assert.equal(r.lineUpScanId, "s1");
    assert.deepEqual(r.comparisons.map((c) => c.referenceScanId), ["s1"], "only the selected area's findings are compared");
    assert.deepEqual(r.candidateScanIds, [], "no revisit questions about other areas");
  });

  it("falls back to automatic matching if the lined-up scan has no open findings or no photo", async () => {
    const api = fakeApi(session(), ["new"]); // s1's photo no longer available
    const p = runScanPipeline(api.deps, "new", new Blob(["x"]), { signal: signal(), lineUpScanId: "s1" });
    await tick();
    api.next("analyze").resolve({ analysis: analysis([]), model: "g" });
    const r = await p;
    assert.equal(r.lineUpScanId, undefined);
    assert.deepEqual(api.log, ["analyze"], "no candidates with photos → analysis only");
  });

  it("a lined-up comparison that finds a different place is passed through unchanged (the engine leaves findings alone)", async () => {
    const api = fakeApi(session());
    const p = runScanPipeline(api.deps, "new", new Blob(["x"]), { signal: signal(), lineUpScanId: "s1" });
    await tick();
    api.next("compare").resolve({ result: cmpResult("uncertain", "no") });
    api.next("analyze").resolve({ analysis: analysis([chair]), model: "g" });
    const r = await p;
    assert.ok(!api.log.includes("match(dedupe)"), "no duplicate check when the place isn't confirmed");
    const s = E.integrateScan(
      E.setAnalysis(session(), "new", r.analysis, r.model),
      "new",
      { candidateScanIds: r.candidateScanIds, match: r.match, matchFailed: r.matchFailed, comparisons: r.comparisons, newFindingIds: ["nf"], lineUpScanId: r.lineUpScanId },
      9,
    );
    assert.equal(s.findings[0].status, "observed", "earlier chair untouched");
    assert.equal(s.findings.length, 2, "new chair recorded separately");
    assert.ok(s.scans.at(-1)!.events.some((e) => e.kind === "notice" && /doesn't look like the same spot as scan 1/.test(e.message)));
    assert.deepEqual(s.scans.at(-1)!.pendingRevisit, []);
  });
});

describe("scan pipeline: duplicate check only when needed", () => {
  it("re-check: runs a follow-up duplicate check when a new finding could repeat an open one at a confirmed spot", async () => {
    const api = fakeApi(session());
    const p = runScanPipeline(api.deps, "new", new Blob(["x"]), { signal: signal(), lineUpScanId: "s1" });
    await tick();
    api.next("compare").resolve({ result: cmpResult("still_present", "yes") });
    api.next("analyze").resolve({ analysis: analysis([chair]), model: "g" });
    await tick();
    assert.equal(api.log.at(-1), "match(dedupe)");
    assert.deepEqual(api.next("match").ctx!.candidates.map((c) => c.scanId), ["s1"]);
    api.next("match").resolve(matchResult([["s1", "yes"]], [[0, "s1-f0"]]));
    const r = await p;
    assert.equal(r.intent, "recheck");
    assert.deepEqual(r.match!.duplicates, [{ newFindingIndex: 0, findingId: "s1-f0" }]);
  });

  it("skips it when barrier types differ, the spot isn't confirmed, or it's a new area", async () => {
    for (const [lineUp, sameLocation, finding] of [["s1", "yes", stairs], ["s1", "likely", chair], [undefined, "yes", chair]] as const) {
      const api = fakeApi(session());
      const p = runScanPipeline(api.deps, "new", new Blob(["x"]), { signal: signal(), lineUpScanId: lineUp });
      await tick();
      if (lineUp) api.next("compare").resolve({ result: cmpResult("still_present", sameLocation) });
      else api.next("match").resolve(matchResult([["s1", sameLocation]]));
      api.next("analyze").resolve({ analysis: analysis([finding]), model: "g" });
      await p;
      assert.ok(!api.log.includes("match(dedupe)"), `${lineUp ?? "new area"}/${sameLocation}/${finding.barrierType}`);
    }
  });
});

describe("scan pipeline: cancellation and unusable photos", () => {
  it("a failed analysis aborts the in-flight comparisons (re-check) and match (new area)", async () => {
    const fresh = fakeApi(session());
    const q = runScanPipeline(fresh.deps, "new", new Blob(["x"]), { signal: signal() });
    await tick();
    const match = fresh.next("match");
    fresh.next("analyze").reject(new Error("AI_UNAVAILABLE"));
    await assert.rejects(q, /AI_UNAVAILABLE/);
    assert.equal(match.signal.aborted, true);

    const api = fakeApi(session());
    const p = runScanPipeline(api.deps, "new", new Blob(["x"]), { signal: signal(), lineUpScanId: "s1" });
    await tick();
    const cmp = api.next("compare");
    api.next("analyze").reject(new Error("AI_UNAVAILABLE"));
    await assert.rejects(p, /AI_UNAVAILABLE/);
    assert.equal(cmp.signal.aborted, true, "sibling request cancelled so it doesn't spend quota");
  });

  it("aborting the walkthrough cancels every request of the scan", async () => {
    const ctrl = new AbortController();
    const api = fakeApi(session());
    const p = runScanPipeline(api.deps, "new", new Blob(["x"]), { signal: ctrl.signal });
    await tick();
    ctrl.abort();
    await assert.rejects(p, { name: "AbortError" });
    assert.ok(api.calls.every((c) => c.signal.aborted));
  });

  it("an unusable photo discards revisit results (no conclusions from a dark/blurry photo)", async () => {
    const api = fakeApi(session());
    const p = runScanPipeline(api.deps, "new", new Blob(["x"]), { signal: signal(), lineUpScanId: "s1" });
    await tick();
    api.next("compare").resolve({ result: cmpResult("improved") });
    api.next("analyze").resolve({ analysis: analysis([], false), model: "g" });
    const r = await p;
    assert.deepEqual(r.comparisons, []);
    assert.equal(r.match, null);
  });
});

describe("engine: lined-up scans", () => {
  const integrate = (comparisons: E.CompareOutcome[]) =>
    E.integrateScan(E.setAnalysis(session(), "new", analysis([]), "g"), "new", { candidateScanIds: [], match: null, matchFailed: false, comparisons, newFindingIds: [], lineUpScanId: "s1" }, 9);

  it("improved + same place → appears improved, same area, line-up recorded", () => {
    const s = integrate([{ findingId: "s1-f0", referenceScanId: "s1", result: cmpResult("improved") }]);
    assert.equal(s.findings[0].status, "appears_improved");
    const scan = s.scans.at(-1)!;
    assert.equal(scan.relations[0].decidedBy, "lineup");
    assert.equal(scan.areaId, s.scans[0].areaId);
    assert.ok(scan.events.some((e) => e.kind === "revisit" && e.decidedBy === "lineup"));
    assert.ok(scan.doneAt);
  });

  it("still present → still observed", () => {
    assert.equal(integrate([{ findingId: "s1-f0", referenceScanId: "s1", result: cmpResult("still_present") }]).findings[0].status, "still_observed");
  });

  it("comparison failed → nothing changes, no claim either way", () => {
    const s = integrate([{ findingId: "s1-f0", referenceScanId: "s1", error: "boom" }]);
    assert.equal(s.findings[0].status, "observed");
    assert.ok(!s.scans.at(-1)!.events.some((e) => e.kind === "revisit"));
  });
});

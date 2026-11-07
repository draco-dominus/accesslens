import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as E from "../src/lib/session/engine";
import { lumiMessagesForScan, scanActivity } from "../src/lib/session/lumi";
import { runScanPipeline, type PipelineDeps } from "../src/lib/session/pipeline";
import type { Scan, ScanStage, Session } from "../src/lib/session/types";

/** Regression tests for the release-blocker patch. Mocked results only; no network, no quota. */

const finding = (title: string, barrierType = "obstructed_walkway") => ({
  barrierType,
  title,
  locationInImage: "center",
  visualEvidence: "x",
  whoMayBeAffected: ["wheelchair users"],
  potentialImpact: "x",
  suggestedImprovement: "x",
  uncertainty: "x",
  confidence: "high",
});
const analysis = (findings: object[], imageUsable = true) => ({ imageUsable, sceneSummary: "s", findings, limitations: "l" }) as never;
const cmp = (status: string, sameLocation: string) =>
  ({
    ok: true,
    model: "m",
    concern: "c",
    guardrail: null,
    disclaimer: "d",
    comparison: { beforeScene: "", afterScene: "", locationEvidence: "", sameLocation, viewpoint: "similar", originalBarrier: "", beforeBarrierVisible: "yes", afterAreaVisible: "yes", observedChange: "changed", status, visualEvidence: ["e"], remainingUncertainty: "u", suggestedNextAction: "", confidence: "medium" },
  }) as never;
const sceneMatch = (verdict: string) => ({ ok: true, model: "m", candidates: [{ scanId: "s1", sameArea: verdict, evidence: "e" }], duplicates: [] }) as never;
const ok = (findingId: string, status: string, sameLocation: string): E.CompareOutcome => ({ findingId, referenceScanId: "s1", result: cmp(status, sameLocation) });
const err = (findingId: string): E.CompareOutcome => ({ findingId, referenceScanId: "s1", error: "503" });

/** s1 with two open findings (f1 chair, f2 bin), s2 about to be integrated. */
function base(): Session {
  let s = E.createSession("w", 0);
  s = E.addScan(s, "s1", 1);
  s = E.setAnalysis(s, "s1", analysis([finding("Chair"), finding("Bin")]), "g");
  s = E.integrateScan(s, "s1", { candidateScanIds: [], match: null, matchFailed: false, comparisons: [], newFindingIds: ["f1", "f2"] }, 2);
  s = E.addScan(s, "s2", 3);
  return E.setAnalysis(s, "s2", analysis([]), "g");
}
const auto = (verdict: string, comparisons: E.CompareOutcome[]) =>
  E.integrateScan(base(), "s2", { candidateScanIds: ["s1"], match: sceneMatch(verdict), matchFailed: false, comparisons, newFindingIds: [] }, 4);
const lineUp = (comparisons: E.CompareOutcome[]) =>
  E.integrateScan(base(), "s2", { candidateScanIds: [], match: null, matchFailed: false, comparisons, newFindingIds: [], lineUpScanId: "s1" }, 4);
const status = (s: Session, id: string) => s.findings.find((f) => f.id === id)!.status;
const said = (s: Session) => lumiMessagesForScan(s, "s2").join(" ");

describe("P1: failed comparisons stay retryable", () => {
  it("a failed comparison isn't recorded as compared, and the scan stays offered for re-checking", () => {
    const s = auto("yes", [err("f1"), err("f2")]);
    const sc = s.scans[1];
    assert.deepEqual(sc.comparedWith, []);
    assert.deepEqual(sc.failedComparisons?.map((f) => [f.findingId, f.source]), [["f1", "auto"], ["f2", "auto"]]);
    assert.deepEqual(E.manualRevisitOptions(s, "s2", () => true).map((x) => x.id), ["s1"]);
    assert.ok(E.scansNeedingImages(s).has("s1") && E.scansNeedingImages(s).has("s2"), "both photos kept for the retry");
  });

  it("only successful comparisons count as compared", () => {
    const s = auto("yes", [ok("f1", "still_present", "yes"), err("f2")]);
    assert.deepEqual(s.scans[1].comparedWith, ["s1"]);
    assert.deepEqual(s.scans[1].failedComparisons?.map((f) => f.findingId), ["f2"]);
  });

  it("a user-confirmed revisit records failures as retryable too", () => {
    let s = auto("unclear", []);
    s = E.applyUserRevisit(s, "s2", "s1", [err("f1"), err("f2")], 5);
    assert.deepEqual(s.scans[1].comparedWith, []);
    assert.ok(s.scans[1].failedComparisons?.every((f) => f.source === "user"));
  });

  it("retrying applies the result and clears the failure", () => {
    const s0 = auto("yes", [err("f1"), err("f2")]);
    const s = E.applyRetriedComparison(s0, "s2", ok("f1", "improved", "yes"), 5);
    assert.equal(status(s, "f1"), "appears_improved");
    assert.deepEqual(s.scans[1].comparedWith, ["s1"]);
    assert.deepEqual(s.scans[1].failedComparisons?.map((f) => f.findingId), ["f2"]);
    assert.match(said(s), /looks improved/);
  });

  it("a retry that fails again changes nothing (still retryable)", () => {
    const s0 = auto("yes", [err("f1")]);
    assert.equal(E.applyRetriedComparison(s0, "s2", err("f1"), 5), s0);
  });

  it("retry of an automatic match that finds a different place leaves the finding untouched", () => {
    const s = E.applyRetriedComparison(auto("yes", [err("f1")]), "s2", ok("f1", "improved", "no"), 5);
    assert.equal(status(s, "f1"), "observed");
    assert.equal(s.scans[1].relations[0].sameArea, "no");
    assert.match(said(s), /different spot from scan 1/);
  });

  it("a retry that conflicts with an earlier result downgrades that earlier 'improved'", () => {
    const s0 = auto("yes", [ok("f1", "improved", "yes"), err("f2")]);
    assert.equal(status(s0, "f1"), "appears_improved");
    const s = E.applyRetriedComparison(s0, "s2", ok("f2", "still_present", "no"), 5);
    assert.equal(s.scans[1].relations[0].sameArea, "unclear");
    assert.equal(status(s, "f1"), "needs_verification", "can't keep an improvement once the place is disputed");
    assert.equal(status(s, "f2"), "observed");
    assert.match(said(s), /now disagree/);
  });

  it("a retry never overwrites a newer result from a later scan", () => {
    let s = auto("yes", [err("f1")]);
    s = E.addScan(s, "s3", 6);
    s = E.setAnalysis(s, "s3", analysis([]), "g");
    s = E.integrateScan(s, "s3", { candidateScanIds: ["s1"], match: { ok: true, model: "m", candidates: [{ scanId: "s1", sameArea: "yes", evidence: "e" }], duplicates: [] } as never, matchFailed: false, comparisons: [{ findingId: "f1", referenceScanId: "s1", result: cmp("still_present", "yes") }], newFindingIds: [] }, 7);
    assert.equal(status(s, "f1"), "still_observed");
    const after = E.applyRetriedComparison(s, "s2", ok("f1", "improved", "yes"), 8);
    assert.equal(status(after, "f1"), "still_observed", "the newer scan-3 result stands");
    assert.ok(lumiMessagesForScan(after, "s2").some((m) => /later scan already re-checked/.test(m)));
  });

  it("ignores retries that don't match a recorded failure", () => {
    const s0 = auto("yes", [ok("f1", "still_present", "yes")]);
    assert.equal(E.applyRetriedComparison(s0, "s2", ok("f1", "improved", "yes"), 5), s0);
  });
});

describe("P2: visible progress comes from real active stages", () => {
  const scan = (step: Scan["step"], stages: Partial<ScanStage>[]): Scan =>
    ({ step, stages: stages.map((x, i) => ({ id: `x${i}`, label: "?", state: "done", startedAt: 0, ...x })) }) as Scan;

  it("after analysis finishes, shows the step that is actually running", () => {
    const a = scanActivity(scan("analyzing", [{ id: "prepare", state: "done" }, { id: "analyze", label: "Looking for barriers", state: "done" }, { id: "match", label: "Checking whether we've been here before", state: "active" }]));
    assert.equal(a.title, "Checking whether we've been here before");
    const b = scanActivity(scan("analyzing", [{ id: "analyze", label: "Looking for barriers", state: "done" }, { id: "compare:f1", label: "Re-checking #1 Chair", state: "active" }]));
    assert.equal(b.title, "Re-checking #1 Chair");
  });

  it("concurrent stages are all mentioned", () => {
    const a = scanActivity(scan("analyzing", [{ id: "analyze", label: "Looking for barriers", state: "active" }, { id: "compare:f1", label: "Re-checking #1 Chair", state: "active" }]));
    assert.equal(a.title, "Looking for barriers");
    assert.match(a.detail!, /re-checking #1 chair/);
  });

  it("between stages it never claims analysis is still running", () => {
    const a = scanActivity(scan("analyzing", [{ id: "analyze", label: "Looking for barriers", state: "done" }]));
    assert.equal(a.title, "Putting the results together");
    assert.equal(scanActivity(scan("queued", [{ id: "prepare", state: "done" }])).title, "Photo ready, waiting for the previous scan to finish");
    assert.equal(scanActivity(scan("queued", [])).title, "Waiting for the previous scan to finish");
  });
});

describe("P3: conflicting location evidence is never a confirmed revisit", () => {
  it("line up: one comparison says same place, another says different → unclear, no improvement claimed", () => {
    const s = lineUp([ok("f1", "improved", "yes"), ok("f2", "still_present", "no")]);
    const rel = s.scans[1].relations[0];
    assert.equal(rel.sameArea, "unclear");
    assert.ok(!s.scans[1].events.some((e) => e.kind === "revisit"), "no same-area announcement");
    assert.equal(status(s, "f1"), "needs_verification");
    assert.equal(status(s, "f2"), "observed");
    assert.match(said(s), /disagreed about whether this is the same spot/);
    assert.notEqual(s.scans[1].areaId, s.scans[0].areaId);
  });

  it("line up: 'yes' + 'likely' → only 'might be the same spot', improvement held back", () => {
    const s = lineUp([ok("f1", "improved", "yes"), ok("f2", "uncertain", "likely")]);
    assert.equal(s.scans[1].relations[0].sameArea, "likely");
    assert.match(said(s), /might be the same spot/);
    assert.equal(status(s, "f1"), "needs_verification");
  });

  it("line up: unanimous same place → confirmed, improvement stands", () => {
    const s = lineUp([ok("f1", "improved", "yes"), ok("f2", "still_present", "yes")]);
    assert.equal(s.scans[1].relations[0].sameArea, "yes");
    assert.match(said(s), /looks like the same spot/);
    assert.equal(status(s, "f1"), "appears_improved");
    assert.equal(status(s, "f2"), "still_observed");
  });

  it("automatic match with conflicting comparisons → uncertain, user asked, improvement held back", () => {
    const s = auto("yes", [ok("f1", "improved", "yes"), ok("f2", "still_present", "no")]);
    assert.equal(s.scans[1].relations[0].sameArea, "unclear");
    assert.deepEqual(s.scans[1].pendingRevisit, ["s1"]);
    assert.doesNotMatch(said(s), /looks like the same area/);
    assert.equal(status(s, "f1"), "needs_verification");
  });

  it("user-confirmed revisit can't override disagreeing photos either", () => {
    let s = auto("unclear", []);
    s = E.applyUserRevisit(s, "s2", "s1", [ok("f1", "improved", "yes"), ok("f2", "uncertain", "no")], 5);
    assert.equal(status(s, "f1"), "needs_verification");
  });
});

describe("P4: finishing waits for processing to complete", () => {
  it("can't finish while a scan is queued or processing", () => {
    let s = base(); // s2 is still "queued"
    assert.equal(E.canFinish(s), false);
    assert.equal(E.finishSession(s, 9).finishedAt, null, "finishSession refuses");
    s = E.setStep(s, "s2", "comparing");
    assert.equal(E.canFinish(s), false);
    s = E.setStep(s, "s2", "error", "boom");
    assert.equal(E.canFinish(s), true, "a failed scan doesn't block finishing");
    assert.ok(E.finishSession(s, 9).finishedAt);
  });

  it("needs at least one completed scan", () => {
    let s = E.createSession("w", 0);
    s = E.addScan(s, "a", 1);
    s = E.setStep(s, "a", "error", "x");
    assert.equal(E.canFinish(s), false);
  });
});

describe("P5: unusable photos stop the revisit check", () => {
  it("aborts in-flight revisit requests once analysis says the photo can't be assessed", async () => {
    const s = base();
    const signals: AbortSignal[] = [];
    const stages: { id: string; state?: string; note?: string }[] = [];
    let resolveAnalyze!: (v: unknown) => void;
    const deps: PipelineDeps = {
      session: () => s,
      blobOf: () => new Blob(["x"]),
      analyze: () => new Promise((r) => (resolveAnalyze = r as never)),
      match: (_b, _c, _m, signal) =>
        new Promise((_r, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
      compare: () => new Promise(() => {}),
      stage: (u) => stages.push(u),
    };
    const p = runScanPipeline(deps, "s2", new Blob(["x"]), { signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 0));
    resolveAnalyze({ analysis: analysis([], false), model: "g" });
    const r = await p;
    assert.deepEqual(r.comparisons, []);
    assert.equal(signals[0].aborted, true, "the scene-match request was cancelled");
    await new Promise((r2) => setTimeout(r2, 0));
    assert.ok(stages.some((x) => x.id === "match" && x.state === "skipped" && /couldn't be assessed/.test(x.note ?? "")));
  });
});

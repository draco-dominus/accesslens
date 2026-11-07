import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { areaOf, areas, recheckTarget } from "../src/lib/session/areas";
import * as E from "../src/lib/session/engine";
import { runScanPipeline, type PipelineDeps } from "../src/lib/session/pipeline";
import type { Session } from "../src/lib/session/types";
import { spatialBoxes } from "../src/lib/spatial";

/**
 * "Scan new area" and "Re-check this area" are separate operations. Scanning A → B → C must never start a
 * comparison (even if the scene match thinks two areas look alike); re-checking C must. No network.
 */

const finding = (barrierType: string, title: string) =>
  ({ barrierType, title, locationInImage: "center", visualEvidence: title, whoMayBeAffected: ["wheelchair users"], potentialImpact: "x", suggestedImprovement: "x", uncertainty: "x", confidence: "medium" }) as const;
const SIGN = finding("other", "Small, low-contrast room sign");
const STEP = finding("steps", "Single step at the entrance");
const CHAIR = finding("obstructed_walkway", "Chair placed in a walking path");
const analysis = (findings: object[], imageUsable = true) => ({ imageUsable, sceneSummary: "s", findings, limitations: "l" }) as never;
const cmp = (status: string, sameLocation = "yes") =>
  ({
    ok: true, model: "m", concern: "c", guardrail: null, disclaimer: "d",
    comparison: { beforeScene: "", afterScene: "", locationEvidence: "", sameLocation, viewpoint: "similar", originalBarrier: "", beforeBarrierVisible: "yes", afterAreaVisible: "yes", observedChange: "The chair is gone from the path.", status, visualEvidence: ["e"], remainingUncertainty: "u", suggestedNextAction: "", confidence: "high" },
  }) as never;

type Scripted = { findings: object[]; match?: [string, string][]; compare?: string; sameLocation?: string; imageUsable?: boolean; matchFails?: boolean };

/** Runs one scan the way useWalkthrough does: addScan → pipeline (scripted API) → setAnalysis → integrateScan. */
async function scan(s: Session, id: string, script: Scripted, lineUpScanId?: string) {
  const calls: string[] = [];
  s = E.addScan(s, id, 1, { lineUpScanId });
  const deps: PipelineDeps = {
    session: () => s,
    blobOf: () => new Blob(["img"]),
    analyze: async () => (calls.push("analyze"), { analysis: analysis(script.findings, script.imageUsable ?? true), model: "g" }),
    match: async (_b, ctx) => {
      calls.push(ctx.newFindings.length ? "dedupe" : "match");
      if (script.matchFails) throw new Error("503");
      return { ok: true, model: "m", candidates: (script.match ?? []).map(([scanId, sameArea]) => ({ scanId, sameArea, evidence: "e" })), duplicates: [] } as never;
    },
    compare: async () => (calls.push("compare"), { result: cmp(script.compare ?? "still_present", script.sameLocation ?? "yes") }),
  };
  const r = await runScanPipeline(deps, id, new Blob(["img"]), { signal: new AbortController().signal, lineUpScanId });
  s = E.setAnalysis(s, id, r.analysis, r.model);
  s = E.integrateScan(
    s,
    id,
    { candidateScanIds: r.candidateScanIds, match: r.match, matchFailed: r.matchFailed, comparisons: r.comparisons, newFindingIds: r.analysis.findings.map((_, i) => `${id}-f${i}`), lineUpScanId: r.lineUpScanId, intent: r.intent },
    2,
  );
  return { s, calls };
}

async function threeAreas(bMatch: [string, string][] = [["A", "no"]], cMatch: [string, string][] = [["B", "no"], ["A", "no"]]) {
  let s = E.createSession("w", 0);
  const a = await scan(s, "A", { findings: [SIGN] });
  const b = await scan(a.s, "B", { findings: [STEP], match: bMatch });
  const c = await scan(b.s, "C", { findings: [CHAIR], match: cMatch });
  s = c.s;
  return { s, calls: [...a.calls, ...b.calls, ...c.calls] };
}

describe("scan new area: A → B → C", () => {
  it("never compares, never changes earlier findings, and makes three areas", async () => {
    const { s, calls } = await threeAreas();
    assert.ok(!calls.includes("compare"), `no comparison requests (got ${calls.join(", ")})`);
    assert.ok(!calls.includes("dedupe"));
    assert.deepEqual(s.findings.map((f) => f.status), ["observed", "observed", "observed"]);
    assert.deepEqual(areas(s).map((a) => a.number), [1, 2, 3]);
    assert.equal(areaOf(s, "C")!.number, 3);
    assert.ok(s.scans.every((sc) => sc.pendingRevisit.length === 0), "no questions when nothing looks alike");
  });

  it("even a confident 'same area' match only SUGGESTS a re-check: no comparison, no merge, own area", async () => {
    const { s, calls } = await threeAreas([["A", "yes"]]);
    assert.ok(!calls.includes("compare"));
    const b = s.scans.find((x) => x.id === "B")!;
    assert.deepEqual(b.pendingRevisit, ["A"], "non-blocking suggestion");
    assert.equal(b.areaId, "area-B", "kept as its own area until the user says otherwise");
    assert.ok(!b.events.some((e) => e.kind === "revisit"), "no 'we've been here before' claim");
    assert.equal(s.findings[0].status, "observed", "Area A's finding untouched");
    assert.equal(areas(s).length, 3);
  });

  it("unclear or failed matches raise nothing at all", async () => {
    let { s } = await threeAreas([["A", "unclear"]]);
    assert.deepEqual(s.scans.find((x) => x.id === "B")!.pendingRevisit, []);
    const failed = await scan(s, "D", { findings: [], matchFails: true });
    s = failed.s;
    const d = s.scans.find((x) => x.id === "D")!;
    assert.deepEqual(d.pendingRevisit, []);
    assert.ok(!d.events.some((e) => e.kind === "notice"), "no 'couldn't check' nag for an intentional new area");
  });

  it("an unusable photo suggests nothing", async () => {
    const s0 = (await threeAreas()).s;
    const { s } = await scan(s0, "D", { findings: [], match: [["C", "yes"]], imageUsable: false });
    assert.deepEqual(s.scans.find((x) => x.id === "D")!.pendingRevisit, []);
  });

  it("accepting the suggestion joins the area (with real comparisons); dismissing keeps it separate", async () => {
    const { s } = await threeAreas([["A", "yes"]]);
    const joined = E.applyUserRevisit(s, "B", "A", [{ findingId: "A-f0", referenceScanId: "A", result: cmp("still_present") }], 5);
    assert.equal(areaOf(joined, "B")!.number, 1);
    assert.equal(areas(joined).length, 2);
    assert.equal(joined.findings[0].status, "still_observed");
    const declined = E.declineRevisit(s, "B", "A");
    assert.deepEqual(declined.scans.find((x) => x.id === "B")!.pendingRevisit, []);
    assert.equal(areas(declined).length, 3);
  });
});

describe("re-check this area", () => {
  it("re-checking Area C compares the chair and updates it conservatively; still three areas", async () => {
    const { s: before } = await threeAreas();
    assert.equal(recheckTarget(before, "C", () => true), "C");
    const { s, calls } = await scan(before, "C2", { findings: [], compare: "improved", sameLocation: "yes" }, "C");
    assert.deepEqual(calls.sort(), ["analyze", "compare"], "compare runs; no scene match for a re-check");
    const chair = s.findings.find((f) => f.id === "C-f0")!;
    assert.equal(chair.status, "appears_improved");
    assert.ok(chair.history.some((h) => h.scanId === "C2" && h.referenceScanId === "C"), "relation to the original kept");
    assert.equal(areaOf(s, "C2")!.number, 3, "the re-check belongs to Area C");
    assert.equal(areas(s).length, 3);
    assert.deepEqual(s.findings.filter((f) => f.id !== "C-f0").map((f) => f.status), ["observed", "observed"], "A and B untouched");
  });

  it("a re-check whose photos show a different place changes nothing, and is still filed under that area", async () => {
    const { s: before } = await threeAreas();
    const { s } = await scan(before, "C2", { findings: [], compare: "improved", sameLocation: "no" }, "C");
    assert.equal(s.findings.find((f) => f.id === "C-f0")!.status, "observed");
    assert.equal(areaOf(s, "C2")!.number, 3);
  });

  it("nothing to re-check when the area has no open findings or no photo", async () => {
    const { s } = await threeAreas();
    assert.equal(recheckTarget(s, "C", () => false), null);
    const improved = (await scan(s, "C2", { findings: [], compare: "improved" }, "C")).s;
    assert.equal(recheckTarget(improved, "C2", () => true), null);
  });
});

describe("grounded visual indicators: disabled, and strict when enabled", () => {
  const ev = (box: object, extra: object = {}) => ({ ...CHAIR, spatialEvidence: { box, target: "black chair", groundingConfidence: "high", ...extra } });
  const good = { yMin: 300, xMin: 150, yMax: 750, xMax: 600 };

  it("is off for this release: nothing is drawn even for a well-formed box", () => {
    assert.deepEqual(spatialBoxes(ev(good)), []);
    assert.deepEqual(spatialBoxes(CHAIR), []);
  });

  it("when enabled, maps Google's 0..1000 grid (y before x) to fractions of the analyzed photo", () => {
    assert.deepEqual(spatialBoxes(ev(good), true), [{ x: 0.15, y: 0.3, width: 0.45, height: 0.45 }]);
  });

  it("when enabled, still refuses low confidence, missing targets, malformed, inverted or scene-wide boxes", () => {
    const bad = [
      ev(good, { groundingConfidence: "low" }),
      ev(good, { target: " " }),
      ev({ ...good, xMax: 1200 }),
      ev({ ...good, yMin: 800 }),
      ev({ ...good, xMin: 10.5 }),
      ev({ yMin: 0, xMin: 0, yMax: 1000, xMax: 900 }),
      { ...CHAIR, spatialEvidence: { boxes: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }] } },
    ];
    for (const d of bad) assert.deepEqual(spatialBoxes(d, true), [], JSON.stringify((d as { spatialEvidence?: unknown }).spatialEvidence));
  });
});

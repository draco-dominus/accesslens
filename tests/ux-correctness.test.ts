import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitContain } from "../src/lib/fit";
import * as E from "../src/lib/session/engine";
import { lineUpSuggestion, lumiMessagesForScan } from "../src/lib/session/lumi";
import type { Session } from "../src/lib/session/types";

/** Camera framing, location messaging and Line-up nudges. Mocked results only; no network. */

describe("camera capture frame (what you see is what's analyzed)", () => {
  it("fits a portrait camera frame without cropping or stretching", () => {
    const r = fitContain({ w: 380, h: 430 }, { w: 1440, h: 1920 });
    assert.equal(r.height, 430);
    assert.equal(r.width, Math.round(1440 * (430 / 1920)));
    assert.ok(Math.abs(r.width / r.height - 1440 / 1920) < 0.01, "aspect ratio preserved");
    assert.equal(r.left, Math.round((380 - r.width) / 2), "centered");
  });

  it("fits a landscape frame by width", () => {
    const r = fitContain({ w: 380, h: 430 }, { w: 1920, h: 1080 });
    assert.equal(r.width, 380);
    assert.ok(Math.abs(r.width / r.height - 1920 / 1080) < 0.01);
    assert.ok(r.top > 0);
  });

  it("never exceeds the available area and handles unknown sizes", () => {
    for (const media of [{ w: 3, h: 4 }, { w: 4000, h: 1000 }, { w: 500, h: 5000 }]) {
      const r = fitContain({ w: 300, h: 400 }, media);
      assert.ok(r.width <= 300 && r.height <= 400);
    }
    assert.deepEqual(fitContain({ w: 0, h: 400 }, { w: 3, h: 4 }), { left: 0, top: 0, width: 0, height: 0 });
  });
});

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
const analysis = (findings: object[]) => ({ imageUsable: true, sceneSummary: "s", findings, limitations: "l" }) as never;
const cmp = (status: string, sameLocation: string) =>
  ({
    ok: true,
    model: "m",
    concern: "c",
    guardrail: null,
    disclaimer: "d",
    comparison: { beforeScene: "", afterScene: "", locationEvidence: "", sameLocation, viewpoint: "similar", originalBarrier: "", beforeBarrierVisible: "yes", afterAreaVisible: "yes", observedChange: "changed", status, visualEvidence: ["e"], remainingUncertainty: "u", suggestedNextAction: "", confidence: "medium" },
  }) as never;
const matchYes = (verdict: string) => ({ ok: true, model: "m", candidates: [{ scanId: "s1", sameArea: verdict, evidence: "e" }], duplicates: [] }) as never;

function base(): Session {
  let s = E.createSession("w", 0);
  s = E.addScan(s, "s1", 1);
  s = E.setAnalysis(s, "s1", analysis([chair]), "g");
  s = E.integrateScan(s, "s1", { candidateScanIds: [], match: null, matchFailed: false, comparisons: [], newFindingIds: ["f1"] }, 2);
  s = E.addScan(s, "s2", 3);
  return E.setAnalysis(s, "s2", analysis([]), "g");
}
const rescan = (sceneVerdict: string, comparisons: E.CompareOutcome[]) =>
  E.integrateScan(base(), "s2", { candidateScanIds: ["s1"], match: matchYes(sceneVerdict), matchFailed: false, comparisons, newFindingIds: [] }, 4);
const said = (s: Session) => lumiMessagesForScan(s, "s2").join(" ");

describe("location messaging is reconciled with comparison evidence", () => {
  it("scene match 'yes' but the comparison finds a different place → no 'same area' claim, findings untouched", () => {
    const s = rescan("yes", [{ findingId: "f1", referenceScanId: "s1", result: cmp("uncertain", "no") }]);
    const scan = s.scans[1];
    assert.equal(scan.relations[0].sameArea, "no");
    assert.ok(!scan.events.some((e) => e.kind === "revisit"), "no revisit claimed");
    assert.doesNotMatch(said(s), /looks like the same area|might be the same area/);
    assert.match(said(s), /closer comparison found a different spot/);
    assert.equal(s.findings[0].status, "observed");
    assert.notEqual(scan.areaId, s.scans[0].areaId, "not merged into the earlier area");
    assert.deepEqual(scan.pendingRevisit, []);
  });

  it("scene match 'yes' but the comparison can't tell → uncertain: ask the user, claim nothing", () => {
    const s = rescan("yes", [{ findingId: "f1", referenceScanId: "s1", result: cmp("uncertain", "unclear") }]);
    assert.equal(s.scans[1].relations[0].sameArea, "unclear");
    assert.deepEqual(s.scans[1].pendingRevisit, ["s1"]);
    assert.doesNotMatch(said(s), /looks like the same area/);
    assert.match(said(s), /not sure whether this is the same area as scan 1/);
    assert.equal(s.findings[0].status, "observed");
  });

  it("scene match 'likely' confirmed by the comparison → confirmed same area", () => {
    const s = rescan("likely", [{ findingId: "f1", referenceScanId: "s1", result: cmp("improved", "yes") }]);
    assert.equal(s.scans[1].relations[0].sameArea, "yes");
    assert.equal(s.scans[1].areaId, s.scans[0].areaId);
    assert.match(said(s), /looks like the same area as scan 1/);
    assert.equal(s.findings[0].status, "appears_improved");
  });

  it("scene match 'yes' and comparison 'likely' → presented as possible, not confirmed", () => {
    const s = rescan("yes", [{ findingId: "f1", referenceScanId: "s1", result: cmp("uncertain", "likely") }]);
    assert.equal(s.scans[1].relations[0].sameArea, "likely");
    assert.match(said(s), /might be the same area/);
    assert.notEqual(s.scans[1].areaId, s.scans[0].areaId);
  });

  it("no comparison evidence (request failed) → the scene match isn't contradicted, and nothing is resolved", () => {
    const s = rescan("yes", [{ findingId: "f1", referenceScanId: "s1", error: "boom" }]);
    assert.equal(s.scans[1].relations[0].sameArea, "yes");
    assert.equal(s.findings[0].status, "observed");
    assert.match(said(s), /couldn't compare finding #1/);
  });

  it("reconcileArea rules (conservative: only unanimous evidence confirms)", () => {
    assert.equal(E.reconcileArea("yes", []), "yes", "no evidence: scene match stands");
    assert.equal(E.reconcileArea("likely", ["yes", "yes"]), "yes");
    assert.equal(E.reconcileArea("likely", ["yes", "no"]), "unclear", "conflict is never a confirmed revisit");
    assert.equal(E.reconcileArea("yes", ["no", "no"]), "no");
    assert.equal(E.reconcileArea("yes", ["no", "unclear"]), "unclear");
    assert.equal(E.reconcileArea("yes", ["likely", "no"]), "unclear");
    assert.equal(E.reconcileArea("yes", ["yes", "likely"]), "likely");
    assert.equal(E.reconcileArea("yes", ["yes", "unclear"]), "unclear");
  });
});

describe("Line-up suggestion", () => {
  it("suggests re-checking the spot of a fresh open finding", () => {
    const s = base();
    const n = lineUpSuggestion(s, "s1");
    assert.equal(n?.scanId, "s1");
    assert.match(n!.text, /chair in the walkway is moved or fixed.*Re-check.*line up/);
  });

  it("is silent when nothing here is open, or while the scan is still processing", () => {
    const improved = rescan("yes", [{ findingId: "f1", referenceScanId: "s1", result: cmp("improved", "yes") }]);
    assert.equal(lineUpSuggestion(improved, "s1"), null);
    assert.equal(lineUpSuggestion(base(), "s2"), null, "s2 has no findings and isn't done");
  });

  it("asks for a same-spot re-check to settle uncertainty", () => {
    let s = base();
    s = E.integrateScan(s, "s2", { candidateScanIds: ["s1"], match: matchYes("yes"), matchFailed: false, comparisons: [{ findingId: "f1", referenceScanId: "s1", result: cmp("uncertain", "yes") }], newFindingIds: [] }, 4);
    assert.equal(s.findings[0].status, "needs_verification");
    assert.match(lineUpSuggestion(s, "s1")!.text, /To settle/);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { areaOf, areas, recheckOutcome } from "../src/lib/session/areas";
import * as E from "../src/lib/session/engine";
import { findingsForScan, lumiMessagesForScan } from "../src/lib/session/lumi";
import { reportPhotoStatus } from "../src/lib/session/report";
import type { Session } from "../src/lib/session/types";

/** Regression tests for the release-hardening QA issues. No network. */

const CHAIR = { barrierType: "obstructed_walkway", title: "Chair in the path", locationInImage: "center", visualEvidence: "A chair.", whoMayBeAffected: ["wheelchair users"], potentialImpact: "x", suggestedImprovement: "x", uncertainty: "x", confidence: "high" };
const cmp = (status: string, sameLocation: string) =>
  ({ ok: true, model: "m", concern: "c", guardrail: null, disclaimer: "d", comparison: { beforeScene: "", afterScene: "", locationEvidence: "", sameLocation, viewpoint: "similar", originalBarrier: "", beforeBarrierVisible: "yes", afterAreaVisible: "partially", observedChange: "Hard to tell.", status, visualEvidence: ["e"], remainingUncertainty: "u", suggestedNextAction: "", confidence: "low" } }) as never;
const ok = (status: string, sameLocation = "yes", findingId = "s1-f0", referenceScanId = "s1") => ({ findingId, referenceScanId, result: cmp(status, sameLocation) });
const failed = (findingId = "s1-f0", referenceScanId = "s1") => ({ findingId, referenceScanId, error: "503" });

function newArea(s: Session, id: string, findings: object[] = []) {
  s = E.addScan(s, id, 1);
  s = E.setAnalysis(s, id, { imageUsable: true, sceneSummary: "x", findings, limitations: "l" } as never, "g");
  return E.integrateScan(s, id, { candidateScanIds: [], match: null, matchFailed: false, comparisons: [], newFindingIds: findings.map((_, i) => `${id}-f${i}`), intent: "new_area" }, 2);
}
function recheck(s: Session, id: string, of: string, comparisons: object[]) {
  s = E.addScan(s, id, 3, { lineUpScanId: of });
  s = E.setAnalysis(s, id, { imageUsable: true, sceneSummary: "x", findings: [], limitations: "l" } as never, "g");
  return E.integrateScan(s, id, { candidateScanIds: [], match: null, matchFailed: false, comparisons: comparisons as never, newFindingIds: [], lineUpScanId: of, intent: "recheck" }, 4);
}
const chairArea = () => newArea(E.createSession("w", 0), "s1", [CHAIR]);
const scanOf = (s: Session, id: string) => s.scans.find((x) => x.id === id)!;

describe("QA 2: rejected same-area comparisons are never grouped or described as the same area", () => {
  it("line up: comparison says a different spot → own area, no 'same spot' message", () => {
    const s = recheck(chairArea(), "s2", "s1", [ok("improved", "no")]);
    assert.equal(recheckOutcome(scanOf(s, "s2")), "rejected");
    assert.notEqual(areaOf(s, "s2")!.key, areaOf(s, "s1")!.key);
    assert.ok(!lumiMessagesForScan(s, "s2").some((m) => /same spot/.test(m) && !/doesn't look like/.test(m)));
  });

  it("line up: comparisons disagree about the place → rejected too", () => {
    let s = newArea(E.createSession("w", 0), "s1", [CHAIR, { ...CHAIR, title: "Second chair" }]);
    s = recheck(s, "s2", "s1", [ok("improved", "yes"), ok("uncertain", "no", "s1-f1")]);
    assert.equal(recheckOutcome(scanOf(s, "s2")), "rejected");
    assert.equal(areas(s).length, 2);
  });

  it("line up: no comparison finished yet (retryable failure) → still filed with the intended area", () => {
    const s = recheck(chairArea(), "s2", "s1", [failed()]);
    assert.equal(recheckOutcome(scanOf(s, "s2")), "pending");
    assert.equal(areaOf(s, "s2")!.key, areaOf(s, "s1")!.key);
  });

  it("line up: confirmed or likely same place → grouped", () => {
    for (const where of ["yes", "likely"]) {
      const s = recheck(chairArea(), "s2", "s1", [ok("still_present", where)]);
      assert.equal(recheckOutcome(scanOf(s, "s2")), "matched", where);
      assert.equal(areas(s).length, 1, where);
    }
  });

  it("accepted suggestion contradicted by the photos → not joined, not recorded as 'yes', no 'same area' claim", () => {
    let s = newArea(chairArea(), "s2", []);
    s = E.applyUserRevisit(s, "s2", "s1", [ok("improved", "no")], 5);
    const b = scanOf(s, "s2");
    assert.equal(b.areaId, "area-s2");
    assert.equal(b.relations.find((r) => r.scanId === "s1")!.sameArea, "no");
    assert.ok(!b.events.some((e) => e.kind === "revisit"));
    assert.ok(lumiMessagesForScan(s, "s2").some((m) => /kept this as a separate area/.test(m)));
    assert.equal(s.findings[0].status, "needs_verification", "the user's disagreement with the photos still can't claim improvement");
    assert.equal(areas(s).length, 2);
  });

  it("accepted suggestion with agreeing photos → joined; with no comparison evidence → the user's answer stands", () => {
    const agreed = E.applyUserRevisit(newArea(chairArea(), "s2", []), "s2", "s1", [ok("still_present", "yes")], 5);
    assert.equal(areas(agreed).length, 1);
    const unverified = E.applyUserRevisit(newArea(chairArea(), "s2", []), "s2", "s1", [failed()], 5);
    assert.equal(areas(unverified).length, 1);
  });

  it("a retried comparison that contradicts a user-confirmed place un-groups the scan", () => {
    let s = E.applyUserRevisit(newArea(chairArea(), "s2", []), "s2", "s1", [failed()], 5);
    assert.equal(areas(s).length, 1);
    s = E.applyRetriedComparison(s, "s2", ok("improved", "no"), 6);
    assert.equal(areas(s).length, 2);
    assert.notEqual(scanOf(s, "s2").relations.find((r) => r.scanId === "s1")!.sameArea, "yes");
    assert.ok(scanOf(s, "s2").events.some((e) => e.kind === "notice" && /no longer treat it as the same area/.test(e.message)));
  });
});

describe("QA 3: repeated inconclusive comparisons stay in results and history", () => {
  it("a second inconclusive re-check is listed in that scan's results and recorded in history", () => {
    let s = recheck(chairArea(), "s2", "s1", [ok("uncertain", "yes")]);
    assert.equal(s.findings[0].status, "needs_verification");
    s = recheck(s, "s3", "s1", [ok("uncertain", "yes")]);
    assert.equal(s.findings[0].status, "needs_verification");
    assert.deepEqual(findingsForScan(s, "s3").map((x) => x.finding.id), ["s1-f0"], "shown in the current results");
    const comparisons = s.findings[0].history.filter((h) => h.source === "comparison");
    assert.deepEqual(comparisons.map((h) => h.scanId), ["s2", "s3"], "both re-checks kept in history");
    assert.ok(lumiMessagesForScan(s, "s3").some((m) => /still couldn't confirm a change/.test(m)));
  });

  it("the same holds for a retried comparison that is inconclusive again", () => {
    let s = recheck(chairArea(), "s2", "s1", [ok("uncertain", "yes")]);
    s = recheck(s, "s3", "s1", [failed()]);
    assert.deepEqual(findingsForScan(s, "s3"), []);
    s = E.applyRetriedComparison(s, "s3", ok("uncertain", "yes"), 7);
    assert.deepEqual(findingsForScan(s, "s3").map((x) => x.finding.id), ["s1-f0"]);
  });
});

describe("QA 4: report export waits for photos and warns when any are missing", () => {
  const s = recheck(chairArea(), "s2", "s1", [ok("improved", "yes")]);
  it("blocks export while photos are being restored", () => {
    assert.equal(reportPhotoStatus(s, () => false, "loading").state, "restoring");
  });
  it("is complete when every expected photo is present", () => {
    assert.deepEqual(reportPhotoStatus(s, () => true, "ready"), { state: "complete", missingScanNumbers: [] });
  });
  it("lists the scans whose expected photos are missing", () => {
    assert.deepEqual(reportPhotoStatus(s, (id) => id === "s1", "ready"), { state: "missing", missingScanNumbers: [2] });
    assert.deepEqual(reportPhotoStatus(s, () => false, "unavailable").missingScanNumbers, [1, 2]);
  });
});

describe("QA 1: the simulated status bar / Dynamic Island never reaches an exported PDF", () => {
  it("is marked no-print, and print CSS hides no-print elements", () => {
    const app = readFileSync(new URL("../src/components/app/AccessLensApp.tsx", import.meta.url), "utf8");
    const block = app.slice(app.indexOf("Simulated status bar"), app.indexOf("Simulated status bar") + 400);
    assert.match(block, /className="no-print /);
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const print = css.slice(css.indexOf("@media print"));
    assert.match(print, /\.no-print\s*\{\s*display:\s*none !important;/);
  });

  it("print CSS turns the size-contained preview frame into a full-width block (no collapsed column)", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const print = css.slice(css.indexOf("@media print"));
    const device = print.slice(print.indexOf(".device {"), print.indexOf("}", print.indexOf(".device {")));
    assert.match(device, /container-type: normal !important/);
    assert.match(device, /width: 100% !important/);
  });
});

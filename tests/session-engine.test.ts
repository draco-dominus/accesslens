import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as E from "../src/lib/session/engine";
import { lumiMessagesForScan, walkthroughSummary } from "../src/lib/session/lumi";
import type { Session } from "../src/lib/session/types";

/** Session engine tests: recorded API results only (no network). */

let t = 0;
const now = () => ++t;
const chair = {
  barrierType: "obstructed_walkway",
  title: "Chair placed in a walking path",
  locationInImage: "center-left",
  visualEvidence: "A black chair in the open floor area.",
  whoMayBeAffected: ["wheelchair users"],
  potentialImpact: "x",
  suggestedImprovement: "Move it",
  uncertainty: "x",
  confidence: "high",
} as const;
const chair2 = { ...chair, title: "Second chair blocking the doorway", locationInImage: "right" } as const;
const stairs = { ...chair, barrierType: "steps", title: "Wide staircase without a visible ramp", locationInImage: "center" } as const;
const analysis = (findings: object[]) => ({ imageUsable: true, sceneSummary: "s", findings, limitations: "l" }) as never;
const cmp = (status: string, extra = {}) =>
  ({
    ok: true,
    model: "m",
    concern: "c",
    guardrail: null,
    disclaimer: "d",
    comparison: {
      beforeScene: "",
      afterScene: "",
      locationEvidence: "",
      sameLocation: "yes",
      viewpoint: "similar",
      originalBarrier: "",
      beforeBarrierVisible: "yes",
      afterAreaVisible: "yes",
      observedChange: status === "improved" ? "The chair is now beside the counter" : "No visible change",
      status,
      visualEvidence: ["e"],
      remainingUncertainty: "Photos can't confirm it stays there",
      suggestedNextAction: "",
      confidence: "medium",
      ...extra,
    },
  }) as never;
const match = (cands: [string, string][], dups: [number, string][] = []) =>
  ({
    ok: true,
    model: "m",
    candidates: cands.map(([scanId, sameArea]) => ({ scanId, sameArea, evidence: "e" })),
    duplicates: dups.map(([newFindingIndex, findingId]) => ({ newFindingIndex, findingId })),
  }) as never;
const has = () => true;

function scan(s: Session, id: string, findings: object[], opts: { match?: never; matchFailed?: boolean; comparisons?: E.CompareOutcome[] } = {}) {
  s = E.addScan(s, id, now());
  s = E.setAnalysis(s, id, analysis(findings), "gemma");
  const cands = E.selectCandidates(s, id, has).map((c) => c.scanId);
  const next = E.integrateScan(
    s,
    id,
    { candidateScanIds: cands, match: opts.match ?? null, matchFailed: !!opts.matchFailed, comparisons: opts.comparisons ?? [], newFindingIds: findings.map((_, i) => `${id}-f${i}`) },
    now(),
  );
  assertNoDanglingEvents(next);
  return next;
}

/** Invariant: every event refers to a finding that exists. */
function assertNoDanglingEvents(s: Session) {
  const ids = new Set(s.findings.map((f) => f.id));
  for (const sc of s.scans)
    for (const e of sc.events)
      if ("findingId" in e) assert.ok(ids.has(e.findingId), `scan ${sc.id} event ${e.kind} references missing finding ${e.findingId}`);
}

describe("scenarios", () => {
  it("A: chair then chair moved → appears improved, one finding, one area", () => {
    let s = scan(E.createSession("A", 0), "s1", [chair]);
    s = scan(s, "s2", [], { match: match([["s1", "yes"]]), comparisons: [{ findingId: "s1-f0", referenceScanId: "s1", result: cmp("improved") }] });
    assert.equal(s.findings[0].status, "appears_improved");
    assert.equal(s.findings.length, 1);
    assert.equal(s.areaCount, 1);
  });

  it("B: same chair twice → still observed, merged by guarded duplicate decision", () => {
    let s = scan(E.createSession("B", 0), "s1", [chair]);
    s = scan(s, "s2", [chair], { match: match([["s1", "yes"]], [[0, "s1-f0"]]), comparisons: [{ findingId: "s1-f0", referenceScanId: "s1", result: cmp("still_present") }] });
    assert.equal(s.findings[0].status, "still_observed");
    assert.equal(s.findings.length, 1);
    assert.equal(s.findings[0].lastSeenScanId, "s2");
  });

  it("duplicate sighting + 'improved' comparison conflict → needs verification", () => {
    let s = scan(E.createSession("B2", 0), "s1", [chair]);
    s = scan(s, "s2", [chair], { match: match([["s1", "yes"]], [[0, "s1-f0"]]), comparisons: [{ findingId: "s1-f0", referenceScanId: "s1", result: cmp("improved") }] });
    assert.equal(s.findings[0].status, "needs_verification");
  });

  it("C: chair then staircase with unclear match → question asked, chair untouched", () => {
    let s = scan(E.createSession("C", 0), "s1", [chair]);
    s = scan(s, "s2", [stairs], { match: match([["s1", "unclear"]]) });
    assert.equal(s.findings[0].status, "observed");
    assert.equal(s.findings.length, 2);
    assert.deepEqual(s.scans[1].pendingRevisit, ["s1"]);
    assert.equal(s.areaCount, 2);
    const declined = E.declineRevisit(s, "s2", "s1");
    assert.equal(declined.findings[0].status, "observed");
    assert.equal(declined.scans[1].pendingRevisit.length, 0);
  });

  it("D: no findings → none fabricated", () => {
    const s = scan(E.createSession("D", 0), "s1", []);
    assert.equal(s.findings.length, 0);
    assert.match(lumiMessagesForScan(s, "s1")[0], /doesn't mean the area is accessible/);
  });

  it("E: findings persist across 3+ scans and summary uses session data", () => {
    let s = scan(E.createSession("E", 0), "s1", [chair]);
    s = scan(s, "s2", [stairs], { match: match([["s1", "no"]]) });
    s = scan(s, "s3", [], { match: match([["s2", "no"], ["s1", "yes"]]), comparisons: [{ findingId: "s1-f0", referenceScanId: "s1", result: cmp("improved") }] });
    assert.equal(s.findings.length, 2);
    assert.equal(s.findings[0].status, "appears_improved");
    assert.equal(s.findings[1].status, "observed");
    assert.deepEqual([...E.scansNeedingImages(s)].sort(), ["s2", "s3"]);
    assert.match(walkthroughSummary(s).lines[0], /three scans across two areas/);
  });
});

describe("safety rules", () => {
  it("absent from a same-area scan without a comparison → NOT improved", () => {
    let s = scan(E.createSession("H", 0), "s1", [chair]);
    s = scan(s, "s2", [], { match: match([["s1", "yes"]]) });
    assert.equal(s.findings[0].status, "observed");
  });

  it("failed scene match → user asked, nothing resolved", () => {
    let s = scan(E.createSession("F", 0), "s1", [chair]);
    s = scan(s, "s2", [], { matchFailed: true });
    assert.deepEqual(s.scans[1].pendingRevisit, ["s1"]);
    assert.equal(s.findings[0].status, "observed");
  });

  it("failed comparison → status unchanged", () => {
    let s = scan(E.createSession("G", 0), "s1", [chair]);
    s = scan(s, "s2", [], { match: match([["s1", "yes"]]), comparisons: [{ findingId: "s1-f0", referenceScanId: "s1", error: "boom" }] });
    assert.equal(s.findings[0].status, "observed");
  });

  it("'likely' match whose comparison says different place → finding untouched, no revisit claimed", () => {
    let s = scan(E.createSession("R", 0), "s1", [stairs]);
    s = scan(s, "s2", [], { match: match([["s1", "likely"]]), comparisons: [{ findingId: "s1-f0", referenceScanId: "s1", result: cmp("uncertain", { sameLocation: "no" }) }] });
    assert.equal(s.findings[0].status, "observed");
    assert.equal(s.findings[0].history.length, 1);
    assert.ok(!s.scans[1].events.some((e) => e.kind === "revisit"));
  });

  it("user-confirmed revisit + comparison says different place → needs verification (never improved)", () => {
    let s = scan(E.createSession("U", 0), "s1", [chair]);
    s = scan(s, "s2", [stairs], { match: match([["s1", "unclear"]]) });
    s = E.applyUserRevisit(s, "s2", "s1", [{ findingId: "s1-f0", referenceScanId: "s1", result: cmp("uncertain", { sameLocation: "no" }) }], now());
    assert.equal(s.findings[0].status, "needs_verification");
    assertNoDanglingEvents(s);
  });
});

describe("finding merging (regression: unsafe same-category merge)", () => {
  function twoChairsConfirmedRevisit() {
    // Scan 1: chair A. Scan 2 (match unclear → user confirms same area): chair A still there AND a
    // different chair B recorded as a new finding of the same type.
    let s = scan(E.createSession("M", 0), "s1", [chair]);
    s = scan(s, "s2", [chair2], { match: match([["s1", "unclear"]]) });
    s = E.applyUserRevisit(s, "s2", "s1", [{ findingId: "s1-f0", referenceScanId: "s1", result: cmp("still_present") }], now());
    return s;
  }

  it("a user-confirmed revisit never auto-merges or deletes a same-type finding", () => {
    const s = twoChairsConfirmedRevisit();
    assert.equal(s.findings.length, 2, "distinct chair B must survive");
    assert.deepEqual(s.findings.map((f) => f.details.title), [chair.title, chair2.title]);
    assert.equal(s.findings[0].status, "still_observed");
    assert.equal(s.findings[1].status, "observed");
    assertNoDanglingEvents(s);
  });

  it("possible duplicates are only suggested, for the specific pair", () => {
    const s = twoChairsConfirmedRevisit();
    assert.deepEqual(E.duplicateSuggestions(s, "s2"), [{ newFindingId: "s2-f0", existingFindingId: "s1-f0" }]);
  });

  it("explicit confirmation merges the pair and removes every event about the merged finding", () => {
    const s = E.confirmDuplicate(twoChairsConfirmedRevisit(), "s2", "s2-f0", "s1-f0", now());
    assert.equal(s.findings.length, 1);
    assert.equal(s.findings[0].lastSeenScanId, "s2");
    assert.equal(s.findings[0].history.at(-1)?.source, "duplicate");
    assertNoDanglingEvents(s);
    assert.ok(lumiMessagesForScan(s, "s2").some((m) => /You confirmed finding #2 is the same barrier as #1/.test(m)));
  });

  it("confirmation is refused for pairs that weren't suggested", () => {
    const base = twoChairsConfirmedRevisit();
    assert.equal(E.confirmDuplicate(base, "s2", "s2-f0", "nope", now()), base);
    assert.equal(E.confirmDuplicate(base, "s1", "s2-f0", "s1-f0", now()), base);
    // Different barrier type is never suggested.
    let s = scan(E.createSession("M2", 0), "s1", [chair]);
    s = scan(s, "s2", [stairs], { match: match([["s1", "unclear"]]) });
    s = E.applyUserRevisit(s, "s2", "s1", [{ findingId: "s1-f0", referenceScanId: "s1", result: cmp("still_present") }], now());
    assert.deepEqual(E.duplicateSuggestions(s, "s2"), []);
  });

  it("no suggestion when the earlier finding wasn't confirmed still present in this scan", () => {
    let s = scan(E.createSession("M3", 0), "s1", [chair]);
    s = scan(s, "s2", [chair2], { match: match([["s1", "unclear"]]) });
    s = E.applyUserRevisit(s, "s2", "s1", [{ findingId: "s1-f0", referenceScanId: "s1", result: cmp("uncertain", { afterAreaVisible: "partially" }) }], now());
    assert.deepEqual(E.duplicateSuggestions(s, "s2"), []);
  });

  it("new finding numbers never collide after a merge", () => {
    let s = E.confirmDuplicate(twoChairsConfirmedRevisit(), "s2", "s2-f0", "s1-f0", now());
    s = scan(s, "s3", [stairs], { match: match([["s2", "no"]]) });
    const numbers = s.findings.map((f) => f.number);
    assert.equal(new Set(numbers).size, numbers.length);
  });
});

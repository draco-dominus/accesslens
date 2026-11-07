import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as E from "../src/lib/session/engine";
import { answerQuestion, findingCaptionForScan, LUMI_QUESTIONS } from "../src/lib/session/lumi";
import type { Session } from "../src/lib/session/types";
import { firstSentence, isWhole } from "../src/lib/text";

/** Phase A (visual inspection UI): grounded Ask Lumi, progressive-disclosure summaries, trust copy. */

describe("progressive disclosure summaries", () => {
  it("takes the first sentence of validated text without rewriting it", () => {
    const t = "A black chair sits in the middle of the walkway. It narrows the path to about half its width.";
    assert.equal(firstSentence(t), "A black chair sits in the middle of the walkway.");
    assert.equal(isWhole(t), false);
  });

  it("keeps single-sentence text whole", () => {
    const t = "A wide staircase with no visible ramp.";
    assert.equal(firstSentence(t), t);
    assert.equal(isWhole(t), true);
  });

  it("doesn't split on abbreviations or leave a tiny fragment", () => {
    assert.equal(firstSentence("Move it approx. 1 m to the side of the door."), "Move it approx. 1 m to the side of the door.");
    assert.equal(firstSentence("Note. The rest of the explanation follows here."), "Note. The rest of the explanation follows here.");
  });
});

const finding = {
  barrierType: "obstructed_walkway",
  title: "Chair in the walkway",
  locationInImage: "center-left",
  visualEvidence: "A black chair in the open floor area.",
  whoMayBeAffected: ["wheelchair users", "people who are blind"],
  potentialImpact: "It narrows the path.",
  suggestedImprovement: "Move the chair beside the counter.",
  uncertainty: "The exact path width can't be measured from a photo.",
  confidence: "high",
} as const;

function session(): Session {
  let s = E.createSession("w", 0);
  s = E.addScan(s, "s1", 1);
  s = E.setAnalysis(s, "s1", { imageUsable: true, sceneSummary: "hall", findings: [finding], limitations: "Only one angle." } as never, "g");
  return E.integrateScan(s, "s1", { candidateScanIds: [], match: null, matchFailed: false, comparisons: [], newFindingIds: ["f1"] }, 2);
}

describe("Ask Lumi answers are grounded in recorded data", () => {
  const s = session();
  const f = s.findings[0];

  it("answers repeat the analysis fields verbatim and name their source", () => {
    assert.deepEqual(answerQuestion(s, f, "why"), { text: finding.potentialImpact, source: "From scan 1’s analysis" });
    assert.equal(answerQuestion(s, f, "fix").text, finding.suggestedImprovement);
    assert.equal(answerQuestion(s, f, "who").text, "It could affect wheelchair users, people who are blind.");
    assert.equal(answerQuestion(s, f, "unknown").text, `${finding.uncertainty} More generally: Only one angle.`);
  });

  it("'has it changed' only reports recorded history", () => {
    assert.match(answerQuestion(s, f, "changed").text, /only seen this in scan 1/);
    let s2 = E.addScan(s, "s2", 3);
    s2 = E.setAnalysis(s2, "s2", { imageUsable: true, sceneSummary: "hall", findings: [], limitations: "l" } as never, "g");
    s2 = E.integrateScan(
      s2,
      "s2",
      {
        candidateScanIds: ["s1"],
        match: { ok: true, model: "m", candidates: [{ scanId: "s1", sameArea: "yes", evidence: "e" }], duplicates: [] } as never,
        matchFailed: false,
        comparisons: [{ findingId: "f1", referenceScanId: "s1", result: { ok: true, model: "m", concern: "c", guardrail: null, disclaimer: "d", comparison: { beforeScene: "", afterScene: "", locationEvidence: "", sameLocation: "yes", viewpoint: "similar", originalBarrier: "", beforeBarrierVisible: "yes", afterAreaVisible: "yes", observedChange: "The chair is now beside the counter.", status: "improved", visualEvidence: ["e"], remainingUncertainty: "u", suggestedNextAction: "", confidence: "medium" } } as never }],
        newFindingIds: [],
      },
      4,
    );
    const a = answerQuestion(s2, s2.findings[0], "changed");
    assert.match(a.text, /Scan 2: appears improved\. The chair is now beside the counter\./);
    assert.match(a.text, /Please confirm it in person/);
  });

  it("every question has an answer, and question ids are unique", () => {
    assert.equal(new Set(LUMI_QUESTIONS.map((q) => q.id)).size, LUMI_QUESTIONS.length);
    for (const q of LUMI_QUESTIONS) assert.ok(answerQuestion(s, f, q.id).text.length > 0, q.id);
  });
});

describe("photo-specific finding captions", () => {
  it("uses original evidence only on the photo where the finding was first observed", () => {
    const s = session();
    const caption = findingCaptionForScan(s, "s1", s.findings[0]);
    assert.equal(caption?.label, "#1 · Where, as described by Lumi: center-left");
    assert.equal(caption?.text, finding.visualEvidence);
  });

  it("uses comparison evidence on a later photo instead of evidence from the original photo", () => {
    let s = session();
    s = E.addScan(s, "s2", 3);
    s = E.setAnalysis(s, "s2", { imageUsable: true, sceneSummary: "hall", findings: [], limitations: "l" } as never, "g");
    s = E.integrateScan(
      s,
      "s2",
      {
        candidateScanIds: ["s1"],
        match: { ok: true, model: "m", candidates: [{ scanId: "s1", sameArea: "yes", evidence: "e" }], duplicates: [] } as never,
        matchFailed: false,
        comparisons: [{ findingId: "f1", referenceScanId: "s1", result: { ok: true, model: "m", concern: "c", guardrail: null, disclaimer: "d", comparison: { beforeScene: "", afterScene: "", locationEvidence: "", sameLocation: "yes", viewpoint: "similar", originalBarrier: "", beforeBarrierVisible: "yes", afterAreaVisible: "yes", observedChange: "The chair is now beside the counter. The walkway appears clearer.", status: "improved", visualEvidence: ["e"], remainingUncertainty: "u", suggestedNextAction: "", confidence: "medium" } } as never }],
        newFindingIds: [],
      },
      4,
    );

    const caption = findingCaptionForScan(s, "s2", s.findings[0]);
    assert.equal(caption?.label, "#1 · Compared with scan 1: appears improved");
    assert.equal(caption?.text, "The chair is now beside the counter.");
    assert.doesNotMatch(caption?.text ?? "", /black chair in the open floor area/i);
  });

  it("does not attach a finding caption to a photo that never observed or compared it", () => {
    const s = session();
    assert.equal(findingCaptionForScan(s, "unrelated", s.findings[0]), null);
  });
});

describe("trust copy guard", () => {
  // Claims we must not make without evidence (see the visual-inspection proposal).
  const banned = [
    /endorsed by/i,
    /validated by/i,
    /trained (by|with) (accessibility|disability)/i,
    /reviewed by (accessibility|disability)/i,
    /certified (accessible|compliant)/i,
    /\bADA[- ]compliant\b/i,
    /\bmeets (code|ADA)\b/i,
    /this space is (fully )?accessible/i,
    /powered by gemini/i,
    /\d+\s?% accura/i,
  ];
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(n) ? [p] : [];
    });

  it("user-facing UI and Lumi text make none of the banned claims", () => {
    const sources = [...files("src/components"), "src/lib/session/lumi.ts"];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const re of banned) assert.doesNotMatch(text, re, `${file} contains ${re}`);
    }
  });
});

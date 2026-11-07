import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChatRequestSchema, validateGroundedChatOutput } from "../src/lib/chat-schema";
import { buildChatRequest, completedTurns, type ChatMessage } from "../src/lib/session/chat-context";
import * as E from "../src/lib/session/engine";
import type { Session } from "../src/lib/session/types";

/** Ask Lumi client contract: what the app sends to /api/chat must always pass the server's schema. */

const finding = (title: string, extra: object = {}) => ({
  barrierType: "obstructed_walkway",
  title,
  locationInImage: "center-left",
  visualEvidence: "A black chair sits in the open floor where people walk.",
  whoMayBeAffected: ["wheelchair users", "people who are blind or have low vision"],
  potentialImpact: "It narrows the route.",
  suggestedImprovement: "Move the chair beside the counter.",
  uncertainty: "Width can't be measured from a photo.",
  confidence: "high",
  ...extra,
});

function sessionWith(findings: object[][]): Session {
  let s = E.createSession("w1", 0);
  findings.forEach((fs, i) => {
    const id = `s${i + 1}`;
    s = E.addScan(s, id, 1);
    s = E.setAnalysis(s, id, { imageUsable: true, sceneSummary: "x", findings: fs, limitations: "l" } as never, "g");
    s = E.integrateScan(s, id, { candidateScanIds: [], match: null, matchFailed: false, comparisons: [], newFindingIds: fs.map((_, j) => `${id}-f${j}`), intent: "new_area" }, 2);
  });
  return s;
}

describe("Ask Lumi request", () => {
  it("maps the session to a request the server accepts, selected finding first, no photos", () => {
    const s = sessionWith([[finding("Sign too small")], [finding("Chair placed in a walking path")]]);
    const body = buildChatRequest(s, "s2-f0", "Why does this matter if someone can just walk around it?", [])!;
    assert.equal(ChatRequestSchema.safeParse(body).success, true);
    assert.equal(body.selectedFindingId, "s2-f0");
    assert.equal(body.findings[0].id, "s2-f0");
    const json = JSON.stringify(body);
    assert.ok(!/blob:|data:image|imageUrl|scanId|createdAt|model/.test(json), "only text fields leave the device");
  });

  it("clips overlong or empty fields to the contract instead of failing", () => {
    const long = "x".repeat(2000);
    const s = sessionWith([[finding(long, { visualEvidence: long, uncertainty: "  ", whoMayBeAffected: Array(9).fill(long) })]]);
    const body = buildChatRequest(s, "s1-f0", "q".repeat(900), [])!;
    assert.equal(ChatRequestSchema.safeParse(body).success, true);
    assert.equal(body.findings[0].whoMayBeAffected.length, 6);
    assert.equal(body.findings[0].uncertainty, "Not recorded.");
    assert.ok(body.question.length <= 500);
  });

  it("caps findings at 10 and history at the last 3 complete turns", () => {
    const s = sessionWith([Array.from({ length: 14 }, (_, i) => finding(`Finding ${i}`))]);
    const turns = Array.from({ length: 5 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    const body = buildChatRequest(s, "s1-f13", "next?", turns)!;
    assert.equal(ChatRequestSchema.safeParse(body).success, true);
    assert.equal(body.findings.length, 10);
    assert.equal(body.findings[0].id, "s1-f13");
    assert.deepEqual(body.history.map((h) => h.content), ["q2", "a2", "q3", "a3", "q4", "a4"]);
  });

  it("returns nothing to send when there are no findings", () => {
    assert.equal(buildChatRequest(E.createSession("w", 0), null, "hi", []), null);
  });
});

describe("conversation memory", () => {
  const u = (text: string): ChatMessage => ({ id: text, role: "user", text });
  const l = (text: string, extra: object = {}): ChatMessage => ({ id: `l${text}`, role: "lumi", kind: "ai", text, question: "", ...extra });
  it("sends only completed exchanges: no pending or failed answers", () => {
    const thread = [u("Why does it matter?"), l("Because the route narrows."), u("What would you change?"), l("", { error: { message: "x", retryable: true } }), u("Again?"), l("", { pending: true })];
    assert.deepEqual(completedTurns(thread), [{ question: "Why does it matter?", answer: "Because the route narrows." }]);
  });
});

describe("answer guard", () => {
  const input = { question: "q", findings: [{ id: "f1" }] } as never;
  const out = (answer: string) => ({ answer, groundedFindingIds: [], needsOnSiteVerification: false });
  it("still rejects invented measurements", () => {
    for (const a of ["Leave at least 36 inches clear.", "Keep 0.9 m clear.", "About 3 ft.", 'A 2" lip.', "Use 12 in. of clearance."]) {
      assert.equal(validateGroundedChatOutput(input, out(a)).valid, false, a);
    }
  });
  it("doesn't mistake ordinary words for inches", () => {
    assert.equal(validateGroundedChatOutput(input, out("Finding 4 in the hallway narrows the route.")).valid, true);
  });
});

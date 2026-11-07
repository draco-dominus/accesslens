import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleChatPost, type ChatGenerator } from "../src/lib/chat-handler";
import {
  ChatModelOutputSchema,
  ChatRequestSchema,
  chatPrompt,
  validateGroundedChatOutput,
  type ChatRequest,
} from "../src/lib/chat-schema";

const finding = {
  id: "finding-1",
  barrierType: "obstructed_walkway" as const,
  title: "Chair narrows the hallway",
  visualEvidence: "A chair is visible in the marked walking route.",
  whoMayBeAffected: ["wheelchair users", "people using walkers"],
  potentialImpact: "The available route may be narrowed.",
  suggestedImprovement: "Move the chair outside the walking route.",
  uncertainty: "The remaining clear width cannot be measured from the photo.",
  confidence: "high" as const,
  status: "observed" as const,
  history: [{ status: "observed" as const, source: "analysis" as const, note: "Chair observed in scan 1." }],
};

const validInput: ChatRequest = {
  question: "What should I do next?",
  selectedFindingId: finding.id,
  findings: [finding],
  history: [
    { role: "user", content: "Who might this affect?" },
    { role: "assistant", content: "The inspection recorded that the route may be narrowed." },
  ],
};

const request = (body: unknown, contentType = "application/json") =>
  new Request("https://accesslens.test/api/chat", { method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body) });

describe("chat input contract", () => {
  it("accepts bounded findings and complete prior turns", () => {
    assert.equal(ChatRequestSchema.safeParse(validInput).success, true);
  });

  it("rejects photographs, unknown fields and an unknown selected finding", () => {
    assert.equal(ChatRequestSchema.safeParse({ ...validInput, image: "data:image/jpeg;base64,abc" }).success, false);
    assert.equal(ChatRequestSchema.safeParse({ ...validInput, selectedFindingId: "not-present" }).success, false);
  });

  it("rejects overlong questions and incomplete or misordered history", () => {
    assert.equal(ChatRequestSchema.safeParse({ ...validInput, question: "q".repeat(501) }).success, false);
    assert.equal(ChatRequestSchema.safeParse({ ...validInput, history: [{ role: "user", content: "unfinished" }] }).success, false);
    assert.equal(
      ChatRequestSchema.safeParse({ ...validInput, history: [{ role: "assistant", content: "wrong order" }, { role: "user", content: "wrong order" }] }).success,
      false,
    );
  });

  it("serializes only validated text context and no photograph payload", () => {
    const prompt = chatPrompt(validInput);
    assert.match(prompt, /finding-1/);
    assert.match(prompt, /What should I do next/);
    assert.match(prompt, /wheelchair users/);
    assert.doesNotMatch(prompt, /data:image|inlineData|base64/);
  });
});

describe("chat output safety", () => {
  const output = { answer: "The recorded next step is to move the chair outside the walking route.", groundedFindingIds: [finding.id], needsOnSiteVerification: false };

  it("accepts a bounded answer citing supplied findings", () => {
    assert.equal(ChatModelOutputSchema.safeParse(output).success, true);
    assert.deepEqual(validateGroundedChatOutput(validInput, output), { valid: true });
  });

  it("rejects invented IDs, compliance claims, guarantees and precise measurements", () => {
    assert.deepEqual(validateGroundedChatOutput(validInput, { ...output, groundedFindingIds: ["invented"] }), {
      valid: false,
      reason: "unknown source ID",
    });
    for (const answer of ["This is ADA compliant.", "The hallway is safe.", "The route is 36 inches wide."]) {
      assert.equal(validateGroundedChatOutput(validInput, { ...output, answer }).valid, false);
    }
  });

  it("enforces the response text cap", () => {
    assert.equal(ChatModelOutputSchema.safeParse({ ...output, answer: "a".repeat(1201) }).success, false);
  });
});

describe("POST /api/chat handler with a mocked generator", () => {
  it("returns a grounded success response and calls the generator once", async () => {
    const calls: ChatRequest[] = [];
    const generate: ChatGenerator = async (input) => {
      calls.push(input);
      return {
        model: "mock-gemini",
        output: { answer: "Move the recorded chair outside the route, then re-check the same area.", groundedFindingIds: [finding.id], needsOnSiteVerification: true },
      };
    };
    const { response } = await handleChatPost(request(validInput), generate);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    const json = await response.json();
    assert.equal(json.ok, true);
    assert.deepEqual(json.groundedFindingIds, [finding.id]);
    assert.equal(json.needsOnSiteVerification, true);
  });

  it("returns distinct actionable errors without calling the generator", async () => {
    let calls = 0;
    const generate: ChatGenerator = async () => {
      calls++;
      throw new Error("must not run");
    };
    const wrongType = await handleChatPost(request(validInput, "multipart/form-data"), generate);
    assert.equal(wrongType.response.status, 415);
    assert.equal((await wrongType.response.json()).error.code, "CHAT_CONTENT_TYPE");

    const invalidJson = await handleChatPost(
      new Request("https://accesslens.test/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }),
      generate,
    );
    assert.equal((await invalidJson.response.json()).error.code, "CHAT_INVALID_JSON");

    const invalidInput = await handleChatPost(request({ question: "Hi", findings: [], history: [] }), generate);
    assert.equal((await invalidInput.response.json()).error.code, "CHAT_INVALID_INPUT");

    const oversized = await handleChatPost(
      new Request("https://accesslens.test/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...validInput, ignoredPadding: "x".repeat(65 * 1024) }),
      }),
      generate,
    );
    assert.equal(oversized.response.status, 413);
    assert.equal((await oversized.response.json()).error.code, "CHAT_TOO_LARGE");
    assert.equal(calls, 0);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyComparisonGuardrails } from "../src/lib/comparison-guardrails";
import { resolveMatch } from "../src/lib/match-guardrails";
import { FixedWindowLimiter } from "../src/lib/rate-limit";

const base = {
  beforeScene: "x",
  afterScene: "x",
  originalBarrier: "chair",
  beforeBarrierVisible: "yes",
  afterAreaVisible: "yes",
  sameLocation: "yes",
  viewpoint: "similar",
  locationEvidence: "x",
  observedChange: "x",
  status: "improved",
  visualEvidence: ["x"],
  remainingUncertainty: "x",
  suggestedNextAction: "orig",
  confidence: "high",
} as const;

describe("comparison guardrails", () => {
  const cases: [string, object, string][] = [
    ["clean improved stays improved", {}, "improved"],
    ["improved + only 'likely' same place", { sameLocation: "likely" }, "uncertain"],
    ["improved + area out of frame", { afterAreaVisible: "no" }, "uncertain"],
    ["improved + area partially visible", { afterAreaVisible: "partially" }, "uncertain"],
    ["improved + different place", { sameLocation: "no" }, "uncertain"],
    ["improved + unclear place", { sameLocation: "unclear" }, "uncertain"],
    ["improved + barrier not in BEFORE", { beforeBarrierVisible: "no" }, "uncertain"],
    ["improved + different viewpoint (area visible)", { viewpoint: "different" }, "improved"],
    ["still_present + area hidden in AFTER", { status: "still_present", afterAreaVisible: "no" }, "uncertain"],
    ["still_present + barrier NOT established in BEFORE (new rule)", { status: "still_present", beforeBarrierVisible: "no" }, "uncertain"],
    ["still_present + barrier partially visible in BEFORE", { status: "still_present", beforeBarrierVisible: "partially" }, "still_present"],
    ["still_present + 'likely' same place", { status: "still_present", sameLocation: "likely" }, "still_present"],
    ["still_present + different place", { status: "still_present", sameLocation: "no" }, "uncertain"],
    ["uncertain stays uncertain", { status: "uncertain", sameLocation: "no" }, "uncertain"],
  ];
  for (const [name, patch, want] of cases) {
    it(name, () => {
      const { comparison, guardrail } = applyComparisonGuardrails({ ...base, ...patch } as never);
      assert.equal(comparison.status, want);
      if (want === "uncertain" && (patch as { status?: string }).status !== "uncertain") {
        assert.ok(guardrail && guardrail.reasons.length > 0, "an override must explain itself");
      }
    });
  }

  it("different viewpoint caps 'improved' confidence at medium", () => {
    assert.equal(applyComparisonGuardrails({ ...base, viewpoint: "different" } as never).comparison.confidence, "medium");
  });
});

describe("match guardrails", () => {
  const ctx = {
    newFindings: [
      { barrierType: "obstructed_walkway", title: "Chair", locationInImage: "left" },
      { barrierType: "steps", title: "Stairs", locationInImage: "back" },
    ],
    candidates: [
      { scanId: "s1", findings: [{ id: "f1", barrierType: "obstructed_walkway", title: "Chair", locationInImage: "left" }] },
      { scanId: "s2", findings: [{ id: "f2", barrierType: "steps", title: "Stairs", locationInImage: "c" }] },
    ],
  } as never;
  const out = (c1: string, c2: string, dups: [string, string][]) =>
    ({
      newScene: "x",
      candidates: [
        { ref: "C1", scene: "", locationEvidence: "e", sameArea: c1 },
        { ref: "C2", scene: "", locationEvidence: "e", sameArea: c2 },
      ],
      duplicates: dups.map(([n, e]) => ({ newFinding: n, earlierFinding: e, reason: "r" })),
    }) as never;

  it("accepts a duplicate only with a confident same-area match and the same type", () => {
    assert.deepEqual(resolveMatch(ctx, out("yes", "no", [["N1", "F1"]]), "m").duplicates, [{ newFindingIndex: 0, findingId: "f1" }]);
  });
  it("rejects a duplicate when the area is only 'likely'", () => {
    assert.deepEqual(resolveMatch(ctx, out("likely", "no", [["N1", "F1"]]), "m").duplicates, []);
  });
  it("rejects a duplicate across barrier types", () => {
    assert.deepEqual(resolveMatch(ctx, out("yes", "yes", [["N1", "F2"]]), "m").duplicates, []);
  });
  it("ignores unknown aliases", () => {
    assert.deepEqual(resolveMatch(ctx, out("yes", "yes", [["N9", "F1"], ["N1", "F7"]]), "m").duplicates, []);
  });
  it("is one-to-one", () => {
    assert.deepEqual(resolveMatch(ctx, out("yes", "yes", [["N1", "F1"], ["N2", "F1"]]), "m").duplicates, [{ newFindingIndex: 0, findingId: "f1" }]);
  });
  it("treats unanswered candidates as 'unclear', never as a match", () => {
    const r = resolveMatch(ctx, { newScene: "x", candidates: [], duplicates: [] } as never, "m");
    assert.ok(r.candidates.every((c) => c.sameArea === "unclear"));
  });
});

describe("rate limiter (per instance)", () => {
  it("allows up to the limit per window, then reports when to retry", () => {
    let t = 0;
    const l = new FixedWindowLimiter(2, 60_000, 100, () => t);
    assert.equal(l.check("a").allowed, true);
    assert.equal(l.check("a").allowed, true);
    const denied = l.check("a");
    assert.equal(denied.allowed, false);
    assert.equal(denied.retryAfterMs, 60_000);
    assert.equal(l.check("b").allowed, true, "keys are independent");
    t = 60_000;
    assert.equal(l.check("a").allowed, true, "new window");
  });

  it("keeps memory bounded", () => {
    let t = 0;
    const l = new FixedWindowLimiter(1, 1_000, 3, () => t);
    for (const k of ["a", "b", "c", "d", "e"]) l.check(k);
    // @ts-expect-error inspecting private state in a test
    assert.ok(l.windows.size <= 3);
    t = 5_000;
    assert.equal(l.check("a").allowed, true);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recheckHeadline } from "../src/lib/session/lumi";
import type { FindingEvent, TrackedFinding } from "../src/lib/session/types";

/** The re-check headline may only say "appears removed" when every piece of recorded evidence agrees. */
const finding = (barrierType: string) => ({ details: { barrierType } }) as unknown as TrackedFinding;
const event = (status: string, c: Partial<Record<string, string>> = {}): FindingEvent =>
  ({
    scanId: "s2", at: 1, status, source: "comparison", note: "n",
    comparison: { status: "improved", sameLocation: "yes", afterAreaVisible: "yes", observedChange: "The chair was moved beside the counter. The floor is clear.", ...c },
  }) as unknown as FindingEvent;

describe("re-check headline", () => {
  it("names the improvement only when status, comparison, place and visibility all agree", () => {
    const h = recheckHeadline(finding("obstructed_walkway"), event("appears_improved"));
    assert.equal(h.text, "Obstruction appears removed");
    assert.equal(h.tone, "improved");
    assert.equal(h.detail, "The chair was moved beside the counter.");
  });

  it("stays generic when any evidence is weaker", () => {
    for (const c of [{ sameLocation: "likely" }, { afterAreaVisible: "partially" }, { status: "uncertain" }]) {
      assert.equal(recheckHeadline(finding("obstructed_walkway"), event("appears_improved", c)).text, "Appears improved", JSON.stringify(c));
    }
  });

  it("never claims improvement when the guarded status didn't", () => {
    assert.equal(recheckHeadline(finding("obstructed_walkway"), event("needs_verification")).tone, "unsure");
    assert.equal(recheckHeadline(finding("obstructed_walkway"), event("still_observed", { status: "still_present" })).text, "Still present in the new photo");
  });

  it("uses wording that fits the barrier type", () => {
    assert.equal(recheckHeadline(finding("steps"), event("appears_improved")).text, "Step barrier appears improved");
    assert.equal(recheckHeadline(finding("other"), event("appears_improved")).text, "Barrier appears improved");
  });
});

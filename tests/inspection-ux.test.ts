import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessibilityNeeds, uncategorizedGroups } from "../src/lib/session/categories";

/**
 * Accessibility-need categories come only from the AI's own "who may be affected" list.
 * A transparent mapping: several categories per finding, uncategorized groups kept, no guessing.
 */
describe("accessibility-need categories", () => {
  it("maps the groups the analysis named, with the supporting groups", () => {
    const needs = accessibilityNeeds(["wheelchair users", "people who are blind or have low vision", "people using walkers"]);
    assert.deepEqual(needs, [
      { category: "mobility", groups: ["wheelchair users", "people using walkers"] },
      { category: "vision", groups: ["people who are blind or have low vision"] },
    ]);
  });

  it("supports wayfinding and cognitive needs", () => {
    const needs = accessibilityNeeds(["people with cognitive disabilities", "people with dementia", "autistic visitors"]);
    assert.deepEqual(needs.map((n) => n.category), ["cognitive"]);
    assert.equal(needs[0].groups.length, 3);
  });

  it("allows several categories for one group", () => {
    assert.deepEqual(accessibilityNeeds(["blind wheelchair users"]).map((n) => n.category), ["mobility", "vision"]);
  });

  it("doesn't guess for ambiguous or general groups", () => {
    const who = ["older adults", "people carrying luggage", "people using canes", "everyone"];
    assert.deepEqual(accessibilityNeeds(who), []);
    assert.deepEqual(uncategorizedGroups(who), who);
  });

  it("keeps unmatched groups alongside matched ones", () => {
    assert.deepEqual(uncategorizedGroups(["wheelchair users", "parents with young children"]), ["parents with young children"]);
  });

  it("recognises common wording variants", () => {
    const cases: [string, string][] = [
      ["people with limited mobility", "mobility"],
      ["parents with strollers", "mobility"],
      ["people with visual impairments", "vision"],
      ["white cane users", "vision"],
      ["guide dog users", "vision"],
      ["people who may become disoriented", "cognitive"],
    ];
    for (const [group, category] of cases) assert.deepEqual(accessibilityNeeds([group]).map((n) => n.category), [category], group);
  });
});

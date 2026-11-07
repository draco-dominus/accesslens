/**
 * Accessibility-need categories for a finding, derived ONLY from the AI's own validated
 * `whoMayBeAffected` list (e.g. "wheelchair users", "people who are blind or have low vision").
 *
 * This is a transparent, deterministic mapping of groups the analysis already named — no new model
 * call, no schema change, no severity. A group that matches no rule simply stays uncategorized, and the
 * UI always shows the groups a category came from. A finding can have several categories.
 */

export type NeedCategory = "mobility" | "vision" | "cognitive";

export const NEED_CATEGORIES: readonly NeedCategory[] = ["mobility", "vision", "cognitive"];

export const NEED_LABEL: Record<NeedCategory, string> = {
  mobility: "Mobility",
  vision: "Vision",
  cognitive: "Wayfinding & cognitive",
};

const RULES: Record<NeedCategory, RegExp[]> = {
  mobility: [
    /wheelchair/i,
    /\bwalkers?\b/i,
    /rollator/i,
    /walking (aid|frame|stick)/i,
    /mobility/i,
    /crutch/i,
    /stroller|pram|pushchair|buggy/i,
    /mobility scooter|\bscooters?\b/i,
    /difficulty walking|trouble walking|unsteady/i,
    /\bbalance\b/i,
    /prosthe/i,
  ],
  vision: [
    /\bblind/i,
    /low vision/i,
    /visual(ly)? impair/i,
    /vision (loss|impair)/i,
    /partially sighted|sight loss|limited sight|visual disabilit/i,
    /white cane/i,
    /guide dog/i,
  ],
  cognitive: [
    /cognitive/i,
    /intellectual/i,
    /learning disabilit/i,
    /dementia/i,
    /autis/i,
    /neurodiverg/i,
    /wayfinding/i,
    /disorient|\borientation\b/i,
    /confus/i,
    /memory/i,
  ],
};

export type NeedMatch = { category: NeedCategory; groups: string[] };

/** Categories (in a fixed order) with the exact groups that support each one. */
export function accessibilityNeeds(whoMayBeAffected: readonly string[]): NeedMatch[] {
  return NEED_CATEGORIES.map((category) => ({
    category,
    groups: whoMayBeAffected.filter((g) => RULES[category].some((re) => re.test(g))),
  })).filter((m) => m.groups.length > 0);
}

/** Groups that didn't map to any category (shown as-is, never dropped). */
export function uncategorizedGroups(whoMayBeAffected: readonly string[]): string[] {
  return whoMayBeAffected.filter((g) => !NEED_CATEGORIES.some((c) => RULES[c].some((re) => re.test(g))));
}

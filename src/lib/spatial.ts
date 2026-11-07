/**
 * Grounded visual hazard indicators — UI side only. DISABLED.
 *
 * Status (hackathon sprint): the experimental grounding evaluation produced one accurate chair box, one
 * semantically wrong box reported with HIGH confidence, and no evidence for two signage photos. Model
 * confidence is not proof of correctness, and there is no runtime check that a box encloses the right
 * object, so overlays stay off. The production analysis schema doesn't request or keep spatial fields.
 *
 * When a verified source exists, this adapter maps Google's image-grounding convention used by the
 * experimental schema — `spatialEvidence: { box: { yMin, xMin, yMax, xMax } (integers 0..1000 of the
 * exact upright JPEG analyzed), target, groundingConfidence }` — to fractions for the UI, and still refuses
 * anything malformed. Flip SPATIAL_OVERLAYS_ENABLED only with that verification in place.
 * Positions are never derived from text such as "center-left".
 */

export const SPATIAL_OVERLAYS_ENABLED = false;

export type NormalizedBox = { x: number; y: number; width: number; height: number };

const grid = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1000;

/** Fractional box from validated spatial evidence on a finding's details; [] when absent, invalid or disabled. */
export function spatialBoxes(details: unknown, enabled = SPATIAL_OVERLAYS_ENABLED): NormalizedBox[] {
  if (!enabled) return [];
  const ev = (details as { spatialEvidence?: unknown } | null)?.spatialEvidence as
    | { box?: Record<string, unknown>; groundingConfidence?: unknown; target?: unknown }
    | undefined;
  const b = ev?.box;
  if (!b || typeof ev?.target !== "string" || !ev.target.trim() || !["medium", "high"].includes(String(ev.groundingConfidence))) return [];
  const { yMin, xMin, yMax, xMax } = b;
  if (!grid(yMin) || !grid(xMin) || !grid(yMax) || !grid(xMax) || yMin >= yMax || xMin >= xMax) return [];
  const box = { x: xMin / 1000, y: yMin / 1000, width: (xMax - xMin) / 1000, height: (yMax - yMin) / 1000 };
  // A box covering most of the photo says nothing about where the barrier is.
  if (box.width * box.height > 0.6 || box.width < 0.01 || box.height < 0.01) return [];
  return [box];
}

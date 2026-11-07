/**
 * Grounded visual hazard indicators — UI side only.
 *
 * The analysis schema has NO coordinates today, so this returns nothing and no marker is ever drawn.
 * When the optional spatial-evidence field (being validated separately) ships, the server includes it
 * only for validated regions; this adapter is the single place that maps it for the UI, and it still
 * refuses anything out of range. Positions are never derived from text such as "center-left".
 *
 * Expected (provisional) shape on a finding: `spatialEvidence: { boxes: [{ x, y, width, height }] }`,
 * normalized to the photo (0–1, origin top-left). Adjust here when the final schema is agreed.
 */

export type NormalizedBox = { x: number; y: number; width: number; height: number };

const inUnit = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

function validBox(b: unknown): b is NormalizedBox {
  if (!b || typeof b !== "object") return false;
  const { x, y, width, height } = b as Record<string, unknown>;
  return (
    inUnit(x) && inUnit(y) && inUnit(width) && inUnit(height) &&
    width > 0.005 && height > 0.005 && x + width <= 1.0001 && y + height <= 1.0001
  );
}

/** Validated boxes for one finding's details; [] unless the data is present and entirely valid. */
export function spatialBoxes(details: unknown): NormalizedBox[] {
  const evidence = (details as { spatialEvidence?: unknown } | null)?.spatialEvidence;
  const boxes = (evidence as { boxes?: unknown } | null | undefined)?.boxes;
  if (!Array.isArray(boxes) || !boxes.length || boxes.length > 4) return [];
  return boxes.every(validBox) ? boxes.map(({ x, y, width, height }) => ({ x, y, width, height })) : [];
}

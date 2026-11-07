import type { Comparison, GuardrailAdjustment } from "./comparison-schema";

/**
 * Deterministic safety rules applied AFTER the model answers. The model's own visibility and
 * location answers must support its conclusion; otherwise the status becomes "uncertain".
 * This enforces in code (not just in the prompt) that a barrier is never marked improved
 * just because it's absent from a differently framed photo.
 */

const RETAKE_ACTION =
  "Retake the AFTER photo from the same spot and angle as the BEFORE photo, with the area where the barrier was fully in frame, then compare again.";

export function applyComparisonGuardrails(c: Comparison): { comparison: Comparison; guardrail: GuardrailAdjustment | null } {
  const reasons: string[] = [];

  if (c.sameLocation === "no" || c.sameLocation === "unclear") {
    reasons.push(
      c.sameLocation === "no"
        ? "The two photos appear to show different places."
        : "It isn't clear that the two photos show the same place.",
    );
  }

  if (c.status === "improved") {
    // Declaring a fix needs a confident same-place match; "likely" isn't enough.
    // (Observed: Gemma rated two different cities' staircases as "likely" the same place.)
    if (c.sameLocation === "likely") {
      reasons.push("The photos weren't confirmed to show the same place, so a fix can't be confirmed.");
    }
    if (c.beforeBarrierVisible === "no") {
      reasons.push("The described barrier couldn't be found in the BEFORE photo, so a change can't be confirmed.");
    }
    if (c.afterAreaVisible !== "yes") {
      reasons.push(
        c.afterAreaVisible === "no"
          ? "The area where the barrier was isn't visible in the AFTER photo. It may simply be out of frame."
          : "The area where the barrier was is only partially visible in the AFTER photo.",
      );
    }
  }

  if (c.status === "still_present") {
    // "Still there" needs the barrier established in the BEFORE photo and its spot visible in AFTER.
    if (c.beforeBarrierVisible === "no") {
      reasons.push("The described barrier couldn't be found in the BEFORE photo, so I can't say it's still there.");
    }
    if (c.afterAreaVisible === "no") {
      reasons.push("The area where the barrier was isn't visible in the AFTER photo.");
    }
  }

  if (reasons.length > 0 && c.status !== "uncertain") {
    return {
      comparison: { ...c, status: "uncertain", suggestedNextAction: RETAKE_ACTION },
      guardrail: { modelStatus: c.status, reasons },
    };
  }

  // A different viewpoint can still support "improved", but not with high confidence.
  if (c.status === "improved" && c.viewpoint !== "similar" && c.confidence === "high") {
    return {
      comparison: { ...c, confidence: "medium" },
      guardrail: {
        modelStatus: c.status,
        reasons: ["The photos were taken from different viewpoints, so confidence was lowered to medium."],
      },
    };
  }

  return { comparison: c, guardrail: null };
}

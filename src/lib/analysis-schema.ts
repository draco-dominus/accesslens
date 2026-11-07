import { z } from "zod";

/**
 * Shared contract between the model, the API route, and the UI.
 * Safe to import from client code: contains no secrets.
 */

export const BARRIER_TYPES = [
  "steps",
  "obstructed_walkway",
  "protruding_obstacle",
  "other",
] as const;

export const FindingSchema = z.object({
  barrierType: z
    .enum(BARRIER_TYPES)
    .describe(
      "Category of the potential barrier. Use 'other' only for a clearly visible physical barrier that does not fit the first three.",
    ),
  title: z.string().min(1).describe("Short plain-language label, e.g. 'Two steps at entrance, no ramp visible'."),
  locationInImage: z
    .string()
    .min(1)
    .describe("Where in the photo this appears, e.g. 'bottom-left, in front of the door'."),
  visualEvidence: z
    .string()
    .min(1)
    .describe("What is actually visible in the image that supports this finding. Describe only what you can see."),
  whoMayBeAffected: z
    .array(z.string().min(1))
    .min(1)
    .max(6)
    .describe("Groups of people who may be affected, e.g. 'wheelchair users', 'people who are blind or have low vision'."),
  potentialImpact: z.string().min(1).describe("How this could make the space harder or unsafe to use."),
  suggestedImprovement: z
    .string()
    .min(1)
    .describe("A practical, specific improvement a business owner could consider."),
  uncertainty: z
    .string()
    .min(1)
    .describe(
      "What cannot be determined from this single photo (e.g. exact heights, widths, whether an alternative route exists out of frame).",
    ),
  confidence: z
    .enum(["low", "medium", "high"])
    .describe("How confident you are that this barrier is really present, based only on the visible evidence."),
});

export const AnalysisSchema = z.object({
  imageUsable: z
    .boolean()
    .describe("False if the image is too dark, blurry, or does not show a physical space that can be assessed."),
  sceneSummary: z.string().min(1).describe("One or two sentences describing what the photo shows."),
  findings: z
    .array(FindingSchema)
    .max(10)
    .describe("Potential barriers visible in the image. Empty if none are visible. Never invent findings."),
  limitations: z
    .string()
    .min(1)
    .describe(
      "Overall limits of this analysis: what is out of frame, what needs on-site measurement, and what a photo cannot show.",
    ),
});

export type Finding = z.infer<typeof FindingSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

/** Shape returned by POST /api/analyze. */
export type AnalyzeSuccess = {
  ok: true;
  model: string;
  analysis: Analysis;
  disclaimer: string;
};

export type AnalyzeFailure = {
  ok: false;
  error: { code: string; message: string };
};

export type AnalyzeResponse = AnalyzeSuccess | AnalyzeFailure;

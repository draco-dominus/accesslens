import { z } from "zod";

/**
 * Before/after comparison contract. Safe to import from client code (no secrets).
 */

export const COMPARISON_STATUSES = ["improved", "still_present", "uncertain"] as const;
export type ComparisonStatus = (typeof COMPARISON_STATUSES)[number];

const Visibility = z.enum(["yes", "partially", "no"]);

export const ComparisonSchema = z.object({
  originalBarrier: z
    .string()
    .min(1)
    .describe("The previously identified barrier, restated in plain language as it appears in the BEFORE photo."),
  beforeBarrierVisible: Visibility.describe(
    "Is the described barrier actually visible in the BEFORE photo? 'no' if you cannot find it there.",
  ),
  afterAreaVisible: Visibility.describe(
    "Is the SAME AREA where the barrier was located clearly visible in the AFTER photo? 'no' if that spot is out of frame, cropped, hidden, or too blurry/dark to check.",
  ),
  sameLocation: z
    .enum(["yes", "likely", "unclear", "no"])
    .describe("Do both photos show the same place? Base this on fixed features (walls, doors, floor pattern, fixtures)."),
  viewpoint: z
    .enum(["similar", "different", "unclear"])
    .describe("Were the photos taken from a similar camera position and angle?"),
  locationEvidence: z
    .string()
    .min(1)
    .describe("Fixed features that match (or don't match) between the two photos, supporting the sameLocation answer."),
  observedChange: z
    .string()
    .min(1)
    .describe("What visibly changed regarding this barrier between BEFORE and AFTER. Say 'No visible change' if none."),
  status: z
    .enum(COMPARISON_STATUSES)
    .describe(
      "improved = same area clearly visible in AFTER and the barrier is visibly removed or reduced; still_present = barrier visibly remains in AFTER; uncertain = anything else.",
    ),
  visualEvidence: z
    .array(z.string().min(1))
    .min(1)
    .max(6)
    .describe("Specific things visible in the photos that support the status."),
  remainingUncertainty: z
    .string()
    .min(1)
    .describe("What these two photos cannot confirm (measurements, areas out of frame, whether the change is permanent, etc.)."),
  suggestedNextAction: z.string().min(1).describe("One practical next step for the business owner."),
  confidence: z.enum(["low", "medium", "high"]),
});

export type Comparison = z.infer<typeof ComparisonSchema>;

/** Added by the server when it overrides the model's status for safety. */
export type GuardrailAdjustment = {
  modelStatus: ComparisonStatus;
  reasons: string[];
};

export type CompareSuccess = {
  ok: true;
  model: string;
  concern: string;
  comparison: Comparison;
  guardrail: GuardrailAdjustment | null;
  disclaimer: string;
};

export type CompareFailure = {
  ok: false;
  error: { code: string; message: string };
};

export type CompareResponse = CompareSuccess | CompareFailure;

export const MAX_CONCERN_LENGTH = 500;

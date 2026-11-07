import { z } from "zod";

/**
 * Before/after comparison contract. Safe to import from client code (no secrets).
 */

export const COMPARISON_STATUSES = ["improved", "still_present", "uncertain"] as const;
export type ComparisonStatus = (typeof COMPARISON_STATUSES)[number];

const Visibility = z.enum(["yes", "partially", "no"]);

// Field order matters: models generate JSON in schema order, so evidence fields come BEFORE the
// judgments that depend on them (describe each scene → compare fixed features → decide same place →
// check visibility → decide status).
export const ComparisonSchema = z.object({
  beforeScene: z
    .string()
    .min(1)
    .describe("Describe the BEFORE photo on its own: the kind of place and its distinctive fixed features."),
  afterScene: z
    .string()
    .min(1)
    .describe("Describe the AFTER photo on its own, WITHOUT assuming it is the same place as BEFORE."),
  locationEvidence: z
    .string()
    .min(1)
    .describe(
      "List specific fixed features (buildings, walls, doors, windows, counters, floor/paving pattern, signs) and say for each whether it appears in BOTH photos. Note any clear mismatches.",
    ),
  sameLocation: z
    .enum(["yes", "likely", "unclear", "no"])
    .describe(
      "Do both photos show the same place? 'yes' only if several specific fixed features clearly match. 'no' if fixed features clearly differ. Similar-looking kinds of places (e.g. two different staircases) are NOT the same place.",
    ),
  viewpoint: z
    .enum(["similar", "different", "unclear"])
    .describe("Were the photos taken from a similar camera position and angle?"),
  originalBarrier: z
    .string()
    .min(1)
    .describe("The previously identified barrier, restated in plain language as it appears in the BEFORE photo."),
  beforeBarrierVisible: Visibility.describe(
    "Is the described barrier actually visible in the BEFORE photo? 'no' if you cannot find it there.",
  ),
  afterAreaVisible: Visibility.describe(
    "Is the SAME AREA where the barrier was located clearly visible in the AFTER photo? 'no' if that spot is out of frame, cropped, hidden, or too blurry/dark to check, or if AFTER shows a different place.",
  ),
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

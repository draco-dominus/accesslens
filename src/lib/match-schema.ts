import { z } from "zod";
import { BARRIER_TYPES } from "./analysis-schema";

/**
 * Scene matching for continuous walkthroughs: does a NEW scan revisit an earlier scan's area, and
 * are any of its findings the same physical barrier already recorded? Safe to import from client code.
 */

export const MAX_MATCH_CANDIDATES = 4;
const MAX_FINDINGS_PER_SCAN = 10;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const FindingRef = z.object({
  id: z.string().regex(SAFE_ID),
  barrierType: z.enum(BARRIER_TYPES),
  title: z.string().min(1).max(200),
  locationInImage: z.string().max(200),
});

/** JSON sent in the `context` form field of POST /api/match (images are sent as files). */
export const MatchRequestContextSchema = z.object({
  newFindings: z.array(FindingRef.omit({ id: true })).max(MAX_FINDINGS_PER_SCAN),
  candidates: z
    .array(z.object({ scanId: z.string().regex(SAFE_ID), findings: z.array(FindingRef).max(MAX_FINDINGS_PER_SCAN) }))
    .min(1)
    .max(MAX_MATCH_CANDIDATES),
});
export type MatchRequestContext = z.infer<typeof MatchRequestContextSchema>;

export const SAME_AREA = ["yes", "likely", "unclear", "no"] as const;
export type SameArea = (typeof SAME_AREA)[number];

/**
 * What the model returns. It only sees short aliases (N1.., C1.., F1..), never client IDs.
 * Evidence fields come before the judgments that depend on them (models generate in schema order).
 */
export const MatchModelSchema = z.object({
  newScene: z.string().min(1).describe("Describe the NEW photo on its own: the kind of place and its distinctive fixed features."),
  candidates: z
    .array(
      z.object({
        ref: z.string().describe("Earlier photo alias, e.g. C1."),
        scene: z.string().min(1).describe("Describe this earlier photo on its own."),
        locationEvidence: z
          .string()
          .min(1)
          .describe("Specific fixed features (walls, doors, windows, counters, floor pattern, signs) that match or clearly differ between this earlier photo and the NEW photo."),
        sameArea: z
          .enum(SAME_AREA)
          .describe("'yes' only if several specific fixed features clearly match. 'no' if fixed features clearly differ. Two places of the same kind are NOT the same area."),
      }),
    )
    .describe("One entry per earlier photo."),
  duplicates: z
    .array(
      z.object({
        newFinding: z.string().describe("New finding alias, e.g. N1."),
        earlierFinding: z.string().describe("Earlier finding alias, e.g. F2, or 'none'."),
        reason: z.string().min(1),
      }),
    )
    .describe("One entry per new finding: the earlier finding it is the SAME physical barrier at the SAME spot as, or 'none'."),
});
export type MatchModelOutput = z.infer<typeof MatchModelSchema>;

/** Response of POST /api/match, with aliases mapped back to client IDs and safety rules applied. */
export type MatchSuccess = {
  ok: true;
  model: string;
  candidates: { scanId: string; sameArea: SameArea; evidence: string }[];
  /** newFindingIndex → existing finding ID. Only accepted when same area is "yes" and barrier types match. */
  duplicates: { newFindingIndex: number; findingId: string }[];
};
export type MatchFailure = { ok: false; error: { code: string; message: string } };
export type MatchResponse = MatchSuccess | MatchFailure;

import type { Analysis, Finding as AnalysisFinding } from "../analysis-schema";
import type { Comparison, GuardrailAdjustment } from "../comparison-schema";
import type { SameArea } from "../match-schema";

/**
 * Walkthrough session data. Plain JSON (no Blobs/URLs) so it can be persisted to sessionStorage
 * and handed to Lumi later. Images live separately in the client image store (see useWalkthrough).
 */

export type FindingStatus = "observed" | "appears_improved" | "still_observed" | "needs_verification";
export const OPEN_STATUSES: readonly FindingStatus[] = ["observed", "still_observed", "needs_verification"];
export const isOpen = (s: FindingStatus) => OPEN_STATUSES.includes(s);

export type ScanStep = "queued" | "preparing" | "analyzing" | "matching" | "comparing" | "done" | "error";

/** A barrier tracked across the walkthrough. Created once; later scans update it instead of duplicating it. */
export type TrackedFinding = {
  id: string;
  number: number; // 1-based, in order of discovery
  details: AnalysisFinding; // as first observed
  status: FindingStatus;
  firstScanId: string;
  /** Most recent scan whose photo shows this barrier; used as the BEFORE image for later comparisons. */
  lastSeenScanId: string;
  history: FindingEvent[];
};

export type FindingEvent = {
  scanId: string;
  at: number;
  status: FindingStatus;
  source: "analysis" | "duplicate" | "comparison";
  note: string;
  comparison?: Comparison;
  guardrail?: GuardrailAdjustment | null;
  model?: string;
  /** For comparison events: the earlier scan whose photo was compared. */
  referenceScanId?: string;
};

/**
 * How a scan relates to an earlier scan. "lineup": the user lined the photo up with that scan in the
 * camera; the comparisons still decide whether it's really the same spot.
 */
export type RelationSource = "auto" | "user" | "lineup";
export type ScanRelation = {
  scanId: string; // the earlier scan
  /** Final verdict after reconciling the scene match with the comparisons (see engine.reconcileArea). */
  sameArea: SameArea;
  decidedBy: RelationSource;
  evidence: string;
  /** The quick scene-match verdict, before comparison evidence ("unclear" when none was requested). */
  sceneVerdict?: SameArea;
  /** Same-place verdicts from each successful comparison against this scan. */
  comparisonVerdicts?: SameArea[];
};

/** A comparison that failed (network/AI error) and can be retried without rescanning. */
export type FailedComparison = { findingId: string; referenceScanId: string; source: RelationSource };

/**
 * One real processing stage of a scan, for truthful progress and timing diagnostics.
 * Durations only; no image data, prompts or identifiers beyond this session's own IDs.
 */
export type StageState = "active" | "done" | "failed" | "skipped";
export type ScanStage = {
  id: string; // "prepare" | "analyze" | "match" | "dedupe" | `compare:${findingId}`
  label: string;
  state: StageState;
  startedAt: number;
  endedAt?: number;
  /** Network round trip and the server's own breakdown, when the stage was an API call. */
  timing?: { clientMs: number; serverTotalMs?: number; imageMs?: number; aiMs?: number; ai?: string };
  note?: string;
};

/** What happened during a scan, in order. Lumi's messages are generated from these. */
export type ScanEvent =
  | { kind: "new_finding"; findingId: string }
  | { kind: "seen_again"; findingId: string }
  | { kind: "status_change"; findingId: string; from: FindingStatus; to: FindingStatus; referenceScanId: string }
  | { kind: "revisit"; scanId: string; sameArea: SameArea; decidedBy: RelationSource }
  | { kind: "revisit_question"; scanIds: string[] }
  | { kind: "revisit_declined"; scanId: string }
  | { kind: "no_findings" }
  | { kind: "image_unusable"; reason: string }
  | { kind: "notice"; message: string };

export type Scan = {
  id: string;
  number: number; // 1-based, original scan order
  createdAt: number;
  step: ScanStep;
  error?: string;
  /** False when retrying can't help (e.g. unsupported or oversized file). */
  errorRetryable?: boolean;
  /** Earlier scan the user lined this photo up with in the camera, if any. */
  lineUpScanId?: string;
  /** Real processing stages, in start order. */
  stages?: ScanStage[];
  /** When processing finished (createdAt → doneAt is the user-visible wait). */
  doneAt?: number;
  areaId: string | null;
  analysis: Analysis | null;
  analysisModel?: string;
  relations: ScanRelation[];
  /** Earlier scans the user should confirm or deny as the same area (automatic match was "unclear"). */
  pendingRevisit: string[];
  /** Earlier scans successfully compared against, so they aren't offered again. Failed ones stay retryable. */
  comparedWith: string[];
  /** Comparisons that failed and can be retried with "Try comparison again". */
  failedComparisons?: FailedComparison[];
  events: ScanEvent[];
};

export type Session = {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  scans: Scan[];
  findings: TrackedFinding[];
  areaCount: number;
};

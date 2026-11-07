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
};

/** How a scan relates to an earlier scan. */
export type ScanRelation = {
  scanId: string; // the earlier scan
  sameArea: SameArea;
  decidedBy: "auto" | "user";
  evidence: string;
};

/** What happened during a scan, in order. Lumi's messages are generated from these. */
export type ScanEvent =
  | { kind: "new_finding"; findingId: string }
  | { kind: "seen_again"; findingId: string }
  | { kind: "status_change"; findingId: string; from: FindingStatus; to: FindingStatus; referenceScanId: string }
  | { kind: "revisit"; scanId: string; sameArea: SameArea; decidedBy: "auto" | "user" }
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
  areaId: string | null;
  analysis: Analysis | null;
  analysisModel?: string;
  relations: ScanRelation[];
  /** Earlier scans the user should confirm or deny as the same area (automatic match was "unclear"). */
  pendingRevisit: string[];
  /** Earlier scans already compared against, so they aren't offered again. */
  comparedWith: string[];
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

import { z } from "zod";
import { BARRIER_TYPES } from "./analysis-schema";

export const MAX_CHAT_BODY_BYTES = 64 * 1024;
export const MAX_CHAT_QUESTION_LENGTH = 500;
export const MAX_CHAT_HISTORY_MESSAGES = 6;
export const MAX_CHAT_FINDINGS = 10;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const CHAT_FINDING_STATUSES = ["observed", "appears_improved", "still_observed", "needs_verification"] as const;

const BoundedText = (max: number) => z.string().trim().min(1).max(max);

export const ChatHistoryMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: BoundedText(600),
  })
  .strict();

const ChatHistorySchema = z
  .array(ChatHistoryMessageSchema)
  .max(MAX_CHAT_HISTORY_MESSAGES)
  .superRefine((messages, ctx) => {
    if (messages.length % 2 !== 0) {
      ctx.addIssue({ code: "custom", message: "History must contain complete user/assistant turns." });
    }
    messages.forEach((message, index) => {
      const expected = index % 2 === 0 ? "user" : "assistant";
      if (message.role !== expected) ctx.addIssue({ code: "custom", path: [index, "role"], message: `Expected ${expected}.` });
    });
  });

export const ChatFindingSchema = z
  .object({
    id: z.string().regex(SAFE_ID),
    barrierType: z.enum(BARRIER_TYPES),
    title: BoundedText(200),
    visualEvidence: BoundedText(500),
    whoMayBeAffected: z.array(BoundedText(120)).min(1).max(6),
    potentialImpact: BoundedText(500),
    suggestedImprovement: BoundedText(500),
    uncertainty: BoundedText(500),
    confidence: z.enum(["low", "medium", "high"]),
    status: z.enum(CHAT_FINDING_STATUSES),
    history: z
      .array(
        z
          .object({
            status: z.enum(CHAT_FINDING_STATUSES),
            source: z.enum(["analysis", "duplicate", "comparison"]),
            note: BoundedText(300),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();

export const ChatRequestSchema = z
  .object({
    question: BoundedText(MAX_CHAT_QUESTION_LENGTH),
    selectedFindingId: z.string().regex(SAFE_ID).optional(),
    findings: z.array(ChatFindingSchema).min(1).max(MAX_CHAT_FINDINGS),
    history: ChatHistorySchema.default([]),
  })
  .strict()
  .superRefine((input, ctx) => {
    const ids = input.findings.map((finding) => finding.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["findings"], message: "Finding IDs must be unique." });
    if (input.selectedFindingId && !ids.includes(input.selectedFindingId)) {
      ctx.addIssue({ code: "custom", path: ["selectedFindingId"], message: "Selected finding is not included in findings." });
    }
  });

export const ChatModelOutputSchema = z
  .object({
    answer: BoundedText(1200).describe("A concise answer grounded only in the supplied inspection records."),
    groundedFindingIds: z.array(z.string().regex(SAFE_ID)).max(5).describe("Finding IDs that directly support the answer."),
    needsOnSiteVerification: z.boolean().describe("True when the question cannot be settled from recorded photo evidence."),
  })
  .strict();

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatModelOutput = z.infer<typeof ChatModelOutputSchema>;

export type ChatSuccess = {
  ok: true;
  model: string;
  answer: string;
  groundedFindingIds: string[];
  needsOnSiteVerification: boolean;
  disclaimer: string;
};

export type ChatFailure = { ok: false; error: { code: string; message: string } };
export type ChatResponse = ChatSuccess | ChatFailure;

const FORBIDDEN_ANSWER_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(?:ada\s+)?complian(?:t|ce)\b|\bmeets?\s+(?:building\s+)?code\b/i, reason: "compliance conclusion" },
  { pattern: /\b(?:guaranteed?|certified?)\s+(?:safe|accessible)\b|\b(?:is|are|now|fully)\s+(?:safe|accessible)\b/i, reason: "safety or accessibility guarantee" },
  // "in" alone is the word "in" far more often than inches ("finding 4 in the hallway"), so inches need "inch(es)", "in." or ".
  { pattern: /\b\d+(?:\.\d+)?\s*(?:mm|cm|m|inch(?:es)?|ft|feet|foot|met(?:er|re)s?)\b|\b\d+(?:\.\d+)?\s*(?:in\.|")/i, reason: "unsupported precise measurement" },
];

/** Runtime checks that depend on this request and cannot be expressed by the model JSON schema. */
export function validateGroundedChatOutput(input: ChatRequest, output: ChatModelOutput): { valid: true } | { valid: false; reason: string } {
  const allowed = new Set(input.findings.map((finding) => finding.id));
  if (new Set(output.groundedFindingIds).size !== output.groundedFindingIds.length) return { valid: false, reason: "duplicate source IDs" };
  if (output.groundedFindingIds.some((id) => !allowed.has(id))) return { valid: false, reason: "unknown source ID" };
  const forbidden = FORBIDDEN_ANSWER_PATTERNS.find(({ pattern }) => pattern.test(output.answer));
  return forbidden ? { valid: false, reason: forbidden.reason } : { valid: true };
}

/** Serialize only bounded, validated fields. Context and prior messages remain untrusted data, never instructions. */
export function chatPrompt(input: ChatRequest): string {
  const ordered = input.selectedFindingId
    ? [...input.findings].sort((a, b) => Number(b.id === input.selectedFindingId) - Number(a.id === input.selectedFindingId))
    : input.findings;
  const context = {
    selectedFindingId: input.selectedFindingId ?? null,
    findings: ordered.map((finding) => ({
      id: finding.id,
      barrierType: finding.barrierType,
      title: finding.title,
      visualEvidence: finding.visualEvidence,
      whoMayBeAffected: finding.whoMayBeAffected,
      potentialImpact: finding.potentialImpact,
      suggestedImprovement: finding.suggestedImprovement,
      uncertainty: finding.uncertainty,
      confidence: finding.confidence,
      status: finding.status,
      recentHistory: finding.history,
    })),
    priorConversation: input.history,
    currentQuestion: input.question,
  };
  return `UNTRUSTED_INSPECTION_DATA\n${JSON.stringify(context)}\nEND_UNTRUSTED_INSPECTION_DATA\nAnswer the current question using only these records.`;
}

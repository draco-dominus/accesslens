import {
  ChatRequestSchema,
  MAX_CHAT_BODY_BYTES,
  type ChatModelOutput,
  type ChatRequest,
  type ChatSuccess,
} from "./chat-schema";

export type ChatGeneration = {
  model: string;
  output: ChatModelOutput;
  diag?: { model: string; aiMs: number; attempts: number; fallbackUsed: boolean; failures: string[] };
};

export type ChatGenerator = (input: ChatRequest) => Promise<ChatGeneration>;

const DISCLAIMER =
  "Lumi answers from this inspection's recorded AI observations. Photos cannot establish measurements, safety, accessibility, or compliance; verify important decisions on site.";

function failure(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** HTTP parsing and validation with an injected generator, so tests never need the live SDK. */
export async function handleChatPost(
  request: Request,
  generate: ChatGenerator,
): Promise<{ response: Response; diag?: ChatGeneration["diag"] }> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return { response: failure(415, "CHAT_CONTENT_TYPE", "Send chat requests as application/json. Photographs are not accepted by this endpoint.") };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { response: failure(400, "CHAT_BAD_REQUEST", "The chat request body could not be read. Please try again.") };
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_CHAT_BODY_BYTES) {
    return { response: failure(413, "CHAT_TOO_LARGE", "Shorten the conversation or include fewer findings, then try again.") };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { response: failure(400, "CHAT_INVALID_JSON", "The chat request is not valid JSON.") };
  }
  const parsed = ChatRequestSchema.safeParse(json);
  if (!parsed.success) {
    return { response: failure(400, "CHAT_INVALID_INPUT", "Check the question, selected finding, inspection context, and bounded conversation history.") };
  }

  const generated = await generate(parsed.data);
  const response: ChatSuccess = {
    ok: true,
    model: generated.model,
    answer: generated.output.answer,
    groundedFindingIds: generated.output.groundedFindingIds,
    needsOnSiteVerification: generated.output.needsOnSiteVerification,
    disclaimer: DISCLAIMER,
  };
  return { response: Response.json(response, { headers: { "Cache-Control": "no-store" } }), diag: generated.diag };
}

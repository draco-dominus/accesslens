import { errorResponse } from "@/lib/api-errors.server";
import { handleChatPost } from "@/lib/chat-handler";
import { answerInspectionQuestion } from "@/lib/gemini.server";
import { guardRequest } from "@/lib/request-guard.server";
import { RequestTimer } from "@/lib/server-timing.server";

export const runtime = "nodejs";
export const maxDuration = 40;

export async function POST(request: Request) {
  const timer = new RequestTimer();
  const blocked = guardRequest(request, "chat");
  if (blocked) return blocked;
  try {
    const { response, diag } = await handleChatPost(request, answerInspectionQuestion);
    if (diag) timer.ai(diag);
    return timer.finish("chat", response, diag);
  } catch (error) {
    return errorResponse(error, "chat");
  }
}

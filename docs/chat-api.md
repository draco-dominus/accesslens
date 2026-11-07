# Ask Lumi API

`POST /api/chat` is a text-only, same-origin endpoint. It accepts bounded inspection records and up to three complete prior user/assistant turns. It does not accept photographs, blobs, data URLs or arbitrary session objects.

## Request

```json
{
  "question": "What should I do next?",
  "selectedFindingId": "f_123",
  "findings": [
    {
      "id": "f_123",
      "barrierType": "obstructed_walkway",
      "title": "Chair narrows the hallway",
      "visualEvidence": "A chair is visible in the marked walking route.",
      "whoMayBeAffected": ["wheelchair users", "people using walkers"],
      "potentialImpact": "The available route may be narrowed.",
      "suggestedImprovement": "Move the chair outside the walking route.",
      "uncertainty": "The clear width cannot be measured from the photo.",
      "confidence": "high",
      "status": "observed",
      "history": [
        { "status": "observed", "source": "analysis", "note": "Chair observed in scan 1." }
      ]
    }
  ],
  "history": [
    { "role": "user", "content": "Who might this affect?" },
    { "role": "assistant", "content": "The recorded route may be narrowed." }
  ]
}
```

Limits: 64 KB body, 500-character question, 10 findings, six history messages (three complete turns), six recent status events per finding. Unknown fields are rejected. The client should send only the fields above, derived from the current validated session.

## Success

```json
{
  "ok": true,
  "model": "gemini-3.5-flash-lite",
  "answer": "The recorded next step is to move the chair outside the route, then re-check the same area.",
  "groundedFindingIds": ["f_123"],
  "needsOnSiteVerification": true,
  "disclaimer": "..."
}
```

Use `groundedFindingIds` to show which existing finding cards support the answer. Do not treat it as a compliance citation. Keep conversation history client-side and send only the latest three complete turns with each question.

## Client integration

Map the current session's `TrackedFinding` values to this narrow contract; do not send the session, scans, photos, timestamps, model names or comparison objects. In particular:

- `details.barrierType`, `title`, `visualEvidence`, `whoMayBeAffected`, `potentialImpact`, `suggestedImprovement`, `uncertainty` and `confidence` map directly.
- Copy the current tracked `status`.
- Send at most the latest six history events, retaining only `status`, `source` and a note truncated to 300 characters.
- Send the latest three complete chat turns. Add the latest assistant answer to local history only after a successful response.
- Treat `groundedFindingIds` as links back to existing cards. If an ID is unexpectedly absent from the current session, discard the response.
- On 429, honor `Retry-After`. On provider errors, expose one manual retry; do not retry chat automatically.

The endpoint uses the project's existing in-memory, per-IP guard at six requests per minute and 60 per hour. On serverless hosting this limiter is per warm instance, not a globally durable quota. Configure a platform-level rate limit or authenticated quota before exposing the endpoint beyond the hackathon audience.

## Errors

- `CHAT_CONTENT_TYPE` (415): send JSON; images are not accepted.
- `BLOCKED` (422): rephrase the question; the provider safety filter refused it.
- `CHAT_TOO_LARGE` or `REQUEST_TOO_LARGE` (413): shorten history or include fewer findings.
- `CHAT_INVALID_JSON` / `CHAT_INVALID_INPUT` (400): repair the request contract.
- `RATE_LIMITED` (429): respect `Retry-After`; do not loop automatically.
- `AI_TIMEOUT` (504): offer a manual retry.
- `AI_QUOTA` / `AI_UNAVAILABLE` (503): explain temporary unavailability.
- `INVALID_MODEL_OUTPUT` / `UNSAFE_MODEL_OUTPUT` (502): ask a narrower question; do not display discarded output.
- `CONFIG` (500): server configuration problem; the response never exposes the API key.

Chat uses `GEMINI_CHAT_MODEL` when set, otherwise `gemini-3.5-flash-lite`. It makes one model attempt by default with a 15-second timeout and 400-token cap. `GEMINI_CHAT_FALLBACK_MODEL` may explicitly enable one distinct fallback attempt; it is disabled by default to protect quota.

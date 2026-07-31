// JSON <-> letter-service adapters, shared by the letter routes. Lives here
// rather than in a route file because a Next route module may only export HTTP
// handlers.

import {
  letterServiceMessage,
  type LetterDraft,
  type LetterInput,
  type LetterServiceError,
} from "./letter-service.ts";
import type { ApiLetterDetail, ApiLetterSummary } from "./mobile-contract.ts";
import { asString, jsonError } from "./mobile-response.ts";

// Adapt a JSON body to the same strings the web form submits.
//
// `intent` is fixed by the caller rather than read from the body: a route that
// updates a draft must never be able to seal one because the client sent
// `intent: "submit"`. Sealing has its own route, and it seals what is stored.
export function letterInputFrom(
  body: Record<string, unknown> | null,
  options: { id: string },
): LetterInput {
  return {
    id: options.id,
    title: asString(body?.title),
    childId: asString(body?.childId),
    body: asString(body?.body),
    intent: "draft",
  };
}

export function toApiLetterSummary(draft: LetterDraft): ApiLetterSummary {
  return {
    id: draft.id,
    title: draft.title,
    recipientName: draft.recipientName,
    childId: draft.childId,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

export function toApiLetterDetail(draft: LetterDraft): ApiLetterDetail {
  return {
    ...toApiLetterSummary(draft),
    body: draft.body,
    images: draft.images,
  };
}

// Codes that mean "this letter is not yours to change" rather than "your input
// was wrong". Both of the app's read/write refusals collapse to 404 so the API
// never confirms that a letter id exists.
const NOT_FOUND_CODES = new Set<LetterServiceError>(["LETTER_NOT_EDITABLE"]);

export function letterError(error: LetterServiceError): Response {
  const status = NOT_FOUND_CODES.has(error) ? 404 : 400;
  return jsonError(error, letterServiceMessage(error), status);
}

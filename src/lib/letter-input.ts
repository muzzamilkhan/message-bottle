// Pure validation for the letter form. The asymmetry here is the rule worth
// testing: a draft only needs a title to be findable later, but sealing a
// letter requires everything, because a SENT letter can never be edited.

import { IMAGES_PER_LETTER } from "./letter-image.ts";

export type LetterIntent = "draft" | "submit";

export type LetterFormValues = {
  title: string;
  childId: string;
  body: string;
};

export type LetterInputError =
  | "SEND_INCOMPLETE"
  | "DRAFT_NEEDS_TITLE"
  | "SEND_IMAGES_NOT_ALLOWED"
  | "TOO_MANY_IMAGES";

export type LetterInputResult =
  | { ok: true; value: LetterFormValues & { sealing: boolean } }
  | { ok: false; error: LetterInputError };

// What the author is currently entitled to, and what this letter holds.
// Passed in rather than read here so the rule stays pure and testable.
export type LetterImageContext = {
  // Whether the submitted body references any images.
  hasImages: boolean;
  // Whether the author's subscription currently covers holding images.
  mayHoldImages: boolean;
  // How many distinct images the submitted body references. The cap lives here
  // rather than in reconciliation so an over-cap body is *rejected*, never
  // quietly trimmed - trimming would leave the extra markers in the text while
  // reconciliation deleted their blobs and rows as unreferenced, losing a
  // photograph for good.
  imageCount: number;
};

export function letterInputMessage(error: LetterInputError): string {
  switch (error) {
    case "SEND_INCOMPLETE":
      return "Please fill in the title, child, and message.";
    case "DRAFT_NEEDS_TITLE":
      return "Give your draft a title so you can find it later.";
    case "SEND_IMAGES_NOT_ALLOWED":
      return "This letter has photos, which are part of Pro. Remove them to seal it, or renew to keep them.";
    case "TOO_MANY_IMAGES":
      return `A letter can hold up to ${IMAGES_PER_LETTER} photos. Remove a few and try again.`;
  }
}

// Anything other than an explicit "submit" is treated as saving a draft - the
// safe direction, since a draft stays editable.
export function parseLetterIntent(raw: string): LetterIntent {
  return raw.trim() === "submit" ? "submit" : "draft";
}

export function parseLetterInput(
  raw: LetterFormValues,
  intent: LetterIntent,
  context: LetterImageContext,
): LetterInputResult {
  const title = raw.title.trim();
  const childId = raw.childId.trim();
  const body = raw.body.trim();
  const sealing = intent === "submit";

  // Sealing is final, so a sent letter must be complete: a recipient and a
  // message, not just a title.
  if (sealing) {
    if (!title || !childId || !body) return { ok: false, error: "SEND_INCOMPLETE" };
    // A subscription that lapsed mid-draft blocks sealing, not saving - the
    // parent keeps their words and chooses whether to drop the photos or renew.
    if (context.hasImages && !context.mayHoldImages) {
      return { ok: false, error: "SEND_IMAGES_NOT_ALLOWED" };
    }
  } else if (!title) {
    return { ok: false, error: "DRAFT_NEEDS_TITLE" };
  }

  // Applies to a draft save as much as to a seal: a body reconciliation can't
  // handle safely must not reach the database at all.
  if (context.imageCount > IMAGES_PER_LETTER) {
    return { ok: false, error: "TOO_MANY_IMAGES" };
  }

  return { ok: true, value: { title, childId, body, sealing } };
}

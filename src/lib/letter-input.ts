// Pure validation for the letter form. The asymmetry here is the rule worth
// testing: a draft only needs a title to be findable later, but sealing a
// letter requires everything, because a SENT letter can never be edited.

export type LetterIntent = "draft" | "submit";

export type LetterFormValues = {
  title: string;
  childId: string;
  body: string;
};

export type LetterInputError = "SEND_INCOMPLETE" | "DRAFT_NEEDS_TITLE";

export type LetterInputResult =
  | { ok: true; value: LetterFormValues & { sealing: boolean } }
  | { ok: false; error: LetterInputError };

export function letterInputMessage(error: LetterInputError): string {
  switch (error) {
    case "SEND_INCOMPLETE":
      return "Please fill in the title, child, and message.";
    case "DRAFT_NEEDS_TITLE":
      return "Give your draft a title so you can find it later.";
  }
}

// Anything other than an explicit "submit" is treated as saving a draft — the
// safe direction, since a draft stays editable.
export function parseLetterIntent(raw: string): LetterIntent {
  return raw.trim() === "submit" ? "submit" : "draft";
}

export function parseLetterInput(
  raw: LetterFormValues,
  intent: LetterIntent,
): LetterInputResult {
  const title = raw.title.trim();
  const childId = raw.childId.trim();
  const body = raw.body.trim();
  const sealing = intent === "submit";

  // Sealing is final, so a sent letter must be complete: a recipient and a
  // message, not just a title.
  if (sealing) {
    if (!title || !childId || !body) return { ok: false, error: "SEND_INCOMPLETE" };
  } else if (!title) {
    return { ok: false, error: "DRAFT_NEEDS_TITLE" };
  }

  return { ok: true, value: { title, childId, body, sealing } };
}

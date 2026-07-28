import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  letterInputMessage,
  parseLetterInput,
  parseLetterIntent,
} from "./letter-input.ts";
import { IMAGES_PER_LETTER } from "./letter-image.ts";

const complete = { title: "For your 18th", childId: "child_1", body: "Hello!" };

// Default context: the author may hold images and this letter has none. Cases
// about the Pro rule pass their own.
const anyone = { hasImages: false, mayHoldImages: true, imageCount: 0 };

describe("parseLetterIntent", () => {
  it("treats an explicit submit as sealing", () => {
    assert.equal(parseLetterIntent("submit"), "submit");
    assert.equal(parseLetterIntent("  submit  "), "submit");
  });

  // Defaulting to "draft" is the safe direction: a draft stays editable,
  // whereas sealing can never be undone.
  for (const raw of ["", "draft", "SUBMIT", "anything-else"]) {
    it(`treats ${JSON.stringify(raw)} as a draft`, () => {
      assert.equal(parseLetterIntent(raw), "draft");
    });
  }
});

describe("parseLetterInput", () => {
  describe("saving a draft", () => {
    it("needs only a title", () => {
      const result = parseLetterInput(
        { title: "Notes to self", childId: "", body: "" },
        "draft",
        anyone,
      );
      assert.ok(result.ok);
      assert.equal(result.value.sealing, false);
      assert.equal(result.value.childId, "");
    });

    it("rejects a draft with no title", () => {
      assert.partialDeepStrictEqual(
        parseLetterInput(
          { title: "   ", childId: "c", body: "b" },
          "draft",
          anyone,
        ),
        { ok: false, error: "DRAFT_NEEDS_TITLE" },
      );
    });
  });

  describe("sealing a letter", () => {
    it("accepts a complete letter and marks it sealing", () => {
      const result = parseLetterInput(complete, "submit", anyone);
      assert.ok(result.ok);
      assert.partialDeepStrictEqual(result.value, {
        title: "For your 18th",
        childId: "child_1",
        body: "Hello!",
        sealing: true,
      });
    });

    for (const missing of ["title", "childId", "body"] as const) {
      it(`rejects sending without a ${missing}`, () => {
        const result = parseLetterInput(
          { ...complete, [missing]: "  " },
          "submit",
          anyone,
        );
        assert.partialDeepStrictEqual(result, {
          ok: false,
          error: "SEND_INCOMPLETE",
        });
      });
    }
  });

  it("trims every field", () => {
    const result = parseLetterInput(
      { title: "  T  ", childId: "  c  ", body: "  b  " },
      "submit",
      anyone,
    );
    assert.ok(result.ok);
    assert.partialDeepStrictEqual(result.value, {
      title: "T",
      childId: "c",
      body: "b",
    });
  });
});

describe("images and sealing", () => {
  const complete = { title: "T", childId: "c1", body: "Hello" };

  it("seals a letter with images when the author may hold them", () => {
    const result = parseLetterInput(complete, "submit", {
      hasImages: true,
      mayHoldImages: true,
      imageCount: 1,
    });
    assert.equal(result.ok, true);
  });

  it("seals a letter with no images regardless of entitlement", () => {
    const result = parseLetterInput(complete, "submit", {
      hasImages: false,
      mayHoldImages: false,
      imageCount: 0,
    });
    assert.equal(result.ok, true);
  });

  // A subscription that lapsed mid-draft.
  it("refuses to seal a letter holding images the author may no longer hold", () => {
    const result = parseLetterInput(complete, "submit", {
      hasImages: true,
      mayHoldImages: false,
      imageCount: 1,
    });
    assert.deepEqual(result, { ok: false, error: "SEND_IMAGES_NOT_ALLOWED" });
  });

  // Sealing is blocked, but the parent must never be locked out of their own
  // unsent words.
  it("still saves that letter as a draft", () => {
    const result = parseLetterInput(complete, "draft", {
      hasImages: true,
      mayHoldImages: false,
      imageCount: 1,
    });
    assert.equal(result.ok, true);
  });

  // An incomplete letter is incomplete first — reporting the image problem
  // would send the parent looking for photos in an empty letter.
  it("reports incompleteness before the image rule", () => {
    const result = parseLetterInput({ ...complete, body: "" }, "submit", {
      hasImages: true,
      mayHoldImages: false,
      imageCount: 1,
    });
    assert.deepEqual(result, { ok: false, error: "SEND_INCOMPLETE" });
  });
});

// The cap has to reject the save outright rather than let reconciliation
// quietly redefine which markers count as referenced — silently dropping the
// images past the cap would delete a parent's photograph for good.
describe("the per-letter image cap", () => {
  const complete = { title: "T", childId: "c1", body: "Hello" };
  const holding = (imageCount: number) => ({
    hasImages: imageCount > 0,
    mayHoldImages: true,
    imageCount,
  });

  for (const intent of ["draft", "submit"] as const) {
    it(`accepts exactly ${IMAGES_PER_LETTER} images on ${intent}`, () => {
      const result = parseLetterInput(
        complete,
        intent,
        holding(IMAGES_PER_LETTER),
      );
      assert.equal(result.ok, true);
    });

    // A draft that can't be reconciled safely must not be saved at all.
    it(`rejects one over the cap on ${intent}`, () => {
      const result = parseLetterInput(
        complete,
        intent,
        holding(IMAGES_PER_LETTER + 1),
      );
      assert.deepEqual(result, { ok: false, error: "TOO_MANY_IMAGES" });
    });

    it(`accepts a letter with no images on ${intent}`, () => {
      const result = parseLetterInput(complete, intent, holding(0));
      assert.equal(result.ok, true);
    });
  }

  // Ordering still holds: an incomplete letter is incomplete first.
  it("reports incompleteness before the cap", () => {
    const result = parseLetterInput(
      { ...complete, body: "" },
      "submit",
      holding(IMAGES_PER_LETTER + 1),
    );
    assert.deepEqual(result, { ok: false, error: "SEND_INCOMPLETE" });
  });

  it("reports a missing draft title before the cap", () => {
    const result = parseLetterInput(
      { ...complete, title: " " },
      "draft",
      holding(IMAGES_PER_LETTER + 1),
    );
    assert.deepEqual(result, { ok: false, error: "DRAFT_NEEDS_TITLE" });
  });
});

describe("letterInputMessage", () => {
  it("returns a message for every error code", () => {
    for (const code of [
      "SEND_INCOMPLETE",
      "DRAFT_NEEDS_TITLE",
      "SEND_IMAGES_NOT_ALLOWED",
      "TOO_MANY_IMAGES",
    ] as const) {
      assert.ok(letterInputMessage(code).length > 0, `${code} has no message`);
    }
  });
});

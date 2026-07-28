import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  letterInputMessage,
  parseLetterInput,
  parseLetterIntent,
} from "./letter-input.ts";

const complete = { title: "For your 18th", childId: "child_1", body: "Hello!" };

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
      );
      assert.ok(result.ok);
      assert.equal(result.value.sealing, false);
      assert.equal(result.value.childId, "");
    });

    it("rejects a draft with no title", () => {
      assert.partialDeepStrictEqual(
        parseLetterInput({ title: "   ", childId: "c", body: "b" }, "draft"),
        { ok: false, error: "DRAFT_NEEDS_TITLE" },
      );
    });
  });

  describe("sealing a letter", () => {
    it("accepts a complete letter and marks it sealing", () => {
      const result = parseLetterInput(complete, "submit");
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
    );
    assert.ok(result.ok);
    assert.partialDeepStrictEqual(result.value, {
      title: "T",
      childId: "c",
      body: "b",
    });
  });
});

describe("letterInputMessage", () => {
  it("returns a message for every error code", () => {
    for (const code of ["SEND_INCOMPLETE", "DRAFT_NEEDS_TITLE"] as const) {
      assert.ok(letterInputMessage(code).length > 0, `${code} has no message`);
    }
  });
});

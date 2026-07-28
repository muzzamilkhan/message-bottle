import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  imageMarker,
  letterImageIds,
  parseLetterBody,
  type LetterNode,
} from "./letter-body.ts";

// Shorthand: a paragraph of one unstyled span.
function plain(text: string): LetterNode {
  return { kind: "paragraph", spans: [{ text, bold: false, italic: false }] };
}

describe("parseLetterBody", () => {
  it("returns nothing for an empty body", () => {
    assert.deepEqual(parseLetterBody(""), []);
    assert.deepEqual(parseLetterBody("   \n\n  "), []);
  });

  it("reads a single paragraph", () => {
    assert.deepEqual(parseLetterBody("Dear Ada,"), [plain("Dear Ada,")]);
  });

  it("splits paragraphs on a blank line", () => {
    assert.deepEqual(parseLetterBody("One.\n\nTwo."), [
      plain("One."),
      plain("Two."),
    ]);
  });

  it("treats several blank lines as one break", () => {
    assert.deepEqual(parseLetterBody("One.\n\n\n\nTwo."), [
      plain("One."),
      plain("Two."),
    ]);
  });

  it("keeps a single newline inside one paragraph", () => {
    assert.deepEqual(parseLetterBody("One.\nStill one."), [
      plain("One.\nStill one."),
    ]);
  });

  describe("emphasis", () => {
    it("reads bold", () => {
      assert.deepEqual(parseLetterBody("a **b** c"), [
        {
          kind: "paragraph",
          spans: [
            { text: "a ", bold: false, italic: false },
            { text: "b", bold: true, italic: false },
            { text: " c", bold: false, italic: false },
          ],
        },
      ]);
    });

    it("reads italic", () => {
      assert.deepEqual(parseLetterBody("a *b* c"), [
        {
          kind: "paragraph",
          spans: [
            { text: "a ", bold: false, italic: false },
            { text: "b", bold: false, italic: true },
            { text: " c", bold: false, italic: false },
          ],
        },
      ]);
    });

    it("nests italic inside bold", () => {
      assert.deepEqual(parseLetterBody("**a *b***"), [
        {
          kind: "paragraph",
          spans: [
            { text: "a ", bold: true, italic: false },
            { text: "b", bold: true, italic: true },
          ],
        },
      ]);
    });

    // A parent typing about a 2*3 sum, or trailing off with "so**", must get
    // their characters back rather than an error or a swallowed rest-of-letter.
    it("leaves an unmatched marker as literal text", () => {
      assert.deepEqual(parseLetterBody("2 * 3 = 6"), [plain("2 * 3 = 6")]);
      assert.deepEqual(parseLetterBody("wow**"), [plain("wow**")]);
      assert.deepEqual(parseLetterBody("a *b"), [plain("a *b")]);
    });

    it("ignores an empty emphasis pair", () => {
      assert.deepEqual(parseLetterBody("a ** b"), [plain("a ** b")]);
    });
  });

  describe("image markers", () => {
    it("reads a marker alone on its line", () => {
      assert.deepEqual(parseLetterBody("[[img:abc123]]"), [
        { kind: "image", id: "abc123" },
      ]);
    });

    it("reads a marker between paragraphs", () => {
      assert.deepEqual(parseLetterBody("One.\n\n[[img:abc123]]\n\nTwo."), [
        plain("One."),
        { kind: "image", id: "abc123" },
        plain("Two."),
      ]);
    });

    it("reads a marker without blank lines around it", () => {
      assert.deepEqual(parseLetterBody("One.\n[[img:abc123]]\nTwo."), [
        plain("One."),
        { kind: "image", id: "abc123" },
        plain("Two."),
      ]);
    });

    it("tolerates whitespace around the marker line", () => {
      assert.deepEqual(parseLetterBody("  [[img:abc123]]  "), [
        { kind: "image", id: "abc123" },
      ]);
    });

    // Only a whole line is a marker, so prose mentioning one stays prose.
    it("leaves a marker with text beside it as literal", () => {
      assert.deepEqual(parseLetterBody("see [[img:abc123]] here"), [
        plain("see [[img:abc123]] here"),
      ]);
    });

    it("leaves a malformed marker as literal", () => {
      assert.deepEqual(parseLetterBody("[[img:]]"), [plain("[[img:]]")]);
      assert.deepEqual(parseLetterBody("[[img:a-b!]]"), [plain("[[img:a-b!]]")]);
    });

    it("reads several markers in order", () => {
      assert.deepEqual(parseLetterBody("[[img:aaa]]\n\n[[img:bbb]]"), [
        { kind: "image", id: "aaa" },
        { kind: "image", id: "bbb" },
      ]);
    });
  });
});

describe("letterImageIds", () => {
  it("finds no ids in a plain letter", () => {
    assert.deepEqual(letterImageIds("Dear Ada,\n\nLove, Dad."), []);
  });

  it("returns ids in the order they appear", () => {
    assert.deepEqual(
      letterImageIds("[[img:bbb]]\n\ntext\n\n[[img:aaa]]"),
      ["bbb", "aaa"],
    );
  });

  // Reconciliation asks "is this image referenced?", so a repeated marker is
  // one referenced image, not two.
  it("de-duplicates a repeated id", () => {
    assert.deepEqual(letterImageIds("[[img:aaa]]\n\n[[img:aaa]]"), ["aaa"]);
  });

  it("ignores a marker that isn't alone on its line", () => {
    assert.deepEqual(letterImageIds("see [[img:aaa]] here"), []);
  });
});

describe("imageMarker", () => {
  it("builds a marker the parser reads back", () => {
    assert.deepEqual(parseLetterBody(imageMarker("abc123")), [
      { kind: "image", id: "abc123" },
    ]);
  });
});

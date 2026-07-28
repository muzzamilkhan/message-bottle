import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toBlocks, toBody, type LetterBlock } from "./letter-blocks.ts";
import { letterImageIds } from "./letter-body.ts";

describe("toBlocks", () => {
  it("returns nothing for an empty body", () => {
    assert.deepEqual(toBlocks(""), []);
  });

  it("reads a body with no photos as one text block", () => {
    assert.deepEqual(toBlocks("Dear Ada,\n\nLove, Dad"), [
      { kind: "text", text: "Dear Ada,\n\nLove, Dad" },
    ]);
  });

  it("keeps blank lines inside a text block, so paragraphs survive", () => {
    const blocks = toBlocks("One\n\nTwo\n\n[[img:abc123]]");
    assert.deepEqual(blocks[0], { kind: "text", text: "One\n\nTwo" });
  });

  it("splits a text block at a photo marker", () => {
    assert.deepEqual(toBlocks("Before\n\n[[img:abc123]]\n\nAfter"), [
      { kind: "text", text: "Before" },
      { kind: "photo", id: "abc123" },
      { kind: "text", text: "After" },
    ]);
  });

  it("reads adjacent markers as adjacent photo blocks", () => {
    assert.deepEqual(toBlocks("[[img:aaa]]\n[[img:bbb]]"), [
      { kind: "photo", id: "aaa" },
      { kind: "photo", id: "bbb" },
    ]);
  });

  it("reads a leading marker with no text before it", () => {
    assert.deepEqual(toBlocks("[[img:aaa]]\n\nAfter"), [
      { kind: "photo", id: "aaa" },
      { kind: "text", text: "After" },
    ]);
  });

  it("reads a trailing marker with no text after it", () => {
    assert.deepEqual(toBlocks("Before\n\n[[img:aaa]]"), [
      { kind: "text", text: "Before" },
      { kind: "photo", id: "aaa" },
    ]);
  });

  it("tolerates whitespace around a marker line", () => {
    assert.deepEqual(toBlocks("Before\n\n  [[img:aaa]]  \n\nAfter"), [
      { kind: "text", text: "Before" },
      { kind: "photo", id: "aaa" },
      { kind: "text", text: "After" },
    ]);
  });

  it("leaves a marker with text beside it as prose", () => {
    assert.deepEqual(toBlocks("see [[img:aaa]] here"), [
      { kind: "text", text: "see [[img:aaa]] here" },
    ]);
  });

  it("leaves a malformed marker as prose", () => {
    assert.deepEqual(toBlocks("[[img:has-a-dash]]"), [
      { kind: "text", text: "[[img:has-a-dash]]" },
    ]);
  });

  it("keeps unmatched asterisks verbatim, so the parser still sees them", () => {
    assert.deepEqual(toBlocks("2 * 3 and **bold**"), [
      { kind: "text", text: "2 * 3 and **bold**" },
    ]);
  });
});

describe("toBody", () => {
  it("returns an empty string for no blocks", () => {
    assert.equal(toBody([]), "");
  });

  it("joins blocks with a blank line", () => {
    const blocks: LetterBlock[] = [
      { kind: "text", text: "Before" },
      { kind: "photo", id: "abc123" },
      { kind: "text", text: "After" },
    ];
    assert.equal(toBody(blocks), "Before\n\n[[img:abc123]]\n\nAfter");
  });

  it("drops empty text blocks", () => {
    const blocks: LetterBlock[] = [
      { kind: "text", text: "" },
      { kind: "photo", id: "abc123" },
      { kind: "text", text: "   " },
    ];
    assert.equal(toBody(blocks), "[[img:abc123]]");
  });

  it("trims each text block", () => {
    assert.equal(toBody([{ kind: "text", text: "  Hi  " }]), "Hi");
  });
});

describe("round trip through the editor's own output", () => {
  // Bodies written by this editor normalise, so they round-trip byte-identically
  // when loaded and saved again. Hand-edited bodies may normalise differently.
  const bodies = [
    "",
    "Dear Ada,\n\nLove, Dad",
    "Before\n\n[[img:abc123]]\n\nAfter",
    "[[img:aaa]]\n\n[[img:bbb]]",
    "[[img:aaa]]",
    "You were **so** small\n\n[[img:aaa]]\n\n2 * 3",
  ];

  for (const body of bodies) {
    it(`preserves ${JSON.stringify(body)}`, () => {
      assert.equal(toBody(toBlocks(body)), body);
    });
  }
});

describe("marker preservation", () => {
  // The property blob deletion actually depends on: normalising a body must
  // never change which images it references.
  const bodies = [
    "Hi\n",
    "\nHi",
    "Before\n[[img:aaa]]\nAfter",
    "[[img:aaa]]\n\n\n[[img:bbb]]",
    "   ",
    " [[img:aaa]] ",
    "a\n[[img:x]]\nb\n[[img:y]]",
  ];

  for (const body of bodies) {
    it(`keeps every marker in ${JSON.stringify(body)}`, () => {
      assert.deepEqual(
        letterImageIds(toBody(toBlocks(body))),
        letterImageIds(body),
      );
    });
  }
});

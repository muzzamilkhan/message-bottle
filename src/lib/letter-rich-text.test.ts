import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serializeRichText, type RichNode } from "./letter-rich-text.ts";

// Small builders so the trees below read like the markup they stand for.
const t = (text: string): RichNode => ({ type: "text", text });
const el = (tag: string, ...children: RichNode[]): RichNode => ({
  type: "element",
  tag,
  children,
});

describe("serializeRichText", () => {
  it("returns an empty string for no nodes", () => {
    assert.equal(serializeRichText([]), "");
  });

  it("passes plain text through", () => {
    assert.equal(serializeRichText([t("Dear Ada")]), "Dear Ada");
  });

  it("wraps bold in double asterisks", () => {
    assert.equal(serializeRichText([el("b", t("so"))]), "**so**");
  });

  it("treats strong as bold", () => {
    assert.equal(serializeRichText([el("strong", t("so"))]), "**so**");
  });

  it("wraps italic in single asterisks", () => {
    assert.equal(serializeRichText([el("i", t("so"))]), "*so*");
  });

  it("treats em as italic", () => {
    assert.equal(serializeRichText([el("em", t("so"))]), "*so*");
  });

  it("nests italic inside bold", () => {
    assert.equal(
      serializeRichText([el("b", t("very "), el("i", t("small")))]),
      "**very *small***",
    );
  });

  it("merges adjacent runs of the same format", () => {
    assert.equal(
      serializeRichText([el("b", t("so")), el("b", t(" small"))]),
      "**so small**",
    );
  });

  it("does not emit markers around empty formatting", () => {
    assert.equal(serializeRichText([el("b")]), "");
  });

  it("turns a br into a newline", () => {
    assert.equal(
      serializeRichText([t("One"), el("br"), t("Two")]),
      "One\nTwo",
    );
  });

  it("ends a div with a newline", () => {
    assert.equal(
      serializeRichText([el("div", t("One")), el("div", t("Two"))]),
      "One\nTwo\n",
    );
  });

  it("ends a p with a newline", () => {
    assert.equal(serializeRichText([el("p", t("One"))]), "One\n");
  });

  // The security cases. An unhandled element is not "stripped" — it is simply
  // not a case the walker handles, so only its text survives, into a string
  // that reaches the child as a text node.
  it("keeps only the text of a script element", () => {
    assert.equal(
      serializeRichText([t("Hi "), el("script", t("alert(1)"))]),
      "Hi alert(1)",
    );
  });

  it("keeps only the text of an unknown element", () => {
    assert.equal(
      serializeRichText([el("marquee", t("hello"))]),
      "hello",
    );
  });

  it("keeps formatting inside an unknown element", () => {
    assert.equal(
      serializeRichText([el("span", el("b", t("bold")))]),
      "**bold**",
    );
  });

  it("emits nothing for an element with no text, such as an img", () => {
    assert.equal(serializeRichText([el("img")]), "");
  });

  it("does not escape asterisks the parent typed", () => {
    // The letter parser already renders an unmatched marker literally, so
    // escaping here would invent a backslash grammar the renderer can't read.
    assert.equal(serializeRichText([t("2 * 3")]), "2 * 3");
  });
});

import { parseLetterBody } from "./letter-body.ts";

describe("agreement with the letter parser", () => {
  it("emits bold the parser reads back as bold", () => {
    const body = serializeRichText([t("You were "), el("b", t("so")), t(" small")]);
    const nodes = parseLetterBody(body);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "paragraph");
    if (nodes[0].kind !== "paragraph") return;
    assert.deepEqual(nodes[0].spans, [
      { text: "You were ", bold: false, italic: false },
      { text: "so", bold: true, italic: false },
      { text: " small", bold: false, italic: false },
    ]);
  });

  it("emits nested emphasis the parser reads back nested", () => {
    const body = serializeRichText([el("b", t("very "), el("i", t("small")))]);
    const nodes = parseLetterBody(body);
    if (nodes[0].kind !== "paragraph") throw new Error("expected a paragraph");
    assert.deepEqual(nodes[0].spans, [
      { text: "very ", bold: true, italic: false },
      { text: "small", bold: true, italic: true },
    ]);
  });

  it("leaves a script's text as inert prose", () => {
    const body = serializeRichText([el("script", t("alert(1)"))]);
    const nodes = parseLetterBody(body);
    if (nodes[0].kind !== "paragraph") throw new Error("expected a paragraph");
    assert.deepEqual(nodes[0].spans, [
      { text: "alert(1)", bold: false, italic: false },
    ]);
  });
});

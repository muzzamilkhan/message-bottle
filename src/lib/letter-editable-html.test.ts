import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toEditableHtml } from "./letter-editable-html.ts";

describe("toEditableHtml", () => {
  it("returns an empty string for an empty block", () => {
    assert.equal(toEditableHtml(""), "");
  });

  it("does not pair markers across a blank line", () => {
    // These are exactly the paragraph-pairs a text block may hold. A text
    // block is rendered per-paragraph, mirroring parseLetterBody splitting
    // the body on blank lines before ever calling parseSpans — so a marker
    // in one paragraph must never pair with one in another.
    assert.equal(toEditableHtml("5 * 3\n\n2 * 4"), "5 * 3<br><br>2 * 4");
    assert.equal(
      toEditableHtml("You are 5* now\n\nLove you 100*"),
      "You are 5* now<br><br>Love you 100*",
    );
    assert.equal(toEditableHtml("* one\n\n* two"), "* one<br><br>* two");
  });

  it("wraps bold in <b>", () => {
    assert.equal(toEditableHtml("**bold**"), "<b>bold</b>");
  });

  it("wraps italic in <i>", () => {
    assert.equal(toEditableHtml("*it*"), "<i>it</i>");
  });

  it("leaves an unmatched marker as literal text", () => {
    assert.equal(toEditableHtml("2 * 3"), "2 * 3");
  });

  it("leaves a lone double-asterisk as literal text", () => {
    assert.equal(toEditableHtml("**"), "**");
  });

  it("leaves a lone triple-asterisk as literal text", () => {
    assert.equal(toEditableHtml("***"), "***");
  });

  it("nests emphasis properly", () => {
    assert.equal(
      toEditableHtml("**very *small***"),
      "<b>very <i>small</i></b>",
    );
  });

  it("escapes html-significant characters in the parent's text", () => {
    assert.equal(
      toEditableHtml("<script>alert(1)</script> & friends"),
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; friends",
    );
  });

  it("turns a single newline within a paragraph into <br>", () => {
    assert.equal(toEditableHtml("One.\nStill one."), "One.<br>Still one.");
  });

  it("separates paragraphs with a blank line", () => {
    assert.equal(toEditableHtml("One\n\nTwo"), "One<br><br>Two");
  });
});

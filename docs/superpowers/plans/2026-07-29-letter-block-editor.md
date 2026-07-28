# Letter Block Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the letter body's plain textarea and visible `[[img:<cuid>]]` markers with a WYSIWYG block editor — text blocks showing real bold/italic while typing, and photo blocks showing the actual photograph.

**Architecture:** Blocks are a *view* over the existing string body, never a storage format. `Letter.body` stays a `String` in exactly today's format, so reconciliation, the orphan sweep, the child's renderer, and every blob-deletion path are untouched. Two new pure libs (`letter-blocks.ts`, `letter-rich-text.ts`) do the string↔block and DOM↔string conversion and carry all the tests; the React components around them stay untested, as canvas and DOM code already is in this codebase.

**Tech Stack:** Next.js 15 App Router, React 19 client components, TypeScript, Node's built-in test runner (`node --test`) with native TypeScript stripping.

**Design doc:** `docs/superpowers/specs/2026-07-29-letter-block-editor-design.md`

## Global Constraints

- **Work directly on `main`.** No feature branches, no PRs. Atomic commits, one logical change each.
- **Never skip the pre-commit hook.** No `--no-verify`, no unsetting `core.hooksPath`, no narrowing a check. A red check is a finding, not an obstacle.
- **Modules under `src/lib/` import each other with relative paths and explicit `.ts` extensions** (e.g. `import { imageMarker } from "./letter-body.ts"`). The `@/` alias needs a bundler Node doesn't have. App code outside `src/lib/` still uses `@/`.
- **Test files are `src/**/*.test.ts`** — the `npm test` glob does not match `.tsx`. Both new libs are plain `.ts`, so this holds.
- **Never use `dangerouslySetInnerHTML`.** User text always lands in a text node. This is the project's standing rule and the security basis of this feature.
- **Do not change** `Letter.body`'s storage format, `prisma/schema.prisma`, `src/lib/letter-body.ts`, `src/app/actions.ts`, `src/lib/letter-input.ts`, `src/components/letter-body.tsx`, `src/app/api/letter-image/[id]/route.ts`, or any blob-deletion path.
- **The two invariants hold:** sealing stays final (`status: "DRAFT"` in every letter `updateMany`/`deleteMany`), and the time lock stays server-side. No task here touches either mechanism.
- **Components take `childOptions`, never a `children` prop** — `children` is React's and trips `react/no-children-prop`.
- **Verify with** `npm test && npm run typecheck && npm run lint`. Never `npm run build` — it runs `prisma db push --accept-data-loss` against `DATABASE_URL` and is not a read-only check.
- **The dev server is already running on :3000.** Do not start another; see `dev.log` to debug.
- `IMAGES_PER_LETTER` is **12** (from `src/lib/letter-image.ts`). Never hardcode the number in copy — import the constant.

---

## File Structure

**Create:**
- `src/lib/letter-blocks.ts` — string ↔ block-list conversion. Pure.
- `src/lib/letter-blocks.test.ts` — its tests.
- `src/lib/letter-rich-text.ts` — DOM-node-tree → body-string serialiser. Pure. The security boundary.
- `src/lib/letter-rich-text.test.ts` — its tests.
- `src/components/use-letter-image-upload.ts` — the compress-and-upload hook, lifted verbatim from `letter-image-input.tsx`.
- `src/components/letter-text-block.tsx` — one contenteditable text block.
- `src/components/letter-photo-block.tsx` — one photo block with move/remove controls.
- `src/components/letter-selection-toolbar.tsx` — the floating B/I popover.
- `src/components/letter-blocks-editor.tsx` — composes the above into the block list.

**Modify:**
- `src/components/letter-form.tsx` — holds blocks instead of a body string.
- `CLAUDE.md` — document the block editor in the inline-images section.

**Delete:**
- `src/components/letter-image-input.tsx` — its upload half moves to the hook; its button, caption, and thumbnail strip are the UI being replaced.

Task order is dependency order: the two pure libs first (fully tested, no UI), then the upload hook, then the leaf components, then the editor that composes them, then the form swap that makes it live, then cleanup and docs.

---

### Task 1: The block model (`letter-blocks.ts`)

Converts between the stored body string and a list of editor blocks. This is the task that makes "blocks are a view, not a format" true.

**Files:**
- Create: `src/lib/letter-blocks.ts`
- Test: `src/lib/letter-blocks.test.ts`

**Interfaces:**
- Consumes: `IMAGE_MARKER_PATTERN`, `imageMarker` from `./letter-body.ts` (both already exported).
- Produces:
  - `type LetterBlock = { kind: "text"; text: string } | { kind: "photo"; id: string }`
  - `function toBlocks(body: string): LetterBlock[]`
  - `function toBody(blocks: LetterBlock[]): string`

**Why not reuse `parseLetterBody`:** that function returns *styled spans*, and re-serialising spans back to `**`/`*` does not round-trip — `parseSpans` renders an unmatched `*` as a literal character, and re-emitting it would change its meaning on the next parse. Splitting at the raw-string level with the same `IMAGE_MARKER_PATTERN` keeps the round-trip exact and avoids a second grammar.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/letter-blocks.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toBlocks, toBody, type LetterBlock } from "./letter-blocks.ts";

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

describe("round trip", () => {
  // The property that matters: an existing draft must survive a load-and-save
  // byte-identically, or opening a draft would silently rewrite it.
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/muzza/Projects/message-bottle && node --test src/lib/letter-blocks.test.ts`
Expected: FAIL — cannot find module `./letter-blocks.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/letter-blocks.ts`:

```ts
// The editor's view of a letter body.
//
// A body is stored as a plain string and always will be: letterImageIds() reads
// it to decide which blobs are still referenced, and that is the mechanism
// behind "delete the child, and every photo goes with it". These blocks exist
// only inside the editor, and every edit is serialised straight back to the
// same string — so nothing downstream can tell the editor changed.

import { IMAGE_MARKER_PATTERN, imageMarker } from "./letter-body.ts";

export type LetterBlock =
  | { kind: "text"; text: string }
  | { kind: "photo"; id: string };

// Split a stored body into blocks.
//
// Deliberately not built on parseLetterBody: that returns styled spans, and
// re-serialising spans back to **/* would not round-trip — parseSpans treats an
// unmatched * as a literal character, so re-emitting it would change its
// meaning on the next parse. Splitting the raw string on the same marker
// pattern keeps the round-trip exact and leaves one grammar, not two.
export function toBlocks(body: string): LetterBlock[] {
  const blocks: LetterBlock[] = [];
  // Lines accumulated for the text block currently being read.
  let pending: string[] = [];

  function flushText() {
    const text = pending.join("\n").trim();
    pending = [];
    if (text) blocks.push({ kind: "text", text });
  }

  for (const line of body.split("\n")) {
    const marker = IMAGE_MARKER_PATTERN.exec(line.trim());
    if (marker) {
      flushText();
      blocks.push({ kind: "photo", id: marker[1] });
      continue;
    }
    pending.push(line);
  }
  flushText();

  return blocks;
}

// Serialise blocks back to a stored body. A text block may hold several
// paragraphs, so blocks join with a blank line just as paragraphs do.
export function toBody(blocks: LetterBlock[]): string {
  return blocks
    .map((block) =>
      block.kind === "photo" ? imageMarker(block.id) : block.text.trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/muzza/Projects/message-bottle && node --test src/lib/letter-blocks.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Run the full checks**

Run: `cd /Users/muzza/Projects/message-bottle && npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/muzza/Projects/message-bottle
git add src/lib/letter-blocks.ts src/lib/letter-blocks.test.ts
git commit -m "Add the block model over the letter body string

Blocks are a view over the stored body, not a new format: toBlocks and
toBody round-trip any existing draft byte-identically, so reconciliation
and the orphan sweep keep reading exactly what they read today.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The rich-text serialiser (`letter-rich-text.ts`)

Turns a contenteditable's DOM into the body string. **This is the security boundary of the feature** — the reason no sanitizer library is needed.

**Files:**
- Create: `src/lib/letter-rich-text.ts`
- Test: `src/lib/letter-rich-text.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RichNode = { type: "text"; text: string } | { type: "element"; tag: string; children: RichNode[] }`
  - `function serializeRichText(nodes: RichNode[]): string`
  - `function fromDom(node: Node): RichNode[]` — adapts real DOM to `RichNode`. Not unit-tested (Node has no `DOMParser`); it is a five-line structural mapping.

**The design point:** the walk is an *allowlist that emits text*, never a blocklist that strips tags. An unrecognised element contributes only its text content. A pasted `<script>` therefore survives as inert text in a text node, and there is no path from a DOM node to stored markup. `RichNode` exists so this is testable in Node, which has no DOM.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/letter-rich-text.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/muzza/Projects/message-bottle && node --test src/lib/letter-rich-text.test.ts`
Expected: FAIL — cannot find module `./letter-rich-text.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/letter-rich-text.ts`:

```ts
// The contenteditable's DOM, turned back into the stored body string.
//
// This is the security boundary of the block editor, and the reason it needs no
// sanitizer. The walk below is an ALLOWLIST THAT EMITS TEXT, not a blocklist
// that strips tags: an element it doesn't recognise contributes only its text
// content, and every character it emits ends up in a plain string that reaches
// the child through parseSpans as a text node. There is no path from a DOM node
// to stored markup, and dangerouslySetInnerHTML stays absent from this codebase.
//
// Adding a case to this walker is the one way to widen what the editor accepts.
// Think hard before doing it.

// A minimal structural view of a DOM node. Real DOM nodes are mapped onto this
// by fromDom() below, which keeps the serialiser testable in Node — which has
// no DOMParser — by letting tests build plain objects instead.
export type RichNode =
  | { type: "text"; text: string }
  | { type: "element"; tag: string; children: RichNode[] };

// Tags that set a formatting flag on the text beneath them.
const BOLD_TAGS = new Set(["b", "strong"]);
const ITALIC_TAGS = new Set(["i", "em"]);
// Tags that end a line. A contenteditable produces these on Enter, and which
// one it picks varies by browser — so handle both rather than depending on it.
const BLOCK_TAGS = new Set(["div", "p"]);

// A run of text sharing one set of formatting flags. Collected before emitting
// so adjacent runs with the same flags merge into a single pair of markers,
// rather than "**so** ** small**" from two neighbouring <b> elements.
type Run = { text: string; bold: boolean; italic: boolean };

function collect(
  nodes: RichNode[],
  bold: boolean,
  italic: boolean,
  runs: Run[],
): void {
  for (const node of nodes) {
    if (node.type === "text") {
      if (node.text) runs.push({ text: node.text, bold, italic });
      continue;
    }

    const tag = node.tag.toLowerCase();

    if (tag === "br") {
      // A line break carries no formatting: markers must close before it, or
      // an unmatched ** would swallow the rest of the paragraph.
      runs.push({ text: "\n", bold: false, italic: false });
      continue;
    }

    if (BOLD_TAGS.has(tag)) {
      collect(node.children, true, italic, runs);
      continue;
    }

    if (ITALIC_TAGS.has(tag)) {
      collect(node.children, bold, true, runs);
      continue;
    }

    if (BLOCK_TAGS.has(tag)) {
      collect(node.children, bold, italic, runs);
      runs.push({ text: "\n", bold: false, italic: false });
      continue;
    }

    // Everything else — <span>, <script>, <img>, anything pasted. The element
    // itself is ignored and only its text survives. This is the default that
    // makes the walker safe by construction.
    collect(node.children, bold, italic, runs);
  }
}

export function serializeRichText(nodes: RichNode[]): string {
  const runs: Run[] = [];
  collect(nodes, false, false, runs);

  let out = "";
  let bold = false;
  let italic = false;

  function setFormat(nextBold: boolean, nextItalic: boolean) {
    // Close in the reverse order of opening, so markers nest rather than
    // interleave: "**very *small***", never "**very *small**​*".
    if (italic && !nextItalic) {
      out += "*";
      italic = false;
    }
    if (bold !== nextBold) {
      if (bold && italic) {
        // Bold closes outside italic, so italic must close first and reopen.
        out += "*";
        italic = false;
      }
      out += "**";
      bold = nextBold;
    }
    if (!italic && nextItalic) {
      out += "*";
      italic = true;
    }
  }

  for (const run of runs) {
    setFormat(run.bold, run.italic);
    out += run.text;
  }
  setFormat(false, false);

  return out;
}

// Map a real DOM node's children onto RichNode. Kept separate from the walk
// above so the rules stay testable without a browser.
export function fromDom(root: Node): RichNode[] {
  return Array.from(root.childNodes).map((node): RichNode => {
    if (node.nodeType === 3 /* Node.TEXT_NODE */) {
      return { type: "text", text: node.textContent ?? "" };
    }
    if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
      return {
        type: "element",
        tag: (node as Element).tagName.toLowerCase(),
        children: fromDom(node),
      };
    }
    // Comments and anything else contribute nothing.
    return { type: "text", text: "" };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/muzza/Projects/message-bottle && node --test src/lib/letter-rich-text.test.ts`
Expected: PASS, all cases.

If the nesting case (`**very *small***`) or the merge case fails, the bug is in `setFormat`'s open/close ordering — fix it there rather than in `collect`, and do not change the assertions: the expected strings are what `parseSpans` in `letter-body.ts` reads back correctly.

- [ ] **Step 5: Verify the serialiser agrees with the letter parser**

This is the check that matters most: what the editor writes must be what the child's renderer reads. Add to the end of `src/lib/letter-rich-text.test.ts`:

```ts
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
```

Run: `cd /Users/muzza/Projects/message-bottle && node --test src/lib/letter-rich-text.test.ts`
Expected: PASS. If a nesting assertion fails, `setFormat`'s ordering is wrong — the parser is the authority here, not the serialiser.

- [ ] **Step 6: Run the full checks**

Run: `cd /Users/muzza/Projects/message-bottle && npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/muzza/Projects/message-bottle
git add src/lib/letter-rich-text.ts src/lib/letter-rich-text.test.ts
git commit -m "Add the contenteditable serialiser

An allowlist that emits text, not a blocklist that strips tags: an
unrecognised element contributes only its text content, so a pasted
script survives as inert prose. Tests assert the output against
parseLetterBody, so what the editor writes is what the child reads.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract the upload hook

Lift the compress-and-upload half of `letter-image-input.tsx` into a hook the block editor can call, leaving the old component's UI behind. Pure refactor — no behaviour change, and `letter-image-input.tsx` still works and is still used at the end of this task.

**Files:**
- Create: `src/components/use-letter-image-upload.ts`
- Modify: `src/components/letter-image-input.tsx` (delegate to the hook)

**Interfaces:**
- Consumes: `uploadLetterImage`, `type LetterImageState` from `@/app/actions`; `downscaleSteps`, `fitDimensions`, `IMAGE_MAX_BYTES`, `IMAGE_MAX_UPLOAD_BYTES`, `IMAGE_QUALITY_LADDER`, `letterImageMessage` from `@/lib/letter-image`.
- Produces:
  - `type DraftImage = { id: string; width: number; height: number }`
  - `function useLetterImageUpload(options: { letterId?: string }): { busy: boolean; error: string | null; clearError: () => void; upload: (file: File) => Promise<DraftImage | null> }`

`DraftImage` currently lives in `letter-image-input.tsx` and is imported by `letter-form.tsx`. Moving it here is what lets that component be deleted in Task 7.

- [ ] **Step 1: Create the hook**

Create `src/components/use-letter-image-upload.ts`. Move `compress()` across **verbatim** from `letter-image-input.tsx` including its comments — it is working canvas code and this task must not change its behaviour:

```ts
"use client";

import { useCallback, useState } from "react";
import { uploadLetterImage, type LetterImageState } from "@/app/actions";
import {
  downscaleSteps,
  fitDimensions,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_UPLOAD_BYTES,
  IMAGE_QUALITY_LADDER,
  letterImageMessage,
} from "@/lib/letter-image";

// The browser half of image upload: shrink a picked file and send it. The rules
// it applies all live in src/lib/letter-image.ts; this is the canvas work
// around them, and is untested for the same reason the avatar's input is.

// An image this draft already holds, or one uploaded during this session.
export type DraftImage = { id: string; width: number; height: number };

// Shrink a picked file to something the letter UI can actually use. The child
// reads at ~640px, so anything past 1280 is bytes nobody sees.
async function compress(
  file: File,
): Promise<{ blob: Blob; width: number; height: number }> {
  // Applies the EXIF rotation flag, so phone photos aren't stored sideways.
  // That's the whole EXIF story — and re-encoding through a canvas drops the
  // rest of the metadata, including GPS coordinates, which is exactly what we
  // want for a photo of a child.
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const target = fitDimensions(bitmap.width, bitmap.height);
  const aspect = bitmap.height / bitmap.width;

  let canvas = document.createElement("canvas");
  let source: ImageBitmap | HTMLCanvasElement = bitmap;

  // Step down in halves rather than one big draw: browsers don't box-filter at
  // extreme ratios, and a single 4000→1280 draw looks grainy.
  for (const width of downscaleSteps(bitmap.width, target.width)) {
    const height = Math.max(1, Math.round(width * aspect));
    const next = document.createElement("canvas");
    next.width = width;
    next.height = height;
    const context = next.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);
    source = next;
    canvas = next;
  }

  bitmap.close();

  // Try qualities in order, stopping at the first result under the cap.
  for (const quality of IMAGE_QUALITY_LADDER) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (blob && blob.size <= IMAGE_MAX_BYTES) {
      return { blob, width: canvas.width, height: canvas.height };
    }
  }
  throw new Error("IMAGE_TOO_LARGE");
}

export function useLetterImageUpload({ letterId }: { letterId?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // Returns the stored image on success, or null after setting `error`.
  const upload = useCallback(
    async (file: File): Promise<DraftImage | null> => {
      setError(null);

      if (file.size > IMAGE_MAX_UPLOAD_BYTES) {
        setError(letterImageMessage("IMAGE_TOO_LARGE_TO_READ"));
        return null;
      }

      setBusy(true);
      try {
        const { blob, width, height } = await compress(file);
        const data = new FormData();
        data.set(
          "image",
          new File([blob], "photo.webp", { type: "image/webp" }),
        );
        data.set("width", String(width));
        data.set("height", String(height));
        if (letterId) data.set("letterId", letterId);

        const result: LetterImageState = await uploadLetterImage({}, data);
        const image = result.image;
        if (result.error || !image) {
          setError(result.error ?? letterImageMessage("IMAGE_MALFORMED"));
          return null;
        }
        return image;
      } catch {
        setError(letterImageMessage("IMAGE_TOO_LARGE"));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [letterId],
  );

  return { busy, error, clearError, upload };
}
```

- [ ] **Step 2: Point the old component at the hook**

In `src/components/letter-image-input.tsx`: delete the local `compress` function, the `DraftImage` type declaration, the `busy`/`error` state, and the now-unused imports (`useState` stays for `showUpsell` and `uploaded`; drop `downscaleSteps`, `fitDimensions`, `IMAGE_MAX_BYTES`, `IMAGE_MAX_UPLOAD_BYTES`, `IMAGE_QUALITY_LADDER`, `uploadLetterImage`, `LetterImageState`).

Re-export the type so `letter-form.tsx`'s existing import keeps working:

```ts
import {
  useLetterImageUpload,
  type DraftImage,
} from "@/components/use-letter-image-upload";

export type { DraftImage };
```

Replace the body of `onPick` with:

```ts
  const { busy, error, upload } = useLetterImageUpload({ letterId });

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a failure.
    event.target.value = "";
    if (!file) return;

    const image = await upload(file);
    if (!image) return;
    // Show it in the strip straight away, before any save.
    setUploaded((current) => [...current, image]);
    // Built by the same module that parses it, so the two can't drift.
    onInsert(imageMarker(image.id));
  }
```

- [ ] **Step 3: Verify nothing changed**

Run: `cd /Users/muzza/Projects/message-bottle && npm test && npm run typecheck && npm run lint`
Expected: all pass. This is a pure refactor — no test should change.

- [ ] **Step 4: Check the letter form still works in the browser**

The dev server is already running on :3000 — do not start another. Open `http://localhost:3000/letters/new`, and confirm the photo button still uploads and inserts a marker exactly as before. If it errors, check `dev.log`.

- [ ] **Step 5: Commit**

```bash
cd /Users/muzza/Projects/message-bottle
git add src/components/use-letter-image-upload.ts src/components/letter-image-input.tsx
git commit -m "Extract the letter image upload hook

Pure refactor: the compress-and-send half moves to a hook so the block
editor can call it without inheriting the button, caption, and thumbnail
strip that are about to be replaced.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The text block

One contenteditable paragraph region. The caret discipline here is the whole reason this is its own component.

**Files:**
- Create: `src/components/letter-text-block.tsx`

**Interfaces:**
- Consumes: `serializeRichText`, `fromDom` from `@/lib/letter-rich-text`.
- Produces: `function LetterTextBlock(props: { text: string; placeholder?: string; onChange: (text: string) => void; onFocus: () => void; onBlur: () => void }): JSX.Element`

**The rule that makes contenteditable survivable:** React sets `innerHTML` **once on mount** and never again for the life of the block. State flows DOM → React only. If React ever re-rendered the element's content, the caret would jump to the start on every keystroke. `text` is therefore an *initial* value, not a controlled one — hence `useRef` for the initial render and a deliberately empty dependency list.

- [ ] **Step 1: Write the component**

Create `src/components/letter-text-block.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { fromDom, serializeRichText } from "@/lib/letter-rich-text";

// One contenteditable region of the letter.
//
// The load-bearing rule: React writes this element's content ONCE, on mount,
// and never again. A contenteditable whose innerHTML React re-renders puts the
// caret back at the start on every keystroke, so `text` is an initial value,
// not a controlled one — state flows DOM → React only. Everything else here
// follows from that.

// Render the initial text as markup the browser will edit. Bold and italic are
// the only elements ever produced, and every piece of the parent's text goes
// through escapeHtml first — so this is markup we generated, not markup anyone
// supplied. (dangerouslySetInnerHTML is still not used: this is a direct
// innerHTML write on a ref, under the same rule, and it is the only place in
// the codebase that writes markup at all.)
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Turn the stored **/* form into <b>/<i> for editing. Mirrors parseSpans in
// letter-body.ts, including its rule that an unmatched marker is literal text.
function toEditableHtml(text: string): string {
  let html = "";
  let bold = false;
  let italic = false;
  let buffer = "";

  const flush = () => {
    html += escapeHtml(buffer);
    buffer = "";
  };

  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    const isBold = two === "**";
    const isItalic = !isBold && text[i] === "*";

    if (isBold || isItalic) {
      const marker = isBold ? "**" : "*";
      const open = isBold ? bold : italic;
      const closes = open || text.indexOf(marker, i + marker.length) !== -1;
      const empty = !open && text.slice(i + marker.length).startsWith(marker);

      if (closes && !empty) {
        flush();
        if (isBold) {
          html += bold ? "</b>" : "<b>";
          bold = !bold;
        } else {
          html += italic ? "</i>" : "<i>";
          italic = !italic;
        }
        i += marker.length;
        continue;
      }
    }

    buffer += text[i];
    i += 1;
  }

  flush();
  if (italic) html += "</i>";
  if (bold) html += "</b>";

  return html.replace(/\n/g, "<br>");
}

export function LetterTextBlock({
  text,
  placeholder,
  onChange,
  onFocus,
  onBlur,
}: {
  // The initial content only. Later changes to this prop are ignored by
  // design — see the note at the top of this file.
  text: string;
  placeholder?: string;
  onChange: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Captured once so the effect below can't be tempted into re-running when the
  // parent's copy of the text changes.
  const initial = useRef(text);

  useEffect(() => {
    const element = ref.current;
    if (element) element.innerHTML = toEditableHtml(initial.current);
    // Deliberately empty: this must run on mount and never again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emit() {
    const element = ref.current;
    if (element) onChange(serializeRichText(fromDom(element)));
  }

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Letter text"
      data-placeholder={placeholder}
      onInput={emit}
      onFocus={onFocus}
      onBlur={() => {
        emit();
        onBlur();
      }}
      onPaste={(event) => {
        // The serialiser would neutralise pasted markup anyway; this keeps the
        // visible document clean too, so what the parent sees while writing is
        // what the letter will hold.
        event.preventDefault();
        const plain = event.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, plain);
      }}
      className="min-h-8 w-full whitespace-pre-wrap outline-none empty:before:text-sea-400 empty:before:content-[attr(data-placeholder)]"
    />
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `cd /Users/muzza/Projects/message-bottle && npm run typecheck && npm run lint`
Expected: both pass. The one `eslint-disable-next-line` is intentional and explained by the comment above it; do not remove it or add the dependency the rule asks for — doing so reintroduces the caret bug.

- [ ] **Step 3: Commit**

```bash
cd /Users/muzza/Projects/message-bottle
git add src/components/letter-text-block.tsx
git commit -m "Add the contenteditable text block

React writes the element's content once on mount and never again, so the
caret survives typing; state flows DOM to React only. Paste is forced to
plain text.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The photo block and the selection toolbar

Two small presentational components with no shared state. They are one task because neither carries a test cycle worth gating on its own.

**Files:**
- Create: `src/components/letter-photo-block.tsx`
- Create: `src/components/letter-selection-toolbar.tsx`

**Interfaces:**
- Consumes: `letterImageUrl` from `@/lib/letter-image-url`; `type DraftImage` from `@/components/use-letter-image-upload`.
- Produces:
  - `function LetterPhotoBlock(props: { image: DraftImage; canMoveUp: boolean; canMoveDown: boolean; onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void }): JSX.Element`
  - `function LetterSelectionToolbar(props: { position: { top: number; left: number } | null; onBold: () => void; onItalic: () => void }): JSX.Element | null`

- [ ] **Step 1: Write the photo block**

Create `src/components/letter-photo-block.tsx`:

```tsx
"use client";

import { letterImageUrl } from "@/lib/letter-image-url";
import type { DraftImage } from "@/components/use-letter-image-upload";

// A photograph, where the parent placed it. This replaces the [[img:<cuid>]]
// marker they used to have to place by hand — the photo is the marker now.
export function LetterPhotoBlock({
  image,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  image: DraftImage;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group relative my-4">
      {/* Plain <img>, not next/image: the route is authorized per-request and
          returns no-store, so there is nothing for the optimizer to fetch or
          cache. No token here — this is the author's own view, and the route
          authorizes them by session. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={letterImageUrl(image.id)}
        // Content, not decoration. The word "photo" is out for the same
        // jsx-a11y/img-redundant-alt reason as in letter-body.tsx.
        alt="Included in your letter"
        width={image.width}
        height={image.height}
        className="h-auto w-full rounded-2xl"
      />
      <div className="absolute right-2 top-2 flex gap-1 rounded-full bg-white/90 p-1 opacity-0 shadow-sm transition group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label="Move this photo earlier"
          className="rounded-full px-2 py-1 text-sm text-sea-600 hover:bg-sea-100 disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label="Move this photo later"
          className="rounded-full px-2 py-1 text-sm text-sea-600 hover:bg-sea-100 disabled:opacity-30"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this photo from the letter"
          className="rounded-full px-2 py-1 text-sm text-sea-600 hover:bg-blush-200 hover:text-blush-500"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the selection toolbar**

Create `src/components/letter-selection-toolbar.tsx`:

```tsx
"use client";

// The floating B / I popover, shown above a selection inside a text block.
//
// It must not steal focus: taking focus would collapse the very selection the
// buttons are about to format, so every button suppresses mousedown rather
// than relying on click alone.
export function LetterSelectionToolbar({
  position,
  onBold,
  onItalic,
}: {
  // Viewport coordinates of the selection, or null when there is none.
  position: { top: number; left: number } | null;
  onBold: () => void;
  onItalic: () => void;
}) {
  if (!position) return null;

  return (
    <div
      // Fixed, because the coordinates come from getBoundingClientRect.
      style={{ top: position.top, left: position.left }}
      className="fixed z-50 flex -translate-x-1/2 -translate-y-full gap-1 rounded-xl bg-sea-800 p-1 shadow-lg"
      // Keeping the selection alive is the whole job of this handler.
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        onClick={onBold}
        aria-label="Bold"
        className="rounded-lg px-3 py-1 text-sm font-extrabold text-white hover:bg-sea-600"
      >
        B
      </button>
      <button
        type="button"
        onClick={onItalic}
        aria-label="Italic"
        className="rounded-lg px-3 py-1 text-sm italic text-white hover:bg-sea-600"
      >
        I
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify both compile and lint**

Run: `cd /Users/muzza/Projects/message-bottle && npm run typecheck && npm run lint`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/muzza/Projects/message-bottle
git add src/components/letter-photo-block.tsx src/components/letter-selection-toolbar.tsx
git commit -m "Add the photo block and the selection toolbar

The photo block shows the photograph where the marker used to sit. The
toolbar suppresses mousedown so pressing B never collapses the selection
it is about to format.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The block editor

Composes the blocks into the editing surface: the list, the insertion affordance, the toolbar wiring, and the upload path.

**Files:**
- Create: `src/components/letter-blocks-editor.tsx`

**Interfaces:**
- Consumes: `type LetterBlock` from `@/lib/letter-blocks`; `LetterTextBlock`; `LetterPhotoBlock`; `LetterSelectionToolbar`; `useLetterImageUpload`, `type DraftImage` from `@/components/use-letter-image-upload`; `IMAGES_PER_LETTER` from `@/lib/letter-image`.
- Produces: `function LetterBlocksEditor(props: { blocks: LetterBlock[]; onChange: (blocks: LetterBlock[]) => void; letterId?: string; canUpload: boolean; existingImages: DraftImage[] }): JSX.Element`

**Block identity:** blocks need stable React keys, or a text block would remount when a sibling is added and lose its caret. Photo blocks key on their image id. Text blocks get an id from a counter held in a ref, assigned when the block is created and carried alongside the block list.

- [ ] **Step 1: Write the editor**

Create `src/components/letter-blocks-editor.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LetterBlock } from "@/lib/letter-blocks";
import { IMAGES_PER_LETTER } from "@/lib/letter-image";
import { LetterPhotoBlock } from "@/components/letter-photo-block";
import { LetterSelectionToolbar } from "@/components/letter-selection-toolbar";
import { LetterTextBlock } from "@/components/letter-text-block";
import {
  useLetterImageUpload,
  type DraftImage,
} from "@/components/use-letter-image-upload";

// The letter body, as blocks the parent can see and rearrange.
//
// Everything here is a view over a plain string: letter-form.tsx serialises
// these blocks with toBody() before submitting, so the server receives exactly
// what the old textarea sent.

// Stable React keys. Without them a text block remounts when a sibling is
// inserted, and remounting a contenteditable loses the caret.
type Keyed = { key: string; block: LetterBlock };

export function LetterBlocksEditor({
  blocks,
  onChange,
  letterId,
  canUpload,
  existingImages,
}: {
  blocks: LetterBlock[];
  onChange: (blocks: LetterBlock[]) => void;
  letterId?: string;
  // Whether this author's subscription covers uploading. The server checks
  // again — this only decides what the form offers.
  canUpload: boolean;
  // Photos this draft already holds, so their dimensions are known before the
  // image loads. Uploads from this session are merged in.
  existingImages: DraftImage[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, error, upload } = useLetterImageUpload({ letterId });
  const [uploaded, setUploaded] = useState<DraftImage[]>([]);
  const [showUpsell, setShowUpsell] = useState(false);
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(
    null,
  );
  // Where a photo should land: the index after the text block last focused.
  const insertAt = useRef<number | null>(null);

  // Keys are assigned once per block and kept in step with the block list by
  // index. A ref, not state — changing a key must never trigger a render.
  const nextKey = useRef(0);
  const keysRef = useRef<string[]>([]);
  if (keysRef.current.length !== blocks.length) {
    // Blocks were added or removed outside a keyed operation (the first render,
    // or a draft loading). Rebuild, preferring an image id where there is one.
    keysRef.current = blocks.map(
      (block, index) =>
        keysRef.current[index] ??
        (block.kind === "photo" ? `photo-${block.id}` : `text-${nextKey.current++}`),
    );
  }

  const keyed: Keyed[] = blocks.map((block, index) => ({
    key:
      block.kind === "photo"
        ? `photo-${block.id}`
        : (keysRef.current[index] ?? `text-${index}`),
    block,
  }));

  const known = new Map(
    [...existingImages, ...uploaded].map((image) => [image.id, image]),
  );

  const photoCount = blocks.filter((block) => block.kind === "photo").length;
  const full = photoCount >= IMAGES_PER_LETTER;

  function update(next: LetterBlock[]) {
    // Never leave the editor with nothing to type into.
    onChange(next.length > 0 ? next : [{ kind: "text", text: "" }]);
  }

  function setBlock(index: number, text: string) {
    const next = [...blocks];
    next[index] = { kind: "text", text };
    onChange(next);
  }

  function removeAt(index: number) {
    keysRef.current.splice(index, 1);
    update(blocks.filter((_, i) => i !== index));
  }

  function move(index: number, by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[to]] = [next[to], next[index]];
    const keys = keysRef.current;
    [keys[index], keys[to]] = [keys[to], keys[index]];
    onChange(next);
  }

  // Track the selection so the toolbar can follow it.
  useEffect(() => {
    function onSelectionChange() {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setToolbar(null);
        return;
      }
      const range = selection.getRangeAt(0);
      // Only inside this editor's text blocks — a selection elsewhere on the
      // page is none of our business.
      const container =
        range.commonAncestorContainer.nodeType === 1
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
      if (!container?.closest("[data-letter-text-block]")) {
        setToolbar(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setToolbar({ top: rect.top - 8, left: rect.left + rect.width / 2 });
    }

    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // execCommand is formally deprecated but implemented everywhere, and it
  // handles caret and selection restoration correctly. Hand-rolled Range
  // surgery is more code and more edge cases for no gain at this size.
  const format = useCallback((command: "bold" | "italic") => {
    document.execCommand(command);
    // The DOM changed under the block; its own onInput won't fire for an
    // execCommand, so nudge the focused block to re-emit.
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, []);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a failure.
    event.target.value = "";
    if (!file) return;

    const image = await upload(file);
    if (!image) return;

    setUploaded((current) => [...current, image]);

    const at = insertAt.current ?? blocks.length;
    const next = [...blocks];
    next.splice(at, 0, { kind: "photo", id: image.id });
    keysRef.current.splice(at, 0, `photo-${image.id}`);
    // A photo always has somewhere to type after it.
    if (at === next.length - 1) {
      next.push({ kind: "text", text: "" });
      keysRef.current.push(`text-${nextKey.current++}`);
    }
    onChange(next);
  }

  return (
    <div>
      <div className="field-input min-h-48 space-y-1">
        {keyed.map(({ key, block }, index) => {
          if (block.kind === "photo") {
            const image = known.get(block.id);
            // An id with no known dimensions still renders — the image loads,
            // the box just isn't reserved.
            return (
              <LetterPhotoBlock
                key={key}
                image={image ?? { id: block.id, width: 1280, height: 960 }}
                canMoveUp={index > 0}
                canMoveDown={index < blocks.length - 1}
                onMoveUp={() => move(index, -1)}
                onMoveDown={() => move(index, 1)}
                onRemove={() => removeAt(index)}
              />
            );
          }
          return (
            <div key={key} data-letter-text-block>
              <LetterTextBlock
                text={block.text}
                placeholder={
                  index === 0
                    ? "Dear Ada, I'm writing this while you're still small enough to fall asleep on my shoulder…"
                    : undefined
                }
                onChange={(text) => setBlock(index, text)}
                onFocus={() => {
                  insertAt.current = index + 1;
                }}
                onBlur={() => {
                  // An emptied block that isn't the only one goes away, so the
                  // letter doesn't accumulate blank gaps.
                  if (blocks.length > 1 && blocks[index]?.kind === "text") {
                    const current = blocks[index];
                    if (current.kind === "text" && current.text.trim() === "") {
                      removeAt(index);
                    }
                  }
                }}
              />
            </div>
          );
        })}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
      />

      {canUpload ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || full}
            className="text-sm font-semibold text-sea-600 hover:text-sea-800 disabled:opacity-60"
          >
            {busy ? "Adding your photo…" : "📷 Add a photo"}
          </button>
          <p className="mt-1 text-xs text-sea-500">
            {full
              ? `That's all ${IMAGES_PER_LETTER} photos for this letter.`
              : `${photoCount}/${IMAGES_PER_LETTER} photos. It lands where you're writing.`}
          </p>
        </div>
      ) : (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowUpsell(true)}
            className="text-sm font-semibold text-sea-500 hover:text-sea-700"
          >
            📷 Add a photo <span className="text-blush-400">· Pro</span>
          </button>
          {showUpsell && (
            <p className="mt-2 rounded-2xl bg-sea-100 px-4 py-3 text-sm text-sea-600">
              Photos in letters are part of Pro.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-2xl bg-blush-200 px-4 py-3 text-sm font-semibold text-blush-500">
          {error}
        </p>
      )}

      <LetterSelectionToolbar
        position={toolbar}
        onBold={() => format("bold")}
        onItalic={() => format("italic")}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `cd /Users/muzza/Projects/message-bottle && npm run typecheck && npm run lint`
Expected: both pass. The editor is not yet reachable in the UI — Task 7 wires it in.

- [ ] **Step 3: Commit**

```bash
cd /Users/muzza/Projects/message-bottle
git add src/components/letter-blocks-editor.tsx
git commit -m "Add the letter block editor

Composes text and photo blocks into the editing surface: stable keys so
a contenteditable never remounts under the caret, a selection-following
toolbar, and photo insertion at the block last focused.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Wire it into the form and delete the old input

The task that makes the feature live. After this the textarea and the visible markers are gone.

**Files:**
- Modify: `src/components/letter-form.tsx`
- Delete: `src/components/letter-image-input.tsx`

**Interfaces:**
- Consumes: `toBlocks`, `toBody`, `type LetterBlock` from `@/lib/letter-blocks`; `LetterBlocksEditor`; `type DraftImage` from `@/components/use-letter-image-upload`.
- Produces: no new exports. `LetterForm`'s props are unchanged, so `src/app/letters/new/page.tsx` and `src/app/letters/[id]/page.tsx` need no edits.

- [ ] **Step 1: Swap the textarea for the editor**

In `src/components/letter-form.tsx`:

Replace the `LetterImageInput` import with:

```tsx
import { LetterBlocksEditor } from "@/components/letter-blocks-editor";
import type { DraftImage } from "@/components/use-letter-image-upload";
import { toBlocks, toBody, type LetterBlock } from "@/lib/letter-blocks";
```

Replace the `body` state, `bodyRef`, and the whole `insertMarker` function with:

```tsx
  // The body as blocks. Serialised back to the stored string on submit, so the
  // server sees exactly what the old textarea sent.
  const [blocks, setBlocks] = useState<LetterBlock[]>(() => {
    const loaded = toBlocks(letter?.body ?? "");
    // Always something to type into.
    return loaded.length > 0 ? loaded : [{ kind: "text", text: "" }];
  });
```

Replace the `<label>`/`<textarea>`/`<LetterImageInput>` group with:

```tsx
      <div>
        <span className="field-label">Your message</span>
        {/* The body travels as the same plain string it always has. */}
        <input type="hidden" name="body" value={toBody(blocks)} />
        <LetterBlocksEditor
          blocks={blocks}
          onChange={setBlocks}
          letterId={letter?.id}
          canUpload={canUploadImages}
          existingImages={existingImages}
        />
      </div>
```

Note `htmlFor="body"` and `id="body"` are gone with the textarea — a `<span className="field-label">` replaces the `<label>`, because there is no single form control to point at. The text blocks carry their own `aria-label`.

- [ ] **Step 2: Delete the old component**

```bash
cd /Users/muzza/Projects/message-bottle
git rm src/components/letter-image-input.tsx
```

- [ ] **Step 3: Verify nothing still imports it**

Run: `cd /Users/muzza/Projects/message-bottle && grep -rn "letter-image-input" src/ ; npm run typecheck && npm run lint`
Expected: the grep prints nothing, and both checks pass. If `DraftImage` is reported missing anywhere, it should now come from `@/components/use-letter-image-upload`.

- [ ] **Step 4: Run the full checks**

Run: `cd /Users/muzza/Projects/message-bottle && npm test && npm run typecheck && npm run lint`
Expected: all pass. No test should have changed — the server contract is identical.

- [ ] **Step 5: Test it by hand in the browser**

The dev server is already running on :3000. Walk this list at `http://localhost:3000/letters/new`; check `dev.log` on any error.

- Type a paragraph, press Enter, type another. The caret must never jump to the start.
- Select a few words, press **B** in the popover. The text goes visibly bold *and stays selected*.
- Do the same with **I**, and with Cmd/Ctrl+B and Cmd/Ctrl+I.
- Paste formatted text copied from a web page. It must arrive as plain text.
- Add a photo mid-letter. It appears as the actual photograph, inline, with no `[[img:…]]` anywhere on screen.
- Move it up and down with ↑ ↓; remove it with ✕.
- Save the draft, reload the page: the letter comes back with the photo in the same place and the bold still bold.
- Open the child's `/open/<token>` page (or seal a test letter) and confirm the child sees the same thing.

- [ ] **Step 6: Commit**

```bash
cd /Users/muzza/Projects/message-bottle
git add src/components/letter-form.tsx
git commit -m "Replace the letter textarea with the block editor

Photos are photographs now, not [[img:<cuid>]] markers the parent had to
place by hand, and bold and italic show as bold and italic while typing.
The body still submits as the same plain string, so the server, the
child's renderer, and every blob-deletion path are untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Document the editor

`CLAUDE.md` still describes markers as something the author places. Bring it in step.

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none.

- [ ] **Step 1: Update the inline-images section**

In `CLAUDE.md`, find the "Inline letter images" section. Leave every sentence about storage, authorization, the age gate, and blob deletion exactly as it is — none of that changed. Append this paragraph to the end of that section:

```markdown
Authors never see the marker. `src/components/letter-blocks-editor.tsx` presents the body
as blocks — text blocks are `contenteditable` regions showing real bold and italic, photo
blocks show the photograph — and `src/lib/letter-blocks.ts` converts to and from the stored
string on every edit. The string is the format; blocks are only a view, which is what keeps
`letterImageIds` and every blob-deletion path reading exactly what they always have.

`src/lib/letter-rich-text.ts` turns the contenteditable's DOM back into that string, and it
is the security boundary: an **allowlist that emits text**, so an element it doesn't
recognise contributes only its text content and pasted markup arrives as prose. There is no
sanitizer here and no `dangerouslySetInnerHTML` — adding a tag to that walker is the only
way to widen what the editor accepts.
```

Also update the "Testing philosophy" section's list of tested libs — find the sentence listing them and add the two new ones:

```markdown
The tested libs are `age`, `letters`, `child-input`, `letter-input`, `letter-stack-style`,
`letter-blocks`, and `letter-rich-text`; `children.ts` and `prisma.ts` are DB access and
stay untested.
```

- [ ] **Step 2: Run the full checks**

Run: `cd /Users/muzza/Projects/message-bottle && npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 3: Commit and push**

```bash
cd /Users/muzza/Projects/message-bottle
git add CLAUDE.md
git commit -m "Document the letter block editor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

---

## Verification

The feature is done when all of these hold:

- `npm test && npm run typecheck && npm run lint` pass, with the pre-commit hook green on every commit.
- `src/components/letter-image-input.tsx` no longer exists, and nothing imports it.
- No `[[img:` string appears anywhere in the authoring UI.
- Loading and saving an existing draft leaves `Letter.body` byte-identical when nothing was edited (Task 1's round-trip tests guarantee the conversion; confirm once by hand in Prisma Studio).
- The child's `/open/[token]` page renders letters written in the new editor exactly as before — same paragraphs, same emphasis, same photos.
- `git diff` against the starting commit touches none of: `prisma/schema.prisma`, `src/app/actions.ts`, `src/lib/letter-body.ts`, `src/lib/letter-input.ts`, `src/components/letter-body.tsx`, `src/app/api/letter-image/[id]/route.ts`.

## Known gaps, carried from the design

- **No preview of the child's page chrome.** The editor reproduces content faithfully — paragraphs, emphasis, photos — but not the bottle, the fonts, or the paper. The cheap retrofit, if it turns out to matter, is rendering `LetterBody` inside the seal-confirmation panel above the irreversible button.
- **Contenteditable caret behaviour is the part most likely to need iteration** once the editor is in real use. The structural mitigations are in place (uncontrolled blocks, no block merging, plain-text paste, stable keys), but expect to revisit Task 4 after Task 7's manual pass.
- **`execCommand` is formally deprecated.** Removed nowhere, and the standard choice at this size. If a browser drops it, the replacement is a `Range`-based toggle behind `format()` in the editor.

# Inline Letter Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Pro parents place photos between the paragraphs of a letter, stored privately and served only to people authorized to see them.

**Architecture:** The letter body stays a plain string containing `[[img:<id>]]` markers; a pure parser turns it into nodes that a React component renders as elements (never HTML). Image bytes live in a **private** Vercel Blob store and are served exclusively by one authenticated route that re-derives the child's age gate. Uploading is gated on `User.subscription`; reading never is.

**Tech Stack:** Next.js 15 App Router, React 19 server components, Prisma 6 + Postgres, `@vercel/blob`, Tailwind, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-07-28-letter-inline-images-design.md`

## Global Constraints

- **Privacy is the point of this feature.** These are photographs of children. Any change that could expose one to someone unauthorized is a defect, not a trade-off.
- **The blob store must be created with `access: "private"`.** The mode is fixed at store creation and cannot be changed afterward — a public store can only be fixed by creating a new one.
- **Never render letter body content with `dangerouslySetInnerHTML`.** The renderer emits React elements only. This is what keeps the feature free of a sanitization surface.
- **Reading an image is never gated on subscription.** Only uploading and sealing are.
- **A `SENT` letter's images are frozen.** No cleanup path may ever delete an image belonging to a sealed letter.
- **Blob deletion order is always: blobs first, then rows.** Losing an image is visible and recoverable; leaking one is neither.
- **Rejected image requests return 404, never 403.** A 403 confirms the id exists.
- Modules under `src/lib/` import each other with **relative paths and explicit `.ts` extensions**. App code outside `src/lib/` uses `@/`.
- Validation libs return **error codes, not copy**; the caller maps a code to its message.
- Pure libs take an **injectable clock** (`now`/`at` defaulting to `new Date()`).
- Components take children-of-a-parent as **`childOptions`**, never a `children` prop.
- **Never use `git commit --no-verify`.** If the pre-commit hook fails, fix what it caught.
- Verify with `npm test && npm run typecheck && npm run lint`. **Never** `npm run build` — it runs `prisma db push --accept-data-loss` against the live database.
- Do not start a dev server; one is already running on :3000 (see `dev.log`).

## File Structure

**Pure libs (tested):**
- `src/lib/subscription.ts` — the Pro allow-list and `canUploadImages`.
- `src/lib/letter-body.ts` — the body grammar: parse to nodes, extract image ids.
- `src/lib/letter-image.ts` — image geometry, size/type validation, error copy.
- `src/lib/letter-input.ts` *(modify)* — gains the lapsed-Pro seal rule.

**Infrastructure (untested):**
- `prisma/schema.prisma` *(modify)* — `LetterImage` model, `User.subscription`.
- `src/lib/letter-image-store.ts` — the only module that talks to `@vercel/blob`.

**Server (untested):**
- `src/app/api/letter-image/[id]/route.ts` — the single authorized read path.
- `src/app/actions.ts` *(modify)* — upload action, reconciliation, cleanup.

**Client (untested):**
- `src/components/letter-body.tsx` — node renderer.
- `src/components/letter-image-input.tsx` — canvas compression + upload + strip.
- `src/components/letter-form.tsx` *(modify)* — hosts the photo strip.
- `src/components/letter-stack.tsx` *(modify)* — renders nodes instead of raw text.

---

### Task 1: The Pro gate

**Files:**
- Create: `src/lib/subscription.ts`
- Test: `src/lib/subscription.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `IMAGE_UPLOAD_TIERS: readonly string[]`, `canUploadImages(subscription: string | null | undefined): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/subscription.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canUploadImages, IMAGE_UPLOAD_TIERS } from "./subscription.ts";

describe("canUploadImages", () => {
  it("allows a PRO subscriber", () => {
    assert.equal(canUploadImages("PRO"), true);
  });

  it("refuses a user with no subscription", () => {
    assert.equal(canUploadImages(null), false);
    assert.equal(canUploadImages(undefined), false);
  });

  it("refuses an empty string", () => {
    assert.equal(canUploadImages(""), false);
  });

  it("refuses an unknown tier", () => {
    assert.equal(canUploadImages("PLUS"), false);
  });

  // The column is written by hand until billing exists, so a typo must fail
  // closed rather than quietly granting access.
  it("is case sensitive", () => {
    assert.equal(canUploadImages("pro"), false);
    assert.equal(canUploadImages(" PRO "), false);
  });

  it("names PRO as the only tier for now", () => {
    assert.deepEqual([...IMAGE_UPLOAD_TIERS], ["PRO"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/subscription.test.ts`
Expected: FAIL — cannot find module `./subscription.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/subscription.ts`:

```ts
// Which subscription tiers may use paid features. Billing doesn't exist yet —
// User.subscription is set by hand — so this is the whole entitlement story.

// Tiers allowed to upload inline letter images. Membership, not equality, so
// adding a tier later means adding a string here and nothing else.
export const IMAGE_UPLOAD_TIERS = ["PRO"] as const;

// Whether this subscription may upload images. Reading an image never consults
// this: the child opening a bottle has no account at all, and a letter sealed
// while the author was Pro must keep its photos forever.
export function canUploadImages(
  subscription: string | null | undefined,
): boolean {
  return (IMAGE_UPLOAD_TIERS as readonly string[]).includes(subscription ?? "");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/subscription.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/subscription.ts src/lib/subscription.test.ts
git commit -m "Add the subscription tier gate for image uploads"
```

---

### Task 2: The letter body grammar

**Files:**
- Create: `src/lib/letter-body.ts`
- Test: `src/lib/letter-body.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Span = { text: string; bold: boolean; italic: boolean }`, `type LetterNode = { kind: "paragraph"; spans: Span[] } | { kind: "image"; id: string }`, `parseLetterBody(body: string): LetterNode[]`, `letterImageIds(body: string): string[]`, `IMAGE_MARKER_PATTERN: RegExp`, `imageMarker(id: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/letter-body.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/letter-body.test.ts`
Expected: FAIL — cannot find module `./letter-body.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/letter-body.ts`:

```ts
// The letter body grammar. A body is a plain string — the column is unchanged
// and no letter needed migrating — carrying a deliberately tiny subset of
// Markdown plus image markers.
//
// This parser produces nodes, and src/components/letter-body.tsx turns those
// nodes into React elements. Nothing here or there ever produces HTML: user
// text always lands in a text node, so there is no sanitization surface to get
// wrong. Keep it that way.

export type Span = { text: string; bold: boolean; italic: boolean };

export type LetterNode =
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "image"; id: string };

// An image reference. Only ever a whole line — prose that happens to mention a
// marker stays prose. Ids are cuids, so letters and digits.
export const IMAGE_MARKER_PATTERN = /^\[\[img:([A-Za-z0-9]+)\]\]$/;

export function imageMarker(id: string): string {
  return `[[img:${id}]]`;
}

// Split a paragraph into styled spans.
//
// Hand-rolled rather than regex-driven because the rule that matters is the
// failure mode: an unmatched ** or * must come back as literal characters. A
// parent writing "2 * 3" or trailing off mid-word should never lose the rest of
// their letter to a greedy match.
function parseSpans(text: string): Span[] {
  const spans: Span[] = [];
  let bold = false;
  let italic = false;
  let buffer = "";

  function flush() {
    if (buffer) spans.push({ text: buffer, bold, italic });
    buffer = "";
  }

  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    const isBold = two === "**";
    const isItalic = !isBold && text[i] === "*";

    if (isBold || isItalic) {
      const marker = isBold ? "**" : "*";
      const open = isBold ? bold : italic;
      // A marker only counts if its partner exists later in the paragraph;
      // otherwise it's just an asterisk the parent typed.
      const closes = open || text.indexOf(marker, i + marker.length) !== -1;
      // An empty pair ("**" with nothing inside) is literal too.
      const empty = !open && text.slice(i + marker.length).startsWith(marker);

      if (closes && !empty) {
        flush();
        if (isBold) bold = !bold;
        else italic = !italic;
        i += marker.length;
        continue;
      }
    }

    buffer += text[i];
    i += 1;
  }

  flush();
  return spans;
}

// Turn a body into renderable nodes. Blank lines separate paragraphs; a line
// that is exactly a marker becomes an image.
export function parseLetterBody(body: string): LetterNode[] {
  const nodes: LetterNode[] = [];
  // Lines accumulated for the paragraph currently being read.
  let pending: string[] = [];

  function flushParagraph() {
    const text = pending.join("\n").trim();
    pending = [];
    if (text) nodes.push({ kind: "paragraph", spans: parseSpans(text) });
  }

  for (const line of body.split("\n")) {
    const marker = IMAGE_MARKER_PATTERN.exec(line.trim());
    if (marker) {
      // An image ends the paragraph it interrupts, so text never merges across
      // a photo.
      flushParagraph();
      nodes.push({ kind: "image", id: marker[1] });
      continue;
    }
    if (line.trim() === "") flushParagraph();
    else pending.push(line);
  }
  flushParagraph();

  return nodes;
}

// Every image id the body references, in order, without repeats.
//
// Cleanup uses this to decide what is still referenced, and the renderer uses
// the same parser to decide what to show — so the two can never disagree about
// which images a letter contains.
export function letterImageIds(body: string): string[] {
  const ids = parseLetterBody(body)
    .filter((node) => node.kind === "image")
    .map((node) => node.id);
  return [...new Set(ids)];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/letter-body.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/letter-body.ts src/lib/letter-body.test.ts
git commit -m "Add the letter body grammar for markers and emphasis"
```

---

### Task 3: Image geometry and validation

**Files:**
- Create: `src/lib/letter-image.ts`
- Test: `src/lib/letter-image.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `IMAGE_MAX_DIMENSION`, `IMAGE_MAX_BYTES`, `IMAGE_MAX_UPLOAD_BYTES`, `IMAGE_MIME_TYPES`, `IMAGE_QUALITY_LADDER`, `IMAGES_PER_LETTER`, `fitDimensions(width, height): { width: number; height: number }`, `downscaleSteps(from: number, to?: number): number[]`, `type LetterImageError`, `validateUpload(input: { mimeType: string; bytes: number; width: number; height: number }): { ok: true } | { ok: false; error: LetterImageError }`, `letterImageMessage(error: LetterImageError): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/letter-image.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  downscaleSteps,
  fitDimensions,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_DIMENSION,
  letterImageMessage,
  validateUpload,
  type LetterImageError,
} from "./letter-image.ts";

describe("fitDimensions", () => {
  it("caps a landscape source on its width", () => {
    assert.deepEqual(fitDimensions(4000, 3000), { width: 1280, height: 960 });
  });

  it("caps a portrait source on its height", () => {
    assert.deepEqual(fitDimensions(3000, 4000), { width: 960, height: 1280 });
  });

  it("caps a square source on both", () => {
    assert.deepEqual(fitDimensions(2000, 2000), { width: 1280, height: 1280 });
  });

  // Unlike the avatar path there is no crop and no upscale: a letter photo
  // keeps its shape, and a small source is stored as-is.
  it("passes a source under the cap through untouched", () => {
    assert.deepEqual(fitDimensions(800, 600), { width: 800, height: 600 });
  });

  it("passes a source exactly at the cap through untouched", () => {
    assert.deepEqual(fitDimensions(1280, 720), { width: 1280, height: 720 });
  });

  it("never rounds a dimension to zero", () => {
    assert.deepEqual(fitDimensions(4000, 3), { width: 1280, height: 1 });
  });
});

describe("downscaleSteps", () => {
  it("halves repeatedly until within 2x, then lands on target", () => {
    assert.deepEqual(downscaleSteps(4000, 1280), [2000, 1280]);
  });

  it("goes straight to target when already within 2x", () => {
    assert.deepEqual(downscaleSteps(2000, 1280), [1280]);
  });

  it("goes straight to target at exactly 2x", () => {
    assert.deepEqual(downscaleSteps(2560, 1280), [1280]);
  });

  it("returns a single no-op step when already at target", () => {
    assert.deepEqual(downscaleSteps(1280, 1280), [1280]);
  });

  it("defaults to the max dimension", () => {
    assert.deepEqual(downscaleSteps(4000), downscaleSteps(4000, IMAGE_MAX_DIMENSION));
  });
});

describe("validateUpload", () => {
  const valid = {
    mimeType: "image/webp",
    bytes: 200 * 1024,
    width: 1280,
    height: 960,
  };

  it("accepts a compressed photo", () => {
    assert.deepEqual(validateUpload(valid), { ok: true });
  });

  it("accepts jpeg, which canvas may hand back instead of webp", () => {
    assert.deepEqual(validateUpload({ ...valid, mimeType: "image/jpeg" }), {
      ok: true,
    });
  });

  it("rejects a type we don't store", () => {
    assert.deepEqual(validateUpload({ ...valid, mimeType: "image/gif" }), {
      ok: false,
      error: "IMAGE_NOT_AN_IMAGE",
    });
  });

  it("rejects a non-image entirely", () => {
    assert.deepEqual(validateUpload({ ...valid, mimeType: "application/pdf" }), {
      ok: false,
      error: "IMAGE_NOT_AN_IMAGE",
    });
  });

  it("accepts a payload exactly at the cap", () => {
    assert.deepEqual(validateUpload({ ...valid, bytes: IMAGE_MAX_BYTES }), {
      ok: true,
    });
  });

  it("rejects a payload over the cap", () => {
    assert.deepEqual(validateUpload({ ...valid, bytes: IMAGE_MAX_BYTES + 1 }), {
      ok: false,
      error: "IMAGE_TOO_LARGE",
    });
  });

  it("rejects an empty payload", () => {
    assert.deepEqual(validateUpload({ ...valid, bytes: 0 }), {
      ok: false,
      error: "IMAGE_MALFORMED",
    });
  });

  // The client promises to downscale, but the client is not a trust boundary.
  it("rejects dimensions past the cap", () => {
    assert.deepEqual(validateUpload({ ...valid, width: 1281 }), {
      ok: false,
      error: "IMAGE_MALFORMED",
    });
    assert.deepEqual(validateUpload({ ...valid, height: 4000 }), {
      ok: false,
      error: "IMAGE_MALFORMED",
    });
  });

  it("rejects a zero dimension", () => {
    assert.deepEqual(validateUpload({ ...valid, width: 0 }), {
      ok: false,
      error: "IMAGE_MALFORMED",
    });
  });
});

describe("letterImageMessage", () => {
  it("returns a message for every error code", () => {
    const codes: LetterImageError[] = [
      "IMAGE_NOT_AN_IMAGE",
      "IMAGE_MALFORMED",
      "IMAGE_TOO_LARGE",
      "IMAGE_TOO_LARGE_TO_READ",
      "IMAGE_TOO_MANY",
      "IMAGE_NOT_PRO",
    ];
    for (const code of codes) {
      assert.equal(typeof letterImageMessage(code), "string");
      assert.ok(letterImageMessage(code).length > 0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/letter-image.test.ts`
Expected: FAIL — cannot find module `./letter-image.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/letter-image.ts`:

```ts
// Pure geometry and validation for inline letter images. Kept free of canvas,
// File, and the DOM so the rules can be tested with plain numbers and strings.
// The canvas work that uses these lives in
// src/components/letter-image-input.tsx.
//
// Sibling of child-photo.ts, with one deliberate difference: an avatar is
// cropped to a fixed square, a letter photo keeps its shape.

// Long-edge cap for a stored image. Letter content renders at most ~640px
// wide, so 1280 is exactly 2x for a retina display and stores nothing the UI
// can show.
export const IMAGE_MAX_DIMENSION = 1280;

// Encoded byte cap for one stored image. A quality-0.82 WebP at 1280px lands
// around 150-350 KB.
export const IMAGE_MAX_BYTES = 600 * 1024;

// Pre-decode guard on the file the parent picked, so a stray huge file can't
// hang the tab before we ever look at it.
export const IMAGE_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// What we accept as a stored image. WebP is what we ask the browser to encode;
// JPEG is here because canvas.toBlob may hand back its own type.
export const IMAGE_MIME_TYPES = ["image/webp", "image/jpeg"] as const;

// Encode qualities tried in order, stopping at the first result under the cap.
export const IMAGE_QUALITY_LADDER = [0.82, 0.7, 0.6] as const;

// Cap per letter. Bounds both the reconciliation cost on save and how much one
// letter can put in the store.
export const IMAGES_PER_LETTER = 12;

// The stored size for a source image: aspect ratio preserved, long edge capped.
// A source already within the cap is left alone rather than upscaled — there is
// no detail to invent, and storing it as-is keeps it sharp.
export function fitDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= IMAGE_MAX_DIMENSION) return { width, height };

  const scale = IMAGE_MAX_DIMENSION / longest;
  return {
    // A very long, thin source could otherwise round its short edge to zero,
    // which would make an un-drawable canvas.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// The ladder of long-edge sizes to draw through on the way down to `to`.
//
// Browsers don't box-filter when drawing at extreme ratios, so scaling a
// 4000px photo straight down in one step aliases badly. Halving repeatedly
// while we're more than 2x away costs a few extra draws and is visibly
// sharper.
export function downscaleSteps(
  from: number,
  to: number = IMAGE_MAX_DIMENSION,
): number[] {
  const steps: number[] = [];
  let current = from;
  while (current > to * 2) {
    current = Math.max(Math.round(current / 2), to);
    steps.push(current);
  }
  if (steps.at(-1) !== to) steps.push(to);
  return steps;
}

// Why an image was rejected. Codes rather than copy, so tests assert on rules
// and wording stays free to change.
export type LetterImageError =
  | "IMAGE_NOT_AN_IMAGE"
  | "IMAGE_MALFORMED"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_TOO_LARGE_TO_READ"
  | "IMAGE_TOO_MANY"
  | "IMAGE_NOT_PRO";

export type UploadValidation =
  | { ok: true }
  | { ok: false; error: LetterImageError };

export function letterImageMessage(error: LetterImageError): string {
  switch (error) {
    case "IMAGE_NOT_AN_IMAGE":
      return "That file doesn't look like a photo we can use.";
    case "IMAGE_MALFORMED":
      return "We couldn't read that photo. Try picking it again.";
    case "IMAGE_TOO_LARGE":
      return "That photo is too large, even after shrinking it.";
    case "IMAGE_TOO_LARGE_TO_READ":
      return "That file is too big to open. Try a smaller photo.";
    case "IMAGE_TOO_MANY":
      return `A letter can hold up to ${IMAGES_PER_LETTER} photos.`;
    case "IMAGE_NOT_PRO":
      return "Photos in letters are part of Pro.";
  }
}

// Validate what the browser uploaded.
//
// The client downscales and compresses before sending, but that's a UX
// convenience and never a trust boundary — anyone can POST to a server action,
// so every one of these checks has to hold here on its own.
export function validateUpload(input: {
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
}): UploadValidation {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return { ok: false, error: "IMAGE_NOT_AN_IMAGE" };
  }
  if (!Number.isInteger(input.bytes) || input.bytes <= 0) {
    return { ok: false, error: "IMAGE_MALFORMED" };
  }
  if (input.bytes > IMAGE_MAX_BYTES) {
    return { ok: false, error: "IMAGE_TOO_LARGE" };
  }

  const { width, height } = input;
  const sane = [width, height].every(
    (n) => Number.isInteger(n) && n > 0 && n <= IMAGE_MAX_DIMENSION,
  );
  if (!sane) return { ok: false, error: "IMAGE_MALFORMED" };

  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/letter-image.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/letter-image.ts src/lib/letter-image.test.ts
git commit -m "Add geometry and validation for inline letter images"
```

---

### Task 4: The lapsed-Pro sealing rule

**Files:**
- Modify: `src/lib/letter-input.ts`
- Test: `src/lib/letter-input.test.ts` (existing — add cases)

**Interfaces:**
- Consumes: nothing.
- Produces: `parseLetterInput` gains a third parameter `context: { hasImages: boolean; mayHoldImages: boolean }`; `LetterInputError` gains `"SEND_IMAGES_NOT_ALLOWED"`.

**Context:** `parseLetterInput(raw, intent)` currently takes two arguments and is called once, in `saveLetter` in `src/app/actions.ts`. Adding a required third parameter is deliberate — it makes every call site state the entitlement rather than defaulting to permissive.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/letter-input.test.ts`. Note the existing tests call `parseLetterInput(values, intent)` with two arguments; they must all gain a third. Add this helper near the top of the file and update existing calls to use it:

```ts
// Default context: the author may hold images and this letter has none. Cases
// about the Pro rule pass their own.
const anyone = { hasImages: false, mayHoldImages: true };
```

Then add this suite:

```ts
describe("images and sealing", () => {
  const complete = { title: "T", childId: "c1", body: "Hello" };

  it("seals a letter with images when the author may hold them", () => {
    const result = parseLetterInput(complete, "submit", {
      hasImages: true,
      mayHoldImages: true,
    });
    assert.equal(result.ok, true);
  });

  it("seals a letter with no images regardless of entitlement", () => {
    const result = parseLetterInput(complete, "submit", {
      hasImages: false,
      mayHoldImages: false,
    });
    assert.equal(result.ok, true);
  });

  // A subscription that lapsed mid-draft.
  it("refuses to seal a letter holding images the author may no longer hold", () => {
    const result = parseLetterInput(complete, "submit", {
      hasImages: true,
      mayHoldImages: false,
    });
    assert.deepEqual(result, { ok: false, error: "SEND_IMAGES_NOT_ALLOWED" });
  });

  // Sealing is blocked, but the parent must never be locked out of their own
  // unsent words.
  it("still saves that letter as a draft", () => {
    const result = parseLetterInput(complete, "draft", {
      hasImages: true,
      mayHoldImages: false,
    });
    assert.equal(result.ok, true);
  });

  // An incomplete letter is incomplete first — reporting the image problem
  // would send the parent looking for photos in an empty letter.
  it("reports incompleteness before the image rule", () => {
    const result = parseLetterInput({ ...complete, body: "" }, "submit", {
      hasImages: true,
      mayHoldImages: false,
    });
    assert.deepEqual(result, { ok: false, error: "SEND_INCOMPLETE" });
  });
});
```

Also extend the existing `letterInputMessage` "returns a message for every error code" test to include `"SEND_IMAGES_NOT_ALLOWED"` in its list of codes.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/letter-input.test.ts`
Expected: FAIL — the new suite gets `ok: true` where it expects `SEND_IMAGES_NOT_ALLOWED`, and typecheck complains about the third argument.

- [ ] **Step 3: Write the implementation**

In `src/lib/letter-input.ts`, add the error code to the union:

```ts
export type LetterInputError =
  | "SEND_INCOMPLETE"
  | "DRAFT_NEEDS_TITLE"
  | "SEND_IMAGES_NOT_ALLOWED";
```

Add its message to `letterInputMessage`:

```ts
    case "SEND_IMAGES_NOT_ALLOWED":
      return "This letter has photos, which are part of Pro. Remove them to seal it, or renew to keep them.";
```

Add the context type and the rule. Replace the `parseLetterInput` signature and the sealing branch:

```ts
// What the author is currently entitled to, and what this letter holds.
// Passed in rather than read here so the rule stays pure and testable.
export type LetterImageContext = {
  // Whether the submitted body references any images.
  hasImages: boolean;
  // Whether the author's subscription currently covers holding images.
  mayHoldImages: boolean;
};

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
    // A subscription that lapsed mid-draft blocks sealing, not saving — the
    // parent keeps their words and chooses whether to drop the photos or renew.
    if (context.hasImages && !context.mayHoldImages) {
      return { ok: false, error: "SEND_IMAGES_NOT_ALLOWED" };
    }
  } else if (!title) {
    return { ok: false, error: "DRAFT_NEEDS_TITLE" };
  }

  return { ok: true, value: { title, childId, body, sealing } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/letter-input.test.ts`
Expected: PASS, all tests.

Note: `npm run typecheck` will now fail on `src/app/actions.ts`, which still calls `parseLetterInput` with two arguments. **Do not** paper over this with a hardcoded permissive placeholder — a commit containing `mayHoldImages: true` is a hardcoded auth bypass, however briefly it lives.

The real call site needs `User.subscription`, which Task 5 adds. So the call-site update is deferred to Task 5 Step 3a, and **this task's commit is expected to leave typecheck failing on that one call**. That is the deliberate cost of not committing a permissive default.

Commit this task with `npm test` green and note the known typecheck failure in your report. The pre-commit hook runs typecheck and will block the commit — so commit the lib and its tests together with the call-site fix in Task 5 instead. Concretely: **do not commit at the end of this task.** Leave the working tree dirty, report DONE_WITH_CONCERNS naming the pending call site, and Task 5 makes the single green commit covering both.

- [ ] **Step 5: Verify tests, and stop without committing**

Run: `npm test`
Expected: all pass, including the new cases.

Run: `npm run typecheck`
Expected: **one failure** in `src/app/actions.ts` — `parseLetterInput` called with 2 arguments, 3 expected. This is the known, deliberate state described in Step 4.

Do not commit. Do not add a placeholder argument to silence it. Leave the working tree dirty and report `DONE_WITH_CONCERNS`, naming the failing call site. Task 5 commits this work together with the real call-site fix.

---

### Task 5: Schema and the blob store

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/letter-image-store.ts`
- Modify: `.env.example` (create if absent)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `LetterImage` and `User.subscription`; `putLetterImage(input: { authorId: string; body: Buffer | Uint8Array; mimeType: string }): Promise<{ pathname: string }>`, `getLetterImage(pathname: string): Promise<ReadableStream | null>`, `deleteLetterImages(pathnames: string[]): Promise<void>`.

**This task contains the one configuration step that cannot be undone.** The blob store's access mode is fixed at creation.

- [ ] **Step 1: Install the SDK**

```bash
npm install @vercel/blob
```

- [ ] **Step 2: Create the private blob store**

This is a manual step in the Vercel dashboard, and the **access mode cannot be changed afterward**:

1. Vercel dashboard → Storage → Create Database → Blob.
2. **Set access to Private.** A store created public can only be fixed by creating a new store and re-uploading every image.
3. Connect it to this project.
4. Locally: `vercel env pull .env.local` to get `BLOB_READ_WRITE_TOKEN`.

On Vercel, Functions authenticate with a short-lived auto-rotating OIDC token scoped to the project, so no static token sits in the production environment. The pulled token is for local development only.

Record the requirement in `.env.example`:

```
# Vercel Blob. The store MUST be created with private access — the mode is
# fixed at creation and cannot be changed. Local development only; on Vercel,
# Functions authenticate with a short-lived OIDC token instead.
BLOB_READ_WRITE_TOKEN=
```

- [ ] **Step 3: Add the schema**

In `prisma/schema.prisma`, add to `model User`:

```prisma
  // Subscription tier. Null means free. Read through canUploadImages in
  // src/lib/subscription.ts — never compared directly — so adding a tier is a
  // one-line change there. Set by hand until billing exists.
  subscription String?
  letterImages LetterImage[]
```

Add to `model Letter`:

```prisma
  images LetterImage[]
```

Add the model:

```prisma
// A photo placed inline in a letter body, referenced from the body text by a
// `[[img:<id>]]` marker. The bytes live in a private blob store and are only
// ever served through /api/letter-image/[id], which authorizes every request.
model LetterImage {
  id       String @id @default(cuid())
  // Pathname in the private blob store. Never a public URL — a private store
  // is unreadable by URL at all, which is the point.
  pathname String @unique
  // The stored size, so the renderer can reserve the aspect box before the
  // bytes arrive and the child's page doesn't jump as photos load.
  width    Int
  height   Int
  bytes    Int
  mimeType String
  // Null while the image belongs to a new letter that hasn't been saved yet.
  // Set on the letter's first save. Cascade removes the row with the letter,
  // but NOT the blob — blob deletion is always explicit.
  letter   Letter? @relation(fields: [letterId], references: [id], onDelete: Cascade)
  letterId String?
  // The uploader. Both the upload gate and the orphan sweep hang off this.
  author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)
  authorId String

  createdAt DateTime @default(now())

  @@index([letterId])
  // The orphan sweep queries one author's unattached rows by age.
  @@index([authorId, createdAt])
}
```

- [ ] **Step 4: Apply the schema**

Run: `npm run db:push`
Expected: the two models sync. Both changes are additive — existing letters have no images and every existing user is free — so there is no backfill.

- [ ] **Step 4a: Wire the real entitlement into `saveLetter`**

Task 4 left `parseLetterInput`'s third argument unwired because the column it reads didn't exist yet. It does now. In `src/app/actions.ts`, add the imports:

```ts
import { canUploadImages } from "@/lib/subscription";
import { letterImageIds } from "@/lib/letter-body";
```

Then replace the `parseLetterInput` call in `saveLetter` with the real lookup:

```ts
  const body = String(formData.get("body") ?? "");
  const author = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { subscription: true },
  });

  const parsed = parseLetterInput(
    {
      title: String(formData.get("title") ?? ""),
      childId: String(formData.get("childId") ?? ""),
      body,
    },
    parseLetterIntent(String(formData.get("intent") ?? "")),
    {
      hasImages: letterImageIds(body).length > 0,
      mayHoldImages: canUploadImages(author?.subscription),
    },
  );
```

Task 7 adds reconciliation to this same function but does not change this call.

- [ ] **Step 4b: Raise the server action body limit**

A compressed image can reach 600 KB, and Next's server actions default to a 1 MB body — too close for comfort once form fields are added. In `next.config.ts` (or `.mjs`), set:

```ts
  experimental: {
    serverActions: {
      // One compressed letter image is capped at 600 KB; this leaves room for
      // it plus form fields without an opaque 413.
      bodySizeLimit: "2mb",
    },
  },
```

If the config file has no `experimental` key, add it alongside the existing exported config object rather than replacing it.

- [ ] **Step 5: Write the store wrapper**

Create `src/lib/letter-image-store.ts`:

```ts
// The only module that talks to blob storage. Everything else goes through
// these three functions, so the privacy rules live in one readable place.
//
// The store is created with private access, which is fixed at creation and
// cannot be changed. Private means blobs are unreadable by URL: the only way
// to a byte is through a Function that authorized the request first, which is
// src/app/api/letter-image/[id]/route.ts.
//
// Untested by design — it is a thin wrapper over a network service, and the
// rules worth testing live in letter-image.ts.

import { del, get, put } from "@vercel/blob";
import { randomBytes } from "crypto";

const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

export async function putLetterImage(input: {
  authorId: string;
  body: Buffer | Uint8Array;
  mimeType: string;
}): Promise<{ pathname: string }> {
  const extension = EXTENSIONS[input.mimeType] ?? "bin";
  // Scoped by author and randomized. The store is private so a pathname is
  // never a credential, but an unguessable one costs nothing.
  const name = randomBytes(16).toString("base64url");
  const blob = await put(
    `letters/${input.authorId}/${name}.${extension}`,
    input.body,
    { access: "private", addRandomSuffix: true, contentType: input.mimeType },
  );
  return { pathname: blob.pathname };
}

// Read a stored image. Callers MUST authorize the request first.
export async function getLetterImage(
  pathname: string,
): Promise<ReadableStream | null> {
  const result = await get(pathname);
  return result?.stream ?? null;
}

// Remove images from storage. Called before deleting the rows that point at
// them, so a failure leaves a row pointing at a missing image (which renders
// as a skipped photo) rather than a photo nobody references.
//
// Never throws: a blob that is already gone, or a store hiccup, must not stop
// a parent from deleting their draft or their child.
export async function deleteLetterImages(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) return;
  try {
    await del(pathnames);
  } catch (error) {
    console.error("Failed to delete letter images", { pathnames, error });
  }
}
```

- [ ] **Step 6: Document the store in CLAUDE.md**

Add to the Architecture section, after "The two invariants":

```markdown
### Inline letter images

Letter bodies may contain `[[img:<id>]]` markers referencing `LetterImage` rows. The bytes
live in a **private** Vercel Blob store — unreadable by URL — and are served only by
`/api/letter-image/[id]`, which authorizes every request as the author, a co-parent with
access to the child, or the child themselves via `openToken` **after the age gate passes**.
The time lock covers photos exactly as it covers text.

Uploading is gated on `User.subscription` through `canUploadImages`; **reading never is**,
because the child has no account and a sealed letter must keep its photos forever.

Blob deletion is never automatic. `onDelete: Cascade` removes `LetterImage` rows with their
letter but leaves the bytes, so every path that deletes letters — `deleteLetter`,
`deleteChild`, save-time reconciliation, and the orphan sweep — must delete blobs
explicitly, **blobs first, then rows**.
```

- [ ] **Step 7: Verify and commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

This commit also carries Task 4's uncommitted work, which was held back rather than committed with a placeholder auth value.

```bash
git add prisma/schema.prisma src/lib/letter-image-store.ts .env.example CLAUDE.md \
  package.json package-lock.json next.config.ts \
  src/lib/letter-input.ts src/lib/letter-input.test.ts src/app/actions.ts
git commit -m "Add LetterImage, the subscription column, and the private blob store"
```

---

### Task 6: The authorized image route

**Files:**
- Create: `src/app/api/letter-image/[id]/route.ts`

**Interfaces:**
- Consumes: `getLetterImage` from Task 5; `canAccessChild` from `src/lib/children.ts`; `hasReachedOpenAge` from `src/lib/age.ts`.
- Produces: `GET /api/letter-image/<id>[?t=<openToken>]`.

**This route is the entire read path for every image in the application.** Nothing else serves image bytes.

- [ ] **Step 1: Write the route**

Create `src/app/api/letter-image/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessChild } from "@/lib/children";
import { hasReachedOpenAge } from "@/lib/age";
import { getLetterImage } from "@/lib/letter-image-store";

// The only way to an inline letter image. Private blob storage makes the bytes
// unreachable by URL, so every request for a photo of a child arrives here and
// is authorized before anything is read.
//
// Every rejection is a 404, never a 403: a 403 would confirm the id exists.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const image = await prisma.letterImage.findUnique({
    where: { id },
    select: {
      pathname: true,
      mimeType: true,
      authorId: true,
      letter: {
        select: {
          status: true,
          childId: true,
          child: {
            select: { openToken: true, birthday: true, openAtAge: true },
          },
        },
      },
    },
  });
  if (!image) return notFound();

  if (!(await isAuthorized(request, image))) return notFound();

  const stream = await getLetterImage(image.pathname);
  if (!stream) return notFound();

  return new NextResponse(stream, {
    headers: {
      "Content-Type": image.mimeType,
      // Never "public". Vercel's CDN caches Function responses, and a cached
      // authorized response served to the next requester would defeat every
      // check above.
      "Cache-Control": "private, no-store",
      // These are photographs of children; keep them out of other origins'
      // documents entirely.
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type ImageRecord = {
  authorId: string;
  letter: {
    status: string;
    childId: string | null;
    child: {
      openToken: string | null;
      birthday: Date;
      openAtAge: number;
    } | null;
  } | null;
};

async function isAuthorized(
  request: Request,
  image: ImageRecord,
): Promise<boolean> {
  const session = await auth();
  const viewerId = session?.user?.id;

  // 1. The author, who may be mid-draft.
  if (viewerId && viewerId === image.authorId) return true;

  // 2. A co-parent with access to the child this letter is addressed to.
  //    Reuses the shared helper rather than replicating the OR clause.
  if (viewerId && image.letter?.childId) {
    if (await canAccessChild(viewerId, image.letter.childId)) return true;
  }

  // 3. The child, holding their own open link.
  return childMayRead(request, image);
}

// The time lock, re-derived here from the child row.
//
// The rule is that the server never ships letter content before the age gate,
// and an inline photograph is letter content. /open/[token] already refuses to
// render bodies while locked, but this route is directly addressable — so it
// has to check for itself, and it never trusts a client-supplied claim about
// age or unlock state.
function childMayRead(request: Request, image: ImageRecord): boolean {
  const child = image.letter?.child;
  if (!child?.openToken) return false;

  // An <img> can't send a header, so the token rides in the query string. It
  // exposes nothing new: the same token is already the credential in the page
  // URL this image is embedded on.
  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  if (!token || token !== child.openToken) return false;

  // Only sealed letters ever reach a child.
  if (image.letter?.status !== "SENT") return false;

  // The documented testing bypass, inert unless the deployment sets it.
  const testing =
    process.env.TESTING === "true" && url.searchParams.get("test") === "yes";
  if (testing) return true;

  return hasReachedOpenAge(child.birthday, child.openAtAge);
}

function notFound() {
  return new NextResponse(null, { status: 404 });
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run typecheck && npm run lint`
Expected: both pass.

- [ ] **Step 3: Verify the authorization by reading it against the four cases**

No automated test — this needs a session, a database, and a request, which per the project's testing philosophy means it isn't unit-tested. Confirm by reading:

1. The author of the image gets bytes.
2. A signed-in co-parent with `canAccessChild` gets bytes.
3. A request with a correct `?t=` gets bytes **only if** the letter is `SENT` **and** `hasReachedOpenAge` passes (or the `TESTING` bypass is active).
4. Everything else — no session, wrong token, right token but locked, right token but a draft — gets 404.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/letter-image/[id]/route.ts"
git commit -m "Serve letter images only through an authorized, age-gated route"
```

---

### Task 7: Upload, reconciliation, and cleanup

**Files:**
- Modify: `src/app/actions.ts`

**Interfaces:**
- Consumes: `canUploadImages` (Task 1), `letterImageIds` (Task 2), `validateUpload`/`IMAGES_PER_LETTER`/`letterImageMessage` (Task 3), `parseLetterInput` (Task 4), `putLetterImage`/`deleteLetterImages` (Task 5).
- Produces: `uploadLetterImage(prev, formData): Promise<LetterImageState>` where `LetterImageState = { error?: string; image?: { id: string; width: number; height: number } }`; `sweepOrphanedImages(authorId: string): Promise<void>`.

- [ ] **Step 1: Add the upload action**

In `src/app/actions.ts`, add these imports. `canUploadImages` and `letterImageIds` are already imported by Task 5 — don't duplicate them.

```ts
import {
  IMAGE_MAX_UPLOAD_BYTES,
  IMAGES_PER_LETTER,
  letterImageMessage,
  validateUpload,
} from "@/lib/letter-image";
import {
  deleteLetterImages,
  putLetterImage,
} from "@/lib/letter-image-store";
```

Add the action:

```ts
export type LetterImageState = {
  error?: string;
  image?: { id: string; width: number; height: number };
};

// Store one compressed image and hand back the id the client writes into the
// body as a [[img:<id>]] marker.
//
// Uploading is the Pro-gated half of this feature. The button is hidden for
// free users, but that is UX — this check is the boundary, because anyone can
// POST to a server action.
export async function uploadLetterImage(
  _prev: LetterImageState,
  formData: FormData,
): Promise<LetterImageState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in to add a photo." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { subscription: true },
  });
  if (!canUploadImages(user?.subscription)) {
    return { error: letterImageMessage("IMAGE_NOT_PRO") };
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { error: letterImageMessage("IMAGE_MALFORMED") };
  }
  if (file.size > IMAGE_MAX_UPLOAD_BYTES) {
    return { error: letterImageMessage("IMAGE_TOO_LARGE_TO_READ") };
  }

  const width = Number(formData.get("width"));
  const height = Number(formData.get("height"));
  const check = validateUpload({
    mimeType: file.type,
    bytes: file.size,
    width,
    height,
  });
  if (!check.ok) return { error: letterImageMessage(check.error) };

  // A letter id is present when editing a saved draft, absent for a letter
  // that hasn't been saved yet — those rows start unattached and are claimed
  // on first save.
  const letterId = String(formData.get("letterId") ?? "").trim();
  let attachedTo: string | null = null;
  if (letterId) {
    const letter = await prisma.letter.findFirst({
      where: { id: letterId, authorId: session.user.id, status: "DRAFT" },
      select: { id: true, _count: { select: { images: true } } },
    });
    if (!letter) return { error: "That draft can't be edited anymore." };
    if (letter._count.images >= IMAGES_PER_LETTER) {
      return { error: letterImageMessage("IMAGE_TOO_MANY") };
    }
    attachedTo = letter.id;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { pathname } = await putLetterImage({
    authorId: session.user.id,
    body: buffer,
    mimeType: file.type,
  });

  const image = await prisma.letterImage.create({
    data: {
      pathname,
      width,
      height,
      bytes: buffer.byteLength,
      mimeType: file.type,
      authorId: session.user.id,
      letterId: attachedTo,
    },
    select: { id: true, width: true, height: true },
  });

  return { image };
}
```

- [ ] **Step 2: Add reconciliation and the sweep**

Add these helpers to `src/app/actions.ts`:

```ts
// Delete images belonging to this letter that its body no longer references,
// and claim any the author uploaded before the letter existed.
//
// The body is the authority on what is referenced, so this is exact rather
// than heuristic. It covers both "the author removed a marker" and "the author
// uploaded a photo then changed their mind mid-edit".
//
// Sealing runs this one last time; after that the letter's images are frozen
// with it and nothing may touch them again.
async function reconcileLetterImages(input: {
  letterId: string;
  authorId: string;
  body: string;
}): Promise<void> {
  const referenced = new Set(letterImageIds(input.body));

  // Claim rows uploaded for this letter before it had an id. Only ids the body
  // actually references, so an abandoned upload stays unattached and is swept.
  const unattached = [...referenced];
  if (unattached.length > 0) {
    await prisma.letterImage.updateMany({
      where: {
        id: { in: unattached },
        authorId: input.authorId,
        letterId: null,
      },
      data: { letterId: input.letterId },
    });
  }

  const attached = await prisma.letterImage.findMany({
    where: { letterId: input.letterId },
    select: { id: true, pathname: true },
  });
  const stale = attached.filter((image) => !referenced.has(image.id));
  if (stale.length === 0) return;

  // Blobs first, then rows: a failure here leaves a row pointing at a missing
  // image, which renders as a skipped photo. The other order would leave a
  // photograph in storage with nothing referencing it.
  await deleteLetterImages(stale.map((image) => image.pathname));
  await prisma.letterImage.deleteMany({
    where: { id: { in: stale.map((image) => image.id) } },
  });
}

// How long an unattached image may sit before it counts as abandoned. Generous
// on purpose: a parent may leave a half-written letter open overnight, and
// nothing is user-visible during the window.
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Delete images uploaded for a letter that was never saved.
//
// Reconciliation handles every image whose letter got saved; this handles the
// tab that was closed first, where no save ever ran. Rides on a page load that
// already queries this author's letters — no cron, no scheduled function.
//
// Only ever touches unattached rows, so a sealed letter's images are out of
// reach by construction.
export async function sweepOrphanedImages(authorId: string): Promise<void> {
  const orphans = await prisma.letterImage.findMany({
    where: {
      authorId,
      letterId: null,
      createdAt: { lt: new Date(Date.now() - ORPHAN_MAX_AGE_MS) },
    },
    select: { id: true, pathname: true },
    take: 100,
  });
  if (orphans.length === 0) return;

  await deleteLetterImages(orphans.map((image) => image.pathname));
  await prisma.letterImage.deleteMany({
    where: { id: { in: orphans.map((image) => image.id) } },
  });
}
```

- [ ] **Step 3: Reconcile images when a letter is saved**

Task 5 already wired the entitlement lookup into `saveLetter`; leave that call alone. This step only adds reconciliation after the letter is written.

In the update branch, after the `result.count === 0` check:

```ts
    await reconcileLetterImages({
      letterId: id,
      authorId: session.user.id,
      body: parsed.value.body,
    });
```

And in the create branch, capture the created letter so it can be reconciled:

```ts
  } else {
    const created = await prisma.letter.create({
      data: { ...data, authorId: session.user.id },
      select: { id: true },
    });
    await reconcileLetterImages({
      letterId: created.id,
      authorId: session.user.id,
      body: parsed.value.body,
    });
  }
```

- [ ] **Step 4: Delete blobs in `deleteLetter`**

Replace the body of `deleteLetter` after the id check:

```ts
  // Only a draft the current user owns. Once sent, a letter is sealed forever
  // and can't be removed.
  const draft = await prisma.letter.findFirst({
    where: { id, authorId: session.user.id, status: "DRAFT" },
    select: { id: true, images: { select: { pathname: true } } },
  });
  if (!draft) return;

  // Blobs first: the cascade will take the rows, but never the bytes.
  await deleteLetterImages(draft.images.map((image) => image.pathname));
  await prisma.letter.delete({ where: { id: draft.id } });
```

- [ ] **Step 5: Delete blobs in `deleteChild`**

In `deleteChild`, replace the transaction with a blob-deleting version. Without this, photographs of a child outlive an explicit "delete this child" — the most serious leak this feature could introduce.

```ts
  // Every letter written to this child, from every co-parent, drafts and
  // sealed alike — and the photos inside them.
  const images = await prisma.letterImage.findMany({
    where: { letter: { childId: child.id } },
    select: { pathname: true },
  });

  // Blobs first, then rows. A failure after this leaves rows pointing at
  // missing images; the other order would leave photographs of a child in
  // storage after their parent deleted them.
  await deleteLetterImages(images.map((image) => image.pathname));

  await prisma.$transaction([
    prisma.letter.deleteMany({ where: { childId: child.id } }),
    prisma.child.delete({ where: { id: child.id } }),
  ]);
```

- [ ] **Step 6: Call the sweep from the dashboard**

In `src/app/dashboard/page.tsx`, after the session check and alongside the existing letter queries, add:

```ts
  // Clean up images from letters that were never saved. Rides on a page load
  // that already queries this author's letters.
  await sweepOrphanedImages(session.user.id);
```

Import it from `@/app/actions`.

- [ ] **Step 7: Verify and commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

```bash
git add src/app/actions.ts src/app/dashboard/page.tsx
git commit -m "Upload, reconcile, and clean up inline letter images"
```

---

### Task 8: Rendering letter bodies

**Files:**
- Create: `src/components/letter-body.tsx`
- Modify: `src/components/letter-stack.tsx`
- Modify: `src/app/open/[token]/page.tsx`

**Interfaces:**
- Consumes: `parseLetterBody`, `LetterNode`, `Span` (Task 2).
- Produces: `<LetterBody body={string} images={LetterImageRef[]} openToken={string | undefined} />` where `LetterImageRef = { id: string; width: number; height: number }`.

- [ ] **Step 1: Write the renderer**

Create `src/components/letter-body.tsx`:

```tsx
import { parseLetterBody, type Span } from "@/lib/letter-body";

// An image the letter is allowed to show, with its stored size.
export type LetterImageRef = {
  id: string;
  width: number;
  height: number;
};

// Render a letter body: paragraphs, light emphasis, and inline photos.
//
// Every node becomes a React element. Nothing here uses
// dangerouslySetInnerHTML, and nothing here should ever start: user text lands
// in text nodes, which is what keeps this feature free of a sanitization
// surface. Formatting comes from the parser, never from markup in the body.
export function LetterBody({
  body,
  images = [],
  openToken,
}: {
  body: string;
  images?: LetterImageRef[];
  // Present only on the child's open page, where there is no session and the
  // token is the credential.
  openToken?: string;
}) {
  const nodes = parseLetterBody(body);
  const byId = new Map(images.map((image) => [image.id, image]));

  return (
    <>
      {nodes.map((node, index) => {
        if (node.kind === "image") {
          const image = byId.get(node.id);
          // A marker with no matching image — a hand-edited body, or an image
          // deleted from under it — is skipped rather than breaking the page.
          if (!image) return null;
          return (
            <LetterImage key={`${node.id}-${index}`} image={image} openToken={openToken} />
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {node.spans.map((span, spanIndex) => (
              <SpanText key={spanIndex} span={span} />
            ))}
          </p>
        );
      })}
    </>
  );
}

function SpanText({ span }: { span: Span }) {
  let content = <>{span.text}</>;
  if (span.italic) content = <em>{content}</em>;
  if (span.bold) content = <strong>{content}</strong>;
  return content;
}

function LetterImage({
  image,
  openToken,
}: {
  image: LetterImageRef;
  openToken?: string;
}) {
  // Every image byte comes through the authorized route; there is no other URL
  // that serves one. The token rides in the query string because an <img>
  // can't send a header.
  const src = openToken
    ? `/api/letter-image/${image.id}?t=${encodeURIComponent(openToken)}`
    : `/api/letter-image/${image.id}`;

  return (
    // Plain <img>, not next/image: the route is authorized per-request and
    // returns no-store, so there is nothing for the optimizer to fetch or cache.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={image.width}
      height={image.height}
      // Full width of the letter column, with the stored size setting the
      // aspect box so the page doesn't jump as photos load.
      className="my-4 h-auto w-full rounded-2xl"
      loading="lazy"
    />
  );
}
```

- [ ] **Step 2: Render bodies in the letter stack**

In `src/components/letter-stack.tsx`, extend `StackLetter`:

```ts
export type StackLetter = {
  id: string;
  title: string;
  body: string;
  images: LetterImageRef[];
  authorName: string;
  writtenDate: string;
};
```

Import the renderer and its type:

```ts
import { LetterBody, type LetterImageRef } from "@/components/letter-body";
```

Add `openToken` to the component's props:

```ts
export function LetterStack({
  letters,
  openToken,
}: {
  letters: StackLetter[];
  openToken: string;
}) {
```

Replace the raw body render at line 174 (`{letter.body}`) with:

```tsx
        <LetterBody
          body={letter.body}
          images={letter.images}
          openToken={openToken}
        />
```

If the surrounding element carries a `whitespace-pre-wrap` class, remove it — the renderer now emits paragraphs and sets that itself.

- [ ] **Step 3: Pass images and the token from the open page**

In `src/app/open/[token]/page.tsx`, include images in the letters query. Find the `child.letters` selection and add:

```ts
          images: { select: { id: true, width: true, height: true } },
```

Then extend the `StackLetter` mapping and pass the token:

```tsx
        <LetterStack
          openToken={child.openToken!}
          letters={child.letters.map(
            (letter): StackLetter => ({
              id: letter.id,
              title: letter.title,
              body: letter.body,
              images: letter.images,
              authorName: letter.author?.name?.trim() || "A parent",
              writtenDate: formatDate(letter.createdAt),
            }),
          )}
        />
```

The non-null assertion on `openToken` is safe here: this page was reached by looking the child up *by* that token.

**The locked branch is unchanged and must stay that way.** It returns before this code, so no letter body and no image id ever reaches the browser while the bottle is locked.

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

```bash
git add src/components/letter-body.tsx src/components/letter-stack.tsx "src/app/open/[token]/page.tsx"
git commit -m "Render letter bodies as nodes with inline images"
```

---

### Task 9: The photo strip in the editor

**Files:**
- Create: `src/components/letter-image-input.tsx`
- Modify: `src/components/letter-form.tsx`
- Modify: `src/app/letters/[id]/page.tsx`
- Modify: `src/app/letters/new/page.tsx`

**Interfaces:**
- Consumes: `uploadLetterImage`/`LetterImageState` (Task 7), `imageMarker`/`letterImageIds` (Task 2), the `letter-image.ts` constants (Task 3).
- Produces: `<LetterImageInput letterId={string | undefined} canUpload={boolean} body={string} onInsert={(marker: string) => void} />`.

- [ ] **Step 1: Write the compression and upload component**

Create `src/components/letter-image-input.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { uploadLetterImage, type LetterImageState } from "@/app/actions";
import { imageMarker, letterImageIds } from "@/lib/letter-body";
import {
  downscaleSteps,
  fitDimensions,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_UPLOAD_BYTES,
  IMAGE_QUALITY_LADDER,
  IMAGES_PER_LETTER,
  letterImageMessage,
} from "@/lib/letter-image";

// The DOM half of image upload: pick a file, shrink it in the browser, send it,
// and hand back a marker for the body. The rules it applies are all in
// src/lib/letter-image.ts; this file is the canvas work around them, and is
// untested for the same reason the avatar's input is.

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

export function LetterImageInput({
  letterId,
  canUpload,
  body,
  onInsert,
}: {
  letterId?: string;
  // Whether this author's subscription covers uploading. The server checks
  // again — this only decides what the form offers.
  canUpload: boolean;
  // The current body, so the strip can count what's already referenced.
  body: string;
  onInsert: (marker: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpsell, setShowUpsell] = useState(false);

  const used = letterImageIds(body).length;
  const full = used >= IMAGES_PER_LETTER;

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a failure.
    event.target.value = "";
    if (!file) return;

    setError(null);

    if (file.size > IMAGE_MAX_UPLOAD_BYTES) {
      setError(letterImageMessage("IMAGE_TOO_LARGE_TO_READ"));
      return;
    }

    setBusy(true);
    try {
      const { blob, width, height } = await compress(file);
      const data = new FormData();
      data.set("image", new File([blob], "photo.webp", { type: "image/webp" }));
      data.set("width", String(width));
      data.set("height", String(height));
      if (letterId) data.set("letterId", letterId);

      const result: LetterImageState = await uploadLetterImage({}, data);
      if (result.error || !result.image) {
        setError(result.error ?? letterImageMessage("IMAGE_MALFORMED"));
        return;
      }
      // Built by the same module that parses it, so the two can't drift.
      onInsert(imageMarker(result.image.id));
    } catch {
      setError(letterImageMessage("IMAGE_TOO_LARGE"));
    } finally {
      setBusy(false);
    }
  }

  if (!canUpload) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setShowUpsell(true)}
          className="text-sm font-semibold text-sea-500 hover:text-sea-700"
        >
          📎 Add a photo <span className="text-blush-400">· Pro</span>
        </button>
        {showUpsell && (
          <p className="mt-2 rounded-2xl bg-sea-100 px-4 py-3 text-sm text-sea-600">
            Photos in letters are part of Pro.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy || full}
        className="text-sm font-semibold text-sea-600 hover:text-sea-800 disabled:opacity-60"
      >
        {busy ? "Adding your photo…" : "📎 Add a photo"}
      </button>
      <p className="mt-1 text-xs text-sea-500">
        {full
          ? `That's all ${IMAGES_PER_LETTER} photos for this letter.`
          : `Photos sit where the marker lands. ${used}/${IMAGES_PER_LETTER} used.`}
      </p>
      {error && (
        <p className="mt-2 rounded-2xl bg-blush-200 px-4 py-3 text-sm font-semibold text-blush-500">
          {error}
        </p>
      )}
    </div>
  );
}
```

`LetterImageState` is imported as a type from the server action module, which is safe — `import type` is erased at build time, so no server code is pulled into the client bundle.

- [ ] **Step 2: Host the strip in the letter form**

In `src/components/letter-form.tsx`, add the import:

```ts
import { LetterImageInput } from "@/components/letter-image-input";
```

Add two props to `LetterForm`:

```ts
export function LetterForm({
  childOptions,
  letter,
  lockedChild,
  canUploadImages,
}: {
  childOptions: ChildOption[];
  letter?: ExistingLetter;
  lockedChild?: { id: string; name: string; avatar: string };
  // Whether this author's subscription covers photos. The server checks again.
  canUploadImages: boolean;
}) {
```

The textarea must become controlled so a marker can be inserted at the cursor. Add state and a ref alongside the existing refs:

```ts
  const [body, setBody] = useState(letter?.body ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Drop a marker on its own line at the cursor, so the photo lands where the
  // parent was writing rather than at the end.
  function insertMarker(marker: string) {
    const textarea = bodyRef.current;
    const at = textarea?.selectionStart ?? body.length;
    const before = body.slice(0, at).replace(/\n*$/, "");
    const after = body.slice(at).replace(/^\n*/, "");
    const next = [before, marker, after].filter(Boolean).join("\n\n");
    setBody(next);
  }
```

Replace the textarea's `defaultValue` with the controlled pair and the ref:

```tsx
        <textarea
          id="body"
          name="body"
          ref={bodyRef}
          className="field-input min-h-48 resize-y"
          placeholder="Dear Ada, I'm writing this while you're still small enough to fall asleep on my shoulder…"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
```

Add the strip directly beneath the textarea, inside the same `<div>`:

```tsx
        <LetterImageInput
          letterId={letter?.id}
          canUpload={canUploadImages}
          body={body}
          onInsert={insertMarker}
        />
```

- [ ] **Step 3: Pass the entitlement from both letter pages**

In `src/app/letters/[id]/page.tsx`, load the subscription alongside the letter:

```ts
  const author = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { subscription: true },
  });
```

Import the helper and pass the prop:

```ts
import { canUploadImages } from "@/lib/subscription";
```

```tsx
        <LetterForm
          childOptions={children}
          lockedChild={lockedChild}
          canUploadImages={canUploadImages(author?.subscription)}
          letter={{
            id: letter.id,
            title: letter.title,
            childId: letter.childId,
            body: letter.body,
          }}
        />
```

Apply the same lookup and prop in `src/app/letters/new/page.tsx`.

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

```bash
git add src/components/letter-image-input.tsx src/components/letter-form.tsx "src/app/letters/[id]/page.tsx" src/app/letters/new/page.tsx
git commit -m "Add the Pro-gated photo strip to the letter editor"
```

---

### Task 10: Say that photos are deleted too

**Files:**
- Modify: `src/components/child-card.tsx`
- Modify: `src/app/letters/[id]/page.tsx`

**Interfaces:**
- Consumes: nothing new. `ChildCard`'s `child` prop gains `photosCount: number`.
- Produces: nothing later tasks rely on.

Both delete confirmations currently promise that letters go and say nothing about photos. Deleting a child now also destroys photographs from every co-parent's letters — that belongs in the warning the parent reads before confirming, not just in the code.

- [ ] **Step 1: Count photos for the child card**

In `src/app/children/page.tsx`, find the query building each child's `lettersCount` and add a photo count alongside it. Add to the child `select`:

```ts
        letters: {
          select: { _count: { select: { images: true } } },
        },
```

Then derive the total where the card's props are assembled:

```ts
        photosCount: child.letters.reduce(
          (total, letter) => total + letter._count.images,
          0,
        ),
```

If the existing code takes `lettersCount` from a `_count` aggregate rather than a `letters` array, keep that aggregate and add the `letters` selection above purely for the photo total.

- [ ] **Step 2: Name photos in the child-removal warning**

In `src/components/child-card.tsx`, add `photosCount: number` to the `child` prop type.

Replace the `letterWarning` block and the sentence that uses it:

```tsx
    const letterWarning =
      child.lettersCount > 0
        ? `All ${child.lettersCount} letter${
            child.lettersCount === 1 ? "" : "s"
          } written to ${child.name} will be deleted forever`
        : `Any letters written to ${child.name} will be deleted forever`;
    // Photos are worth naming separately: a parent picturing "letters" is
    // thinking about words they wrote, not photographs of their child.
    const photoWarning =
      child.photosCount > 0
        ? `, including ${child.photosCount} photo${
            child.photosCount === 1 ? "" : "s"
          }`
        : "";
```

```tsx
          <p className="mt-2 text-sm text-sea-700">
            {letterWarning}
            {photoWarning}, and their private open link will stop working. This{" "}
            <strong>can&apos;t be undone</strong>.
          </p>
```

Update the confirm button so it doesn't promise less than it does:

```tsx
            <button type="submit" className="btn-primary w-full">
              {child.photosCount > 0
                ? "Yes, remove & delete letters & photos"
                : "Yes, remove & delete letters"}
            </button>
```

- [ ] **Step 3: Warn before deleting a draft that holds photos**

The draft page's "Delete this draft" is a bare submit with no confirmation. Where the draft holds photos, say so.

In `src/app/letters/[id]/page.tsx`, count the draft's images. Extend the existing `prisma.letter.findUnique` call with:

```ts
    include: { _count: { select: { images: true } } },
```

Then replace the delete form's button with copy that names them:

```tsx
        <form action={deleteLetter} className="mt-6 text-center">
          <input type="hidden" name="id" value={letter.id} />
          <button
            type="submit"
            className="text-sm font-semibold text-sea-400 hover:text-blush-500"
          >
            {letter._count.images > 0
              ? `Delete this draft and its ${letter._count.images} photo${
                  letter._count.images === 1 ? "" : "s"
                }`
              : "Delete this draft"}
          </button>
        </form>
```

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

```bash
git add src/components/child-card.tsx src/app/children/page.tsx "src/app/letters/[id]/page.tsx"
git commit -m "Say that photos are deleted too before deleting a child or draft"
```

---

### Task 11: End-to-end verification

**Files:** none — this task changes nothing and exists to catch what unit tests structurally cannot.

The privacy behaviour of this feature lives in a route handler, a session, and a database, none of which are unit-tested by design. That makes a manual pass the only place these rules are actually checked.

- [ ] **Step 1: Confirm the checks pass**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all three pass. Do not run `npm run build` — it pushes schema to the live database.

- [ ] **Step 2: Set up test data**

The dev server is already running on :3000. Set a user to Pro by hand (billing doesn't exist yet):

```bash
npm run db:studio
```

Set `User.subscription` to `PRO` for your signed-in user. Confirm a second user left at `null` to test the gate.

- [ ] **Step 3: Walk the upload path**

1. As the Pro user, start a letter, add a photo, confirm the marker appears at the cursor.
2. Save the draft. Reopen it. The photo renders.
3. Delete the marker from the body, save, reopen — the photo is gone from the strip.
4. As the non-Pro user, confirm the button reads "· Pro" and reveals the note instead of a file picker.

- [ ] **Step 4: Verify the privacy rules by hand — the point of the feature**

Each of these must hold. Copy an image URL (`/api/letter-image/<id>`) from the editor's rendered photo, then:

1. **Signed out** — open the URL in a private window. Expect **404**.
2. **Signed in as an unrelated user** — expect **404**.
3. **The child's link before the age gate** — set a child's `openAtAge` above their current age in Studio, seal a letter with a photo, open `/open/<token>`. The countdown shows and **no image URL appears in the page source**. Fetch the image URL with `?t=<openToken>` directly — expect **404**, because the gate hasn't passed.
4. **The child's link after the gate** — lower `openAtAge` below their current age. The photo renders on the open page.
5. **A wrong token** — the correct image id with a made-up `?t=` value. Expect **404**.
6. **The blob URL itself** — find the image in the Vercel Blob dashboard and open its URL signed out. Expect a denial: the store is private. **If this returns the image, the store was created public** and must be recreated as private.

- [ ] **Step 5: Verify deletion removes bytes, not just rows**

1. Note an image's `pathname` in Studio.
2. Delete the draft containing it. Confirm in the Vercel Blob dashboard that the blob is gone.
3. Repeat for `deleteChild`: seal a letter with a photo to a child, then delete that child, and confirm the blob is gone. This is the leak that would matter most.
4. Confirm the warnings match reality: the child-removal panel names the photo count, and the draft page's delete link names photos when the draft holds any. A parent must not learn that photographs were destroyed only after confirming.

- [ ] **Step 6: Commit any fixes**

If anything failed, fix it and commit. If everything passed, there's nothing to commit — say so explicitly rather than inventing a commit.

---

## Notes for the implementer

**On the two Pro codes.** `IMAGE_NOT_PRO` (in `letter-image.ts`) rejects an *upload*; `SEND_IMAGES_NOT_ALLOWED` (in `letter-input.ts`) blocks *sealing* a letter that already holds images. They belong to different libs and different moments and are never interchangeable.

**On what is not tested, and why.** The route handler, the canvas wrapper, the photo strip, and the renderer need a request, a DOM, or both. The project's rule is that if verifying a rule requires a session, a database, or a rendered DOM, the rule is in the wrong place — so the rules live in `letter-body.ts`, `letter-image.ts`, `subscription.ts`, and `letter-input.ts`, and those are tested hard. Task 10 is what covers the rest; don't skip it.

**If reconciliation and the sweep ever disagree,** the bug is likely that something stopped using `letterImageIds` as the single source of truth for "what does this body reference". Both paths, and the renderer, must keep going through that one function.

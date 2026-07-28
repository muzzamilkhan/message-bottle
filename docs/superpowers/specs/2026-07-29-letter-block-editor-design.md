# The letter block editor

Replace the plain textarea and its `[[img:<cuid>]]` markers with a WYSIWYG block editor:
text blocks that show real bold and italic while typing, and photo blocks that show the
photograph itself. The parent stops seeing tokens they didn't write and can't interpret.

This supersedes the authoring half of the letter-inline-images design. Nothing about
storage, authorization, the time lock, or blob deletion changes.

## The problem

Today a photo appears in the body as `[[img:cmk3x9f2a0001abcd]]`, explained by the caption
"Photos sit where the marker lands", with a thumbnail strip below as the only way to tell
which cuid is which photograph. Three things are wrong with it:

- The parent is asked to hand-place an opaque token in the middle of a letter to their
  child. It reads as a database identifier because it is one.
- The relationship between marker and photo is only recoverable by counting the strip.
- Sealing is irreversible, so "I think that photo is in the right place" is not good
  enough. The parent should see the letter, not a description of it.

Bold and italic have a milder version of the same problem: `**so**` is syntax the parent
sees and the child doesn't.

## Scope

In scope: a block-based editor for the letter body; text blocks with live bold/italic via a
selection toolbar and Cmd/Ctrl+B/I; photo blocks showing the real image with move and remove
controls; insertion of a photo at a chosen point; a DOM-to-string serialiser and its tests;
removal of the marker caption, the thumbnail strip, and the old upload button UI.

Out of scope: any change to `Letter.body`'s storage format, the Prisma schema, the child's
renderer, `/api/letter-image/[id]`, blob deletion, the age gate, the subscription gate,
drag-to-reorder, a separate preview tab, and any formatting beyond bold and italic.

## The load-bearing decision: blocks are a view, not a format

`Letter.body` stays a `String` in exactly today's format — paragraphs separated by blank
lines, `[[img:<id>]]` alone on a line. The block structure exists only inside the editor
and is serialised back to that string on every change.

This is what keeps the change small and safe. `letterImageIds(body)` is what save-time
reconciliation and the orphan sweep use to decide which blobs may be deleted, and it is the
mechanism behind "delete the child, and every photo goes with it". A JSON body would force
every one of those paths to be re-derived and re-verified. Instead they are untouched, and
`saveLetter` receives a byte-identical payload to today.

The editor writes `toBody(blocks)` into a hidden `<input name="body">` before submit. The
server cannot tell the difference.

## Modules

### `src/lib/letter-blocks.ts` (new, pure, tested)

```ts
export type LetterBlock =
  | { kind: "text"; text: string }
  | { kind: "photo"; id: string };

export function toBlocks(body: string): LetterBlock[];
export function toBody(blocks: LetterBlock[]): string;
```

`toBlocks` splits the raw body on lines matching `IMAGE_MARKER_PATTERN` — the same exported
regex the renderer uses, so there is no second grammar to keep in step. Text between two
markers becomes one text block **verbatim**, asterisks and blank lines intact.

It deliberately does not go through `parseLetterBody`. That function returns styled spans,
and re-serialising spans back to `**`/`*` would not round-trip: `parseSpans` treats an
unmatched `*` as a literal character, and re-emitting it would change its meaning on the
next parse. Splitting at the string level keeps the round-trip exact.

A text block holds paragraphs; it is not a paragraph. Blank lines inside one are preserved
and become paragraph breaks for the child, exactly as they do today.

`toBody` joins blocks with `\n\n`, emitting `imageMarker(id)` for photo blocks. Empty text
blocks are dropped.

Tests: round-trip identity for a body with markers, adjacent markers, leading and trailing
markers, a marker mid-line staying prose, a body with no markers, an empty body, and text
containing unmatched asterisks.

### `src/lib/letter-rich-text.ts` (new, pure, tested)

The DOM-to-string serialiser, and the security boundary of this feature.

```ts
// A minimal structural view of a DOM node, so this is testable in Node —
// which has no DOMParser — by building plain objects.
export type RichNode =
  | { type: "text"; text: string }
  | { type: "element"; tag: string; children: RichNode[] };

export function serializeRichText(nodes: RichNode[]): string;
```

The walk is an **allowlist that emits text**, never a blocklist that strips tags:

| Node                              | Emits                                    |
| --------------------------------- | ---------------------------------------- |
| text node                         | its text, wrapped per the active flags    |
| `<b>`, `<strong>`                 | recurse with bold set                     |
| `<i>`, `<em>`                     | recurse with italic set                   |
| `<br>`                            | `\n`                                      |
| `<div>`, `<p>`                    | recurse, then `\n`                        |
| anything else                     | recurse into children; the element itself is ignored |

The final clause is the whole security story. A pasted `<script>` is not "blacklisted" — it
is simply not a case the walker handles, so only its text content survives, into a string
that reaches the child through `parseSpans` as a text node. There is no path from a DOM node
to stored markup, and `dangerouslySetInnerHTML` remains absent from the codebase. No
sanitizer library, no blacklist to maintain.

Bold and italic are emitted as `**` and `*` so the existing parser renders them. Text
containing a literal `*` is not escaped — the parser already treats an unmatched marker as
a literal character, and escaping would introduce a backslash grammar the renderer doesn't
know.

Tests: nested `<b><i>`, adjacent same-format runs merging, `<br>` runs, a stray `<div>`, a
`<script>` contributing only its text, an unknown element with formatted children, and empty
input.

### `src/components/letter-blocks-editor.tsx` (new)

Renders the block list and owns the interaction. Composed of:

- **`TextBlock`** — a `contenteditable` div. React sets its `innerHTML` **once on mount**
  and never again for the lifetime of that block; state flows DOM → React only. This is the
  discipline that prevents React re-renders from resetting the caret, and it is why each
  block is its own component with a stable key.
- **`PhotoBlock`** — the image at letter width via `letterImageUrl(id)`, with `↑ ↓ ✕`
  controls. Removing a block removes the marker from the saved body, which is what makes
  the blob eligible for deletion through the reconciliation path that already exists.
- **`SelectionToolbar`** — a small popover with `B` and `I`, positioned above the current
  selection, shown only while a non-empty selection exists inside a text block.
- **Insertion points** — a thin hover target between blocks offering `+ Photo`. With the
  caret inside a text block, inserting splits that block at the caret; otherwise the photo
  is appended.

Formatting is applied with `document.execCommand("bold" | "italic")`. It is formally
deprecated but universally implemented, and it handles caret and selection restoration
correctly. Hand-rolled `Range` surgery is more code and more edge cases for no gain here.
Cmd/Ctrl+B and Cmd/Ctrl+I are left to fire natively into the contenteditable.

Paste is intercepted: `preventDefault()`, then insert `clipboardData.getData("text/plain")`.
The serialiser would neutralise markup anyway; this keeps the visible document clean too.

Enter inserts a line break within the block. Backspace at the start of a text block does
nothing when a photo block precedes it — there is no block-merging behaviour, and the photo
has its own `✕`.

A text block emptied and blurred is removed, unless it is the only block.

### `src/components/letter-form.tsx` (changed)

Holds `blocks: LetterBlock[]`, initialised with `toBlocks(letter?.body ?? "")`, and writes
`toBody(blocks)` into a hidden `body` input on submit. The textarea, `insertMarker`, and the
`bodyRef` go away.

### `src/components/letter-image-input.tsx` (removed)

Its compression and upload logic — `compress`, the size guard, the `uploadLetterImage`
call — moves verbatim into `useLetterImageUpload` in
`src/components/use-letter-image-upload.ts`, which the block editor calls. The Pro upsell
branch moves to the editor's `+ Photo` affordance. The button, the caption
"Photos sit where the marker lands", and the thumbnail strip are deleted: the photo blocks
are the strip now. The `x/12 photos used` counter is kept, on the insertion affordance.

The canvas code stays untested for the same reason it is today.

## What does not change

- **Sealing is final.** `status: "DRAFT"` stays in the `where` of every letter
  `updateMany`/`deleteMany`. This design touches no action.
- **The time lock is server-side.** No letter content moves anywhere new. The child's page
  and `LetterBody` are untouched.
- `/api/letter-image/[id]` and its authorization.
- Blob deletion: blobs first, then rows, across `deleteLetter`, `deleteChild`, save-time
  reconciliation, and the orphan sweep.
- `saveLetter`, `parseLetterInput`, `letter-body.ts`, and the Prisma schema.
- No migration and no data wipe: existing drafts load into blocks and save back byte-identically.

## Known gap

There is no separate preview. The block editor is the preview, which holds for photos,
paragraphs, bold, and italic — everything the grammar can express. It does not reproduce
the child's page chrome: the bottle, the fonts, the paper. If that turns out to matter, the
cheap addition later is rendering `LetterBody` inside the seal-confirmation panel above the
irreversible button, where the parent is already being asked to be certain.

## Risks

**Contenteditable caret behaviour** is the largest piece of this work and the part most
likely to need iteration after first use. The mitigations are structural: uncontrolled
blocks, no block merging, plain-text paste, and a grammar with no nesting beyond bold and
italic. The constraint — bold, italic, images, nothing else — is what makes it tractable.

**`execCommand` deprecation.** Formally deprecated, removed nowhere, and the standard choice
at this size. If a browser ever drops it, the replacement is a `Range`-based toggle behind
the same call site.

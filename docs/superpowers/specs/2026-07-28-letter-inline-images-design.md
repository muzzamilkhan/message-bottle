# Inline images in letter content

Parents on a Pro subscription may place photos between the paragraphs of a letter. Images
are downscaled in the browser, stored in a **private** Vercel Blob store, and served only
through an authenticated route that re-derives the same age gate the letter body already
obeys. The letter body stays a plain string; images are referenced by a marker token.

This is the feature the child-profile-photos design deferred ("Out of scope: inline images
in letter bodies... will need real blob storage"). The two share the `Child.photo` column's
conventions and nothing else.

## The privacy requirement

Personal photographs of children must not leak under any circumstance. That requirement,
not convenience, decides every trade-off below:

- The blob store is **private**. No image is reachable by URL, signed or otherwise.
- Every byte is served by a Function that authorizes the requester first.
- The time lock covers images exactly as it covers text. A photo in a locked bottle is
  unreachable, not merely unrendered.
- Deleting a child deletes their photos from blob storage, not just their rows.

## Scope

In scope: uploading, compressing, storing, referencing, rendering, authorizing, and
deleting inline letter images; a minimal Markdown subset (bold/italic/paragraphs) rendered
alongside them; a `User.subscription` column gating uploads.

Out of scope: a billing system, a checkout flow, or any way to *become* Pro. This design
introduces the flag and the gate only; the column is set by hand until billing exists.
Also out of scope: video, audio, captions, alt-text authoring, and image reordering by
drag — the marker is text and moves by editing it.

## Data model

```prisma
model LetterImage {
  id        String   @id @default(cuid())
  // Pathname in the private blob store. Never a public URL — bytes are only
  // served through /api/letter-image/[id] after an authorization check.
  pathname  String   @unique
  // Stored so the renderer can reserve the aspect box before the image loads,
  // avoiding layout shift on the child's page.
  width     Int
  height    Int
  bytes     Int
  mimeType  String
  // Null while the image belongs to a new letter that has not been saved yet.
  // Set on the letter's first save.
  letter    Letter?  @relation(fields: [letterId], references: [id], onDelete: Cascade)
  letterId  String?
  // The uploader. Both the upload gate and the orphan sweep hang off this.
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  authorId  String
  createdAt DateTime @default(now())

  @@index([letterId])
  @@index([authorId, createdAt])
}
```

`Letter` gains `images LetterImage[]`; `User` gains `letterImages LetterImage[]` and:

```prisma
// Subscription tier. Null means free. Checked against an allow-list rather
// than by equality, so future tiers only extend the list.
subscription String?
```

`onDelete: Cascade` on `letterId` removes rows when a letter goes, but **not the blobs** —
blob deletion is never automatic and must be done explicitly wherever letters are deleted.
This is the feature's sharpest edge: a missed `del()` leaves a personal photograph in
storage after the user believed they deleted it.

## The Pro gate

`src/lib/subscription.ts`, pure and tested:

```ts
export const IMAGE_UPLOAD_TIERS = ["PRO"] as const;

export function canUploadImages(subscription: string | null | undefined): boolean {
  return (IMAGE_UPLOAD_TIERS as readonly string[]).includes(subscription ?? "");
}
```

Adding a tier means adding a string. Nothing else in the codebase compares `subscription`
directly.

### Where the gate applies — and where it must not

**Gated: uploading.** `uploadLetterImage` loads the caller's `subscription` and rejects a
non-Pro user before touching the blob store. The hidden button is UX; the action is the
boundary, because anyone can POST to a server action.

**Gated: sealing a letter that contains images.** If a subscription lapses while a draft
holds images, the draft cannot be sealed until the images are removed. This is a second,
deliberate check — see "Lapsed subscriptions" below.

**Never gated: reading.** Rendering an existing image must not consult `subscription`:

- The child at `/open/[token]` has no account at all, so there is no subscription to check.
- A co-parent viewing a letter is not its author.
- A sealed letter is immutable. If its images stopped rendering when the author's
  subscription lapsed, a bottle the child opens years later would be missing photographs
  that were sealed into it. Sealing is final in both directions: the author cannot change
  a sent letter, and neither can their billing status.

### Lapsed subscriptions

A Pro user adds images to a draft, then lapses before sealing. The images stay in the
draft and still render, but the letter cannot be sealed while they remain.

`parseLetterInput` gains an input — whether the author may currently hold images — and a
new error code `SEND_IMAGES_NOT_ALLOWED`, mapped to copy that says the letter contains
photos the subscription no longer covers and can be sealed after removing them or renewing.
The check belongs in the pure lib with the other sealing rules, keeping "what makes a
letter sealable" in one testable place.

Saving the draft is *not* blocked — only sealing. A parent must never be locked out of
their own unsent words.

## Storage

A dedicated Vercel Blob store created with **private** access.

```js
await put(pathname, buffer, { access: "private", addRandomSuffix: true });
```

**The access mode is a property of the store and cannot be changed after creation.** A
store created public can only be corrected by creating a new store and re-uploading. This
is the single configuration step where a mistake is expensive, so it is called out in the
implementation plan as its own verified step.

Private stores, signed URLs, and OIDC authentication reached general availability on
30 June 2026. On Vercel, Functions authenticate to the store with a short-lived,
auto-rotating OIDC token scoped to the project, so no static read-write token sits in the
production environment. Local development uses `BLOB_READ_WRITE_TOKEN` from `vercel env pull`.

Pathname: `letters/<authorId>/<cuid>.webp`, with `addRandomSuffix: true`. The suffix makes
even the pathname unguessable — defence in depth for a path that should never be reachable
by URL in the first place.

### Integration on Vercel

One dependency (`@vercel/blob`), one store created in the dashboard and linked to the
project, one env var locally. No bucket policy, no IAM, no CORS configuration, no
credentials to rotate by hand.

## Serving images: `/api/letter-image/[id]`

Every image byte in the application passes through this one route handler.

```
GET /api/letter-image/<LetterImage.id>[?t=<openToken>]
  ├─ load the image, its letter, and the letter's child
  ├─ authorize (below); on failure → 404
  └─ get({ pathname }) from the private store → stream to the client
```

A rejected request returns **404, not 403**, because a 403 would confirm that an id exists.

### Authorization

Allowed if any one of these holds:

1. **Author** — `session.user.id === image.authorId`. Covers writing and reviewing a draft.
2. **Co-parent** — signed in and `canAccessChild(session.user.id, letter.childId)` returns
   true. Reuses `src/lib/children.ts` rather than replicating the `OR` clause, per the
   existing rule about the two access models.
3. **Child** — the request carries the child's `openToken` as `?t=`, the letter is `SENT`,
   **and** `hasReachedOpenAge(child.birthday, child.openAtAge)` passes.

Nothing else. An image whose letter has no child (an unassigned draft) is reachable by its
author alone.

### The time lock covers images

Case 3 is the existing invariant extended, and it is the reason this route cannot be
skipped. The project rule is that the server never ships letter content before the age
gate — an inline photograph is letter content. `/open/[token]/page.tsx` already refuses to
render bodies while locked, but that page is not the only way to reach an image: the route
is directly addressable, so it must re-derive the gate itself from the `Child` row. It
never trusts a client-supplied claim about age or unlock state.

The `?t=` query parameter carries the token because an `<img>` element cannot send a
header. This exposes nothing new — the same token is already the credential in the page URL
the image is embedded on.

`TESTING=true` plus `?test=yes` bypasses the age gate here exactly as it does on the page.
Without the matching bypass, testing a bottle would render text with broken images. It
stays inert in any other environment.

### Caching

`Cache-Control: private, no-store` on every response. Never `public`: Vercel's CDN caches
Function responses, and a cached authorized response served to the next requester would
defeat the entire authorization path.

## Body format

The body column is unchanged — still `String @db.Text`, still plain text. No migration, and
no rewriting of sealed letters, which the "sealing is final" invariant would make
uncomfortable.

An image is referenced by a marker on its own line:

```
Dear Ada,

You took your first steps today.

[[img:clx9a2ff70000]]

I cried, obviously.
```

### `src/lib/letter-body.ts` — pure, tested

```ts
export type Span = { text: string; bold: boolean; italic: boolean };

export type LetterNode =
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "image"; id: string };

export function parseLetterBody(body: string): LetterNode[];
export function letterImageIds(body: string): string[];
```

The grammar is deliberately tiny:

- A blank line separates paragraphs.
- `**text**` is bold, `*text*` is italic. They may nest.
- A line matching exactly `[[img:<cuid>]]` becomes an image node. A marker with text around
  it on the same line is left as literal text.
- Everything else is literal, including unmatched `**` — a stray asterisk renders as an
  asterisk rather than producing an error or eating the rest of the letter.

`letterImageIds` is the same parser used by cleanup, so what the renderer treats as
referenced and what reconciliation treats as referenced cannot drift apart.

### Rendering

`src/components/letter-body.tsx` maps nodes onto `<p>`, `<strong>`, `<em>`, and `<img>` —
**React elements only, never `dangerouslySetInnerHTML`**. This is what buys formatting
without a sanitization burden: user text always lands in a text node, so no parse path can
turn it into markup. That property must survive future edits to this file.

An image node whose id is not in the letter's image list is skipped silently, so a
corrupted or hand-edited body degrades to text instead of breaking the page.

Images render **full width** of the letter content column, in both the editor preview and
the child's reader, with `width`/`height` attributes from the row so the aspect box is
reserved before the bytes arrive.

This replaces the current plain-text rendering of `body` in `letter-stack.tsx` and on the
letter detail page. `LetterStack` is a client component receiving `body` as a string, which
is why the renderer produces elements from parsed nodes rather than server-rendered HTML.

## Compression

Mirrors the structure the child-photo design established: the rules are pure and tested,
the canvas work is a thin untested wrapper.

### `src/lib/letter-image.ts` — pure, tested

```ts
export const IMAGE_MAX_DIMENSION = 1280;                  // px, long edge
export const IMAGE_MAX_BYTES = 600 * 1024;                // encoded result cap
export const IMAGE_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;   // pre-decode input guard
export const IMAGE_MIME_TYPES = ["image/webp", "image/jpeg"] as const;
export const IMAGE_QUALITY_LADDER = [0.82, 0.7, 0.6] as const;
export const IMAGES_PER_LETTER = 12;
```

- `fitDimensions(width, height)` → the target size preserving aspect ratio, long edge
  capped at 1280. Unlike the avatar's `coverCrop`, there is **no cropping** — a letter
  photo keeps its shape. A source smaller than the cap passes through unscaled rather than
  being upscaled.
- `downscaleSteps(from, to)` → repeated halving while the source is more than 2× the
  target, then the target, for the same anti-aliasing reason as the avatar path.
- `validateUpload({ mimeType, bytes })` → `ok` or an error code.

1280px is chosen against the render box: letter content is ~640px wide at most, so 1280
covers a 2× retina display exactly and stores nothing the UI can show. Expect 150–350 KB
per photo.

Error codes, not copy: `IMAGE_NOT_AN_IMAGE`, `IMAGE_MALFORMED`, `IMAGE_TOO_LARGE`,
`IMAGE_TOO_LARGE_TO_READ`, `IMAGE_TOO_MANY`, `IMAGE_NOT_PRO`. `letterImageMessage(code)`
maps them, beside the existing `letterInputMessage`.

Two distinct Pro-related codes exist because they belong to two different libs and two
different moments: `IMAGE_NOT_PRO` (here) rejects an *upload* by a non-Pro user, while
`SEND_IMAGES_NOT_ALLOWED` (in `letter-input.ts`) blocks *sealing* a letter that already
contains images. They are never interchangeable.

### `src/components/letter-image-input.tsx` — client, untested

Given a `File`: reject over `IMAGE_MAX_UPLOAD_BYTES` before decoding; decode with
`createImageBitmap(file, { imageOrientation: "from-image" })` so EXIF rotation is applied
and phone photos are not stored sideways; walk `downscaleSteps` into an offscreen canvas
with `imageSmoothingQuality: "high"`; encode via `canvas.toBlob` down the quality ladder,
stopping at the first result under `IMAGE_MAX_BYTES`.

The server re-validates dimensions, MIME type, and byte length independently. Client
compression is a UX convenience and never a trust boundary.

## Upload and editing

The textarea stays. A photo strip sits beneath it.

- **Pro user, empty:** an "📎 Add a photo" button opening a file picker (`accept="image/*"`).
- **Free user:** the same button rendered as "📎 Add a photo · Pro", which on click reveals
  an inline note that photos in letters are part of Pro. There is no billing page to link
  to yet, so it states the fact and nothing more.
- **After upload:** a thumbnail per image in the strip, so the parent can see which marker
  is which.

On pick: compress, call `uploadLetterImage`, receive `{ id, width, height }`, and insert
`[[img:<id>]]` on its own line at the cursor. Removing an image means deleting its marker
text — the strip's thumbnail disappears on the next save.

The marker is visible in the textarea. That is the accepted cost of keeping a plain
textarea instead of a contenteditable surface: no cursor management, no selection bugs, no
editor dependency, and the body stays a string that any future tool can read.

### Why upload happens on pick, not on save

Uploading with the form would push several hundred KB through a server action per image,
against a 1 MB default body limit that a few photos will exceed, and would re-send every
image on every draft save. Uploading on pick keeps draft saves small and gives the parent
a real preview of the stored image.

The cost is that an image can exist before any letter references it, which the cleanup
design below handles.

## Cleanup

Blobs are never deleted implicitly. Four paths, covering every way an image can become
unreferenced.

### 1. Reconciliation on save — the common case

Every draft save and every seal parses the submitted body with `letterImageIds`, compares
it against the `LetterImage` rows for that letter, and for each row not referenced: `del()`
the blob, then delete the row. Uploads from this session with no letter yet are claimed by
setting `letterId` on first save.

This is exact rather than heuristic — the body is the authority on what is referenced — and
it covers both "the author removed a marker" and "the author uploaded then changed their
mind mid-edit".

### 2. The seal is the last reconciliation

Sealing reconciles once, then the letter's images are frozen with it. **No later sweep or
cleanup path may touch a `SENT` letter's images**, or a child could open a bottle with
missing photographs. Every cleanup query below therefore excludes sealed letters.

### 3. Lazy orphan sweep — the tab that was never saved

If a parent picks a photo and closes the tab, reconciliation never runs and the row keeps
`letterId: null`. When an author next loads their letters list, a bounded query deletes
their own `LetterImage` rows with `letterId: null` and `createdAt` older than 24 hours,
blob first, then row.

The window is deliberately generous — a parent may leave a half-written letter open
overnight. Nothing is user-visible during it and the blob is private and unreferenced, so
the exposure is bytes at rest, not access. No cron job and no scheduled function; the
sweep rides on a page load that already queries this author's letters.

### 4. Deletion of letters and children

- **`deleteLetter`** (drafts only) — collect the draft's image pathnames, delete the blobs,
  then delete the letter.
- **`deleteChild`** — already transactionally deletes every letter written to that child,
  drafts and sealed alike, from every co-parent. It must now also delete those letters'
  blobs. Without this, personal photographs of a child would outlive an explicit "delete
  this child" action, which would be the most serious leak this feature could introduce.

Because blob deletion is a network call it cannot join the Prisma transaction. Order is
**blobs first, then rows**: a failure after deleting blobs leaves rows pointing at missing
images, which renders as a skipped image; a failure the other way would leave photographs
in storage with nothing referencing them. Losing an image is recoverable and visible;
leaking one is neither.

## Testing

Per the project's philosophy, the pure libs are tested and nothing requiring a session, a
database, or a DOM is:

- **`letter-body.test.ts`** — paragraph splitting; bold, italic, and nesting; a marker on
  its own line; a marker with surrounding text (stays literal); unmatched `**`; an empty
  body; `letterImageIds` returning ids in order and de-duplicating.
- **`letter-image.test.ts`** — `fitDimensions` for landscape, portrait, square, and a
  source under the cap; `downscaleSteps` for a huge source, one just over 2×, and one at
  target; `validateUpload` for each allowed MIME type, a disallowed one, and sizes either
  side of the cap.
- **`subscription.test.ts`** — `null`, `""`, `"PRO"`, an unknown tier, and a lowercase
  `"pro"` (which must not pass).
- **`letter-input.test.ts`** — gains the lapsed-Pro cases: sealing with images while not
  Pro fails with `SEND_IMAGES_NOT_ALLOWED`; saving a draft in the same state succeeds;
  sealing with images while Pro succeeds; sealing without images while not Pro succeeds.

The route handler, the canvas wrapper, the photo strip, and the renderer component are
untested — they need a request, a DOM, or both, which per the project's smell test means
the rules belong in the libs, and they do.

## Migration and rollout

`prisma db push` adds `LetterImage` and `User.subscription`. Both are additive: existing
letters have no images and every existing user is free, so there is no backfill.

The feature is inert until a blob store exists and a user's `subscription` is set to
`"PRO"` by hand, which makes it safe to ship before billing is built.

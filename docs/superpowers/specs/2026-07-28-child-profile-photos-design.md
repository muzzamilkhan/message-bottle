# Child profile photos

Parents may upload a photo for a child instead of picking an emoji avatar. The photo is
downscaled in the browser to a 160×160 thumbnail and stored as a data URL on the `Child`
row. No new infrastructure.

## Scope

In scope: uploading, compressing, previewing, storing, rendering, and removing a child's
profile photo; a shared `<ChildAvatar>` component replacing the ad-hoc emoji spans.

Out of scope: inline images in letter bodies. Those are a different size class with a
different lifecycle and will need real blob storage. This design deliberately does not
build shared infrastructure for them - see "Why not blob storage".

## Storage

A new nullable column on `Child`:

```prisma
// A parent-uploaded profile photo, as a `data:image/webp;base64,...` URL, already
// downscaled client-side to 160×160. Null means fall back to the emoji `avatar`.
// Small enough to live on the row (~7-9 KB), but omitted from any `select` that
// does not render it.
photo String? @db.Text
```

`avatar` is unchanged: still non-null, still defaulted, still the fallback. A child always
has an emoji, so removing a photo needs no migration or backfill.

**Query discipline.** Every existing `select` that reads `avatar` must be reviewed. Add
`photo: true` only where the result is rendered through `<ChildAvatar>`. Sites that
interpolate the emoji into prose (`${avatar} ${name}` on the invite and share pages) must
*not* select `photo` - they render text and cannot show an image.

Deletion is automatic: the photo is a column on `Child`, so `deleteChild` removes it with
the row. No orphaned blobs, no cleanup job.

## Compression

Two modules, split so the rules are testable and the DOM work is not.

### `src/lib/child-photo.ts` (pure, tested)

Plain values in, plain values out. No canvas, no `File`, no DOM.

```ts
export const PHOTO_SIZE = 160;              // px, square
export const PHOTO_MAX_BYTES = 20 * 1024;   // decoded, generous for 160px
export const PHOTO_MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // pre-decode input guard
export const PHOTO_MIME_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export const PHOTO_QUALITY_LADDER = [0.82, 0.7, 0.6] as const;
```

- `coverCrop(width, height)` → the source rectangle (`sx, sy, sw, sh`) that center-crops
  the image to its largest centered square. Landscape crops the sides, portrait crops the
  top and bottom, square passes through. The target size is not a parameter: cropping picks
  the square, and scaling it to 160px happens at draw time, so a source smaller than the
  target is upscaled and every stored photo is exactly 160×160.
- `downscaleSteps(from, to)` → the ladder of intermediate widths. Repeated halving while
  the source is more than 2× the target, then the target. Drawing a 4000px photo straight
  to 160px aliases badly because browsers do not box-filter at extreme ratios; stepping is
  what keeps the result from looking grainy.
- `parsePhotoDataUrl(input)` → `{ ok: true; mime; bytes }` or an error code. Validates the
  `data:<mime>;base64,` prefix against the allow-list and computes the decoded byte length
  from the base64 length without allocating the buffer. Rejects malformed input, a
  disallowed MIME type, and anything over `PHOTO_MAX_BYTES`.

Error codes, not copy, matching the `child-input` convention:
`PHOTO_NOT_AN_IMAGE`, `PHOTO_MALFORMED`, `PHOTO_TOO_LARGE`, `PHOTO_TOO_LARGE_TO_READ`.
`childPhotoMessage(code)` maps a code to its message and lives beside the existing
`childInputMessage`.

### `src/components/child-photo-input.tsx` (client, untested)

The thin DOM wrapper. Given a `File`:

1. Reject over `PHOTO_MAX_UPLOAD_BYTES` before decoding, so a stray huge file cannot hang
   the tab.
2. `createImageBitmap(file, { imageOrientation: "from-image" })` - this applies the EXIF
   rotation flag, so phone photos are not stored sideways. This is the whole EXIF story;
   no parser needed.
3. Walk `downscaleSteps`, drawing into an offscreen canvas at each step with
   `imageSmoothingQuality: "high"`, applying `coverCrop` on the first draw.
4. Encode via `canvas.toBlob` at each quality in `PHOTO_QUALITY_LADDER`, stopping at the
   first result under `PHOTO_MAX_BYTES`. WebP first; if the browser hands back something
   other than the requested type, accept it as long as it is in the allow-list.
5. If even the lowest quality overshoots, surface `PHOTO_TOO_LARGE` rather than degrading
   the image further.

Result is a data URL held in React state, shown as the preview, and written to a hidden
input. The preview *is* the stored image - what the parent sees is exactly what is saved.

## Form integration

`ChildForm`'s "Pick an avatar" block becomes a photo slot above the existing emoji row.

- Empty slot: an "Add a photo" button opening a file picker (`accept="image/*"`).
- Chosen: a 160px rounded preview with a "Remove photo" button, which clears the state and
  reveals the emoji row's current selection again.
- The emoji row stays visible and functional throughout. The emoji is always set
  underneath, so removing a photo falls back to a deliberate choice rather than a default.
- Compression runs on selection, with a brief pending state. Errors render in the same
  style as other field errors.

Three hidden inputs carry the state into the existing `useActionState` submit - no
separate upload endpoint, no new route:

- `avatar` - the emoji, exactly as today.
- `photo` - the compressed data URL, or empty.
- `photoAction` - `"keep"`, `"set"`, or `"clear"`. Editing a child must distinguish "the
  parent did not touch the photo" from "the parent removed it", and an empty `photo` field
  alone cannot express that difference. On a create form this is always `"set"` or
  `"clear"`.

**Error echo-back.** Child forms echo raw submitted strings in `values` so an error
re-render can repopulate fields React would otherwise reset. The photo does *not* ride in
that payload - `ChildFormValues` gains `hasPhoto: boolean`, not the data URL. The
compressed photo never left the browser, so the client keeps it in React state across the
re-render at no cost. Echoing ~9 KB back on every failed submit would bloat the action
state for a field the user has not lost.

## Server

`parseChildInput` gains photo handling, keeping its existing shape:

- `photoAction: "clear"` → `photo: null`.
- `photoAction: "keep"` → `photo: undefined`, meaning "do not touch this column".
- `photoAction: "set"` → run `parsePhotoDataUrl`; on success store the data URL, on failure
  return the error code like any other validation failure.
- An unrecognised `photoAction` falls back to `"keep"`, matching how an unknown `avatar`
  silently falls back rather than erroring - a bad value there means a stale client, not a
  user mistake.

`ParsedChild.photo` is `string | null | undefined`, and the three states map directly onto
Prisma: a value sets it, `null` clears it, `undefined` leaves it alone. `createChild`
treats `undefined` as `null`.

The server re-validates independently of the client. Client-side compression is a UX
convenience, never a trust boundary - anyone can POST an arbitrary body to a server
action, so the size and MIME checks must hold on the server on their own.

Only the owner may set a photo, which follows from `updateChild`'s existing ownership
check; no new authorization rule.

## Rendering

A new `src/components/child-avatar.tsx`:

```tsx
<ChildAvatar child={{ avatar, photo }} size="sm" | "md" | "lg" | "xl" />
```

Photo present → an `<img>` cropped to a circle at the size's pixel dimensions. Otherwise
the emoji at the matching text size. The sizes map to the five currently in use
(`text-2xl` through `text-5xl`), so this is a like-for-like replacement at each call site.

This replaces the seven ad-hoc `<span className="text-Nxl">{child.avatar}</span>` spans:
`dashboard/page.tsx:63` and `:127`, `children/page.tsx:102`, `open/[token]/page.tsx:106`,
`letter-form.tsx:73`, `child-card.tsx:66`, `share/page.tsx:118`, `share-form.tsx:64`. The
photo-versus-emoji branch is then written once, and the component is the natural seam for
later avatar work.

Plain `<img>`, not `next/image`: the source is an inline data URL already sized to its
render box, so there is nothing for the image optimizer to fetch, resize, or cache. Add an
`alt` of the child's name.

### Sites that stay emoji-only

Three call sites cannot render an image and keep interpolating the emoji:

- `invite/[token]/page.tsx:55` and `share/page.tsx:81` build prose sentences
  (`${avatar} ${name}`) listing children's names.
- `letter-form.tsx:94` renders `{child.avatar} {child.name}` inside a `<select>`
  `<option>`, whose content model permits text only - an `<img>` is invalid there.

These must not select `photo`, and a child with a photo still shows their emoji in the
recipient dropdown. That is an accepted limitation: replacing the native `<select>` with a
custom listbox to show thumbnails would mean rebuilding keyboard and screen-reader
behaviour, which is far out of proportion to the gain here.

## Testing

Per the project's philosophy, `src/lib/child-photo.ts` is pure and tested:

- `coverCrop` - landscape, portrait, square, and a source smaller than the target.
- `downscaleSteps` - a huge source, a source just over 2×, a source already at target, a
  source below target.
- `parsePhotoDataUrl` - each allowed MIME type, a disallowed one, a malformed prefix, empty
  input, a payload just under the cap, and one just over.

`child-input.test.ts` gains cases for the three `photoAction` branches, an invalid data URL
under `"set"`, and an unrecognised `photoAction`.

The canvas wrapper, the form component, and the render component are untested - they need
a DOM, which per the project's smell test means the rules belong in the lib, and they do.

## Why not blob storage

The later inline letter images will need real blob storage: they are hundreds of KB, they
are referenced from letter bodies, and they have their own deletion lifecycle tied to
letters and sealing. None of that applies to a 7 KB avatar thumbnail that lives and dies
with its `Child` row.

Building blob storage now to serve both would mean credentials, a bucket, remote image
patterns, and an orphan-cleanup story - all so a thumbnail can take a network round trip it
does not need. Building it later, for the case that actually needs it, keeps this change
small and leaves that design free. The two features share the `<ChildAvatar>` seam and
nothing else, which is the right amount of coupling.

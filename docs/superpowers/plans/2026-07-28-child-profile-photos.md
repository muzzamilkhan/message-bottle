# Child Profile Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let parents upload a profile photo for a child, downscaled in the browser to a 160×160 thumbnail and stored as a data URL on the `Child` row.

**Architecture:** A nullable `photo` column on `Child` holds a `data:image/webp;base64,…` URL (~7-9 KB). Pure crop/scale/validate rules live in a tested `src/lib/child-photo.ts`; the canvas work lives in an untested client component. A photo overrides the emoji `avatar`, which stays set as the fallback, and a shared `<ChildAvatar>` renders the branch once.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 6 / Postgres, Tailwind 3, `node --test` with native TypeScript stripping.

**Spec:** `docs/superpowers/specs/2026-07-28-child-profile-photos-design.md`

## Global Constraints

- Work directly on `main`. Atomic commits, one logical change each. Push when done.
- **Never skip the pre-commit hook.** No `git commit --no-verify`, no disabling checks. If it fails on code you didn't touch, stop and say so.
- Verify with `npm test && npm run typecheck && npm run lint`. **Never** run `npm run build` - it runs `prisma db push --accept-data-loss` against the real database.
- Dev server is already running on :3000. Do not start another; see `dev.log`.
- Modules under `src/lib/` import each other with **relative paths and explicit `.ts` extensions** (`./avatars.ts`). App code outside `src/lib/` uses the `@/` alias.
- Validation libs return **error codes**, never user-facing copy. The calling action maps a code to its message.
- Pure libs take an **injectable clock** (`now`/`at` defaulting to `new Date()`) where dates are involved.
- Components take child lists as **`childOptions`**, never a `children` prop.
- Test pure functions only. No tests for server components, Prisma queries, or React rendering.
- Exact constant values, copied verbatim from the spec:
  - `PHOTO_SIZE = 160`
  - `PHOTO_MAX_BYTES = 20 * 1024`
  - `PHOTO_MAX_UPLOAD_BYTES = 15 * 1024 * 1024`
  - `PHOTO_MIME_TYPES = ["image/webp", "image/jpeg", "image/png"]`
  - `PHOTO_QUALITY_LADDER = [0.82, 0.7, 0.6]`

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | Add nullable `photo` column to `Child`. |
| `src/lib/child-photo.ts` | **New, pure, tested.** Crop math, downscale ladder, data-URL validation, error copy. |
| `src/lib/child-photo.test.ts` | **New.** Tests for the above. |
| `src/lib/child-input.ts` | Extend `ChildFormValues`/`ParsedChild` with photo handling. |
| `src/lib/child-input.test.ts` | Add photo-branch cases. |
| `src/components/child-avatar.tsx` | **New.** Shared photo-or-emoji renderer at five sizes. |
| `src/components/child-photo-input.tsx` | **New, client.** File picker + canvas compression + preview. |
| `src/components/child-form.tsx` | Mount the photo input, carry hidden fields. |
| `src/app/actions.ts` | Pass photo fields through to Prisma. |
| `src/lib/children.ts`, `src/app/**/page.tsx`, `src/components/{child-card,letter-form,share-form}.tsx` | Select `photo` and render via `<ChildAvatar>`. |

## Task Order

Tasks 1-3 are pure and testable in isolation. Task 4 wires the database. Tasks 5-7 are UI. Each task ends green and committed.

---

### Task 1: Photo geometry - crop and downscale math

**Files:**
- Create: `src/lib/child-photo.ts`
- Test: `src/lib/child-photo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PHOTO_SIZE`, `PHOTO_MAX_BYTES`, `PHOTO_MAX_UPLOAD_BYTES`, `PHOTO_MIME_TYPES`, `PHOTO_QUALITY_LADDER`; `coverCrop(width: number, height: number): { sx: number; sy: number; sw: number; sh: number }`; `downscaleSteps(from: number, to?: number): number[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/child-photo.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { coverCrop, downscaleSteps, PHOTO_SIZE } from "./child-photo.ts";

test("PHOTO_SIZE is the 160px square the spec fixes", () => {
  assert.equal(PHOTO_SIZE, 160);
});

test("coverCrop", async (t) => {
  await t.test("passes a square source through whole", () => {
    assert.deepEqual(coverCrop(500, 500), { sx: 0, sy: 0, sw: 500, sh: 500 });
  });

  await t.test("crops the sides of a landscape source", () => {
    // 800x400 -> take the middle 400x400, so 200px comes off each side.
    assert.deepEqual(coverCrop(800, 400), { sx: 200, sy: 0, sw: 400, sh: 400 });
  });

  await t.test("crops the top and bottom of a portrait source", () => {
    assert.deepEqual(coverCrop(400, 800), { sx: 0, sy: 200, sw: 400, sh: 400 });
  });

  await t.test("centers an odd-sized crop without going out of bounds", () => {
    const { sx, sy, sw, sh } = coverCrop(101, 50);
    assert.equal(sh, 50);
    assert.equal(sw, 50);
    assert.ok(sx >= 0 && sx + sw <= 101, "crop stays inside the source width");
    assert.equal(sy, 0);
  });

  await t.test("still squares a source smaller than the target", () => {
    // Upscaling happens at draw time; the crop is still the largest square.
    assert.deepEqual(coverCrop(80, 40), { sx: 20, sy: 0, sw: 40, sh: 40 });
  });
});

test("downscaleSteps", async (t) => {
  await t.test("halves repeatedly until within 2x, then lands on target", () => {
    // 1280 -> 640 -> 320 -> 160
    assert.deepEqual(downscaleSteps(1280), [640, 320, 160]);
  });

  await t.test("goes straight to target when already within 2x", () => {
    assert.deepEqual(downscaleSteps(300), [160]);
  });

  await t.test("goes straight to target at exactly 2x", () => {
    assert.deepEqual(downscaleSteps(320), [160]);
  });

  await t.test("handles a huge phone photo", () => {
    const steps = downscaleSteps(4000);
    assert.equal(steps.at(-1), 160);
    assert.ok(steps.length > 1, "a 4000px source must not draw in one step");
    // Every step at least halves, and never overshoots below the target.
    for (const [i, step] of steps.entries()) {
      const prev = i === 0 ? 4000 : steps[i - 1];
      assert.ok(step < prev, `step ${step} must shrink from ${prev}`);
      assert.ok(step >= 160, `step ${step} must not go below the target`);
    }
  });

  await t.test("upscales a small source in a single step", () => {
    assert.deepEqual(downscaleSteps(64), [160]);
  });

  await t.test("returns a single no-op step when already at target", () => {
    assert.deepEqual(downscaleSteps(160), [160]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/child-photo.test.ts`
Expected: FAIL - cannot find module `./child-photo.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/child-photo.ts`:

```ts
// Pure geometry and validation for child profile photos. Kept free of canvas,
// File, and the DOM so the rules can be tested with plain numbers and strings.
// The canvas work that uses these lives in
// src/components/child-photo-input.tsx.

// Stored photos are a fixed square. 160px covers the largest render (a 48px
// emoji slot on the open page) at 2x DPR with headroom to spare.
export const PHOTO_SIZE = 160;

// Decoded byte cap for a stored photo. Generous for 160px - a quality-0.82
// WebP at that size lands around 7-9 KB.
export const PHOTO_MAX_BYTES = 20 * 1024;

// Pre-decode guard on the file the parent picked, so a stray 100 MB file
// can't hang the tab before we ever look at it.
export const PHOTO_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// What we accept as a stored photo. WebP is what we ask the browser to encode;
// JPEG and PNG are here because canvas.toBlob may hand back its own type.
export const PHOTO_MIME_TYPES = [
  "image/webp",
  "image/jpeg",
  "image/png",
] as const;

// Encode qualities tried in order, stopping at the first result under the byte
// cap.
export const PHOTO_QUALITY_LADDER = [0.82, 0.7, 0.6] as const;

// The largest centered square inside a source image. Cropping to square rather
// than letterboxing keeps every render site a clean circle with no layout
// surprises.
export function coverCrop(
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const side = Math.min(width, height);
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    sw: side,
    sh: side,
  };
}

// The ladder of widths to draw through on the way down to `to`.
//
// Browsers don't box-filter when drawing at extreme ratios, so scaling a
// 4000px photo straight to 160px aliases badly and looks grainy. Halving
// repeatedly while we're more than 2x away, then drawing the final step, costs
// a few extra draws and is visibly sharper.
export function downscaleSteps(from: number, to: number = PHOTO_SIZE): number[] {
  const steps: number[] = [];
  let current = from;
  while (current > to * 2) {
    current = Math.max(Math.round(current / 2), to);
    steps.push(current);
  }
  // Always finish exactly on the target, including when the source is smaller
  // (an upscale) or already there (a no-op copy).
  if (steps.at(-1) !== to) steps.push(to);
  return steps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/child-photo.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/child-photo.ts src/lib/child-photo.test.ts
git commit -m "Add pure crop and downscale math for child photos"
```

---

### Task 2: Photo data-URL validation

**Files:**
- Modify: `src/lib/child-photo.ts`
- Test: `src/lib/child-photo.test.ts`

**Interfaces:**
- Consumes: `PHOTO_MAX_BYTES`, `PHOTO_MIME_TYPES` from Task 1.
- Produces: `type ChildPhotoError = "PHOTO_NOT_AN_IMAGE" | "PHOTO_MALFORMED" | "PHOTO_TOO_LARGE" | "PHOTO_TOO_LARGE_TO_READ"`; `type PhotoParseResult = { ok: true; mime: string; bytes: number } | { ok: false; error: ChildPhotoError }`; `parsePhotoDataUrl(input: string): PhotoParseResult`; `childPhotoMessage(error: ChildPhotoError): string`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/child-photo.test.ts`:

```ts
import {
  childPhotoMessage,
  parsePhotoDataUrl,
  PHOTO_MAX_BYTES,
  type ChildPhotoError,
} from "./child-photo.ts";

// Build a data URL whose decoded payload is exactly `bytes` long.
function dataUrlOfSize(bytes: number, mime = "image/webp"): string {
  const base64 = Buffer.alloc(bytes, 7).toString("base64");
  return `data:${mime};base64,${base64}`;
}

test("parsePhotoDataUrl", async (t) => {
  await t.test("accepts each allowed mime type", () => {
    for (const mime of ["image/webp", "image/jpeg", "image/png"]) {
      const result = parsePhotoDataUrl(dataUrlOfSize(64, mime));
      assert.deepEqual(result, { ok: true, mime, bytes: 64 });
    }
  });

  await t.test("computes the decoded size for a padded payload", () => {
    // "hello world" is 11 bytes and encodes with padding.
    const url = `data:image/webp;base64,${Buffer.from("hello world").toString("base64")}`;
    const result = parsePhotoDataUrl(url);
    assert.equal(result.ok && result.bytes, 11);
  });

  await t.test("rejects a disallowed mime type", () => {
    const result = parsePhotoDataUrl(dataUrlOfSize(64, "image/svg+xml"));
    assert.deepEqual(result, { ok: false, error: "PHOTO_NOT_AN_IMAGE" });
  });

  await t.test("rejects a non-image mime type", () => {
    const result = parsePhotoDataUrl(dataUrlOfSize(64, "text/html"));
    assert.deepEqual(result, { ok: false, error: "PHOTO_NOT_AN_IMAGE" });
  });

  await t.test("rejects a payload over the cap", () => {
    const result = parsePhotoDataUrl(dataUrlOfSize(PHOTO_MAX_BYTES + 1));
    assert.deepEqual(result, { ok: false, error: "PHOTO_TOO_LARGE" });
  });

  await t.test("accepts a payload exactly at the cap", () => {
    const result = parsePhotoDataUrl(dataUrlOfSize(PHOTO_MAX_BYTES));
    assert.equal(result.ok, true);
  });

  await t.test("rejects a url with no data: prefix", () => {
    assert.deepEqual(parsePhotoDataUrl("https://example.com/cat.png"), {
      ok: false,
      error: "PHOTO_MALFORMED",
    });
  });

  await t.test("rejects a non-base64 data url", () => {
    assert.deepEqual(parsePhotoDataUrl("data:image/webp,notbase64"), {
      ok: false,
      error: "PHOTO_MALFORMED",
    });
  });

  await t.test("rejects empty input", () => {
    assert.deepEqual(parsePhotoDataUrl(""), {
      ok: false,
      error: "PHOTO_MALFORMED",
    });
  });

  await t.test("rejects a prefix with an empty payload", () => {
    assert.deepEqual(parsePhotoDataUrl("data:image/webp;base64,"), {
      ok: false,
      error: "PHOTO_MALFORMED",
    });
  });

  await t.test("rejects a payload containing invalid base64 characters", () => {
    assert.deepEqual(parsePhotoDataUrl("data:image/webp;base64,!!!!"), {
      ok: false,
      error: "PHOTO_MALFORMED",
    });
  });
});

test("childPhotoMessage returns a message for every error code", () => {
  const codes: ChildPhotoError[] = [
    "PHOTO_NOT_AN_IMAGE",
    "PHOTO_MALFORMED",
    "PHOTO_TOO_LARGE",
    "PHOTO_TOO_LARGE_TO_READ",
  ];
  for (const code of codes) {
    const message = childPhotoMessage(code);
    assert.equal(typeof message, "string");
    assert.ok(message.length > 0, `${code} needs a message`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/child-photo.test.ts`
Expected: FAIL - `parsePhotoDataUrl` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/child-photo.ts`:

```ts
// Why a photo was rejected. Codes rather than copy, so tests assert on rules
// and wording stays free to change - same convention as child-input.ts.
export type ChildPhotoError =
  | "PHOTO_NOT_AN_IMAGE"
  | "PHOTO_MALFORMED"
  | "PHOTO_TOO_LARGE"
  | "PHOTO_TOO_LARGE_TO_READ";

export type PhotoParseResult =
  | { ok: true; mime: string; bytes: number }
  | { ok: false; error: ChildPhotoError };

export function childPhotoMessage(error: ChildPhotoError): string {
  switch (error) {
    case "PHOTO_NOT_AN_IMAGE":
      return "That file doesn't look like a photo we can use.";
    case "PHOTO_MALFORMED":
      return "We couldn't read that photo. Try picking it again.";
    case "PHOTO_TOO_LARGE":
      return "That photo is too large, even after shrinking it.";
    case "PHOTO_TOO_LARGE_TO_READ":
      return "That file is too big to open. Try a smaller photo.";
  }
}

const DATA_URL_PREFIX = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

// Validate a stored photo data URL and report its decoded size.
//
// The server runs this on whatever the browser submitted: client-side
// compression is a UX convenience, never a trust boundary, so the size and
// type checks have to hold here on their own.
export function parsePhotoDataUrl(input: string): PhotoParseResult {
  const match = DATA_URL_PREFIX.exec(input.trim());
  if (!match) return { ok: false, error: "PHOTO_MALFORMED" };

  const [, mime, base64] = match;
  if (!(PHOTO_MIME_TYPES as readonly string[]).includes(mime)) {
    return { ok: false, error: "PHOTO_NOT_AN_IMAGE" };
  }

  // Base64 encodes 3 bytes per 4 characters, so a valid payload's length is a
  // multiple of 4.
  if (base64.length % 4 !== 0) return { ok: false, error: "PHOTO_MALFORMED" };

  // Derive the decoded length from the encoded length rather than allocating
  // the buffer - this runs on every submit, and we may be about to reject it.
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = (base64.length / 4) * 3 - padding;
  if (bytes <= 0) return { ok: false, error: "PHOTO_MALFORMED" };
  if (bytes > PHOTO_MAX_BYTES) return { ok: false, error: "PHOTO_TOO_LARGE" };

  return { ok: true, mime, bytes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/child-photo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/child-photo.ts src/lib/child-photo.test.ts
git commit -m "Validate child photo data URLs server-side"
```

---

### Task 3: Photo handling in `parseChildInput`

**Files:**
- Modify: `src/lib/child-input.ts`
- Test: `src/lib/child-input.test.ts`

**Interfaces:**
- Consumes: `parsePhotoDataUrl`, `childPhotoMessage`, `ChildPhotoError` from Task 2.
- Produces: `type PhotoAction = "keep" | "set" | "clear"`; `ChildFormValues` gains `hasPhoto: boolean`; `ParsedChild` gains `photo: string | null | undefined`; `ChildInputError` gains the four `ChildPhotoError` codes. `parseChildInput` takes `photo: string` and `photoAction: string` in its raw input.

**Why three states:** editing a child must tell "the parent didn't touch the photo" (`keep` → `undefined` → Prisma leaves the column alone) from "the parent removed it" (`clear` → `null` → Prisma nulls it). An empty `photo` string alone can't express both.

**Why `hasPhoto` and not the data URL:** `values` is echoed back on validation errors so the form can repopulate. A ~9 KB data URL riding in that payload on every failed submit is waste - the photo never left the browser, so the client keeps it in React state across the re-render.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/child-input.test.ts`, inside the existing `parseChildInput` suite (alongside the `avatar` sub-suite):

```ts
  await t.test("photo", async (t) => {
    // A valid, tiny photo data URL.
    const photo = `data:image/webp;base64,${Buffer.from("pretend-webp!").toString("base64")}`;
    const base = {
      name: "Ada",
      avatar: "🧒",
      birthday: "2020-01-01",
      openAtAge: "18",
    };

    await t.test("stores a photo when the action is set", () => {
      const result = parseChildInput(
        { ...base, photo, photoAction: "set" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok && result.value.photo, photo);
    });

    await t.test("clears the photo when the action is clear", () => {
      const result = parseChildInput(
        { ...base, photo: "", photoAction: "clear" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok && result.value.photo, null);
    });

    await t.test("leaves the column untouched when the action is keep", () => {
      const result = parseChildInput(
        { ...base, photo: "", photoAction: "keep" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok, true);
      assert.equal(result.ok && result.value.photo, undefined);
    });

    await t.test("ignores a submitted photo when the action is keep", () => {
      const result = parseChildInput(
        { ...base, photo, photoAction: "keep" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok && result.value.photo, undefined);
    });

    await t.test("falls back to keep for an unrecognised action", () => {
      // A bad value means a stale client, not a user mistake - same reasoning
      // as an unknown avatar falling back to the default.
      const result = parseChildInput(
        { ...base, photo: "", photoAction: "nonsense" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok, true);
      assert.equal(result.ok && result.value.photo, undefined);
    });

    await t.test("rejects an invalid data url when setting", () => {
      const result = parseChildInput(
        { ...base, photo: "https://example.com/cat.png", photoAction: "set" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.error, "PHOTO_MALFORMED");
    });

    await t.test("rejects a disallowed image type when setting", () => {
      const svg = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;
      const result = parseChildInput(
        { ...base, photo: svg, photoAction: "set" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(!result.ok && result.error, "PHOTO_NOT_AN_IMAGE");
    });

    await t.test("treats set with an empty photo as a clear", () => {
      const result = parseChildInput(
        { ...base, photo: "", photoAction: "set" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(result.ok && result.value.photo, null);
    });

    await t.test("echoes whether a photo was submitted, not the photo", () => {
      const result = parseChildInput(
        { ...base, name: "", photo, photoAction: "set" },
        new Date("2024-01-01T12:00:00Z"),
      );
      assert.equal(!result.ok && result.values.hasPhoto, true);
      // The data URL must not ride along in the echoed values.
      assert.equal(
        Object.values(!result.ok ? result.values : {}).includes(photo),
        false,
      );
    });
  });
```

Also update the existing `childInputMessage` "returns a message for every error code" test to include the four new codes:

```ts
// In the existing childInputMessage suite, extend the code list with:
//   "PHOTO_NOT_AN_IMAGE", "PHOTO_MALFORMED", "PHOTO_TOO_LARGE",
//   "PHOTO_TOO_LARGE_TO_READ"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/child-input.test.ts`
Expected: FAIL - `parseChildInput` rejects the extra `photo`/`photoAction` properties (TypeScript) and `value.photo` is undefined at runtime.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/child-input.ts`, add the import beside the existing ones:

```ts
import {
  childPhotoMessage,
  parsePhotoDataUrl,
  type ChildPhotoError,
} from "./child-photo.ts";
```

Add the action type and extend the three exported types:

```ts
// What the form wants done with the photo column. Editing must distinguish
// "untouched" from "removed", which an empty photo field alone can't express.
export type PhotoAction = "keep" | "set" | "clear";

export type ChildFormValues = {
  name: string;
  avatar: string;
  birthday: string;
  openAtAge: string;
  // Whether a photo was submitted - not the photo itself. The ~9 KB data URL
  // stays in the browser's React state across an error re-render rather than
  // making a round trip in the echoed values.
  hasPhoto: boolean;
};

export type ParsedChild = {
  name: string;
  avatar: string;
  birthday: Date;
  openAtAge: number;
  // A data URL to store, `null` to clear the column, or `undefined` to leave
  // it alone. These map straight onto Prisma's update semantics.
  photo: string | null | undefined;
};

export type ChildInputError =
  | "NAME_REQUIRED"
  | "BIRTHDAY_REQUIRED"
  | "BIRTHDAY_INVALID"
  | "OPEN_AGE_REQUIRED"
  | "OPEN_AGE_NOT_A_YEAR_COUNT"
  | "OPEN_AGE_NOT_IN_FUTURE"
  | ChildPhotoError;
```

Extend `childInputMessage` to delegate photo codes:

```ts
export function childInputMessage(
  error: ChildInputError,
  ctx: { name: string; currentAge?: number },
): string {
  switch (error) {
    case "NAME_REQUIRED":
      return "Please give your child a name.";
    case "BIRTHDAY_REQUIRED":
      return "Please add your child's birthday.";
    case "BIRTHDAY_INVALID":
      return "That birthday doesn't look right.";
    case "OPEN_AGE_REQUIRED":
      return "Please set the age they can open their bottles.";
    case "OPEN_AGE_NOT_A_YEAR_COUNT":
      return "The age they can open should be a whole number of years.";
    case "OPEN_AGE_NOT_IN_FUTURE":
      return `Pick an age older than ${ctx.name} is now (currently ${ctx.currentAge}).`;
    default:
      return childPhotoMessage(error);
  }
}
```

Update the raw input type and the body of `parseChildInput`. The raw parameter type becomes:

```ts
export function parseChildInput(
  raw: {
    name: string;
    avatar: string;
    birthday: string;
    openAtAge: string;
    photo: string;
    photoAction: string;
  },
  now: Date = new Date(),
): ChildInputResult {
```

Inside, after the existing `avatar` fallback block and before `values` is built:

```ts
  // An unrecognised action falls back to leaving the column alone, for the
  // same reason an unknown avatar falls back: it means a stale client, not a
  // user mistake.
  const photoRaw = raw.photo.trim();
  const action: PhotoAction =
    raw.photoAction === "set" || raw.photoAction === "clear"
      ? raw.photoAction
      : "keep";
```

Build `values` with `hasPhoto`:

```ts
  const values: ChildFormValues = {
    name,
    avatar,
    birthday: birthdayRaw,
    openAtAge: openAtAgeRaw,
    hasPhoto: action === "set" && photoRaw.length > 0,
  };
```

Then, after the existing open-age checks and immediately before the success
return, resolve the photo:

```ts
  // Resolve the photo last, so a bad photo never masks a missing name.
  let photo: string | null | undefined;
  if (action === "clear") {
    photo = null;
  } else if (action === "set") {
    // "Set" with nothing attached means the parent removed it before saving.
    if (!photoRaw) {
      photo = null;
    } else {
      const parsed = parsePhotoDataUrl(photoRaw);
      if (!parsed.ok) return fail(parsed.error);
      photo = photoRaw;
    }
  }

  return {
    ok: true,
    value: { name, avatar, birthday, openAtAge: age, photo },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/child-input.test.ts && npm run typecheck`
Expected: PASS. Typecheck reports an error in `src/app/actions.ts` - `parseChildForm` doesn't yet pass `photo`/`photoAction`. That is expected and Task 4 fixes it; do not patch it here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/child-input.ts src/lib/child-input.test.ts
git commit -m "Parse and validate child photo input"
```

Note: the pre-commit hook runs typecheck and **will fail** on the `actions.ts` error above. Do not commit this task separately - instead, complete Task 4 and commit Tasks 3 and 4 together with the message above plus Task 4's changes. The two are one logical change to the type surface.

---

### Task 4: Schema column and action wiring

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/app/actions.ts:107-126` (`parseChildForm`), `:140-151` (`createChild`), `:186-195` (`updateChild`)

**Interfaces:**
- Consumes: `ParsedChild.photo` from Task 3.
- Produces: a `Child.photo` column, nullable `String? @db.Text`.

- [ ] **Step 1: Add the schema column**

In `prisma/schema.prisma`, in `model Child`, directly below the `avatar` field:

```prisma
  // A parent-uploaded profile photo as a `data:image/webp;base64,...` URL,
  // already downscaled client-side to 160x160 (~7-9 KB). Null means fall back
  // to the emoji `avatar`. Small enough to sit on the row, but omitted from
  // any `select` that doesn't render it.
  photo       String?       @db.Text
```

- [ ] **Step 2: Generate the client and apply the column**

Run: `npx prisma generate && npm run db:push`
Expected: `prisma generate` succeeds and `db:push` reports the `photo` column added. This is additive and nullable - no data loss.

- [ ] **Step 3: Pass the photo fields through `parseChildForm`**

In `src/app/actions.ts`, extend the `parseChildInput` call:

```ts
  const result = parseChildInput({
    name: String(formData.get("name") ?? ""),
    avatar: String(formData.get("avatar") ?? ""),
    birthday: String(formData.get("birthday") ?? ""),
    openAtAge: String(formData.get("openAtAge") ?? ""),
    photo: String(formData.get("photo") ?? ""),
    photoAction: String(formData.get("photoAction") ?? ""),
  });
```

In `createChild`, add to the `data` object (a new child has no column to
preserve, so `undefined` means no photo):

```ts
      avatar: parsed.avatar,
      photo: parsed.photo ?? null,
```

In `updateChild`, add to the `data` object (`undefined` here is meaningful -
Prisma leaves the column untouched):

```ts
      avatar: parsed.avatar,
      photo: parsed.photo,
```

- [ ] **Step 4: Verify the whole suite passes**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green, including the Task 3 tests that were blocked on this.

- [ ] **Step 5: Commit Tasks 3 and 4 together**

```bash
git add prisma/schema.prisma src/app/actions.ts src/lib/child-input.ts src/lib/child-input.test.ts
git commit -m "Store an optional profile photo on Child"
```

---

### Task 5: The `<ChildAvatar>` component

**Files:**
- Create: `src/components/child-avatar.tsx`
- Modify: `src/lib/children.ts` (type + both selects), `src/app/dashboard/page.tsx:63`, `src/app/children/page.tsx` (selects + `:102`), `src/app/open/[token]/page.tsx:106`, `src/app/share/page.tsx` (select + `:118`), `src/components/child-card.tsx:66`, `src/components/child-form.tsx` (`EditableChild`), `src/components/letter-form.tsx:73`, `src/components/share-form.tsx:64`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `<ChildAvatar child={{ avatar: string; photo?: string | null }} name={string} size="sm" | "md" | "lg" | "xl" />`.

**Size mapping**, matching the existing markup exactly:

| `size` | Emoji class | Photo px | Call sites |
|---|---|---|---|
| `sm` | `text-2xl` | 32 | `letter-form.tsx:73`, `share-form.tsx:64` |
| `md` | `text-3xl` | 40 | `share/page.tsx:118` |
| `lg` | `text-4xl` | 48 | `dashboard/page.tsx:63`, `children/page.tsx:102`, `child-card.tsx:66` |
| `xl` | `text-5xl` | 64 | `open/[token]/page.tsx:106` |

**Sites that must NOT change** - these render the emoji as text and cannot hold an `<img>`. Do not add `photo` to their selects:
- `src/app/invite/[token]/page.tsx:55` - `${k.avatar} ${k.name}` in a prose sentence.
- `src/app/share/page.tsx:81` - same, in the invite summary.
- `src/components/letter-form.tsx:94` - inside a `<select>` `<option>`, whose content model is text only. An `<img>` there fails silently.
- `src/app/dashboard/page.tsx:127` - `{draft.child?.avatar ?? "💌"}` is inline text in a `<p>` with an emoji fallback for a letter with no recipient.

- [ ] **Step 1: Create the component**

Create `src/components/child-avatar.tsx`:

```tsx
// The one place that decides between a parent-uploaded photo and the emoji
// avatar. Every visual avatar slot goes through here; the handful of sites
// that render the emoji as text (a <select> option, prose listing kids'
// names) keep interpolating `child.avatar` directly, because an <img> is
// invalid in those positions.

type AvatarSize = "sm" | "md" | "lg" | "xl";

// Emoji class and photo pixel size per slot, matching the markup these
// replaced.
const SIZES: Record<AvatarSize, { text: string; px: number }> = {
  sm: { text: "text-2xl", px: 32 },
  md: { text: "text-3xl", px: 40 },
  lg: { text: "text-4xl", px: 48 },
  xl: { text: "text-5xl", px: 64 },
};

export function ChildAvatar({
  child,
  name,
  size = "lg",
}: {
  child: { avatar: string; photo?: string | null };
  // Used as the photo's alt text.
  name: string;
  size?: AvatarSize;
}) {
  const { text, px } = SIZES[size];

  if (child.photo) {
    return (
      // Not next/image: the source is an inline data URL already sized to its
      // render box, so there is nothing to fetch, resize, or cache.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={child.photo}
        alt={name}
        width={px}
        height={px}
        style={{ width: px, height: px }}
        className="shrink-0 rounded-full object-cover ring-1 ring-sea-100"
      />
    );
  }

  return (
    // No `leading-none`: the spans this replaced used Tailwind's default
    // line-height for each size, and overriding it shortens the avatar box
    // at every size below text-5xl.
    <span className={text} aria-hidden="true">
      {child.avatar}
    </span>
  );
}
```

- [ ] **Step 2: Widen the data types and selects**

In `src/lib/children.ts`, add `photo` to `AccessibleChild` and both selects:

```ts
export type AccessibleChild = {
  id: string;
  name: string;
  avatar: string;
  photo: string | null;
  owned: boolean;
};
```

```ts
      select: { id: true, name: true, avatar: true, photo: true },
```
(both the `owned` and `shared` queries).

In `src/components/child-form.tsx`, add to `EditableChild`:

```ts
export type EditableChild = {
  id: string;
  name: string;
  avatar: string;
  photo: string | null;
  birthday: string | null;
  openAtAge: number | null;
};
```

In `src/app/children/page.tsx`, add `photo: true` to the owned-children select and to the shared-children select, and add `photo: child.photo` to the `childCards` mapping.

In `src/app/share/page.tsx`, add `photo: true` to the select on line 19 and to the `share.child` select on line 33. **Leave the select on line 25 alone** - it feeds the prose summary on line 81.

In `src/app/open/[token]/page.tsx`, add `photo: true` to the child select feeding line 106.

In `src/app/dashboard/page.tsx`, the children come from `getAccessibleChildren`, which now includes `photo`. **Leave the `draft` include on line 20 alone** - it feeds the text fallback on line 127.

- [ ] **Step 3: Swap each visual call site**

Replace each span with the component, importing `ChildAvatar` from `@/components/child-avatar` in each file:

```tsx
// dashboard/page.tsx:63, children/page.tsx:102, child-card.tsx:66
<ChildAvatar child={child} name={child.name} size="lg" />

// open/[token]/page.tsx:106 - replaces the <div className="text-5xl">
<ChildAvatar child={child} name={child.name} size="xl" />

// letter-form.tsx:73
<ChildAvatar child={lockedChild} name={lockedChild.name} size="sm" />

// share-form.tsx:64
<ChildAvatar child={child} name={child.name} size="sm" />

// share/page.tsx:118
<ChildAvatar child={share.child} name={share.child.name} size="md" />
```

`letter-form.tsx`'s `lockedChild` prop type and its `ChildOption` type, plus `share-form.tsx`'s `ChildOption`, each need `photo: string | null` added.

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green. If lint flags `@next/next/no-img-element`, confirm the disable comment sits directly above the `<img>` line.

- [ ] **Step 5: Check the app still renders**

Visit http://localhost:3000/children and http://localhost:3000/dashboard. Every child should still show their emoji exactly as before - no photos exist yet, so this task is a pure refactor with no visible change. Check `dev.log` if a page errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/child-avatar.tsx src/lib/children.ts src/app src/components
git commit -m "Render child avatars through a shared ChildAvatar component"
```

---

### Task 6: The photo input component

**Files:**
- Create: `src/components/child-photo-input.tsx`

**Interfaces:**
- Consumes: `PHOTO_SIZE`, `PHOTO_MAX_BYTES`, `PHOTO_MAX_UPLOAD_BYTES`, `PHOTO_MIME_TYPES`, `PHOTO_QUALITY_LADDER`, `coverCrop`, `downscaleSteps`, `childPhotoMessage`, `ChildPhotoError` from Tasks 1-2.
- Produces: `<ChildPhotoInput initialPhoto={string | null} onChange={(photo: string | null, touched: boolean) => void} />` and the exported helper `compressToDataUrl(file: File): Promise<{ ok: true; dataUrl: string } | { ok: false; error: ChildPhotoError }>`.

This component is **not tested** - it needs a DOM and a canvas. All the rules it applies live in `src/lib/child-photo.ts` and are tested there, which is the point of the split.

- [ ] **Step 1: Write the component**

Create `src/components/child-photo-input.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import {
  childPhotoMessage,
  coverCrop,
  downscaleSteps,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_UPLOAD_BYTES,
  PHOTO_MIME_TYPES,
  PHOTO_QUALITY_LADDER,
  PHOTO_SIZE,
  type ChildPhotoError,
} from "@/lib/child-photo";

type CompressResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: ChildPhotoError };

// Downscale a picked file to the stored 160x160 thumbnail. The geometry rules
// come from the lib; this function is only the canvas plumbing that applies
// them, which is why it isn't unit-tested.
export async function compressToDataUrl(file: File): Promise<CompressResult> {
  // Guard before decoding, so a stray huge file can't hang the tab.
  if (file.size > PHOTO_MAX_UPLOAD_BYTES) {
    return { ok: false, error: "PHOTO_TOO_LARGE_TO_READ" };
  }

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the EXIF rotation flag, so phone photos aren't
    // stored sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, error: "PHOTO_NOT_AN_IMAGE" };
  }

  try {
    const crop = coverCrop(bitmap.width, bitmap.height);

    // Step down through the ladder - drawing a huge photo straight to 160px
    // aliases badly, so each pass at most halves.
    let canvas = document.createElement("canvas");
    let source: CanvasImageSource = bitmap;
    let sourceRect = crop;

    for (const step of downscaleSteps(crop.sw)) {
      const next = document.createElement("canvas");
      next.width = step;
      next.height = step;
      const ctx = next.getContext("2d");
      if (!ctx) return { ok: false, error: "PHOTO_MALFORMED" };
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        source,
        sourceRect.sx,
        sourceRect.sy,
        sourceRect.sw,
        sourceRect.sh,
        0,
        0,
        step,
        step,
      );
      canvas = next;
      source = next;
      // Every pass after the first draws the whole intermediate square.
      sourceRect = { sx: 0, sy: 0, sw: step, sh: step };
    }

    // Try each quality, stopping at the first encode under the cap.
    for (const quality of PHOTO_QUALITY_LADDER) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (!blob) continue;
      if (!(PHOTO_MIME_TYPES as readonly string[]).includes(blob.type)) continue;
      if (blob.size > PHOTO_MAX_BYTES) continue;
      return { ok: true, dataUrl: await blobToDataUrl(blob) };
    }

    // Even the lowest quality overshot. Say so rather than degrading further.
    return { ok: false, error: "PHOTO_TOO_LARGE" };
  } finally {
    bitmap.close();
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function ChildPhotoInput({
  initialPhoto,
  onChange,
}: {
  initialPhoto: string | null;
  // Reports the current photo and whether the parent has touched it this
  // session, which is what decides keep/set/clear on submit.
  onChange: (photo: string | null, touched: boolean) => void;
}) {
  const [photo, setPhoto] = useState<string | null>(initialPhoto);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChange(photo, touched);
  }, [photo, touched, onChange]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const result = await compressToDataUrl(file);
    setBusy(false);
    // Let the same file be picked again after an error.
    if (fileRef.current) fileRef.current.value = "";
    if (!result.ok) {
      setError(childPhotoMessage(result.error));
      return;
    }
    setPhoto(result.dataUrl);
    setTouched(true);
  }

  function remove() {
    setPhoto(null);
    setTouched(true);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div>
      <span className="field-label">Photo</span>
      <div className="flex items-center gap-3">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt="Your child's profile photo"
            width={PHOTO_SIZE / 2}
            height={PHOTO_SIZE / 2}
            style={{ width: PHOTO_SIZE / 2, height: PHOTO_SIZE / 2 }}
            className="rounded-full object-cover ring-1 ring-sea-100"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-sea-50 text-2xl ring-1 ring-sea-100">
            📷
          </div>
        )}

        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="btn-secondary text-sm disabled:opacity-60"
          >
            {busy ? "Shrinking…" : photo ? "Change photo" : "Add a photo"}
          </button>
          {photo && (
            <button
              type="button"
              onClick={remove}
              className="text-sm font-semibold text-sea-500 hover:text-blush-500"
            >
              Remove photo
            </button>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

      <p className="mt-1 text-xs text-sea-500">
        Optional - a photo replaces the emoji below. It&apos;s shrunk on your
        device before saving.
      </p>

      {error && (
        <p className="mt-2 text-sm font-semibold text-blush-500">{error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run typecheck && npm run lint`
Expected: PASS. If `ImageBitmapOptions.imageOrientation` is missing from the DOM types, confirm `@types/node`/TypeScript are current rather than casting the option away.

- [ ] **Step 3: Commit**

```bash
git add src/components/child-photo-input.tsx
git commit -m "Add a client-side photo compressor for child profiles"
```

---

### Task 7: Wire the photo input into `ChildForm`

**Files:**
- Modify: `src/components/child-form.tsx`

**Interfaces:**
- Consumes: `ChildPhotoInput` from Task 6; the `photo`/`photoAction` form fields read in Task 4.

- [ ] **Step 1: Add photo state and the hidden fields**

In `src/components/child-form.tsx`, import the component and `useCallback`:

```tsx
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { ChildPhotoInput } from "@/components/child-photo-input";
```

Add state beside the existing `avatar` state:

```tsx
  const [avatar, setAvatar] = useState<string>(child?.avatar ?? DEFAULT_AVATAR);
  // The compressed photo and whether the parent has touched it this session.
  // Held here (not echoed through the action's `values`) so an error re-render
  // keeps it without a ~9 KB round trip.
  const [photo, setPhoto] = useState<string | null>(child?.photo ?? null);
  const [photoTouched, setPhotoTouched] = useState(false);

  // Stable identity so ChildPhotoInput's reporting effect doesn't re-run every
  // render.
  const handlePhotoChange = useCallback(
    (next: string | null, touched: boolean) => {
      setPhoto(next);
      setPhotoTouched(touched);
    },
    [],
  );
```

Reset it alongside the avatar on a successful create:

```tsx
    if (!editing) {
      formRef.current?.reset();
      setAvatar(DEFAULT_AVATAR);
      setPhoto(null);
      setPhotoTouched(false);
    }
```

- [ ] **Step 2: Render the input and hidden fields**

Replace the `Pick an avatar` block's opening so the photo slot sits above the
emoji row, and carry the two hidden fields:

```tsx
      <ChildPhotoInput
        initialPhoto={child?.photo ?? null}
        onChange={handlePhotoChange}
      />

      <div>
        <span className="field-label">
          {photo ? "Or pick an avatar instead" : "Pick an avatar"}
        </span>
        <input type="hidden" name="avatar" value={avatar} />
        <input type="hidden" name="photo" value={photo ?? ""} />
        <input
          type="hidden"
          name="photoAction"
          // Untouched edits leave the column alone; a create always states its
          // intent outright.
          value={photoTouched || !editing ? (photo ? "set" : "clear") : "keep"}
        />
        {/* ...the existing emoji button row is unchanged... */}
```

- [ ] **Step 3: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 4: Test the real flow in the browser**

At http://localhost:3000/children:

1. **Add a child with a photo.** Pick a large landscape phone photo. It should compress in well under a second, preview as a centered circle, and save. The card shows the photo, not the emoji.
2. **Check the crop.** A landscape source should be center-cropped, not squashed.
3. **Check EXIF.** A photo taken in portrait on a phone should appear upright.
4. **Edit without touching the photo.** Change only the name and save - the photo must survive (`photoAction=keep`).
5. **Remove the photo.** The emoji returns, and the card falls back to it.
6. **Trigger a validation error with a photo attached.** Set the open age to one the child has already passed. The error renders *and* the photo preview survives the re-render.
7. **Check the other surfaces.** The photo appears on `/dashboard`, in the letter form's locked-child header, on `/share`, and on the child's `/open/<token>` page. It stays an emoji in the recipient `<select>`.

Check `dev.log` for errors if anything misbehaves.

- [ ] **Step 5: Commit and push**

```bash
git add src/components/child-form.tsx
git commit -m "Let parents upload a profile photo when adding or editing a child"
git push origin main
```

---

## Self-Review

**Spec coverage:** Storage column → Task 4. Query discipline → Task 5 Step 2, with the four text-only sites named explicitly. Compression lib → Tasks 1-2. Canvas wrapper (EXIF, step-down, quality ladder, upload guard) → Task 6. Form integration and three hidden fields → Task 7. `hasPhoto` echo-back → Task 3. Server re-validation → Task 2, called from Task 3, wired in Task 4. `<ChildAvatar>` and its size mapping → Task 5. Testing → Tasks 1-3.

**Type consistency:** `ParsedChild.photo` is `string | null | undefined` in Task 3 and consumed with that exact meaning in Task 4 (`?? null` on create, passed through on update). `AccessibleChild.photo` and `EditableChild.photo` are both `string | null`, matching `ChildAvatar`'s `photo?: string | null`. `ChildPhotoError` is defined once in Task 2 and reused in Tasks 3 and 6. `compressToDataUrl` returns the same shape it is destructured with.

**Known deviation from the spec:** the spec describes `parsePhotoDataUrl` returning error codes including `PHOTO_TOO_LARGE_TO_READ`, but that code is only ever produced client-side (Task 6's pre-decode guard), never by `parsePhotoDataUrl` itself. It stays in the shared `ChildPhotoError` union so `childPhotoMessage` covers it. This is intentional, not a gap.

**Commit-boundary note:** Task 3 cannot be committed alone - it breaks typecheck until Task 4 updates `parseChildForm`. The plan commits them together, which is the correct atomic unit. Do not work around this by skipping the pre-commit hook.

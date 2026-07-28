// Pure geometry and validation for inline letter images. Kept free of canvas,
// File, and the DOM so the rules can be tested with plain numbers and strings.
// The canvas work that uses these lives in
// src/components/use-letter-image-upload.ts.
//
// Sibling of child-photo.ts, with one deliberate difference: an avatar is
// cropped to a fixed square, a letter photo keeps its shape.

// Long-edge cap for a stored image. Letter content renders at most ~640px
// wide, so 1280 is exactly 2x for a retina display and stores nothing the UI
// can show.
export const IMAGE_MAX_DIMENSION = 1280;

// Long-edge floor for the byte-cap fallback. When even the lowest quality
// overshoots the byte cap at the fit size, the only lever left is fewer pixels,
// so we re-encode at progressively smaller sizes down to this floor. At 400px a
// photo is still recognisable in a letter, and a quality-0.6 WebP that small is
// a small fraction of the cap for any real image — so we never actually reach
// the floor, but it guarantees the fallback terminates.
export const IMAGE_MIN_DIMENSION = 400;

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

// Long edges to re-encode at when a photo overshoots the byte cap at its fit
// size. Encoding is the only place we learn a photo is too dense to fit, and by
// then the quality ladder is spent, so the remaining lever is pixels: each rung
// is ~15% smaller than the last, down to the floor. Starting at `from` means
// the first rung is the fit size itself — the size the quality ladder already
// runs at — so a photo that fits there never shrinks further. Paired with the
// quality ladder this makes "too large even after shrinking" unreachable for a
// real photo.
export function shrinkLadder(from: number = IMAGE_MAX_DIMENSION): number[] {
  const steps = [Math.max(from, IMAGE_MIN_DIMENSION)];
  let current = steps[0];
  while (current > IMAGE_MIN_DIMENSION) {
    current = Math.max(Math.round(current * 0.85), IMAGE_MIN_DIMENSION);
    steps.push(current);
  }
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

// Which of a letter's attached images its body no longer references.
//
// Plain values in, plain values out, so the highest-stakes deletion decision
// in this feature is testable without a session or a database. Reconciliation
// deletes exactly what this returns — blobs first, then rows.
export function staleImages<T extends { id: string; pathname: string }>(
  referenced: string[],
  attached: T[],
): T[] {
  const ids = new Set(referenced);
  return attached.filter((image) => !ids.has(image.id));
}

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

// Pure geometry and validation for child profile photos. Kept free of canvas,
// File, and the DOM so the rules can be tested with plain numbers and strings.
// The canvas work that uses these lives in
// src/components/child-photo-input.tsx.

// Stored photos are a fixed square. 160px covers the largest render (a 48px
// emoji slot on the open page) at 2x DPR with headroom to spare.
export const PHOTO_SIZE = 160;

// Decoded byte cap for a stored photo. Generous for 160px — a quality-0.82
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

// Why a photo was rejected. Codes rather than copy, so tests assert on rules
// and wording stays free to change — same convention as child-input.ts.
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
  // the buffer — this runs on every submit, and we may be about to reject it.
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = (base64.length / 4) * 3 - padding;
  if (bytes <= 0) return { ok: false, error: "PHOTO_MALFORMED" };
  if (bytes > PHOTO_MAX_BYTES) return { ok: false, error: "PHOTO_TOO_LARGE" };

  return { ok: true, mime, bytes };
}

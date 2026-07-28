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

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
  shrinkLadder,
} from "@/lib/letter-image";

// The browser half of image upload: shrink a picked file and send it. The rules
// it applies all live in src/lib/letter-image.ts; this is the canvas work
// around them, and is untested for the same reason the avatar's input is.

// An image this draft already holds, or one uploaded during this session.
export type DraftImage = { id: string; width: number; height: number };

// Draw a source down to an exact size with high-quality smoothing.
function drawTo(
  source: ImageBitmap | HTMLCanvasElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

// Shrink a picked file to something the letter UI can actually use. The child
// reads at ~640px, so anything past 1280 is bytes nobody sees.
async function compress(
  file: File,
): Promise<{ blob: Blob; width: number; height: number }> {
  // Applies the EXIF rotation flag, so phone photos aren't stored sideways.
  // That's the whole EXIF story - and re-encoding through a canvas drops the
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
    canvas = drawTo(source, width, Math.max(1, Math.round(width * aspect)));
    source = canvas;
  }

  bitmap.close();

  // Encode at the fit size and try each quality; the first result under the cap
  // wins. If even the lowest quality overshoots, the photo is too dense to fit
  // at this size, so drop to a smaller long edge and try again. Each rung
  // redraws from the previous one, so every step stays gentle, and the ladder's
  // floor guarantees this terminates - at a real photo it lands on the first
  // rung, so nothing shrinks past the fit size.
  const targetLong = Math.max(target.width, target.height);
  for (const longEdge of shrinkLadder(targetLong)) {
    const scale = longEdge / targetLong;
    const width = Math.max(1, Math.round(target.width * scale));
    const height = Math.max(1, Math.round(target.height * scale));
    if (width !== canvas.width || height !== canvas.height) {
      canvas = drawTo(canvas, width, height);
    }
    for (const quality of IMAGE_QUALITY_LADDER) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (blob && blob.size <= IMAGE_MAX_BYTES) {
        return { blob, width: canvas.width, height: canvas.height };
      }
    }
  }
  throw new Error("IMAGE_TOO_LARGE");
}

export function useLetterImageUpload({ letterId }: { letterId?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return { busy, error, upload };
}

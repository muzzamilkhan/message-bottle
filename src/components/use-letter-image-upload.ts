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

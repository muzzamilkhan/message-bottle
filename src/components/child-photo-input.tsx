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
  shrinkLadder,
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

    // Encode at 160px and try each quality; the first result under the cap
    // wins. If even the lowest quality overshoots, the photo is too dense to
    // fit at this size, so drop to a smaller square and try again. Each rung
    // redraws from the previous one, and the ladder's floor guarantees this
    // terminates - a real photo lands on the first rung, so nothing shrinks
    // past the stored size.
    for (const size of shrinkLadder(PHOTO_SIZE)) {
      if (size !== canvas.width) {
        canvas = drawSquare(canvas, size);
      }
      for (const quality of PHOTO_QUALITY_LADDER) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/webp", quality),
        );
        if (!blob) continue;
        if (!(PHOTO_MIME_TYPES as readonly string[]).includes(blob.type)) {
          continue;
        }
        if (blob.size > PHOTO_MAX_BYTES) continue;
        return { ok: true, dataUrl: await blobToDataUrl(blob) };
      }
    }

    // The shrink floor is small enough this is effectively unreachable for a
    // real photo, but the type still needs an answer.
    return { ok: false, error: "PHOTO_TOO_LARGE" };
  } finally {
    bitmap.close();
  }
}

// Redraw a square canvas down to a smaller square with high-quality smoothing.
// Used only by the byte-cap fallback, once the crop-and-downscale pass has
// already produced a square source.
function drawSquare(source: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, size, size);
  return canvas;
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
    try {
      // compressToDataUrl enumerates its failures as {ok:false}, but this
      // code has never run in a browser during implementation - an
      // unenumerated throw (FileReader rejecting, drawImage raising a
      // security error) is still possible, and without a catch it would
      // leave the button stuck on "Shrinking…" forever.
      const result = await compressToDataUrl(file);
      if (!result.ok) {
        setError(childPhotoMessage(result.error));
        return;
      }
      setPhoto(result.dataUrl);
      setTouched(true);
    } catch {
      setError(childPhotoMessage("PHOTO_MALFORMED"));
    } finally {
      setBusy(false);
      // Let the same file be picked again after an error.
      if (fileRef.current) fileRef.current.value = "";
    }
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
            alt="Your child"
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

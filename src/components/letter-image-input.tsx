"use client";

import { useRef, useState } from "react";
import { uploadLetterImage, type LetterImageState } from "@/app/actions";
import { imageMarker, letterImageIds } from "@/lib/letter-body";
import {
  downscaleSteps,
  fitDimensions,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_UPLOAD_BYTES,
  IMAGE_QUALITY_LADDER,
  IMAGES_PER_LETTER,
  letterImageMessage,
} from "@/lib/letter-image";

// The DOM half of image upload: pick a file, shrink it in the browser, send it,
// and hand back a marker for the body. The rules it applies are all in
// src/lib/letter-image.ts; this file is the canvas work around them, and is
// untested for the same reason the avatar's input is.

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

// An image this draft already holds, or one uploaded during this session.
export type DraftImage = { id: string; width: number; height: number };

export function LetterImageInput({
  letterId,
  canUpload,
  body,
  existingImages,
  onInsert,
}: {
  letterId?: string;
  // Whether this author's subscription covers uploading. The server checks
  // again — this only decides what the form offers.
  canUpload: boolean;
  // The current body, so the strip can count what's already referenced.
  body: string;
  // The images already saved against this draft. A new letter has none.
  existingImages: DraftImage[];
  onInsert: (marker: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpsell, setShowUpsell] = useState(false);
  // Images uploaded during this editing session. Merged with the saved ones so
  // a photo appears in the strip immediately, without waiting for a save.
  const [uploaded, setUploaded] = useState<DraftImage[]>([]);

  const referenced = letterImageIds(body);
  const used = referenced.length;
  const full = used >= IMAGES_PER_LETTER;

  // The body decides which photos show and in what order — the same parser the
  // renderer and reconciliation use, so the strip can't drift from the letter.
  // An upload the parent then deleted the marker for simply drops out.
  const known = new Map(
    [...existingImages, ...uploaded].map((image) => [image.id, image]),
  );
  const thumbnails = referenced
    .map((id) => known.get(id))
    .filter((image): image is DraftImage => image !== undefined);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a failure.
    event.target.value = "";
    if (!file) return;

    setError(null);

    if (file.size > IMAGE_MAX_UPLOAD_BYTES) {
      setError(letterImageMessage("IMAGE_TOO_LARGE_TO_READ"));
      return;
    }

    setBusy(true);
    try {
      const { blob, width, height } = await compress(file);
      const data = new FormData();
      data.set("image", new File([blob], "photo.webp", { type: "image/webp" }));
      data.set("width", String(width));
      data.set("height", String(height));
      if (letterId) data.set("letterId", letterId);

      const result: LetterImageState = await uploadLetterImage({}, data);
      const image = result.image;
      if (result.error || !image) {
        setError(result.error ?? letterImageMessage("IMAGE_MALFORMED"));
        return;
      }
      // Show it in the strip straight away, before any save.
      setUploaded((current) => [...current, image]);
      // Built by the same module that parses it, so the two can't drift.
      onInsert(imageMarker(image.id));
    } catch {
      setError(letterImageMessage("IMAGE_TOO_LARGE"));
    } finally {
      setBusy(false);
    }
  }

  if (!canUpload) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setShowUpsell(true)}
          className="text-sm font-semibold text-sea-500 hover:text-sea-700"
        >
          📎 Add a photo <span className="text-blush-400">· Pro</span>
        </button>
        {showUpsell && (
          <p className="mt-2 rounded-2xl bg-sea-100 px-4 py-3 text-sm text-sea-600">
            Photos in letters are part of Pro.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy || full}
        className="text-sm font-semibold text-sea-600 hover:text-sea-800 disabled:opacity-60"
      >
        {busy ? "Adding your photo…" : "📎 Add a photo"}
      </button>
      <p className="mt-1 text-xs text-sea-500">
        {full
          ? `That's all ${IMAGES_PER_LETTER} photos for this letter.`
          : `Photos sit where the marker lands. ${used}/${IMAGES_PER_LETTER} used.`}
      </p>
      {thumbnails.length > 0 && (
        // Markers are opaque cuids, so without these the parent has no way to
        // tell which marker is which photo before sealing the letter forever.
        <div className="mt-3 flex flex-wrap gap-2">
          {thumbnails.map((image) => (
            // Plain <img>, not next/image: the route is authorized per-request
            // and returns no-store, so there is nothing for the optimizer to
            // fetch or cache. No token here — this is the author's own view and
            // the route authorizes them by session.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={image.id}
              src={`/api/letter-image/${image.id}`}
              // Content, not decoration. The word "photo" is out here for the
              // same jsx-a11y/img-redundant-alt reason as in letter-body.tsx.
              alt="Included in your letter"
              width={image.width}
              height={image.height}
              className="h-16 w-auto rounded-xl"
            />
          ))}
        </div>
      )}
      {error && (
        <p className="mt-2 rounded-2xl bg-blush-200 px-4 py-3 text-sm font-semibold text-blush-500">
          {error}
        </p>
      )}
    </div>
  );
}

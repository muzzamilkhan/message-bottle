"use client";

import { useRef, useState } from "react";
import { imageMarker, letterImageIds } from "@/lib/letter-body";
import { IMAGES_PER_LETTER } from "@/lib/letter-image";
import {
  useLetterImageUpload,
  type DraftImage,
} from "@/components/use-letter-image-upload";

export type { DraftImage };

// The DOM half of image upload: pick a file, shrink it in the browser, send it,
// and hand back a marker for the body. The rules it applies are all in
// src/lib/letter-image.ts; this file is the canvas work around them, and is
// untested for the same reason the avatar's input is.

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
  const [showUpsell, setShowUpsell] = useState(false);
  // Images uploaded during this editing session. Merged with the saved ones so
  // a photo appears in the strip immediately, without waiting for a save.
  const [uploaded, setUploaded] = useState<DraftImage[]>([]);

  const { busy, error, upload } = useLetterImageUpload({ letterId });

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

    const image = await upload(file);
    if (!image) return;
    // Show it in the strip straight away, before any save.
    setUploaded((current) => [...current, image]);
    // Built by the same module that parses it, so the two can't drift.
    onInsert(imageMarker(image.id));
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

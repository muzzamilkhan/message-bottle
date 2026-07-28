"use client";

import { letterImageUrl } from "@/lib/letter-image-url";
import type { DraftImage } from "@/components/use-letter-image-upload";

// A photograph, where the parent placed it. This replaces the [[img:<cuid>]]
// marker they used to have to place by hand — the photo is the marker now.
export function LetterPhotoBlock({
  image,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  image: DraftImage;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group relative my-4">
      {/* Plain <img>, not next/image: the route is authorized per-request and
          returns no-store, so there is nothing for the optimizer to fetch or
          cache. No token here — this is the author's own view, and the route
          authorizes them by session. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={letterImageUrl(image.id)}
        // Content, not decoration. The word "photo" is out for the same
        // jsx-a11y/img-redundant-alt reason as in letter-body.tsx.
        alt="Included in your letter"
        width={image.width}
        height={image.height}
        className="h-auto w-full rounded-2xl"
      />
      <div className="absolute right-2 top-2 flex gap-1 rounded-full bg-white/90 p-1 opacity-0 shadow-sm transition group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label="Move this photo earlier"
          className="rounded-full px-2 py-1 text-sm text-sea-600 hover:bg-sea-100 disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label="Move this photo later"
          className="rounded-full px-2 py-1 text-sm text-sea-600 hover:bg-sea-100 disabled:opacity-30"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this photo from the letter"
          className="rounded-full px-2 py-1 text-sm text-sea-600 hover:bg-blush-200 hover:text-blush-500"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

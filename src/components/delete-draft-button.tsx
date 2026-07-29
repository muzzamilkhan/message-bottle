"use client";

import { useState } from "react";
import { deleteLetter } from "@/app/actions";

export function DeleteDraftButton({
  letterId,
  photosCount,
}: {
  letterId: string;
  photosCount: number;
}) {
  // When true, the confirmation panel replaces the plain delete link.
  const [confirming, setConfirming] = useState(false);

  const label =
    photosCount > 0
      ? `Delete this draft and its ${photosCount} photo${
          photosCount === 1 ? "" : "s"
        }`
      : "Delete this draft";

  if (confirming) {
    return (
      <div className="mt-6 space-y-3 rounded-2xl bg-sea-50 p-4 text-center ring-1 ring-blush-200">
        <p className="text-sm text-sea-700">
          Delete this draft{photosCount > 0 && " and its photos"} for good? This{" "}
          <strong>can&apos;t be undone</strong>.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <form action={deleteLetter}>
            <input type="hidden" name="id" value={letterId} />
            <button type="submit" className="btn-primary w-full sm:w-auto">
              Yes, delete it
            </button>
          </form>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="btn-secondary"
          >
            Keep editing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 text-center">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm font-semibold text-sea-400 hover:text-blush-500"
      >
        {label}
      </button>
    </div>
  );
}

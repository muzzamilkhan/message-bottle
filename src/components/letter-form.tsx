"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Image from "next/image";
import { createLetter, type LetterFormState } from "@/app/actions";

type Uploaded = { url: string; name: string };
type ChildOption = {
  id: string;
  name: string;
  avatar: string;
  owned?: boolean;
};

export function LetterForm({ children }: { children: ChildOption[] }) {
  const [state, formAction] = useActionState<LetterFormState, FormData>(
    createLetter,
    {},
  );
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Default the date picker to one year from today.
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const defaultDate = nextYear.toISOString().slice(0, 10);
  const minDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          setUploadError(data.error ?? "Upload failed.");
          continue;
        }
        setPhotos((prev) => [...prev, { url: data.url, name: file.name }]);
      }
    } catch {
      setUploadError("Something went wrong while uploading.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={formAction} className="card space-y-5">
      <div>
        <label htmlFor="title" className="field-label">
          Letter title
        </label>
        <input
          id="title"
          name="title"
          className="field-input"
          placeholder="Happy 18th birthday, my love"
          maxLength={120}
          required
        />
      </div>

      <div>
        <label htmlFor="childId" className="field-label">
          Who is it for?
        </label>
        <select
          id="childId"
          name="childId"
          className="field-input"
          defaultValue=""
          required
        >
          <option value="" disabled>
            Choose a child…
          </option>
          {children.map((child) => (
            <option key={child.id} value={child.id}>
              {child.avatar} {child.name}
              {child.owned === false ? " (shared with you)" : ""}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-sea-500">
          Manage kids on the{" "}
          <a href="/children" className="font-semibold text-blush-400 underline">
            your kids
          </a>{" "}
          page.
        </p>
      </div>

      <div>
        <label htmlFor="body" className="field-label">
          Your message
        </label>
        <textarea
          id="body"
          name="body"
          className="field-input min-h-48 resize-y"
          placeholder="Dear Ada, I'm writing this while you're still small enough to fall asleep on my shoulder…"
          required
        />
      </div>

      <div>
        <label htmlFor="deliverAt" className="field-label">
          Open on
        </label>
        <input
          id="deliverAt"
          name="deliverAt"
          type="date"
          className="field-input"
          defaultValue={defaultDate}
          min={minDate}
          required
        />
        <p className="mt-1 text-xs text-sea-500">
          The bottle stays sealed until this day.
        </p>
      </div>

      <div>
        <span className="field-label">Photos (optional)</span>
        <label className="btn-secondary cursor-pointer text-sm">
          {uploading ? "Uploading…" : "📸 Add photos"}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
        {uploadError && (
          <p className="mt-2 text-sm text-blush-500">{uploadError}</p>
        )}
        {photos.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
            {photos.map((p, i) => (
              <div key={p.url} className="group relative aspect-square">
                <Image
                  src={p.url}
                  alt={p.name}
                  fill
                  sizes="120px"
                  className="rounded-2xl object-cover ring-1 ring-sea-100"
                />
                <button
                  type="button"
                  onClick={() =>
                    setPhotos((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-sea-700 shadow ring-1 ring-sea-100"
                  aria-label={`Remove ${p.name}`}
                >
                  ✕
                </button>
                <input type="hidden" name="photoUrls" value={p.url} />
              </div>
            ))}
          </div>
        )}
      </div>

      {state.error && (
        <p className="rounded-2xl bg-blush-200 px-4 py-3 text-sm font-semibold text-blush-500">
          {state.error}
        </p>
      )}

      <SubmitButton disabled={uploading} />
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="btn-primary w-full disabled:opacity-60"
    >
      {pending ? "Sealing the bottle…" : "🍾 Seal & set adrift"}
    </button>
  );
}

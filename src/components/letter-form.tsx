"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveLetter, type LetterFormState } from "@/app/actions";
import { ChildAvatar } from "@/components/child-avatar";
import {
  LetterImageInput,
  type DraftImage,
} from "@/components/letter-image-input";
import type { LetterChildOption } from "@/lib/children";

type ExistingLetter = {
  id: string;
  title: string;
  childId: string | null;
  body: string;
};

export function LetterForm({
  childOptions,
  letter,
  lockedChild,
  canUploadImages,
  existingImages = [],
}: {
  childOptions: LetterChildOption[];
  letter?: ExistingLetter;
  // When the recipient is already decided (started from a child's avatar, or an
  // existing draft), the picker is hidden and the letter is fixed to this child.
  lockedChild?: { id: string; name: string; avatar: string; photo: string | null };
  // Whether this author's subscription covers photos. The server checks again.
  canUploadImages: boolean;
  // The photos this draft already holds, so the strip can show them. A new
  // letter has none.
  existingImages?: DraftImage[];
}) {
  const [state, formAction] = useActionState<LetterFormState, FormData>(
    saveLetter,
    {},
  );
  // The intent (draft vs submit) is written into a hidden field just before the
  // form submits, depending on which button was pressed.
  const intentRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // When true, the "seal forever" confirmation panel is shown instead of the
  // normal buttons.
  const [confirming, setConfirming] = useState(false);
  const [body, setBody] = useState(letter?.body ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Drop a marker on its own line at the cursor, so the photo lands where the
  // parent was writing rather than at the end.
  function insertMarker(marker: string) {
    const textarea = bodyRef.current;
    const at = textarea?.selectionStart ?? body.length;
    const before = body.slice(0, at).replace(/\n*$/, "");
    const after = body.slice(at).replace(/^\n*/, "");
    const next = [before, marker, after].filter(Boolean).join("\n\n");
    setBody(next);
  }

  function submitWith(intent: "draft" | "submit") {
    if (intentRef.current) intentRef.current.value = intent;
    formRef.current?.requestSubmit();
  }

  return (
    <form ref={formRef} action={formAction} className="card space-y-5">
      {letter && <input type="hidden" name="id" value={letter.id} />}
      <input type="hidden" name="intent" ref={intentRef} defaultValue="draft" />

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
          defaultValue={letter?.title ?? ""}
          required
        />
      </div>

      {lockedChild ? (
        <div>
          <span className="field-label">Who is it for?</span>
          <div className="flex items-center gap-3 rounded-2xl bg-sea-50 px-4 py-3 ring-1 ring-sea-100">
            <ChildAvatar child={lockedChild} name={lockedChild.name} size="sm" />
            <span className="font-semibold text-sea-800">
              {lockedChild.name}
            </span>
          </div>
          <input type="hidden" name="childId" value={lockedChild.id} />
        </div>
      ) : (
        <div>
          <label htmlFor="childId" className="field-label">
            Who is it for?
          </label>
          <select
            id="childId"
            name="childId"
            className="field-input"
            defaultValue={letter?.childId ?? ""}
          >
            <option value="">Choose a child…</option>
            {childOptions.map((child) => (
              <option key={child.id} value={child.id}>
                {child.avatar} {child.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-sea-500">
            Manage kids on the{" "}
            <a
              href="/children"
              className="font-semibold text-blush-400 underline"
            >
              your kids
            </a>{" "}
            page.
          </p>
        </div>
      )}

      <div>
        <label htmlFor="body" className="field-label">
          Your message
        </label>
        <textarea
          id="body"
          name="body"
          ref={bodyRef}
          className="field-input min-h-48 resize-y"
          placeholder="Dear Ada, I'm writing this while you're still small enough to fall asleep on my shoulder…"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <LetterImageInput
          letterId={letter?.id}
          canUpload={canUploadImages}
          body={body}
          existingImages={existingImages}
          onInsert={insertMarker}
        />
      </div>

      <p className="rounded-2xl bg-sea-100 px-4 py-3 text-sm text-sea-600">
        🗓️ This bottle opens when your child reaches the age you set on their
        profile — no per-letter date needed.
      </p>

      {state.error && (
        <p className="rounded-2xl bg-blush-200 px-4 py-3 text-sm font-semibold text-blush-500">
          {state.error}
        </p>
      )}

      {confirming ? (
        <div className="rounded-2xl bg-blush-100 p-5 ring-1 ring-blush-200">
          <p className="text-sm font-semibold text-blush-500">
            ⚠️ Sealing is forever
          </p>
          <p className="mt-2 text-sm text-sea-700">
            Once you seal this bottle you will{" "}
            <strong>never be able to view, edit, or delete it</strong>. It drifts
            off to your child and out of your hands for good.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <ConfirmSealButton onSeal={() => submitWith("submit")} />
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="btn-secondary"
            >
              Go back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <SaveDraftButton onSave={() => submitWith("draft")} />
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="btn-primary w-full"
          >
            🍾 Seal &amp; set adrift
          </button>
        </div>
      )}
    </form>
  );
}

function SaveDraftButton({ onSave }: { onSave: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={pending}
      className="btn-secondary w-full disabled:opacity-60"
    >
      {pending ? "Saving…" : "💾 Save draft"}
    </button>
  );
}

function ConfirmSealButton({ onSeal }: { onSeal: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      onClick={onSeal}
      disabled={pending}
      className="btn-primary w-full disabled:opacity-60"
    >
      {pending ? "Sealing the bottle…" : "Yes, seal it forever"}
    </button>
  );
}

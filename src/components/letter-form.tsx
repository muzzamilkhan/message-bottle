"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveLetter, type LetterFormState } from "@/app/actions";

type ChildOption = {
  id: string;
  name: string;
  avatar: string;
  owned?: boolean;
};

type ExistingLetter = {
  id: string;
  title: string;
  childId: string | null;
  body: string;
  deliverAt: string | null; // yyyy-mm-dd
};

export function LetterForm({
  children,
  letter,
}: {
  children: ChildOption[];
  letter?: ExistingLetter;
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

  // Default the date picker to one year from today for new letters.
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const defaultDate = letter?.deliverAt ?? nextYear.toISOString().slice(0, 10);
  const minDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

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
          defaultValue={letter?.body ?? ""}
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
        />
        <p className="mt-1 text-xs text-sea-500">
          The bottle stays sealed until this day.
        </p>
      </div>

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

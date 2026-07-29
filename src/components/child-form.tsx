"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createChild,
  updateChild,
  type ChildFormState,
} from "@/app/actions";
import { ChildPhotoInput } from "@/components/child-photo-input";
import { CHILD_AVATARS, DEFAULT_AVATAR } from "@/lib/avatars";

export type EditableChild = {
  id: string;
  name: string;
  avatar: string;
  photo: string | null;
  // Full calendar date as yyyy-mm-dd, or null.
  birthday: string | null;
  openAtAge: number | null;
};

export function ChildForm({
  child,
  onSaved,
}: {
  // When provided, the form edits this child instead of creating a new one.
  child?: EditableChild;
  onSaved?: () => void;
}) {
  const editing = Boolean(child);
  const [state, formAction] = useActionState<ChildFormState, FormData>(
    editing ? updateChild : createChild,
    {},
  );
  const [avatar, setAvatar] = useState<string>(child?.avatar ?? DEFAULT_AVATAR);
  // The compressed photo and whether the parent has touched it this session.
  // Held here (not echoed through the action's `values`) so an error re-render
  // keeps it without a ~9 KB round trip.
  const [photo, setPhoto] = useState<string | null>(child?.photo ?? null);
  const [photoTouched, setPhotoTouched] = useState(false);
  // ChildPhotoInput seeds its own preview state from `initialPhoto` only at
  // mount, so changing that prop after a create doesn't clear a stale
  // preview. Bumping this key forces a remount instead.
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  // Stable identity so ChildPhotoInput's reporting effect doesn't re-run every
  // render.
  const handlePhotoChange = useCallback(
    (next: string | null, touched: boolean) => {
      setPhoto(next);
      setPhotoTouched(touched);
    },
    [],
  );

  // On success, reset a create form for next time, then let the parent collapse
  // itself (an edit card, or the add-a-child section).
  useEffect(() => {
    if (!state.ok) return;
    if (!editing) {
      formRef.current?.reset();
      setAvatar(DEFAULT_AVATAR);
      setPhoto(null);
      setPhotoTouched(false);
      setPhotoInputKey((k) => k + 1);
    }
    onSaved?.();
  }, [state.ok, editing, onSaved]);

  return (
    <form ref={formRef} action={formAction} className="card space-y-4">
      {child && <input type="hidden" name="id" value={child.id} />}

      <div>
        <label htmlFor={`name-${child?.id ?? "new"}`} className="field-label">
          Child&apos;s name
        </label>
        <input
          id={`name-${child?.id ?? "new"}`}
          name="name"
          className="field-input"
          placeholder="Ada"
          maxLength={80}
          defaultValue={state.values?.name ?? child?.name}
          required
        />
      </div>

      <ChildPhotoInput
        key={photoInputKey}
        initialPhoto={child?.photo ?? null}
        onChange={handlePhotoChange}
      />

      <div>
        <span className="field-label">
          {photo ? "Or pick an avatar instead" : "Pick an avatar"}
        </span>
        <input type="hidden" name="avatar" value={avatar} />
        <input type="hidden" name="photo" value={photo ?? ""} />
        <input
          type="hidden"
          name="photoAction"
          // Untouched edits leave the column alone; a create always states its
          // intent outright.
          value={photoTouched || !editing ? (photo ? "set" : "clear") : "keep"}
        />
        <div className="flex flex-wrap gap-2">
          {CHILD_AVATARS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setAvatar(emoji)}
              aria-label={`Choose ${emoji}`}
              aria-pressed={avatar === emoji}
              className={`flex h-11 w-11 items-center justify-center rounded-2xl text-2xl ring-1 transition ${
                avatar === emoji
                  ? "bg-blush-200 ring-blush-400"
                  : "bg-sea-50 ring-sea-100 hover:bg-white"
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label
          htmlFor={`birthday-${child?.id ?? "new"}`}
          className="field-label"
        >
          Birthday
        </label>
        <input
          id={`birthday-${child?.id ?? "new"}`}
          name="birthday"
          type="date"
          className="field-input"
          defaultValue={state.values?.birthday ?? child?.birthday ?? undefined}
          max={new Date().toISOString().slice(0, 10)}
          required
        />
        <p className="mt-1 text-xs text-sea-500">
          Pick the full date - the bottle timer counts the years from it.
        </p>
      </div>

      <div>
        <label
          htmlFor={`openAtAge-${child?.id ?? "new"}`}
          className="field-label"
        >
          🍾 Age they can open their bottles
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`openAtAge-${child?.id ?? "new"}`}
            name="openAtAge"
            type="number"
            min={1}
            max={150}
            step={1}
            inputMode="numeric"
            className="field-input w-28"
            placeholder="18"
            defaultValue={state.values?.openAtAge ?? child?.openAtAge ?? undefined}
            required
          />
          <span className="text-sm text-sea-600">
            years old before they can open their bottles
          </span>
        </div>
        <p className="mt-1 text-xs text-sea-500">
          They&apos;ll get a private link that unlocks the day they reach this
          age. Must be older than they are now.
        </p>
      </div>

      {state.error && (
        <p className="rounded-2xl bg-blush-200 px-4 py-3 text-sm font-semibold text-blush-500">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton editing={editing} />
        {editing && (
          <button
            type="button"
            onClick={onSaved}
            className="text-sm font-semibold text-sea-500 hover:text-sea-700"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary disabled:opacity-60"
    >
      {editing
        ? pending
          ? "Saving…"
          : "💾 Save changes"
        : pending
          ? "Adding…"
          : "➕ Add child"}
    </button>
  );
}

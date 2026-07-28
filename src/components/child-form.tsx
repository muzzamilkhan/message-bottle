"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createChild,
  updateChild,
  type ChildFormState,
} from "@/app/actions";
import { CHILD_AVATARS, DEFAULT_AVATAR } from "@/lib/avatars";

export type EditableChild = {
  id: string;
  name: string;
  avatar: string;
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
  const formRef = useRef<HTMLFormElement>(null);

  // On a successful create, clear the form for the next child. On a successful
  // edit, let the parent card collapse itself.
  useEffect(() => {
    if (!state.ok) return;
    if (editing) {
      onSaved?.();
    } else {
      formRef.current?.reset();
      setAvatar(DEFAULT_AVATAR);
    }
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
          defaultValue={child?.name}
          required
        />
      </div>

      <div>
        <span className="field-label">Pick an avatar</span>
        <input type="hidden" name="avatar" value={avatar} />
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
          defaultValue={child?.birthday ?? undefined}
          max={new Date().toISOString().slice(0, 10)}
        />
        <p className="mt-1 text-xs text-sea-500">
          Pick the full date — the bottle timer counts the years from it.
        </p>
      </div>

      <div>
        <label
          htmlFor={`openAtAge-${child?.id ?? "new"}`}
          className="field-label"
        >
          🍾 Bottle timer (optional)
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
            defaultValue={child?.openAtAge ?? undefined}
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

"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { createChild, type ChildFormState } from "@/app/actions";
import { CHILD_AVATARS, DEFAULT_AVATAR } from "@/lib/avatars";

export function ChildForm() {
  const [state, formAction] = useActionState<ChildFormState, FormData>(
    createChild,
    {},
  );
  const [avatar, setAvatar] = useState<string>(DEFAULT_AVATAR);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(fd) => {
        formAction(fd);
        formRef.current?.reset();
        setAvatar(DEFAULT_AVATAR);
      }}
      className="card space-y-4"
    >
      <div>
        <label htmlFor="name" className="field-label">
          Child&apos;s name
        </label>
        <input
          id="name"
          name="name"
          className="field-input"
          placeholder="Ada"
          maxLength={80}
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
        <label htmlFor="birthday" className="field-label">
          Birthday (optional)
        </label>
        <input
          id="birthday"
          name="birthday"
          type="date"
          className="field-input"
        />
      </div>

      {state.error && (
        <p className="rounded-2xl bg-blush-200 px-4 py-3 text-sm font-semibold text-blush-500">
          {state.error}
        </p>
      )}

      <AddButton />
    </form>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary w-full disabled:opacity-60"
    >
      {pending ? "Adding…" : "➕ Add child"}
    </button>
  );
}

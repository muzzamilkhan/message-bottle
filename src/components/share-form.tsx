"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createShareInvite,
  type ShareInviteFormState,
} from "@/app/actions";

type ChildOption = { id: string; name: string; avatar: string };

export function ShareForm({ children }: { children: ChildOption[] }) {
  const [state, formAction] = useActionState<ShareInviteFormState, FormData>(
    createShareInvite,
    {},
  );
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // When the action returns a token, build the absolute link in the browser
  // so it always matches the host the co-parent will open.
  useEffect(() => {
    if (state.token) {
      setLink(`${window.location.origin}/invite/${state.token}`);
      setCopied(false);
    }
  }, [state.token]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (children.length === 0) {
    return (
      <div className="card text-sea-600">
        Add a child first — then you can invite a co-parent to write to them.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form action={formAction} className="card space-y-4">
        <div>
          <span className="field-label">Choose who to share</span>
          <div className="space-y-2">
            {children.map((child) => (
              <label
                key={child.id}
                className="flex cursor-pointer items-center gap-3 rounded-2xl bg-sea-50 px-4 py-3 ring-1 ring-sea-100"
              >
                <input
                  type="checkbox"
                  name="childIds"
                  value={child.id}
                  className="h-5 w-5 accent-blush-500"
                />
                <span className="text-2xl">{child.avatar}</span>
                <span className="font-semibold text-sea-800">
                  {child.name}
                </span>
              </label>
            ))}
          </div>
        </div>

        {state.error && (
          <p className="rounded-2xl bg-blush-200 px-4 py-3 text-sm font-semibold text-blush-500">
            {state.error}
          </p>
        )}

        <CreateButton />
      </form>

      {link && (
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-sea-700">
            🔗 Share this link with the other parent
          </p>
          <p className="text-xs text-sea-500">
            Anyone who opens it can sign in (creating an account if they need
            one) and accept to start writing to the kids you picked.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
              className="field-input flex-1 text-sm"
            />
            <button
              type="button"
              onClick={copy}
              className="btn-secondary text-sm"
            >
              {copied ? "✓ Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary w-full disabled:opacity-60"
    >
      {pending ? "Creating link…" : "🔗 Create share link"}
    </button>
  );
}

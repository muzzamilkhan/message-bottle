"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  acceptShareInvite,
  type AcceptInviteFormState,
} from "@/app/actions";

export function AcceptInvite({ token }: { token: string }) {
  const [state, formAction] = useActionState<AcceptInviteFormState, FormData>(
    acceptShareInvite,
    {},
  );

  return (
    <form action={formAction} className="w-full">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <p className="mb-3 rounded-2xl bg-blush-200 px-4 py-3 text-sm font-semibold text-blush-500">
          {state.error}
        </p>
      )}
      <AcceptButton />
    </form>
  );
}

function AcceptButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary w-full disabled:opacity-60"
    >
      {pending ? "Accepting…" : "✅ Accept & start writing"}
    </button>
  );
}

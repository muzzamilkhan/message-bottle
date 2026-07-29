"use client";

import { useState } from "react";
import { deleteAccount } from "@/app/actions";

// The destructive "delete everything" control on the account page. Kept behind
// a two-step confirmation because closing the account takes every child,
// letter, and photo with it and can never be undone.
export function DeleteAccountSection({
  childrenCount,
  lettersCount,
  photosCount,
}: {
  childrenCount: number;
  lettersCount: number;
  photosCount: number;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="card space-y-4 ring-2 ring-blush-300">
      <div>
        <h2 className="text-lg font-bold text-blush-500">⚠️ Delete account</h2>
        <p className="mt-1 text-sm text-sea-700">
          Closing your account permanently deletes everything you&apos;ve made
          here — all{" "}
          <strong>
            {childrenCount} child{childrenCount === 1 ? "" : "ren"}
          </strong>
          , every one of the{" "}
          <strong>
            {lettersCount} letter{lettersCount === 1 ? "" : "s"}
          </strong>{" "}
          you&apos;ve ever written or sent
          {photosCount > 0 ? (
            <>
              {" "}
              and the{" "}
              <strong>
                {photosCount} photo{photosCount === 1 ? "" : "s"}
              </strong>{" "}
              inside them
            </>
          ) : null}
          . Sealed bottles already on their way to your children will be
          destroyed too, and their private open links will stop working.
        </p>
      </div>

      {confirming ? (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-blush-500">
            This <strong>can&apos;t be undone</strong>. Are you absolutely sure?
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <form action={deleteAccount} className="sm:flex-1">
              <button type="submit" className="btn-primary w-full">
                Yes, delete my account and everything in it
              </button>
            </form>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="btn-secondary"
            >
              Keep my account
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn-secondary text-blush-500"
        >
          Delete my account
        </button>
      )}
    </section>
  );
}

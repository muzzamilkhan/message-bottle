"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  discardDraftImages,
  saveLetter,
  type LetterFormState,
} from "@/app/actions";
import { ChildAvatar } from "@/components/child-avatar";
import { LetterBlocksEditor } from "@/components/letter-blocks-editor";
import type { DraftImage } from "@/components/use-letter-image-upload";
import type { LetterChildOption } from "@/lib/children";
import { toBlocks, toBody, type LetterBlock } from "@/lib/letter-blocks";

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
  lockedChild?: {
    id: string;
    name: string;
    avatar: string;
    photo: string | null;
    openAtAge: number;
  };
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
  const router = useRouter();
  // When true, the "seal forever" confirmation panel is shown instead of the
  // normal buttons.
  const [confirming, setConfirming] = useState(false);
  // When true, the "discard this letter" confirmation panel is shown.
  const [discarding, setDiscarding] = useState(false);
  const [discardPending, startDiscard] = useTransition();
  // Ids of photos uploaded while writing *this* letter. A brand-new letter's
  // uploads sit unattached until its first save, so discarding before saving
  // would leave them for the 24h orphan sweep - we delete them now instead.
  // We track every upload, not just the ones still in the body, because a photo
  // the author added and then removed is just as unsaved and just as owed a
  // deletion.
  const sessionImageIds = useRef<string[]>([]);
  // The chosen recipient. A locked child is fixed; otherwise it follows the
  // picker. We need it to name the open age, and to hold the message back until
  // a child is chosen so there's an age to show.
  const [childId, setChildId] = useState(
    lockedChild?.id ?? letter?.childId ?? "",
  );
  const selectedChild = lockedChild?.id === childId
    ? lockedChild
    : childOptions.find((child) => child.id === childId);
  // The body as blocks. Serialised back to the stored string on submit, so the
  // server sees exactly what the old textarea sent.
  const [blocks, setBlocks] = useState<LetterBlock[]>(() => {
    const loaded = toBlocks(letter?.body ?? "");
    // Always something to type into.
    return loaded.length > 0 ? loaded : [{ kind: "text", text: "" }];
  });

  function submitWith(intent: "draft" | "submit") {
    if (intentRef.current) intentRef.current.value = intent;
    formRef.current?.requestSubmit();
  }

  // Throw the letter away without saving, taking its just-uploaded photos with
  // it. The server only deletes still-unattached rows the caller owns, so this
  // can never reach a saved draft's or a sealed letter's images.
  function discard() {
    startDiscard(async () => {
      await discardDraftImages(sessionImageIds.current);
      router.push("/dashboard");
    });
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
            value={childId}
            onChange={(e) => setChildId(e.target.value)}
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
        <span className="field-label">Your message</span>
        {/* The body travels as the same plain string it always has. */}
        <input type="hidden" name="body" value={toBody(blocks)} />
        <LetterBlocksEditor
          blocks={blocks}
          onChange={setBlocks}
          letterId={letter?.id}
          canUpload={canUploadImages}
          existingImages={existingImages}
          onImageUploaded={(image) => {
            sessionImageIds.current = [...sessionImageIds.current, image.id];
          }}
        />
      </div>

      {selectedChild && (
        <p className="rounded-2xl bg-sea-100 px-4 py-3 text-sm text-sea-600">
          🗓️ This bottle opens when {selectedChild.name} turns{" "}
          {selectedChild.openAtAge} years old.
        </p>
      )}

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
      ) : discarding ? (
        <div className="rounded-2xl bg-blush-100 p-5 ring-1 ring-blush-200">
          <p className="text-sm font-semibold text-blush-500">
            Discard this letter?
          </p>
          <p className="mt-2 text-sm text-sea-700">
            This letter hasn&apos;t been saved. Discarding throws away what
            you&apos;ve written{" "}
            <strong>and deletes any photos you added to it</strong>. This
            can&apos;t be undone.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={discard}
              disabled={discardPending}
              className="btn-primary w-full disabled:opacity-60"
            >
              {discardPending ? "Discarding…" : "Yes, discard it"}
            </button>
            <button
              type="button"
              onClick={() => setDiscarding(false)}
              disabled={discardPending}
              className="btn-secondary"
            >
              Keep writing
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
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
          {/* Only a brand-new letter has unsaved uploads to clean up; an
              existing draft already persists, so it is edited or deleted, not
              discarded. */}
          {!letter && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setDiscarding(true)}
                className="text-sm font-semibold text-sea-500 hover:text-blush-500"
              >
                Discard letter
              </button>
            </div>
          )}
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

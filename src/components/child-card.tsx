"use client";

import { useEffect, useState } from "react";
import { deleteChild } from "@/app/actions";
import { ChildForm, type EditableChild } from "@/components/child-form";
import { ChildAvatar } from "@/components/child-avatar";

export type ChildCardData = EditableChild & {
  openToken: string | null;
  lettersCount: number;
  birthdayLabel: string | null;
  // Human-readable bottle-timer status, or null when no timer is set.
  timerLabel: string | null;
  // True once the child has reached their open age.
  unlocked: boolean;
};

export function ChildCard({ child }: { child: ChildCardData }) {
  const [editing, setEditing] = useState(false);
  // When true, the destructive-remove confirmation panel replaces the card.
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  if (editing) {
    return <ChildForm child={child} onSaved={() => setEditing(false)} />;
  }

  if (confirmingRemove) {
    const letterWarning =
      child.lettersCount > 0
        ? `All ${child.lettersCount} letter${
            child.lettersCount === 1 ? "" : "s"
          } written to ${child.name} will be deleted forever`
        : `Any letters written to ${child.name} will be deleted forever`;
    return (
      <li className="card space-y-4 ring-2 ring-blush-300">
        <div>
          <p className="text-sm font-semibold text-blush-500">
            ⚠️ Remove {child.name}?
          </p>
          <p className="mt-2 text-sm text-sea-700">
            {letterWarning}, and their private open link will stop working. This{" "}
            <strong>can&apos;t be undone</strong>.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <form action={deleteChild} className="sm:flex-1">
            <input type="hidden" name="id" value={child.id} />
            <button type="submit" className="btn-primary w-full">
              Yes, remove &amp; delete letters
            </button>
          </form>
          <button
            type="button"
            onClick={() => setConfirmingRemove(false)}
            className="btn-secondary"
          >
            Keep {child.name}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="card space-y-3">
      <div className="flex items-center gap-4">
        <ChildAvatar child={child} name={child.name} size="lg" />
        <div className="flex-1">
          <p className="font-bold text-sea-800">{child.name}</p>
          <p className="text-xs text-sea-500">
            {child.lettersCount} letter{child.lettersCount === 1 ? "" : "s"}
            {child.birthdayLabel && ` · 🎂 ${child.birthdayLabel}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-semibold text-sea-600 hover:text-sea-800"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            className="text-sm font-semibold text-sea-400 hover:text-blush-500"
          >
            Remove
          </button>
        </div>
      </div>

      {child.timerLabel && (
        <div
          className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
            child.unlocked
              ? "bg-blush-200 text-blush-500"
              : "bg-sea-100 text-sea-700"
          }`}
        >
          🍾 {child.timerLabel}
        </div>
      )}

      {child.openToken && child.openAtAge ? (
        <OpenLink token={child.openToken} name={child.name} />
      ) : (
        <p className="text-xs text-sea-500">
          Set a bottle timer from <strong>Edit</strong> to create{" "}
          {child.name}&apos;s private open link.
        </p>
      )}
    </li>
  );
}

function OpenLink({ token, name }: { token: string; name: string }) {
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  // Build the absolute link in the browser so it matches the host the child
  // will actually open.
  useEffect(() => {
    setLink(`${window.location.origin}/open/${token}`);
  }, [token]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-2xl bg-sea-50 p-3 ring-1 ring-sea-100">
      <p className="mb-2 text-xs font-semibold text-sea-700">
        🔗 {name}&apos;s self-opening link
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="field-input flex-1 text-xs"
        />
        <button
          type="button"
          onClick={copy}
          className="btn-secondary text-sm"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { ChildForm } from "@/components/child-form";

// The "Add a child" form starts collapsed behind a button. Expanding it reveals
// the form; a successful add (or Cancel) collapses it again.
export function AddChildSection() {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-sea-800">Add a child</h2>
        {open && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm font-semibold text-sea-500 hover:text-sea-700"
          >
            Cancel
          </button>
        )}
      </div>

      {open ? (
        <ChildForm onSaved={() => setOpen(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-primary w-full"
        >
          ➕ Add a child
        </button>
      )}
    </section>
  );
}

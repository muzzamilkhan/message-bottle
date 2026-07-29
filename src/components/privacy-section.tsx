"use client";

import { useState } from "react";

type PrivacyPoint = {
  summary: string;
  detail: string;
};

const points: PrivacyPoint[] = [
  {
    summary: "Your letters are for your child's eyes and yours — no one else's",
    detail:
      "The words you write are scrambled before they're stored, so even someone who got hold of our database would see nothing but gibberish. The letter is unlocked only for you while you write it, and for your child once the bottle is ready to open.",
  },
  {
    summary: "The photos you share stay private, never out in the open",
    detail:
      "Any photo you add to a letter is kept in private storage — there's no public web address anyone can guess or share. A photo is served only to you and, when the time comes, to your child through their private open link. Until the bottle's day arrives, the photos stay locked away just like the words.",
  },
  {
    summary:
      "Remove a child and everything written to them disappears with it",
    detail:
      "Removing a child isn't a soft delete. Every letter you wrote to them — drafts and sealed ones alike — along with all their photos is permanently removed from our storage right away. Once it's gone, it's gone.",
  },
  {
    summary:
      "Close your account and every trace of your data goes with it",
    detail:
      "When you close your account we remove everything tied to it — your children's profiles, every letter, and every photo. Nothing is quietly kept behind the scenes.",
  },
];

export function PrivacySection() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="privacy" className="w-full pb-24">
      <h2 className="mb-2 text-center text-2xl font-bold text-sea-800">
        Your privacy comes first
      </h2>
      <p className="mx-auto mb-8 max-w-md text-center text-sea-700">
        Your privacy is of the utmost importance to us. Here&apos;s exactly how
        we protect the letters and photos you trust us with.
      </p>

      <div className="mx-auto max-w-2xl space-y-4">
        {points.map((point, i) => {
          const isOpen = open === i;
          return (
            <div key={point.summary} className="card">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-sea-100 text-sm font-bold text-sea-700"
                >
                  ✓
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sea-800">{point.summary}</p>
                  {isOpen && (
                    <p className="mt-2 text-sm leading-relaxed text-sea-600">
                      {point.detail}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="mt-2 text-sm font-semibold text-blush-500 hover:text-blush-400"
                  >
                    {isOpen ? "Less info" : "More info"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

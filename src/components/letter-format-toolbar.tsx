"use client";

// The B / I formatting bar pinned to the top of the letter editor's input.
//
// It must not steal focus: taking focus would collapse the selection the
// buttons are about to format, so the bar suppresses mousedown rather than
// relying on click alone. It sticks just under the page header (itself sticky
// at the viewport top) so it stays in reach while the parent writes a long
// letter and the page scrolls past it.
//
// `boldActive` / `italicActive` come from the real selection (queryCommandState
// in the editor), not a click-toggle, so the pressed look always matches
// what's actually formatted - including after Cmd+B or moving the caret in and
// out of styled text.
export function LetterFormatToolbar({
  boldActive,
  italicActive,
  onBold,
  onItalic,
}: {
  boldActive: boolean;
  italicActive: boolean;
  onBold: () => void;
  onItalic: () => void;
}) {
  return (
    // Keeping the selection alive is the whole job of the mousedown handler
    // below. A plain group isn't an interactive role, so jsx-a11y wants the
    // listener on something focusable - but making this focusable is exactly
    // what would steal the selection, so the rule doesn't apply here.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      // Negative margins pull the bar out to the field's edges (cancelling its
      // px-4 pt-3), so it reads as a header the text scrolls under; the matching
      // background hides that text as it passes beneath.
      className="sticky top-14 z-[5] -mx-4 -mt-3 mb-1 flex gap-1 rounded-t-2xl border-b border-sea-100 bg-sea-50/95 px-4 py-1.5 backdrop-blur"
      onMouseDown={(event) => event.preventDefault()}
      role="group"
      aria-label="Text formatting"
    >
      <button
        type="button"
        onClick={onBold}
        aria-label="Bold"
        aria-pressed={boldActive}
        className={`rounded-lg px-3 py-1 text-sm font-extrabold ${
          boldActive
            ? "bg-sea-200 text-sea-900"
            : "text-sea-600 hover:bg-sea-100 hover:text-sea-800"
        }`}
      >
        B
      </button>
      <button
        type="button"
        onClick={onItalic}
        aria-label="Italic"
        aria-pressed={italicActive}
        className={`rounded-lg px-3 py-1 text-sm italic ${
          italicActive
            ? "bg-sea-200 text-sea-900"
            : "text-sea-600 hover:bg-sea-100 hover:text-sea-800"
        }`}
      >
        I
      </button>
    </div>
  );
}

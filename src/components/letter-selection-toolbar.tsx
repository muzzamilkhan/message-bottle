"use client";

// The floating B / I popover, shown above a selection inside a text block.
//
// It must not steal focus: taking focus would collapse the very selection the
// buttons are about to format, so every button suppresses mousedown rather
// than relying on click alone.
export function LetterSelectionToolbar({
  position,
  onBold,
  onItalic,
}: {
  // Viewport coordinates of the selection, or null when there is none.
  position: { top: number; left: number } | null;
  onBold: () => void;
  onItalic: () => void;
}) {
  if (!position) return null;

  return (
    // Keeping the selection alive is the whole job of the mousedown handler
    // below. A plain group isn't an interactive role, so jsx-a11y wants the
    // listener on something focusable — but making this focusable is exactly
    // what would steal the selection, so the rule doesn't apply here.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      // Fixed, because the coordinates come from getBoundingClientRect.
      style={{ top: position.top, left: position.left }}
      className="fixed z-50 flex -translate-x-1/2 -translate-y-full gap-1 rounded-xl bg-sea-800 p-1 shadow-lg"
      onMouseDown={(event) => event.preventDefault()}
      role="group"
      aria-label="Text formatting"
    >
      <button
        type="button"
        onClick={onBold}
        aria-label="Bold"
        className="rounded-lg px-3 py-1 text-sm font-extrabold text-white hover:bg-sea-600"
      >
        B
      </button>
      <button
        type="button"
        onClick={onItalic}
        aria-label="Italic"
        className="rounded-lg px-3 py-1 text-sm italic text-white hover:bg-sea-600"
      >
        I
      </button>
    </div>
  );
}

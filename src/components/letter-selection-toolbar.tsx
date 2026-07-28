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
    <div
      // Fixed, because the coordinates come from getBoundingClientRect.
      style={{ top: position.top, left: position.left }}
      className="fixed z-50 flex -translate-x-1/2 -translate-y-full gap-1 rounded-xl bg-sea-800 p-1 shadow-lg"
      // Keeping the selection alive is the whole job of this handler.
      onMouseDown={(event) => event.preventDefault()}
      role="toolbar"
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

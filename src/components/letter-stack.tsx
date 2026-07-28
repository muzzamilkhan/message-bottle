"use client";

import { useRef, useState } from "react";
import {
  cardStyle,
  LEAVE_MS,
  shouldAdvance,
  swipeDirection,
  VISIBLE_CARDS,
} from "@/lib/letter-stack-style";
import { LetterBody, type LetterImageRef } from "@/components/letter-body";

// One letter, pre-formatted on the server so the client never touches Date
// logic. By the time the stack renders, the child has reached their open age,
// so every letter here is unlocked and ready to read.
export type StackLetter = {
  id: string;
  title: string;
  body: string;
  images: LetterImageRef[];
  authorName: string;
  writtenDate: string;
};

export function LetterStack({
  letters,
  openToken,
  bypass = false,
}: {
  letters: StackLetter[];
  openToken: string;
  // Passed straight down to the photos. See LetterBody: text and images have to
  // clear the age gate together.
  bypass?: boolean;
}) {
  // Index of the letter currently on top of the stack. Oldest is first, so we
  // read from the bottom of the pile forward in time.
  const [index, setIndex] = useState(0);
  // Live drag offset of the top card, and whether a pointer is down.
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  // When set, the top card is animating off-screen in this direction before
  // the next letter takes its place.
  const [leaving, setLeaving] = useState<null | "left" | "right">(null);
  const startX = useRef(0);

  const total = letters.length;
  const done = index >= total;

  function advance(direction: "left" | "right") {
    setLeaving(direction);
    // Match the CSS transition duration before swapping in the next card.
    window.setTimeout(() => {
      setIndex((i) => i + 1);
      setLeaving(null);
      setDrag(0);
    }, LEAVE_MS);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (leaving) return;
    startX.current = e.clientX;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || leaving) return;
    setDrag(e.clientX - startX.current);
  }

  function onPointerUp() {
    if (!dragging || leaving) return;
    setDragging(false);
    if (shouldAdvance(drag)) {
      advance(swipeDirection(drag));
    } else {
      // Not far enough — spring back to center.
      setDrag(0);
    }
  }

  function restart() {
    setIndex(0);
    setDrag(0);
    setLeaving(null);
  }

  if (done) {
    return (
      <div className="card flex flex-col items-center py-16 text-center">
        <div className="text-5xl">💌</div>
        <h2 className="mt-4 text-2xl font-extrabold text-sea-800">
          That&apos;s every bottle, for now
        </h2>
        <p className="mt-2 max-w-sm text-sea-600">
          You&apos;ve read all {total} letter{total === 1 ? "" : "s"} that have
          washed ashore. Keep them close. 🐚
        </p>
        <button onClick={restart} className="btn-secondary mt-6">
          Read them again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-center gap-2">
        {letters.map((_, i) => (
          <span
            key={i}
            className={`h-2 rounded-full transition-all ${
              i < index
                ? "w-2 bg-sea-300"
                : i === index
                ? "w-6 bg-blush-500"
                : "w-2 bg-sea-200"
            }`}
          />
        ))}
      </div>

      {/* The stack. Cards are absolutely positioned; the top one is draggable.
          `perspective` gives the swipe-away a real page-flip feel. */}
      <div
        className="relative select-none"
        style={{ perspective: "1400px", minHeight: "26rem" }}
      >
        {letters
          .map((letter, i) => ({ letter, i }))
          .filter(({ i }) => i >= index && i < index + VISIBLE_CARDS)
          .reverse()
          .map(({ letter, i }) => {
            const depth = i - index; // 0 = top card, 1 = behind, 2 = further
            const isTop = depth === 0;

            return (
              <div
                key={letter.id}
                className="absolute inset-0"
                style={{
                  ...cardStyle(depth, { drag, dragging, leaving }),
                  transformStyle: "preserve-3d",
                  touchAction: "pan-y",
                  cursor: isTop ? (dragging ? "grabbing" : "grab") : "default",
                }}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? onPointerUp : undefined}
                onPointerCancel={isTop ? onPointerUp : undefined}
              >
                <LetterCard
                  letter={letter}
                  openToken={openToken}
                  bypass={bypass}
                />
              </div>
            );
          })}
      </div>

      <div className="mt-6 flex items-center justify-center gap-4">
        <span className="text-sm font-semibold text-sea-500">
          Letter {index + 1} of {total}
        </span>
        <button
          onClick={() => !leaving && advance("left")}
          className="btn-primary"
        >
          {index + 1 === total ? "Finish" : "Next letter"} →
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-sea-400">
        Swipe the letter away to read the next one.
      </p>
    </div>
  );
}

function LetterCard({
  letter,
  openToken,
  bypass,
}: {
  letter: StackLetter;
  openToken: string;
  bypass?: boolean;
}) {
  return (
    <article className="card flex h-full flex-col overflow-y-auto">
      <h2 className="text-2xl font-extrabold text-sea-800">{letter.title}</h2>
      <p className="mt-1 text-xs text-sea-500">
        From <strong className="text-sea-700">{letter.authorName}</strong> ·
        written {letter.writtenDate}
      </p>
      <div className="mt-5 text-lg leading-relaxed text-sea-800">
        <LetterBody
          body={letter.body}
          images={letter.images}
          openToken={openToken}
          bypass={bypass}
        />
      </div>
    </article>
  );
}

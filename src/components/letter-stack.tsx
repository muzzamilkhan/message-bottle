"use client";

import { useRef, useState } from "react";
import { Bottle } from "./bottle";

// One letter, pre-formatted on the server so the client never touches Date
// logic. Locked letters (delivery date still in the future) travel through the
// stack too, shown as a sealed bottle you can swipe past.
export type StackLetter = {
  id: string;
  title: string;
  body: string;
  authorName: string;
  writtenDate: string;
  deliverDate: string;
  countdown: string;
  unlocked: boolean;
};

// How far (px) the top letter must be dragged before it flies away for good.
const SWIPE_THRESHOLD = 110;

export function LetterStack({ letters }: { letters: StackLetter[] }) {
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
    // Match the CSS transition duration below before swapping in the next card.
    window.setTimeout(() => {
      setIndex((i) => i + 1);
      setLeaving(null);
      setDrag(0);
    }, 380);
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
    if (Math.abs(drag) > SWIPE_THRESHOLD) {
      advance(drag < 0 ? "left" : "right");
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
          .filter(({ i }) => i >= index && i < index + 3)
          .reverse()
          .map(({ letter, i }) => {
            const depth = i - index; // 0 = top card, 1 = behind, 2 = further
            const isTop = depth === 0;

            // Cards behind sit slightly lower and scaled down, fanning the pile.
            let transform: string;
            let transition: string;
            let opacity = 1;

            if (isTop) {
              if (leaving) {
                const dir = leaving === "left" ? -1 : 1;
                transform = `translateX(${dir * 140}%) rotate(${
                  dir * 18
                }deg) rotateY(${dir * -60}deg)`;
                transition =
                  "transform 380ms cubic-bezier(0.4, 0, 0.2, 1), opacity 380ms ease";
                opacity = 0;
              } else {
                const rot = drag / 22;
                const flip = drag / 14; // subtle Y-axis flip while dragging
                transform = `translateX(${drag}px) rotate(${rot}deg) rotateY(${flip}deg)`;
                transition = dragging
                  ? "none"
                  : "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)";
              }
            } else {
              transform = `translateY(${depth * 14}px) scale(${
                1 - depth * 0.05
              })`;
              transition = "transform 300ms ease";
              opacity = 1 - depth * 0.08;
            }

            return (
              <div
                key={letter.id}
                className="absolute inset-0"
                style={{
                  transform,
                  transition,
                  opacity,
                  zIndex: 10 - depth,
                  transformStyle: "preserve-3d",
                  touchAction: "pan-y",
                  cursor: isTop ? (dragging ? "grabbing" : "grab") : "default",
                }}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? onPointerUp : undefined}
                onPointerCancel={isTop ? onPointerUp : undefined}
              >
                <LetterCard letter={letter} />
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

function LetterCard({ letter }: { letter: StackLetter }) {
  if (!letter.unlocked) {
    return (
      <div className="card flex h-full flex-col items-center justify-center py-10 text-center">
        <div className="animate-bob">
          <Bottle className="w-24" />
        </div>
        <span className="mt-3 rounded-full bg-sea-100 px-4 py-1 text-xs font-semibold text-sea-700">
          🔒 {letter.countdown}
        </span>
        <p className="mt-3 text-sea-600">
          This bottle opens on <strong>{letter.deliverDate}</strong>.
        </p>
        <p className="mt-1 text-xs text-sea-400">
          From {letter.authorName}
        </p>
      </div>
    );
  }

  return (
    <article className="card flex h-full flex-col overflow-y-auto">
      <h2 className="text-2xl font-extrabold text-sea-800">{letter.title}</h2>
      <p className="mt-1 text-xs text-sea-500">
        From <strong className="text-sea-700">{letter.authorName}</strong> ·
        written {letter.writtenDate}
      </p>
      <div className="mt-5 whitespace-pre-wrap text-lg leading-relaxed text-sea-800">
        {letter.body}
      </div>
    </article>
  );
}

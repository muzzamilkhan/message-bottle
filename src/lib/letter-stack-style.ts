// Pure geometry for the letter stack's swipe animation. Split out of the
// component so the transform maths can be checked without a DOM.

export type StackDrag = {
  // Live horizontal drag offset of the top card, in px.
  drag: number;
  // Whether a pointer is currently down (drag follows the finger with no
  // transition, so it doesn't lag).
  dragging: boolean;
  // When set, the top card is flying off in this direction.
  leaving: null | "left" | "right";
};

export type StackCardStyle = {
  transform: string;
  transition: string;
  opacity: number;
  zIndex: number;
};

// How far (px) the top letter must be dragged before it flies away for good.
export const SWIPE_THRESHOLD = 110;

// Duration of the fly-away, in ms. The component waits this long before
// swapping in the next card, so the two must stay in step.
export const LEAVE_MS = 380;

// How many cards are rendered at once — the top one plus two behind it.
export const VISIBLE_CARDS = 3;

// True when a finished drag was far enough to send the card away.
export function shouldAdvance(drag: number): boolean {
  return Math.abs(drag) > SWIPE_THRESHOLD;
}

// Which way a released drag should fly off.
export function swipeDirection(drag: number): "left" | "right" {
  return drag < 0 ? "left" : "right";
}

// The style for one card. `depth` is 0 for the top card, 1 for the one behind
// it, and so on.
export function cardStyle(depth: number, state: StackDrag): StackCardStyle {
  const zIndex = 10 - depth;

  // Cards behind sit slightly lower and scaled down, fanning the pile.
  if (depth !== 0) {
    return {
      transform: `translateY(${depth * 14}px) scale(${1 - depth * 0.05})`,
      transition: "transform 300ms ease",
      opacity: 1 - depth * 0.08,
      zIndex,
    };
  }

  if (state.leaving) {
    const dir = state.leaving === "left" ? -1 : 1;
    return {
      transform: `translateX(${dir * 140}%) rotate(${dir * 18}deg) rotateY(${
        dir * -60
      }deg)`,
      transition: `transform ${LEAVE_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${LEAVE_MS}ms ease`,
      opacity: 0,
      zIndex,
    };
  }

  // Following the finger: tilt with the drag, plus a subtle Y-axis flip.
  return {
    transform: `translateX(${state.drag}px) rotate(${
      state.drag / 22
    }deg) rotateY(${state.drag / 14}deg)`,
    // No transition while dragging, or the card lags behind the pointer.
    transition: state.dragging
      ? "none"
      : "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)",
    opacity: 1,
    zIndex,
  };
}

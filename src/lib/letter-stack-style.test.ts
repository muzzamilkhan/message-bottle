import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cardStyle,
  shouldAdvance,
  swipeDirection,
  SWIPE_THRESHOLD,
  type StackDrag,
} from "./letter-stack-style.ts";

const idle: StackDrag = { drag: 0, dragging: false, leaving: null };

describe("shouldAdvance", () => {
  it("is false for a drag short of the threshold", () => {
    assert.equal(shouldAdvance(SWIPE_THRESHOLD - 1), false);
  });

  it("is false exactly at the threshold", () => {
    assert.equal(shouldAdvance(SWIPE_THRESHOLD), false);
  });

  it("is true past the threshold", () => {
    assert.equal(shouldAdvance(SWIPE_THRESHOLD + 1), true);
  });

  it("treats left and right drags alike", () => {
    assert.equal(shouldAdvance(-(SWIPE_THRESHOLD + 1)), true);
    assert.equal(shouldAdvance(-(SWIPE_THRESHOLD - 1)), false);
  });

  it("is false for no movement", () => {
    assert.equal(shouldAdvance(0), false);
  });
});

describe("swipeDirection", () => {
  it("sends a negative drag left", () => {
    assert.equal(swipeDirection(-200), "left");
  });

  it("sends a positive drag right", () => {
    assert.equal(swipeDirection(200), "right");
  });
});

describe("cardStyle", () => {
  describe("cards behind the top", () => {
    it("offsets and shrinks by depth", () => {
      const style = cardStyle(1, idle);
      assert.equal(style.transform, "translateY(14px) scale(0.95)");
      assert.equal(style.opacity, 0.92);
    });

    it("fans deeper cards further back", () => {
      const style = cardStyle(2, idle);
      assert.equal(style.transform, "translateY(28px) scale(0.9)");
    });

    it("stacks z-index so shallower cards sit on top", () => {
      assert.ok(cardStyle(0, idle).zIndex > cardStyle(1, idle).zIndex);
      assert.ok(cardStyle(1, idle).zIndex > cardStyle(2, idle).zIndex);
    });

    it("ignores the drag state, which only moves the top card", () => {
      const dragged = cardStyle(1, { drag: 90, dragging: true, leaving: null });
      assert.deepEqual(dragged, cardStyle(1, idle));
    });
  });

  describe("the top card", () => {
    it("sits still and fully opaque when untouched", () => {
      const style = cardStyle(0, idle);
      assert.equal(style.transform, "translateX(0px) rotate(0deg) rotateY(0deg)");
      assert.equal(style.opacity, 1);
    });

    it("follows the drag and tilts with it", () => {
      const style = cardStyle(0, { drag: 44, dragging: true, leaving: null });
      assert.equal(style.transform, "translateX(44px) rotate(2deg) rotateY(3.142857142857143deg)");
    });

    // A transition while the finger is down would make the card lag.
    it("drops the transition while dragging", () => {
      assert.equal(
        cardStyle(0, { drag: 44, dragging: true, leaving: null }).transition,
        "none",
      );
    });

    it("springs back with a transition once released", () => {
      const style = cardStyle(0, { drag: 44, dragging: false, leaving: null });
      assert.match(style.transition, /^transform 300ms/);
    });

    it("tilts the opposite way for a leftward drag", () => {
      const style = cardStyle(0, { drag: -44, dragging: true, leaving: null });
      assert.match(style.transform, /translateX\(-44px\) rotate\(-2deg\)/);
    });
  });

  describe("the leaving card", () => {
    it("flies off to the left and fades out", () => {
      const style = cardStyle(0, { drag: -200, dragging: false, leaving: "left" });
      assert.equal(style.opacity, 0);
      assert.match(style.transform, /translateX\(-140%\)/);
      assert.match(style.transform, /rotate\(-18deg\)/);
    });

    it("flies off to the right", () => {
      const style = cardStyle(0, { drag: 200, dragging: false, leaving: "right" });
      assert.equal(style.opacity, 0);
      assert.match(style.transform, /translateX\(140%\)/);
      assert.match(style.transform, /rotate\(18deg\)/);
    });

    it("overrides the live drag offset", () => {
      // Once it's leaving, the drag position no longer matters.
      const a = cardStyle(0, { drag: 200, dragging: false, leaving: "right" });
      const b = cardStyle(0, { drag: 999, dragging: false, leaving: "right" });
      assert.deepEqual(a, b);
    });
  });
});

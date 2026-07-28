import test from "node:test";
import assert from "node:assert/strict";

import { coverCrop, downscaleSteps, PHOTO_SIZE } from "./child-photo.ts";

test("PHOTO_SIZE is the 160px square the spec fixes", () => {
  assert.equal(PHOTO_SIZE, 160);
});

test("coverCrop", async (t) => {
  await t.test("passes a square source through whole", () => {
    assert.deepEqual(coverCrop(500, 500), { sx: 0, sy: 0, sw: 500, sh: 500 });
  });

  await t.test("crops the sides of a landscape source", () => {
    // 800x400 -> take the middle 400x400, so 200px comes off each side.
    assert.deepEqual(coverCrop(800, 400), { sx: 200, sy: 0, sw: 400, sh: 400 });
  });

  await t.test("crops the top and bottom of a portrait source", () => {
    assert.deepEqual(coverCrop(400, 800), { sx: 0, sy: 200, sw: 400, sh: 400 });
  });

  await t.test("centers an odd-sized crop without going out of bounds", () => {
    const { sx, sy, sw, sh } = coverCrop(101, 50);
    assert.equal(sh, 50);
    assert.equal(sw, 50);
    assert.ok(sx >= 0 && sx + sw <= 101, "crop stays inside the source width");
    assert.equal(sy, 0);
  });

  await t.test("crops a small landscape source the same way", () => {
    // Upscaling happens at draw time; the crop is still the largest square.
    assert.deepEqual(coverCrop(80, 40), { sx: 20, sy: 0, sw: 40, sh: 40 });
  });
});

test("downscaleSteps", async (t) => {
  await t.test("halves repeatedly until within 2x, then lands on target", () => {
    // 1280 -> 640 -> 320 -> 160
    assert.deepEqual(downscaleSteps(1280), [640, 320, 160]);
  });

  await t.test("goes straight to target when already within 2x", () => {
    assert.deepEqual(downscaleSteps(300), [160]);
  });

  await t.test("goes straight to target at exactly 2x", () => {
    assert.deepEqual(downscaleSteps(320), [160]);
  });

  await t.test("handles a huge phone photo", () => {
    const steps = downscaleSteps(4000);
    assert.equal(steps.at(-1), 160);
    assert.ok(steps.length > 1, "a 4000px source must not draw in one step");
    // Every step at least halves, and never overshoots below the target.
    for (const [i, step] of steps.entries()) {
      const prev = i === 0 ? 4000 : steps[i - 1];
      assert.ok(step < prev, `step ${step} must shrink from ${prev}`);
      assert.ok(step >= 160, `step ${step} must not go below the target`);
    }
  });

  await t.test("upscales a small source in a single step", () => {
    assert.deepEqual(downscaleSteps(64), [160]);
  });

  await t.test("returns a single no-op step when already at target", () => {
    assert.deepEqual(downscaleSteps(160), [160]);
  });
});

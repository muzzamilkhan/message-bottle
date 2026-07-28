import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  downscaleSteps,
  fitDimensions,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_DIMENSION,
  letterImageMessage,
  validateUpload,
  type LetterImageError,
} from "./letter-image.ts";

describe("fitDimensions", () => {
  it("caps a landscape source on its width", () => {
    assert.deepEqual(fitDimensions(4000, 3000), { width: 1280, height: 960 });
  });

  it("caps a portrait source on its height", () => {
    assert.deepEqual(fitDimensions(3000, 4000), { width: 960, height: 1280 });
  });

  it("caps a square source on both", () => {
    assert.deepEqual(fitDimensions(2000, 2000), { width: 1280, height: 1280 });
  });

  // Unlike the avatar path there is no crop and no upscale: a letter photo
  // keeps its shape, and a small source is stored as-is.
  it("passes a source under the cap through untouched", () => {
    assert.deepEqual(fitDimensions(800, 600), { width: 800, height: 600 });
  });

  it("passes a source exactly at the cap through untouched", () => {
    assert.deepEqual(fitDimensions(1280, 720), { width: 1280, height: 720 });
  });

  it("never rounds a dimension to zero", () => {
    assert.deepEqual(fitDimensions(4000, 3), { width: 1280, height: 1 });
  });
});

describe("downscaleSteps", () => {
  it("halves repeatedly until within 2x, then lands on target", () => {
    assert.deepEqual(downscaleSteps(4000, 1280), [2000, 1280]);
  });

  it("goes straight to target when already within 2x", () => {
    assert.deepEqual(downscaleSteps(2000, 1280), [1280]);
  });

  it("goes straight to target at exactly 2x", () => {
    assert.deepEqual(downscaleSteps(2560, 1280), [1280]);
  });

  it("returns a single no-op step when already at target", () => {
    assert.deepEqual(downscaleSteps(1280, 1280), [1280]);
  });

  it("defaults to the max dimension", () => {
    assert.deepEqual(downscaleSteps(4000), downscaleSteps(4000, IMAGE_MAX_DIMENSION));
  });
});

describe("validateUpload", () => {
  const valid = {
    mimeType: "image/webp",
    bytes: 200 * 1024,
    width: 1280,
    height: 960,
  };

  it("accepts a compressed photo", () => {
    assert.deepEqual(validateUpload(valid), { ok: true });
  });

  it("accepts jpeg, which canvas may hand back instead of webp", () => {
    assert.deepEqual(validateUpload({ ...valid, mimeType: "image/jpeg" }), {
      ok: true,
    });
  });

  it("rejects a type we don't store", () => {
    assert.deepEqual(validateUpload({ ...valid, mimeType: "image/gif" }), {
      ok: false,
      error: "IMAGE_NOT_AN_IMAGE",
    });
  });

  it("rejects a non-image entirely", () => {
    assert.deepEqual(validateUpload({ ...valid, mimeType: "application/pdf" }), {
      ok: false,
      error: "IMAGE_NOT_AN_IMAGE",
    });
  });

  it("accepts a payload exactly at the cap", () => {
    assert.deepEqual(validateUpload({ ...valid, bytes: IMAGE_MAX_BYTES }), {
      ok: true,
    });
  });

  it("rejects a payload over the cap", () => {
    assert.deepEqual(validateUpload({ ...valid, bytes: IMAGE_MAX_BYTES + 1 }), {
      ok: false,
      error: "IMAGE_TOO_LARGE",
    });
  });

  it("rejects an empty payload", () => {
    assert.deepEqual(validateUpload({ ...valid, bytes: 0 }), {
      ok: false,
      error: "IMAGE_MALFORMED",
    });
  });

  // The client promises to downscale, but the client is not a trust boundary.
  it("rejects dimensions past the cap", () => {
    assert.deepEqual(validateUpload({ ...valid, width: 1281 }), {
      ok: false,
      error: "IMAGE_MALFORMED",
    });
    assert.deepEqual(validateUpload({ ...valid, height: 4000 }), {
      ok: false,
      error: "IMAGE_MALFORMED",
    });
  });

  it("rejects a zero dimension", () => {
    assert.deepEqual(validateUpload({ ...valid, width: 0 }), {
      ok: false,
      error: "IMAGE_MALFORMED",
    });
  });
});

describe("letterImageMessage", () => {
  it("returns a message for every error code", () => {
    const codes: LetterImageError[] = [
      "IMAGE_NOT_AN_IMAGE",
      "IMAGE_MALFORMED",
      "IMAGE_TOO_LARGE",
      "IMAGE_TOO_LARGE_TO_READ",
      "IMAGE_TOO_MANY",
      "IMAGE_NOT_PRO",
    ];
    for (const code of codes) {
      assert.equal(typeof letterImageMessage(code), "string");
      assert.ok(letterImageMessage(code).length > 0);
    }
  });
});

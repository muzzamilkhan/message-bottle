import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canUploadImages, IMAGE_UPLOAD_TIERS } from "./subscription.ts";

describe("canUploadImages", () => {
  it("allows a PRO subscriber", () => {
    assert.equal(canUploadImages("PRO"), true);
  });

  it("refuses a user with no subscription", () => {
    assert.equal(canUploadImages(null), false);
    assert.equal(canUploadImages(undefined), false);
  });

  it("refuses an empty string", () => {
    assert.equal(canUploadImages(""), false);
  });

  it("refuses an unknown tier", () => {
    assert.equal(canUploadImages("PLUS"), false);
  });

  // The column is written by hand until billing exists, so a typo must fail
  // closed rather than quietly granting access.
  it("is case sensitive", () => {
    assert.equal(canUploadImages("pro"), false);
    assert.equal(canUploadImages(" PRO "), false);
  });

  it("names PRO as the only tier for now", () => {
    assert.deepEqual([...IMAGE_UPLOAD_TIERS], ["PRO"]);
  });
});

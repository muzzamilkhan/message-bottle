import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canUploadImages,
  describeSubscription,
  IMAGE_UPLOAD_TIERS,
} from "./subscription.ts";

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

describe("describeSubscription", () => {
  it("labels a PRO subscriber as Pro", () => {
    const result = describeSubscription("PRO");
    assert.equal(result.label, "Pro");
    assert.equal(result.isPro, true);
  });

  it("labels everyone else as Free", () => {
    for (const value of [null, undefined, "", "PLUS", "pro"]) {
      const result = describeSubscription(value);
      assert.equal(result.label, "Free");
      assert.equal(result.isPro, false);
    }
  });

  // isPro must mean exactly "may upload images", so the account page and the
  // upload gate can never disagree about who is Pro.
  it("agrees with canUploadImages", () => {
    for (const value of [null, undefined, "", "PRO", "pro", "PLUS"]) {
      assert.equal(describeSubscription(value).isPro, canUploadImages(value));
    }
  });
});

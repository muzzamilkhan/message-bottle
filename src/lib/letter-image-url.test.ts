import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { letterImageUrl } from "./letter-image-url.ts";

describe("letterImageUrl", () => {
  it("is a bare route path for the signed-in author", () => {
    assert.equal(letterImageUrl("abc123"), "/api/letter-image/abc123");
  });

  it("carries the open token for the child's page", () => {
    assert.equal(
      letterImageUrl("abc123", { openToken: "tok" }),
      "/api/letter-image/abc123?t=tok",
    );
  });

  it("escapes a token containing URL-significant characters", () => {
    // base64url tokens are safe, but the encoding must not depend on that.
    assert.equal(
      letterImageUrl("abc123", { openToken: "a+b/c=d&e" }),
      "/api/letter-image/abc123?t=a%2Bb%2Fc%3Dd%26e",
    );
  });

  // The bug this module exists to prevent: a bypassed open page rendered
  // letters whose photos 404'd, because the client dropped `test=yes` while
  // the route required it.
  it("passes the bypass through so photos survive the age gate", () => {
    assert.equal(
      letterImageUrl("abc123", { openToken: "tok", bypass: true }),
      "/api/letter-image/abc123?t=tok&test=yes",
    );
  });

  it("omits the bypass when the server did not grant it", () => {
    assert.equal(
      letterImageUrl("abc123", { openToken: "tok", bypass: false }),
      "/api/letter-image/abc123?t=tok",
    );
  });

  it("never sends the bypass without a token", () => {
    // The escape hatch belongs to the child's open page. On a session-authorized
    // request it is meaningless, and the route ignores it there.
    assert.equal(
      letterImageUrl("abc123", { bypass: true }),
      "/api/letter-image/abc123",
    );
  });
});

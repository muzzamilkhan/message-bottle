import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bearerToken } from "./bearer.ts";

describe("bearerToken", () => {
  test("reads the token from a well-formed header", () => {
    assert.equal(bearerToken("Bearer abc123"), "abc123");
  });

  test("matches the scheme case-insensitively, as RFC 7235 requires", () => {
    assert.equal(bearerToken("bearer abc123"), "abc123");
    assert.equal(bearerToken("BEARER abc123"), "abc123");
    assert.equal(bearerToken("BeArEr abc123"), "abc123");
  });

  test("tolerates surrounding whitespace", () => {
    assert.equal(bearerToken("  Bearer abc123  "), "abc123");
  });

  test("tolerates extra whitespace between scheme and token", () => {
    assert.equal(bearerToken("Bearer    abc123"), "abc123");
  });

  test("keeps the token exactly, since it is compared byte for byte", () => {
    // base64url alphabet, which is what the session tokens use.
    assert.equal(bearerToken("Bearer aB-_9xyz"), "aB-_9xyz");
  });

  describe("refuses anything that isn't one Bearer credential", () => {
    test("no header at all", () => {
      assert.equal(bearerToken(null), null);
      assert.equal(bearerToken(undefined), null);
      assert.equal(bearerToken(""), null);
    });

    test("whitespace only", () => {
      assert.equal(bearerToken("   "), null);
    });

    test("a different scheme", () => {
      assert.equal(bearerToken("Basic abc123"), null);
      assert.equal(bearerToken("Token abc123"), null);
    });

    test("a scheme with no token", () => {
      assert.equal(bearerToken("Bearer"), null);
      assert.equal(bearerToken("Bearer "), null);
    });

    test("a bare token with no scheme", () => {
      assert.equal(bearerToken("abc123"), null);
    });

    test("more than one value after the scheme", () => {
      // Never guess which of two credentials was meant.
      assert.equal(bearerToken("Bearer abc123 def456"), null);
    });

    test("a scheme that merely starts with bearer", () => {
      assert.equal(bearerToken("Bearerish abc123"), null);
    });
  });
});

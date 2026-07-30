import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseAudiences } from "./google-audience.ts";

describe("parseAudiences", () => {
  test("reads a single client id", () => {
    assert.deepEqual(parseAudiences("ios.apps.googleusercontent.com"), [
      "ios.apps.googleusercontent.com",
    ]);
  });

  test("splits a comma-separated list", () => {
    assert.deepEqual(parseAudiences("ios.example,android.example"), [
      "ios.example",
      "android.example",
    ]);
  });

  test("trims whitespace around each id", () => {
    assert.deepEqual(parseAudiences(" ios.example , android.example "), [
      "ios.example",
      "android.example",
    ]);
  });

  test("merges several sources, so a fallback env var can contribute", () => {
    assert.deepEqual(parseAudiences("ios.example", "web.example"), [
      "ios.example",
      "web.example",
    ]);
  });

  test("de-duplicates an id listed twice", () => {
    assert.deepEqual(parseAudiences("ios.example,ios.example", "ios.example"), [
      "ios.example",
    ]);
  });

  describe("never produces an empty audience", () => {
    // An audience of "" is the dangerous case: some verifiers read it as a
    // wildcard, which would accept a token minted for any application at all.
    test("from a trailing comma", () => {
      assert.deepEqual(parseAudiences("ios.example,"), ["ios.example"]);
    });

    test("from a leading comma", () => {
      assert.deepEqual(parseAudiences(",ios.example"), ["ios.example"]);
    });

    test("from a doubled comma", () => {
      assert.deepEqual(parseAudiences("ios.example,,android.example"), [
        "ios.example",
        "android.example",
      ]);
    });

    test("from a value that is only commas and spaces", () => {
      assert.deepEqual(parseAudiences(" , , "), []);
    });
  });

  describe("returns nothing when nothing is configured", () => {
    test("for an undefined value", () => {
      assert.deepEqual(parseAudiences(undefined), []);
    });

    test("for an empty string", () => {
      assert.deepEqual(parseAudiences(""), []);
    });

    test("for no arguments at all", () => {
      assert.deepEqual(parseAudiences(), []);
    });

    test("for several unset sources", () => {
      assert.deepEqual(parseAudiences(undefined, "", undefined), []);
    });
  });
});

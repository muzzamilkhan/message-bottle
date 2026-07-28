import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countdown, formatDate } from "./letters.ts";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// countdown() reads the real clock via Date.now(), so targets are offsets from
// the actual present. A small padding keeps each case clear of the boundary
// below it, so the elapsed time during a test run can't tip it over.
const inMs = (ms: number) => new Date(Date.now() + ms + 5 * SECOND);

describe("formatDate", () => {
  it("formats a date as a long US date", () => {
    assert.equal(formatDate(new Date("2036-03-04T12:00:00Z")), "March 4, 2036");
  });
});

describe("countdown", () => {
  it("reports a target in the past as ready", () => {
    assert.equal(countdown(new Date(Date.now() - DAY)), "Ready to open!");
  });

  it("reports the exact moment of arrival as ready", () => {
    assert.equal(countdown(new Date()), "Ready to open!");
  });

  describe("minutes", () => {
    it("counts whole minutes", () => {
      assert.equal(countdown(inMs(5 * MINUTE)), "5 minutes to go");
    });

    it("singularises one minute", () => {
      assert.equal(countdown(inMs(1 * MINUTE + SECOND)), "1 minute to go");
    });

    // Anything still in the future rounds up to a minute rather than showing
    // "0 minutes to go".
    it("floors seconds up to a single minute", () => {
      assert.equal(countdown(inMs(10 * SECOND)), "1 minute to go");
    });
  });

  describe("hours", () => {
    it("counts whole hours", () => {
      assert.equal(countdown(inMs(5 * HOUR)), "5 hours to go");
    });

    it("singularises one hour", () => {
      assert.equal(countdown(inMs(1 * HOUR + MINUTE)), "1 hour to go");
    });
  });

  describe("days", () => {
    it("counts whole days", () => {
      assert.equal(countdown(inMs(5 * DAY)), "5 days to go");
    });

    it("singularises one day", () => {
      assert.equal(countdown(inMs(1 * DAY + HOUR)), "1 day to go");
    });
  });

  describe("years", () => {
    it("counts whole years with no remainder", () => {
      assert.equal(countdown(inMs(365 * DAY)), "1 year to go");
    });

    it("adds the remaining days", () => {
      assert.equal(countdown(inMs(366 * DAY)), "1 year 1 day to go");
    });

    it("pluralises both parts", () => {
      assert.equal(countdown(inMs((730 + 5) * DAY)), "2 years 5 days to go");
    });
  });
});

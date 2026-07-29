import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ageInYears,
  birthdayAtAge,
  describeBottleTimer,
  hasReachedOpenAge,
} from "./age.ts";

// Birthdays are stored at UTC noon (see child-input), so build them that way.
const born = (iso: string) => new Date(`${iso}T12:00:00Z`);
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("ageInYears", () => {
  it("counts whole years", () => {
    assert.equal(ageInYears(born("2018-03-04"), at("2026-07-28")), 8);
  });

  it("returns 0 before the first birthday", () => {
    assert.equal(ageInYears(born("2026-01-01"), at("2026-07-28")), 0);
  });

  it("ticks over on the birthday itself", () => {
    assert.equal(ageInYears(born("2018-07-28"), at("2026-07-28")), 8);
  });

  it("still counts the younger age the day before the birthday", () => {
    assert.equal(ageInYears(born("2018-07-29"), at("2026-07-28")), 7);
  });

  it("handles a birthday later in the same month", () => {
    assert.equal(ageInYears(born("2018-07-30"), at("2026-07-28")), 7);
  });

  it("handles a birthday earlier in the same month", () => {
    assert.equal(ageInYears(born("2018-07-01"), at("2026-07-28")), 8);
  });

  it("handles a leap-day birthday in a non-leap year", () => {
    // Feb 29 2016 → on Feb 28 2025 they haven't had their birthday yet.
    assert.equal(ageInYears(born("2016-02-29"), at("2025-02-28")), 8);
    assert.equal(ageInYears(born("2016-02-29"), at("2025-03-01")), 9);
  });
});

describe("birthdayAtAge", () => {
  it("shifts the birthday forward by the given years", () => {
    assert.equal(
      birthdayAtAge(born("2018-03-04"), 18).toISOString(),
      "2036-03-04T12:00:00.000Z",
    );
  });

  it("preserves the time of day", () => {
    const result = birthdayAtAge(born("2018-03-04"), 1);
    assert.equal(result.getUTCHours(), 12);
  });
});

describe("hasReachedOpenAge", () => {
  it("is false while the child is younger", () => {
    assert.equal(hasReachedOpenAge(born("2018-03-04"), 18, at("2026-07-28")), false);
  });

  it("is true once the child is older", () => {
    assert.equal(hasReachedOpenAge(born("2018-03-04"), 18, at("2040-01-01")), true);
  });

  // The boundary that matters: the bottles open on the birthday, not after it.
  it("is true exactly on the unlocking birthday", () => {
    assert.equal(hasReachedOpenAge(born("2018-03-04"), 18, at("2036-03-04")), true);
  });

  it("is false the day before the unlocking birthday", () => {
    assert.equal(hasReachedOpenAge(born("2018-03-04"), 18, at("2036-03-03")), false);
  });
});

describe("describeBottleTimer", () => {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  it("describes a timer still counting down", () => {
    const result = describeBottleTimer(
      { name: "Ada", birthday: born("2018-03-04"), openAtAge: 18 },
      fmt,
      at("2026-07-28"),
    );
    assert.deepEqual(result, {
      unlocked: false,
      timerLabel: "Opens at age 18 · 2036-03-04",
    });
  });

  it("describes an unlocked timer by name", () => {
    const result = describeBottleTimer(
      { name: "Ada", birthday: born("2018-03-04"), openAtAge: 18 },
      fmt,
      at("2040-01-01"),
    );
    assert.equal(result.unlocked, true);
    assert.equal(result.timerLabel, "Unlocked - Ada can open their bottles now");
  });

  it("returns no label when the child has no birthday", () => {
    assert.deepEqual(
      describeBottleTimer({ name: "Ada", birthday: null, openAtAge: 18 }, fmt),
      { unlocked: false, timerLabel: null },
    );
  });

  it("returns no label when the child has no open age", () => {
    assert.deepEqual(
      describeBottleTimer(
        { name: "Ada", birthday: born("2018-03-04"), openAtAge: null },
        fmt,
      ),
      { unlocked: false, timerLabel: null },
    );
  });
});

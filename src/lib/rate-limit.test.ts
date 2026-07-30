import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  pruneRateLimits,
  type RateLimitState,
} from "./rate-limit.ts";

const options = { limit: 3, windowMs: 60_000, now: 1_000_000 };

describe("checkRateLimit", () => {
  test("allows the first request and opens a window", () => {
    const decision = checkRateLimit(undefined, options);

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.state, { start: options.now, count: 1 });
  });

  test("counts requests within the window", () => {
    let state: RateLimitState | undefined;
    for (let i = 1; i <= 3; i += 1) {
      const decision = checkRateLimit(state, { ...options, now: 1_000_000 + i });
      assert.equal(decision.allowed, true, `request ${i} should be allowed`);
      state = decision.state;
    }

    assert.equal(state?.count, 3);
  });

  test("refuses the request past the limit", () => {
    const state = { start: options.now, count: 3 };
    const decision = checkRateLimit(state, { ...options, now: options.now + 1 });

    assert.equal(decision.allowed, false);
  });

  test("keeps the window pinned to its start when refusing", () => {
    // Counting rejections would let a client hammering the endpoint hold their
    // own window open forever.
    const state = { start: options.now, count: 3 };
    const decision = checkRateLimit(state, {
      ...options,
      now: options.now + 30_000,
    });

    assert.deepEqual(decision.state, state);
  });

  test("opens a fresh window once the old one elapses", () => {
    const state = { start: options.now, count: 3 };
    const later = options.now + 60_000;
    const decision = checkRateLimit(state, { ...options, now: later });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.state, { start: later, count: 1 });
  });

  test("treats the window as elapsed exactly at its length", () => {
    const state = { start: options.now, count: 3 };
    const decision = checkRateLimit(state, {
      ...options,
      now: options.now + options.windowMs,
    });

    assert.equal(decision.allowed, true);
  });

  test("still refuses one millisecond before the window elapses", () => {
    const state = { start: options.now, count: 3 };
    const decision = checkRateLimit(state, {
      ...options,
      now: options.now + options.windowMs - 1,
    });

    assert.equal(decision.allowed, false);
  });

  test("refuses everything when the limit is zero", () => {
    const state = { start: options.now, count: 0 };
    const decision = checkRateLimit(state, { ...options, limit: 0 });

    assert.equal(decision.allowed, false);
  });

  describe("retryAfterSeconds", () => {
    test("counts down as the window elapses", () => {
      const state = { start: options.now, count: 3 };
      const decision = checkRateLimit(state, {
        ...options,
        now: options.now + 20_000,
      });

      assert.equal(decision.retryAfterSeconds, 40);
    });

    test("rounds a partial second up", () => {
      const state = { start: options.now, count: 3 };
      const decision = checkRateLimit(state, {
        ...options,
        now: options.now + 20_500,
      });

      assert.equal(decision.retryAfterSeconds, 40);
    });

    test("is never zero, so a client always waits before retrying", () => {
      const state = { start: options.now, count: 3 };
      const decision = checkRateLimit(state, {
        ...options,
        now: options.now + options.windowMs - 1,
      });

      assert.equal(decision.retryAfterSeconds, 1);
    });
  });
});

describe("pruneRateLimits", () => {
  test("drops windows that have fully elapsed", () => {
    const entries = new Map<string, RateLimitState>([
      ["old", { start: 0, count: 3 }],
      ["fresh", { start: 950_000, count: 1 }],
    ]);

    pruneRateLimits(entries, { windowMs: 60_000, now: 1_000_000 });

    assert.deepEqual([...entries.keys()], ["fresh"]);
  });

  test("keeps a window that has only just started", () => {
    const entries = new Map<string, RateLimitState>([
      ["fresh", { start: 1_000_000, count: 1 }],
    ]);

    pruneRateLimits(entries, { windowMs: 60_000, now: 1_000_000 });

    assert.equal(entries.size, 1);
  });

  test("empties a map of nothing but stale windows", () => {
    const entries = new Map<string, RateLimitState>([
      ["a", { start: 0, count: 1 }],
      ["b", { start: 1, count: 9 }],
    ]);

    pruneRateLimits(entries, { windowMs: 60_000, now: 1_000_000 });

    assert.equal(entries.size, 0);
  });
});

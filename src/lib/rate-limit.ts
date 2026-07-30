// A fixed-window rate limiter, kept pure so the counting rule can be tested
// without timers or a server.
//
// Deliberately in-memory and per-instance (docs/mobile/decisions.md, 5): the
// two surfaces it guards are unauthenticated - sign-in, and the child's open
// token - and the real defence there is that an openToken is 24 random bytes.
// This is the second layer, and a second layer that costs nothing to run beats
// a perfect one that needs Redis before the app has any traffic.
//
// Because instances don't share state, the effective limit is
// `limit x instances`. Set limits with that in mind; don't read them as exact.

export type RateLimitState = {
  // When the current window started.
  start: number;
  count: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  state: RateLimitState;
  // Seconds until the window resets, for a Retry-After header.
  retryAfterSeconds: number;
};

// Decide whether one more request fits, and return the state to store back.
//
// A fixed window rather than a sliding one: it can let through up to 2x the
// limit across a window boundary, which is fine for a blunt instrument, and it
// costs one integer instead of a list of timestamps per key.
export function checkRateLimit(
  previous: RateLimitState | undefined,
  options: { limit: number; windowMs: number; now: number },
): RateLimitDecision {
  const { limit, windowMs, now } = options;

  // No previous window, or the old one has fully elapsed: start fresh.
  if (!previous || now - previous.start >= windowMs) {
    return {
      allowed: true,
      state: { start: now, count: 1 },
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  const elapsed = now - previous.start;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - elapsed) / 1000));

  // At the limit: refuse, and don't extend the window by counting the refusal.
  // Counting rejections would let a client hammering the endpoint hold their
  // own window open forever.
  if (previous.count >= limit) {
    return { allowed: false, state: previous, retryAfterSeconds };
  }

  return {
    allowed: true,
    state: { start: previous.start, count: previous.count + 1 },
    retryAfterSeconds,
  };
}

// Drop windows that have fully elapsed. Called before each check so the map
// can't grow without bound on a long-lived instance.
export function pruneRateLimits(
  entries: Map<string, RateLimitState>,
  options: { windowMs: number; now: number },
): void {
  for (const [key, state] of entries) {
    if (options.now - state.start >= options.windowMs) entries.delete(key);
  }
}

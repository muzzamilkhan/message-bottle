// The stateful half of rate limiting: one Map per serverless instance, and the
// client-IP guess. Untested by design - the counting rule is in rate-limit.ts,
// which is pure and tested; this only holds state and reads a header.

import {
  checkRateLimit,
  pruneRateLimits,
  type RateLimitState,
} from "./rate-limit.ts";
import { rateLimited } from "./mobile-response.ts";

// Buckets are per limiter name so one endpoint's traffic can't exhaust
// another's, and survive across requests on a warm instance only. A cold start
// resets them, which is part of why this is defence in depth rather than a
// defence.
const buckets = new Map<string, Map<string, RateLimitState>>();

// Who to count against. Vercel sets x-forwarded-for; the leftmost entry is the
// client as the edge saw it. A caller can forge this header end-to-end, so it
// is a courtesy key rather than an identity - which is fine, because the thing
// it guards is already guarded by an unguessable token.
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

// Count one request against a limiter, and hand back a 429 if it doesn't fit.
// Returns null when the request may proceed.
export function enforceRateLimit(
  request: Request,
  options: { name: string; limit: number; windowMs: number },
): Response | null {
  const now = Date.now();

  let entries = buckets.get(options.name);
  if (!entries) {
    entries = new Map();
    buckets.set(options.name, entries);
  }

  // Prune first, so an instance that has been up for days isn't holding a row
  // per IP that ever touched it.
  pruneRateLimits(entries, { windowMs: options.windowMs, now });

  const key = clientKey(request);
  const decision = checkRateLimit(entries.get(key), {
    limit: options.limit,
    windowMs: options.windowMs,
    now,
  });
  entries.set(key, decision.state);

  if (decision.allowed) return null;

  const response = rateLimited();
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return response;
}

// The API-route analogue of `auth()`.
//
// Native apps can't carry the browser's session cookie, so a mobile client
// authenticates with `Authorization: Bearer <token>`, where the token is the
// `sessionToken` of a row in the same `Session` table Auth.js writes. That
// choice is recorded in docs/mobile/decisions.md: it reuses the existing table,
// the existing expiry column, and the existing revocation story - deleting the
// user cascades to every session, so account closure already signs every device
// out.
//
// The cost, knowingly accepted there: this token is the same value class as a
// web session cookie, so a leak is a leak of both. Two things follow, and both
// are implemented here - mobile sessions get an *explicit* expiry rather than
// inheriting one, and an expired row is rejected on read rather than trusted
// until some sweep removes it.
//
// Thin and env/DB-bound, so untested by design, like letter-crypto-key.ts.

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { bearerToken } from "./bearer.ts";
import { unauthorized } from "./mobile-response.ts";

// How long a mobile session lasts. Longer than the web's 30 days because
// signing back in on a phone is a Google tap rather than a password, and an app
// that logs you out monthly gets deleted; short enough that a token lifted off
// a lost handset doesn't live forever. No sliding renewal: a fixed expiry means
// the row's `expires` is the whole truth about when it dies.
export const MOBILE_SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// The token this request presents, if it presents exactly one. Parsing lives in
// bearer.ts, where it is tested.
export function requestToken(request: Request): string | null {
  return bearerToken(request.headers.get("authorization"));
}

// Resolve a request to the user it authenticates as, or null.
export async function resolveBearerUser(
  request: Request,
  now: Date = new Date(),
): Promise<string | null> {
  const token = requestToken(request);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { sessionToken: token },
    select: { userId: true, expires: true },
  });
  if (!session) return null;

  // An expired row is not a session. It stays in the table until something
  // cleans it up, so the check has to happen here on every read.
  if (session.expires.getTime() <= now.getTime()) return null;

  return session.userId;
}

// Mint a session for a signed-in device and return the bearer token.
export async function createMobileSession(
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; expires: Date }> {
  // 32 random bytes. The column is unique, so a collision would throw rather
  // than hand two devices one session.
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + MOBILE_SESSION_MAX_AGE_MS);

  await prisma.session.create({
    data: { sessionToken: token, userId, expires },
  });

  return { token, expires };
}

// Sign one device out. Scoped to the token itself, so signing out on a phone
// never touches the parent's browser session or their other devices.
export async function revokeMobileSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { sessionToken: token } });
}

// Run a handler only for an authenticated caller, 401ing uniformly otherwise.
//
// Every parent route goes through this, so no route can forget the check or
// invent its own answer for an anonymous caller - the mobile counterpart of the
// `const session = await auth()` line that opens every server action.
export async function requireUser(
  request: Request,
  handler: (userId: string) => Promise<Response>,
): Promise<Response> {
  const userId = await resolveBearerUser(request);
  if (!userId) return unauthorized();
  return handler(userId);
}

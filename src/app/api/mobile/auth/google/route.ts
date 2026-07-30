import { verifyGoogleIdToken } from "@/lib/google-id-token";
import { resolveGoogleUser } from "@/lib/mobile-identity";
import { createMobileSession } from "@/lib/mobile-auth";
import { asString, jsonError, jsonOk, readJson } from "@/lib/mobile-response";
import { enforceRateLimit } from "@/lib/rate-limit-store";

// Exchange a Google ID token from native Google Sign-In for an app session
// token.
//
// This and the open routes are the only unauthenticated surfaces in the API, so
// it is rate limited. Every refusal is the same 401 with the same message: the
// caller learns that sign-in failed and nothing about why, so this can't be used
// to probe which client ids or accounts exist.

// One sign-in a few seconds apart is plenty for a real device; a burst is either
// a retry loop or someone testing tokens.
const RATE_LIMIT = { name: "auth-google", limit: 10, windowMs: 60_000 };

export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const body = await readJson(request);
  const idToken = asString(body?.idToken).trim();
  if (!idToken) return signInFailed();

  const identity = await verifyGoogleIdToken(idToken);
  if (!identity) return signInFailed();

  const user = await resolveGoogleUser(identity);
  const session = await createMobileSession(user.id);

  return jsonOk({
    token: session.token,
    expiresAt: session.expires.toISOString(),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    },
  });
}

function signInFailed(): Response {
  return jsonError(
    "SIGN_IN_FAILED",
    "We couldn't sign you in with that Google account.",
    401,
  );
}

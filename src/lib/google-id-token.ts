// Verify a Google ID token minted by native Google Sign-In on a phone.
//
// The environment-bound half; the rule it depends on (which audiences count)
// is in google-audience.ts, which is tested. Untested here by design, like
// letter-crypto-key.ts - this reads config and delegates the cryptography.
//
// Verification is google-auth-library's, not ours: signature against Google's
// rotating JWKS, issuer, audience, and expiry. Hand-rolling any of that is how
// authentication bypasses happen, and this is the front door to a parent's
// letters.

import { OAuth2Client } from "google-auth-library";
import { parseAudiences } from "./google-audience.ts";

// The identity a verified token asserts.
export type GoogleIdentity = {
  // Google's stable subject id. This - not the email - is the account key, so
  // changing your Gmail address doesn't strand your letters.
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
};

// Client ids a token may be addressed to. iOS and Android each have their own,
// so this is a list and Phase 2 is a config edit rather than a code change; the
// web client id is accepted too, so a token from any of our own front doors
// works.
export function googleAudiences(): string[] {
  return parseAudiences(
    process.env.GOOGLE_MOBILE_CLIENT_IDS,
    process.env.AUTH_GOOGLE_ID,
    process.env.GOOGLE_CLIENT_ID,
  );
}

const client = new OAuth2Client();

// Verify a token and return who it says they are, or null.
//
// Fails closed in every direction: no audiences configured, a bad signature, a
// wrong issuer, an expired token, or a payload with no subject all return null.
// The caller turns that into one uniform 401 and never says which it was.
export async function verifyGoogleIdToken(
  idToken: string,
): Promise<GoogleIdentity | null> {
  const audience = googleAudiences();
  // Nothing configured means nothing can be trusted. Passing an empty audience
  // list to a verifier is the classic way to accidentally accept every token.
  if (audience.length === 0) {
    console.error(
      "No Google client ids configured - set GOOGLE_MOBILE_CLIENT_IDS. Refusing every mobile sign-in.",
    );
    return null;
  }

  try {
    const ticket = await client.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (!payload?.sub) return null;

    return {
      sub: payload.sub,
      email: payload.email ?? null,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
    };
  } catch (error) {
    // Deliberately a warning, not a throw: a bad token is an ordinary event on
    // a public endpoint. Logged because a sudden run of them is worth seeing.
    console.warn("Rejected a Google ID token", error);
    return null;
  }
}

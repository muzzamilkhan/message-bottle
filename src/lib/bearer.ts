// Parsing the Authorization header, kept pure so the edge cases can be tested
// without a request or a database. The DB half is mobile-auth.ts - the same
// split as letter-image.ts / letter-image-store.ts.
//
// This is a small security boundary: it decides what counts as a credential. It
// is deliberately strict, because every string it accepts becomes a database
// lookup, and every shape it accepts is a shape an attacker gets to probe.

// Pull the token out of an `Authorization: Bearer <token>` header.
//
// Returns null for anything that isn't exactly one Bearer credential: no
// header, a different scheme, no token, or more than one whitespace-separated
// value after the scheme. The scheme is matched case-insensitively because
// RFC 7235 says it is; the token is not touched, because it is compared byte
// for byte against a stored value.
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;

  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2) return null;

  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer") return null;

  return token.length > 0 ? token : null;
}

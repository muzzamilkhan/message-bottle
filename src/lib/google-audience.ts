// Which OAuth client ids a Google ID token may be addressed to.
//
// iOS and Android each get their own client id, and the web has a third, so the
// verifier accepts a list. Kept pure and tested because the failure mode is the
// whole point: an empty list must never mean "accept anything". Reading the
// environment is google-id-token.ts's job.

// Split a comma-separated environment value into audiences.
//
// Trims, drops empties, and de-duplicates, so a trailing comma or a value
// pasted with spaces doesn't produce an audience of "" - which some verifiers
// treat as a wildcard, and which would let a token minted for any application
// at all sign someone in here.
export function parseAudiences(...values: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return [...seen];
}

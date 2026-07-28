// The URL an inline letter photo is fetched from.
//
// This is the one place the image query string is built. The route in
// src/app/api/letter-image/[id]/route.ts reads exactly these params back, so
// keeping construction in a pure function is what stops the two sides from
// drifting — a client that forgets a param the route requires renders a broken
// <img>, which is the bug this helper exists to prevent.

export type LetterImageUrlOptions = {
  // Present only on the child's open page, where there is no session and the
  // token is the credential.
  openToken?: string;
  // True when the server granted the `open-bottle-bypass` escape hatch for this
  // render. Never derived from the client: the page passes down what the flag
  // actually returned, so a viewer can't assert a bypass the server refused.
  bypass?: boolean;
};

export function letterImageUrl(
  id: string,
  { openToken, bypass = false }: LetterImageUrlOptions = {},
): string {
  const params = new URLSearchParams();

  // An <img> can't send a header, so the token rides in the query string. It
  // exposes nothing new: the same token is already the credential in the page
  // URL this image is embedded on.
  if (openToken) params.set("t", openToken);

  // Only meaningful alongside a token — the bypass exists for the child's open
  // page, and the route ignores it on any other path. Sending it while signed
  // in would be noise on a URL that is already authorized by session.
  if (bypass && openToken) params.set("test", "yes");

  const query = params.toString();
  return `/api/letter-image/${id}${query ? `?${query}` : ""}`;
}

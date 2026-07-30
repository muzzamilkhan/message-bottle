// The one response shape every /api/mobile/* route speaks.
//
// Success is the resource itself. A refusal is always
// `{ error: { code, message } }`, where the code comes from the validation libs
// (which already return codes, not copy) and the message is mapped server-side
// - so a shipped app build can branch or localize on `code` while the wording
// stays free to change underneath it.
//
// Pure enough to test, but there is nothing here worth a test: it is a shape,
// not a rule.

// Codes this layer owns. Everything else comes from child-service.ts,
// letter-service.ts, or the validation libs they wrap.
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | (string & {});

export type ApiError = { error: { code: ApiErrorCode; message: string } };

// Responses are never cacheable. These carry a parent's private letters and
// photographs of their children, and Vercel's CDN caches Function responses by
// default - a cached authorized response served to the next requester would
// defeat every check the routes make.
const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
} as const;

export function jsonOk<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

export function jsonError(
  code: ApiErrorCode,
  message: string,
  status: number,
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: HEADERS,
  });
}

export function unauthorized(): Response {
  return jsonError("UNAUTHORIZED", "Sign in to continue.", 401);
}

// Every "you can't have this" is a 404, never a 403 - a 403 would confirm the
// id or token exists, which is the same reasoning the web image route uses.
export function notFound(): Response {
  return jsonError("NOT_FOUND", "Not found.", 404);
}

export function badRequest(message = "That request wasn't valid."): Response {
  return jsonError("BAD_REQUEST", message, 400);
}

export function rateLimited(): Response {
  return jsonError("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
}

// Read a JSON body without letting a malformed one throw past the route.
export async function readJson(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Coerce an unknown JSON field to the string the parsers expect. Every
// validation lib takes strings and decides for itself what is acceptable, so
// this only has to make the types line up - a number, null, or a nested object
// all become something the parser will reject on its own terms.
export function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

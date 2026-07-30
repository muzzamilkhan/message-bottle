import { requestToken, revokeMobileSession } from "@/lib/mobile-auth";
import { jsonOk, unauthorized } from "@/lib/mobile-response";

// Sign this device out by deleting its session row.
//
// Scoped to the presented token, so signing out on a phone never touches the
// parent's browser session or their other devices. No requireUser wrapper: the
// point is to destroy the token, and a token that has already expired should
// still be cleaned up rather than 401'd.
export async function POST(request: Request): Promise<Response> {
  const token = requestToken(request);
  if (!token) return unauthorized();

  await revokeMobileSession(token);

  return jsonOk({ ok: true });
}

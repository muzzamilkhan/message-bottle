import { getBottlesByToken } from "@/lib/open-service";
import { toApiBottles } from "@/lib/mobile-contract";
import { jsonOk } from "@/lib/mobile-response";
import { enforceRateLimit } from "@/lib/rate-limit-store";
import { openBottleBypass } from "@/flags";

type Params = { params: Promise<{ token: string }> };

// The child's self-authenticating open link. No auth header - the unguessable
// token in the path *is* the credential, exactly as it is for /open/[token] on
// the web.
//
// Unauthenticated, so it is rate limited alongside sign-in. The real defence is
// that a token is 24 random bytes; this only blunts a brute-force sweep.
//
// getBottlesByToken -> projectBottles decides everything about what leaves the
// server. This route does not branch on locked vs. open at all - it renders
// whatever shape it's handed, which is what makes it impossible for the route
// to accidentally leak more than the projection allows.
const RATE_LIMIT = { name: "open-token", limit: 30, windowMs: 60_000 };

export async function GET(
  request: Request,
  { params }: Params,
): Promise<Response> {
  const limited = enforceRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const { token } = await params;
  const url = new URL(request.url);

  // The same testing escape hatch the web page uses, gated the same way: only
  // consulted when ?test=yes is actually present, and only ever honored when
  // the deployment has opted the flag on.
  const bypass =
    url.searchParams.get("test") === "yes" && (await openBottleBypass());

  const bottles = await getBottlesByToken(token, { bypass });

  return jsonOk(toApiBottles(bottles));
}

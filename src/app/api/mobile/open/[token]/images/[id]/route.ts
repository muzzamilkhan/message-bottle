import { childImage, letterImageResponse } from "@/lib/letter-image-access";
import { notFound } from "@/lib/mobile-response";
import { enforceRateLimit } from "@/lib/rate-limit-store";
import { openBottleBypass } from "@/flags";

type Params = { params: Promise<{ token: string; id: string }> };

// A photo inside a sealed letter, authorized by the open token *and* the age
// gate - exactly as the web open-page image path is. The time lock covers
// photographs exactly as it covers text: this route is directly addressable,
// so it never trusts that the open route was already checked.
//
// Unauthenticated (the token is the credential), so it shares the open route's
// rate limit budget by using the same limiter name.
const RATE_LIMIT = { name: "open-token", limit: 30, windowMs: 60_000 };

export async function GET(
  request: Request,
  { params }: Params,
): Promise<Response> {
  const limited = enforceRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const { token, id } = await params;
  const url = new URL(request.url);
  const bypass =
    url.searchParams.get("test") === "yes" && (await openBottleBypass());

  const image = await childImage(token, id, { bypass });
  if (!image) return notFound();

  return (await letterImageResponse(image)) ?? notFound();
}

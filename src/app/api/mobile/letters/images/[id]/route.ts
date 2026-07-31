import { authorImage, letterImageResponse } from "@/lib/letter-image-access";
import { requireUser } from "@/lib/mobile-auth";
import { notFound } from "@/lib/mobile-response";

type Params = { params: Promise<{ id: string }> };

// The bytes of a photo the caller uploaded.
//
// Scoped to the author, so this serves a parent their own photographs and
// nobody else's. Every rejection is a 404, never a 403: a 403 would confirm the
// id exists.
//
// Reading is deliberately not subscription-gated. A letter sealed while its
// author was Pro must keep its photos forever, and the child on the other end
// has no account at all.
export async function GET(
  request: Request,
  { params }: Params,
): Promise<Response> {
  return requireUser(request, async (userId) => {
    const { id } = await params;

    const image = await authorImage(userId, id);
    if (!image) return notFound();

    return (await letterImageResponse(image)) ?? notFound();
  });
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessChild } from "@/lib/children";
import { hasReachedOpenAge } from "@/lib/age";
import { getLetterImage } from "@/lib/letter-image-store";

// The only way to an inline letter image. Private blob storage makes the bytes
// unreachable by URL, so every request for a photo of a child arrives here and
// is authorized before anything is read.
//
// Every rejection is a 404, never a 403: a 403 would confirm the id exists.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const image = await prisma.letterImage.findUnique({
    where: { id },
    select: {
      pathname: true,
      mimeType: true,
      authorId: true,
      letter: {
        select: {
          status: true,
          childId: true,
          child: {
            select: { openToken: true, birthday: true, openAtAge: true },
          },
        },
      },
    },
  });
  if (!image) return notFound();

  if (!(await isAuthorized(request, image))) return notFound();

  const stream = await getLetterImage(image.pathname);
  if (!stream) return notFound();

  return new NextResponse(stream, {
    headers: {
      "Content-Type": image.mimeType,
      // Never "public". Vercel's CDN caches Function responses, and a cached
      // authorized response served to the next requester would defeat every
      // check above.
      "Cache-Control": "private, no-store",
      // These are photographs of children; keep them out of other origins'
      // documents entirely.
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type ImageRecord = {
  authorId: string;
  letter: {
    status: string;
    childId: string | null;
    child: {
      openToken: string | null;
      birthday: Date;
      openAtAge: number;
    } | null;
  } | null;
};

async function isAuthorized(
  request: Request,
  image: ImageRecord,
): Promise<boolean> {
  const session = await auth();
  const viewerId = session?.user?.id;

  // 1. The author, who may be mid-draft.
  if (viewerId && viewerId === image.authorId) return true;

  // 2. A co-parent with access to the child this letter is addressed to.
  //    Reuses the shared helper rather than replicating the OR clause.
  if (viewerId && image.letter?.childId) {
    if (await canAccessChild(viewerId, image.letter.childId)) return true;
  }

  // 3. The child, holding their own open link.
  return childMayRead(request, image);
}

// The time lock, re-derived here from the child row.
//
// The rule is that the server never ships letter content before the age gate,
// and an inline photograph is letter content. /open/[token] already refuses to
// render bodies while locked, but this route is directly addressable — so it
// has to check for itself, and it never trusts a client-supplied claim about
// age or unlock state.
function childMayRead(request: Request, image: ImageRecord): boolean {
  const child = image.letter?.child;
  if (!child?.openToken) return false;

  // An <img> can't send a header, so the token rides in the query string. It
  // exposes nothing new: the same token is already the credential in the page
  // URL this image is embedded on.
  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  if (!token || token !== child.openToken) return false;

  // Only sealed letters ever reach a child.
  if (image.letter?.status !== "SENT") return false;

  // The documented testing bypass, inert unless the deployment sets it.
  const testing =
    process.env.TESTING === "true" && url.searchParams.get("test") === "yes";
  if (testing) return true;

  return hasReachedOpenAge(child.birthday, child.openAtAge);
}

function notFound() {
  return new NextResponse(null, { status: 404 });
}

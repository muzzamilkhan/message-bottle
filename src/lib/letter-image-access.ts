// Who may read a letter photograph, and the response that carries one.
//
// The bytes live in a private blob store, so they are unreachable by URL and
// every request for one arrives at a route that authorizes it first. There are
// exactly two principals, mirroring the app's two access models:
//
//   1. the author, who is always the child's owner (there is no sharing), and
//   2. the child, holding their own open token, *after the age gate passes*.
//
// The time lock covers photographs exactly as it covers text. A route is
// directly addressable, so it never trusts a page having already checked -
// childImage re-derives the gate from the child row every time.
//
// Untested by design (it needs a database and a blob store); the age rule it
// leans on is hasReachedOpenAge, which is tested.

import { prisma } from "@/lib/prisma";
import { hasReachedOpenAge } from "./age.ts";
import { getLetterImage } from "./letter-image-store.ts";

export type ImageBytes = { pathname: string; mimeType: string };

// A photo the caller uploaded. Scoped to authorId, so this covers a parent
// mid-draft as well as one reading back a saved one.
export async function authorImage(
  userId: string,
  imageId: string,
): Promise<ImageBytes | null> {
  if (!imageId) return null;

  return prisma.letterImage.findFirst({
    where: { id: imageId, authorId: userId },
    select: { pathname: true, mimeType: true },
  });
}

// A photo inside a sealed letter addressed to the child who holds this token.
//
// Every condition has to hold: the letter exists, it is SENT, the token matches
// that child exactly, and the bottle has opened.
export async function childImage(
  token: string,
  imageId: string,
  options: { now?: Date; bypass?: boolean } = {},
): Promise<ImageBytes | null> {
  if (!token || !imageId) return null;

  const image = await prisma.letterImage.findUnique({
    where: { id: imageId },
    select: {
      pathname: true,
      mimeType: true,
      letter: {
        select: {
          status: true,
          child: {
            select: { openToken: true, birthday: true, openAtAge: true },
          },
        },
      },
    },
  });
  if (!image?.letter) return null;

  // Only sealed letters ever reach a child; a draft is still the parent's.
  if (image.letter.status !== "SENT") return null;

  const child = image.letter.child;
  if (!child?.openToken || child.openToken !== token) return null;

  // No timer set means the link opens nothing - checked before the age maths,
  // so a missing or zero openAtAge can't read as "opens at age 0" and unlock
  // every photo. This matches projectBottles, which guards the page the same
  // way.
  if (!child.birthday || !child.openAtAge) return null;

  // The bypass is the flag's answer, never a raw query param, and it is only
  // ever consulted after everything above has already passed.
  if (options.bypass === true) return image;

  if (!hasReachedOpenAge(child.birthday, child.openAtAge, options.now)) {
    return null;
  }

  return image;
}

// Stream authorized bytes back. Callers MUST have authorized the request first.
export async function letterImageResponse(
  image: ImageBytes,
): Promise<Response | null> {
  const stream = await getLetterImage(image.pathname);
  if (!stream) return null;

  return new Response(stream, {
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

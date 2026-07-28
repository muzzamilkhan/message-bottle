// DB-access helper for cleaning up orphaned letter images, consumed by a
// server component (the dashboard). Kept out of src/app/actions.ts on
// purpose: every exported async function in a "use server" file becomes a
// callable HTTP endpoint, and this one takes its principal (authorId) as a
// plain parameter rather than deriving it from a session — exactly the shape
// that must never be reachable from the browser.
import { prisma } from "@/lib/prisma";
import { deleteLetterImages } from "./letter-image-store.ts";

// How long an unattached image may sit before it counts as abandoned. Generous
// on purpose: a parent may leave a half-written letter open overnight, and
// nothing is user-visible during the window.
export const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Delete images uploaded for a letter that was never saved.
//
// Reconciliation (src/app/actions.ts) handles every image whose letter got
// saved; this handles the tab that was closed first, where no save ever ran.
// Rides on a page load that already queries this author's letters — no cron,
// no scheduled function.
//
// Only ever touches unattached rows, so a sealed letter's images are out of
// reach by construction.
export async function sweepOrphanedImages(
  authorId: string,
  at: Date = new Date(),
): Promise<void> {
  const orphans = await prisma.letterImage.findMany({
    where: {
      authorId,
      letterId: null,
      createdAt: { lt: new Date(at.getTime() - ORPHAN_MAX_AGE_MS) },
    },
    select: { id: true, pathname: true },
    take: 100,
  });
  if (orphans.length === 0) return;

  await deleteLetterImages(orphans.map((image) => image.pathname));
  await prisma.letterImage.deleteMany({
    where: { id: { in: orphans.map((image) => image.id) } },
  });
}

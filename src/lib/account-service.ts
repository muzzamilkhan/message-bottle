// Account closure, with the web glue taken off. Sibling of child-service.ts and
// letter-service.ts; untested for the same reason (it needs a database).

import { prisma } from "@/lib/prisma";
import { deleteLetterImages } from "./letter-image-store.ts";

// Permanently delete a user and everything hanging off them. This is the
// account-closure promise the account page makes: every child, every letter
// (draft and sealed alike), and every photo inside those letters goes with the
// account.
//
// The database side is a single cascade from the User row - children, letters,
// letter-image rows, OAuth accounts, and sessions all carry
// `onDelete: Cascade`. The blob bytes never do (blob deletion is always
// explicit), so we gather every pathname this author owns and delete those
// blobs first, then drop the user. A blob failure leaves unreachable bytes
// (swept later), which is the safe direction; a row-first order could strand a
// live photo no row points at.
//
// Every session goes with the user by cascade, so this revokes the web cookie
// session and any mobile bearer tokens in the same stroke. The caller still
// signs out to clear the browser's cookie, which the database can't reach.
export async function deleteAccountFor(userId: string): Promise<void> {
  // Every photo this author ever uploaded, whether attached to a letter or
  // still unattached - the cascade will take the rows, but never the bytes.
  const images = await prisma.letterImage.findMany({
    where: { authorId: userId },
    select: { pathname: true },
  });
  await deleteLetterImages(images.map((image) => image.pathname));

  await prisma.user.delete({ where: { id: userId } });
}

// The child's side of the app: turn an open token into whatever that token's
// holder may see. The DB half of open-bottle.ts, and the only place the open
// query lives - /open/[token] and the mobile open route both call this, so
// neither can widen the select without the other noticing.
//
// Untested by design (it needs a database); the rule it wraps is
// projectBottles, which is pure and tested.

import { prisma } from "@/lib/prisma";
import { decryptLetterField } from "./letter-crypto-key.ts";
import { projectBottles, type BottlesView } from "./open-bottle.ts";

export async function getBottlesByToken(
  token: string,
  options: { bypass?: boolean; now?: Date } = {},
): Promise<BottlesView> {
  const child = await prisma.child.findUnique({
    where: { openToken: token },
    select: {
      name: true,
      avatar: true,
      photo: true,
      birthday: true,
      openAtAge: true,
      letters: {
        // Only sealed (SENT) letters ever reach the child - drafts stay with
        // the parent. Oldest first: the child reads forward through time, one
        // bottle at a time.
        where: { status: "SENT" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          body: true,
          createdAt: true,
          author: { select: { name: true } },
          images: { select: { id: true, width: true, height: true } },
        },
      },
    },
  });

  // An unknown token and a child with no timer read the same, deliberately: a
  // different answer for each would turn this into an oracle for guessing
  // tokens.
  if (!child) return { status: "unavailable" };

  return projectBottles(
    child,
    child.letters.map((letter) => ({
      id: letter.id,
      title: letter.title,
      body: letter.body,
      authorName: letter.author?.name ?? null,
      createdAt: letter.createdAt,
      images: letter.images,
    })),
    {
      now: options.now,
      bypass: options.bypass,
      // Passed as a function, not applied here: projectBottles calls it only on
      // the open branch, so a locked bottle never decrypts.
      decrypt: decryptLetterField,
    },
  );
}

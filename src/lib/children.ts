import { prisma } from "@/lib/prisma";

// A child the signed-in parent can write letters to, plus whether they own it
// or it was shared with them by another parent.
export type AccessibleChild = {
  id: string;
  name: string;
  avatar: string;
  photo: string | null;
  owned: boolean;
};

// All children a user may address a letter to: the ones they own, plus the
// ones a co-parent has shared with them. Owned children sort first.
export async function getAccessibleChildren(
  userId: string,
): Promise<AccessibleChild[]> {
  const [owned, shared] = await Promise.all([
    prisma.child.findMany({
      where: { parentId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, avatar: true, photo: true },
    }),
    prisma.child.findMany({
      where: { shares: { some: { parentId: userId } } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, avatar: true, photo: true },
    }),
  ]);

  return [
    ...owned.map((c) => ({ ...c, owned: true })),
    ...shared.map((c) => ({ ...c, owned: false })),
  ];
}

// A child as shown in a letter's recipient <select>. No `photo`: options
// render as `{avatar} {name}` text, and an <img> can't live inside <option>,
// so shipping the ~9KB data URL to the browser would be dead weight — strip
// it here rather than at the client component boundary.
export type LetterChildOption = Omit<AccessibleChild, "photo">;

export function withoutPhotos(children: AccessibleChild[]): LetterChildOption[] {
  return children.map(({ photo: _photo, ...rest }) => rest);
}

// True when the user may write letters to this child (owner or co-parent).
export async function canAccessChild(
  userId: string,
  childId: string,
): Promise<boolean> {
  const child = await prisma.child.findFirst({
    where: {
      id: childId,
      OR: [{ parentId: userId }, { shares: { some: { parentId: userId } } }],
    },
    select: { id: true },
  });
  return Boolean(child);
}

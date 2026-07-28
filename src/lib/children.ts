import { prisma } from "@/lib/prisma";

// A child the signed-in parent can write letters to, plus whether they own it
// or it was shared with them by another parent.
export type AccessibleChild = {
  id: string;
  name: string;
  avatar: string;
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
      select: { id: true, name: true, avatar: true },
    }),
    prisma.child.findMany({
      where: { shares: { some: { parentId: userId } } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, avatar: true },
    }),
  ]);

  return [
    ...owned.map((c) => ({ ...c, owned: true })),
    ...shared.map((c) => ({ ...c, owned: false })),
  ];
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

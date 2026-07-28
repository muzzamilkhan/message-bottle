import { prisma } from "@/lib/prisma";

// A child the signed-in parent can write letters to. Ownership is the whole
// access model: a child belongs to exactly one parent, and no other account
// can read or write their letters.
export type AccessibleChild = {
  id: string;
  name: string;
  avatar: string;
  photo: string | null;
};

// Every child this user owns, oldest first.
export async function getAccessibleChildren(
  userId: string,
): Promise<AccessibleChild[]> {
  return prisma.child.findMany({
    where: { parentId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, avatar: true, photo: true },
  });
}

// A child as shown in a letter's recipient <select>. No `photo`: options
// render as `{avatar} {name}` text, and an <img> can't live inside <option>,
// so shipping the ~9KB data URL to the browser would be dead weight — strip
// it here rather than at the client component boundary.
export type LetterChildOption = Omit<AccessibleChild, "photo">;

export function withoutPhotos(children: AccessibleChild[]): LetterChildOption[] {
  return children.map(({ photo: _photo, ...rest }) => rest);
}

// True when the user owns this child, and so may write letters to them.
export async function canAccessChild(
  userId: string,
  childId: string,
): Promise<boolean> {
  const child = await prisma.child.findFirst({
    where: { id: childId, parentId: userId },
    select: { id: true },
  });
  return Boolean(child);
}

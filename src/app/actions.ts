"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CHILD_AVATARS, DEFAULT_AVATAR } from "@/lib/avatars";

export type LetterFormState = { error?: string };

export async function createLetter(
  _prev: LetterFormState,
  formData: FormData,
): Promise<LetterFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in to write a letter." };
  }

  const title = String(formData.get("title") ?? "").trim();
  const childId = String(formData.get("childId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const deliverAtRaw = String(formData.get("deliverAt") ?? "").trim();
  const photoUrls = formData
    .getAll("photoUrls")
    .map((v) => String(v))
    .filter(Boolean);

  if (!title || !childId || !body || !deliverAtRaw) {
    return { error: "Please fill in the title, child, message, and date." };
  }

  // Verify the child belongs to this user (or was shared with them by a
  // co-parent) and grab a name snapshot.
  const child = await prisma.child.findFirst({
    where: {
      id: childId,
      OR: [
        { parentId: session.user.id },
        { shares: { some: { parentId: session.user.id } } },
      ],
    },
  });
  if (!child) {
    return { error: "Please choose one of your children." };
  }

  const deliverAt = new Date(deliverAtRaw);
  if (Number.isNaN(deliverAt.getTime())) {
    return { error: "That delivery date doesn't look right." };
  }
  if (deliverAt.getTime() <= Date.now()) {
    return { error: "Pick a delivery date in the future — that's the magic!" };
  }

  await prisma.letter.create({
    data: {
      title,
      recipientName: child.name,
      childId: child.id,
      body,
      deliverAt,
      authorId: session.user.id,
      photos: photoUrls.length
        ? { create: photoUrls.map((url) => ({ url })) }
        : undefined,
    },
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export type ChildFormState = { error?: string };

export async function createChild(
  _prev: ChildFormState,
  formData: FormData,
): Promise<ChildFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const avatarRaw = String(formData.get("avatar") ?? "").trim();
  const birthdayRaw = String(formData.get("birthday") ?? "").trim();

  if (!name) {
    return { error: "Please give your child a name." };
  }

  const avatar = (CHILD_AVATARS as readonly string[]).includes(avatarRaw)
    ? avatarRaw
    : DEFAULT_AVATAR;

  let birthday: Date | null = null;
  if (birthdayRaw) {
    const parsed = new Date(birthdayRaw);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "That birthday doesn't look right." };
    }
    birthday = parsed;
  }

  await prisma.child.create({
    data: { name, avatar, birthday, parentId: session.user.id },
  });

  revalidatePath("/children");
  revalidatePath("/letters/new");
  return {};
}

export async function deleteChild(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Only delete a child the current user owns. Letters keep their name
  // snapshot; their childId is set to null by the schema relation.
  await prisma.child.deleteMany({
    where: { id, parentId: session.user.id },
  });

  revalidatePath("/children");
  revalidatePath("/dashboard");
}

export async function deleteLetter(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Only delete a letter the current user actually owns.
  await prisma.letter.deleteMany({
    where: { id, authorId: session.user.id },
  });

  revalidatePath("/dashboard");
}

// ----- Parent access sharing -----

export type ShareInviteFormState = { error?: string; token?: string };

// Create a share link that grants a co-parent access to the selected children.
// Only the owner of a child may include it in an invite. Returns the invite
// token so the client can build a copyable link.
export async function createShareInvite(
  _prev: ShareInviteFormState,
  formData: FormData,
): Promise<ShareInviteFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in to share access." };
  }

  const childIds = formData
    .getAll("childIds")
    .map((v) => String(v))
    .filter(Boolean);

  if (childIds.length === 0) {
    return { error: "Pick at least one child to share." };
  }

  // Keep only children this user actually owns — you can't share someone
  // else's kids, even if they were shared with you.
  const owned = await prisma.child.findMany({
    where: { id: { in: childIds }, parentId: session.user.id },
    select: { id: true },
  });
  if (owned.length === 0) {
    return { error: "Please choose one of your own children." };
  }

  const token = randomBytes(24).toString("base64url");

  await prisma.shareInvite.create({
    data: {
      token,
      inviterId: session.user.id,
      children: { create: owned.map((c) => ({ childId: c.id })) },
    },
  });

  revalidatePath("/share");
  return { token };
}

// Owner cancels a pending invite they created.
export async function revokeInvite(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.shareInvite.updateMany({
    where: { id, inviterId: session.user.id, status: "PENDING" },
    data: { status: "REVOKED" },
  });

  revalidatePath("/share");
}

// Owner removes a co-parent's access to one of their children.
export async function revokeShare(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Only the child's owner can revoke a share.
  await prisma.childShare.deleteMany({
    where: { id, child: { parentId: session.user.id } },
  });

  revalidatePath("/share");
}

export type AcceptInviteFormState = { error?: string };

// The receiver accepts an invite, gaining write access to its children. The
// grant is idempotent, so re-accepting an already-accepted link is harmless.
export async function acceptShareInvite(
  _prev: AcceptInviteFormState,
  formData: FormData,
): Promise<AcceptInviteFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Please sign in to accept this invite." };
  }

  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { error: "This invite link looks broken." };

  const invite = await prisma.shareInvite.findUnique({
    where: { token },
    include: { children: { select: { childId: true } } },
  });

  if (!invite || invite.status === "REVOKED") {
    return { error: "This invite is no longer available." };
  }
  if (invite.inviterId === session.user.id) {
    return { error: "This is your own invite — share the link with a co-parent." };
  }

  const userId = session.user.id;

  await prisma.$transaction([
    // Grant access to every child on the invite, ignoring any that were
    // already granted (unique childId+parentId).
    prisma.childShare.createMany({
      data: invite.children.map((c) => ({
        childId: c.childId,
        parentId: userId,
      })),
      skipDuplicates: true,
    }),
    prisma.shareInvite.update({
      where: { id: invite.id },
      data: {
        status: "ACCEPTED",
        acceptedById: userId,
        acceptedAt: new Date(),
      },
    }),
  ]);

  revalidatePath("/dashboard");
  revalidatePath("/letters/new");
  redirect("/dashboard");
}

"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  childInputMessage,
  parseChildInput,
  type ChildFormValues,
  type ParsedChild,
} from "@/lib/child-input";

export type LetterFormState = { error?: string };

// Create a new draft or update/submit an existing one. The `intent` field
// decides whether the letter is kept as an editable DRAFT or sealed as SENT.
// Once a letter is SENT it can never be edited, so this action refuses to
// touch anything that isn't still a draft.
export async function saveLetter(
  _prev: LetterFormState,
  formData: FormData,
): Promise<LetterFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in to write a letter." };
  }

  const id = String(formData.get("id") ?? "").trim();
  const intent = String(formData.get("intent") ?? "draft").trim();
  const submitting = intent === "submit";
  const title = String(formData.get("title") ?? "").trim();
  const childId = String(formData.get("childId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  // A draft needs at least a title to have something to come back to; sending
  // requires the recipient and message so the sealed letter is complete. When
  // the bottle opens is set on the child, not the letter.
  if (submitting) {
    if (!title || !childId || !body) {
      return { error: "Please fill in the title, child, and message." };
    }
  } else if (!title) {
    return { error: "Give your draft a title so you can find it later." };
  }

  // Verify the chosen child belongs to this user (or was shared with them by a
  // co-parent) and grab a name snapshot. A child is optional for a draft.
  let child: { id: string; name: string } | null = null;
  if (childId) {
    child = await prisma.child.findFirst({
      where: {
        id: childId,
        OR: [
          { parentId: session.user.id },
          { shares: { some: { parentId: session.user.id } } },
        ],
      },
      select: { id: true, name: true },
    });
    if (!child) {
      return { error: "Please choose one of your children." };
    }
  }

  const data = {
    title,
    recipientName: child?.name ?? "",
    childId: child?.id ?? null,
    body,
    status: submitting ? "SENT" : "DRAFT",
  };

  if (id) {
    // Only update the author's own letter, and only while it's still a draft —
    // a sent letter is sealed forever.
    const result = await prisma.letter.updateMany({
      where: { id, authorId: session.user.id, status: "DRAFT" },
      data,
    });
    if (result.count === 0) {
      return { error: "That draft can't be edited anymore." };
    }
  } else {
    await prisma.letter.create({
      data: { ...data, authorId: session.user.id },
    });
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export type ChildFormState = {
  error?: string;
  ok?: boolean;
  values?: ChildFormValues;
};

// Adapt FormData to the pure parser in @/lib/child-input, turning a rejection
// code back into the message the form shows. The rules themselves live in the
// lib so they can be tested without a request.
function parseChildForm(
  formData: FormData,
): { error: string; values: ChildFormValues } | ParsedChild {
  const result = parseChildInput({
    name: String(formData.get("name") ?? ""),
    avatar: String(formData.get("avatar") ?? ""),
    birthday: String(formData.get("birthday") ?? ""),
    openAtAge: String(formData.get("openAtAge") ?? ""),
  });

  if (result.ok) return result.value;

  return {
    error: childInputMessage(result.error, {
      name: result.values.name,
      currentAge: result.currentAge,
    }),
    values: result.values,
  };
}

export async function createChild(
  _prev: ChildFormState,
  formData: FormData,
): Promise<ChildFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in." };
  }

  const parsed = parseChildForm(formData);
  if ("error" in parsed) return parsed;

  await prisma.child.create({
    data: {
      name: parsed.name,
      avatar: parsed.avatar,
      birthday: parsed.birthday,
      openAtAge: parsed.openAtAge,
      // Every child has an open age, so mint the self-authenticating open token
      // upfront.
      openToken: randomBytes(24).toString("base64url"),
      parentId: session.user.id,
    },
  });

  revalidatePath("/children");
  revalidatePath("/letters/new");
  return { ok: true };
}

// Edit an existing child's details, including the full birthday and the
// bottle-timer age. Only the owner may edit.
export async function updateChild(
  _prev: ChildFormState,
  formData: FormData,
): Promise<ChildFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in." };
  }

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "We couldn't tell which child to update." };

  const existing = await prisma.child.findFirst({
    where: { id, parentId: session.user.id },
    select: { id: true, openToken: true },
  });
  if (!existing) {
    return { error: "That child isn't one you can edit." };
  }

  const parsed = parseChildForm(formData);
  if ("error" in parsed) return parsed;

  // Keep an existing token stable; mint one if this child never had it.
  const openToken = existing.openToken ?? randomBytes(24).toString("base64url");

  await prisma.child.update({
    where: { id: existing.id },
    data: {
      name: parsed.name,
      avatar: parsed.avatar,
      birthday: parsed.birthday,
      openAtAge: parsed.openAtAge,
      openToken,
    },
  });

  revalidatePath("/children");
  revalidatePath("/letters/new");
  return { ok: true };
}

export async function deleteChild(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Only the owner may remove a child. Removing a child is destructive: every
  // letter written to them — drafts and sealed alike, from any co-parent — is
  // deleted forever, and the private open link stops working.
  const child = await prisma.child.findFirst({
    where: { id, parentId: session.user.id },
    select: { id: true },
  });
  if (!child) return;

  await prisma.$transaction([
    prisma.letter.deleteMany({ where: { childId: child.id } }),
    prisma.child.delete({ where: { id: child.id } }),
  ]);

  revalidatePath("/children");
  revalidatePath("/dashboard");
}

export async function deleteLetter(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Only delete a draft the current user owns. Once a letter is sent it's
  // sealed forever and can't be removed.
  await prisma.letter.deleteMany({
    where: { id, authorId: session.user.id, status: "DRAFT" },
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

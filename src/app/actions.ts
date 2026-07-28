"use server";

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

  // Verify the child belongs to this user and grab a name snapshot.
  const child = await prisma.child.findFirst({
    where: { id: childId, parentId: session.user.id },
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

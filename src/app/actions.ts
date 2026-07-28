"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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
  const recipientName = String(formData.get("recipientName") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const deliverAtRaw = String(formData.get("deliverAt") ?? "").trim();
  const photoUrls = formData
    .getAll("photoUrls")
    .map((v) => String(v))
    .filter(Boolean);

  if (!title || !recipientName || !body || !deliverAtRaw) {
    return { error: "Please fill in the title, recipient, message, and date." };
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
      recipientName,
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

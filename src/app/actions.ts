"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  childInputMessage,
  parseChildInput,
  type ChildFormValues,
  type ParsedChild,
} from "@/lib/child-input";
import {
  letterInputMessage,
  parseLetterInput,
  parseLetterIntent,
} from "@/lib/letter-input";
import { canUploadImages } from "@/lib/subscription";
import { letterImageIds } from "@/lib/letter-body";
import {
  IMAGE_MAX_UPLOAD_BYTES,
  IMAGES_PER_LETTER,
  letterImageMessage,
  staleImages,
  validateUpload,
} from "@/lib/letter-image";
import {
  deleteLetterImages,
  putLetterImage,
} from "@/lib/letter-image-store";

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

  // A draft needs at least a title to have something to come back to; sending
  // requires the recipient and message so the sealed letter is complete. When
  // the bottle opens is set on the child, not the letter.
  const rawBody = String(formData.get("body") ?? "");
  const author = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { subscription: true },
  });

  const referencedImageIds = letterImageIds(rawBody);

  const parsed = parseLetterInput(
    {
      title: String(formData.get("title") ?? ""),
      childId: String(formData.get("childId") ?? ""),
      body: rawBody,
    },
    parseLetterIntent(String(formData.get("intent") ?? "")),
    {
      hasImages: referencedImageIds.length > 0,
      mayHoldImages: canUploadImages(author?.subscription),
      imageCount: referencedImageIds.length,
    },
  );
  if (!parsed.ok) return { error: letterInputMessage(parsed.error) };
  const { title, childId, body, sealing: submitting } = parsed.value;

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
    //
    // The status flip to SENT and the image claim/stale-lookup must commit
    // together: if the write landed but the claim never ran (a dropped
    // connection, a function timeout), the letter would be sealed forever
    // while its just-uploaded image sat unattached — and the orphan sweep,
    // which only ever looks at unattached rows, would delete it 24h later out
    // from under a letter nothing can reconcile again. Blob deletion is a
    // network call and can't join a DB transaction, so it happens after this
    // one commits, using the stale set the transaction decided on.
    const staleToDelete = await prisma.$transaction(async (tx) => {
      const result = await tx.letter.updateMany({
        where: { id, authorId: session.user.id, status: "DRAFT" },
        data,
      });
      if (result.count === 0) return null;
      return reconcileLetterImageRows(tx, {
        letterId: id,
        authorId: session.user.id,
        body: parsed.value.body,
      });
    });
    if (staleToDelete === null) {
      return { error: "That draft can't be edited anymore." };
    }
    await deleteLetterImages(staleToDelete.map((image) => image.pathname));
  } else {
    const stale = await prisma.$transaction(async (tx) => {
      const created = await tx.letter.create({
        data: { ...data, authorId: session.user.id },
        select: { id: true },
      });
      return reconcileLetterImageRows(tx, {
        letterId: created.id,
        authorId: session.user.id,
        body: parsed.value.body,
      });
    });
    await deleteLetterImages(stale.map((image) => image.pathname));
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export type LetterImageState = {
  error?: string;
  image?: { id: string; width: number; height: number };
};

// Store one compressed image and hand back the id the client writes into the
// body as a [[img:<id>]] marker.
//
// Uploading is the Pro-gated half of this feature. The button is hidden for
// free users, but that is UX — this check is the boundary, because anyone can
// POST to a server action.
export async function uploadLetterImage(
  _prev: LetterImageState,
  formData: FormData,
): Promise<LetterImageState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in to add a photo." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { subscription: true },
  });
  if (!canUploadImages(user?.subscription)) {
    return { error: letterImageMessage("IMAGE_NOT_PRO") };
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { error: letterImageMessage("IMAGE_MALFORMED") };
  }
  if (file.size > IMAGE_MAX_UPLOAD_BYTES) {
    return { error: letterImageMessage("IMAGE_TOO_LARGE_TO_READ") };
  }

  const width = Number(formData.get("width"));
  const height = Number(formData.get("height"));
  const check = validateUpload({
    mimeType: file.type,
    bytes: file.size,
    width,
    height,
  });
  if (!check.ok) return { error: letterImageMessage(check.error) };

  // A letter id is present when editing a saved draft, absent for a letter
  // that hasn't been saved yet — those rows start unattached and are claimed
  // on first save.
  const letterId = String(formData.get("letterId") ?? "").trim();
  let attachedTo: string | null = null;
  if (letterId) {
    const letter = await prisma.letter.findFirst({
      where: { id: letterId, authorId: session.user.id, status: "DRAFT" },
      select: { id: true, _count: { select: { images: true } } },
    });
    if (!letter) return { error: "That draft can't be edited anymore." };
    if (letter._count.images >= IMAGES_PER_LETTER) {
      return { error: letterImageMessage("IMAGE_TOO_MANY") };
    }
    attachedTo = letter.id;
  } else {
    // No letter yet — the common case for a brand-new draft. Without this,
    // a client could upload without bound before any letter exists to cap
    // against: each upload is a real blob sitting in the store for up to 24h,
    // and an unmetered write against it besides.
    const unattachedCount = await prisma.letterImage.count({
      where: { authorId: session.user.id, letterId: null },
    });
    if (unattachedCount >= IMAGES_PER_LETTER) {
      return { error: letterImageMessage("IMAGE_TOO_MANY") };
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { pathname } = await putLetterImage({
    authorId: session.user.id,
    body: buffer,
    mimeType: file.type,
  });

  const image = await prisma.letterImage.create({
    data: {
      pathname,
      width,
      height,
      bytes: buffer.byteLength,
      mimeType: file.type,
      authorId: session.user.id,
      letterId: attachedTo,
    },
    select: { id: true, width: true, height: true },
  });

  return { image };
}

// Claim rows uploaded for this letter before it had an id, and delete rows
// (not blobs) for images the body no longer references — then hand back what
// it deleted so the caller can remove those blobs after the transaction
// commits.
//
// The body is the authority on what is referenced, so this is exact rather
// than heuristic. It covers both "the author removed a marker" and "the author
// uploaded a photo then changed their mind mid-edit".
//
// Sealing runs this one last time; after that the letter's images are frozen
// with it and nothing may touch them again.
//
// Runs inside the same transaction as the letter write that calls it: the
// status flip to SENT and this claim/delete must commit together, or a
// dropped connection between the two could seal a letter while its
// just-uploaded image row was still unattached — and the orphan sweep, which
// only looks at unattached rows, would delete it later out from under a
// letter nothing can reconcile again.
async function reconcileLetterImageRows(
  tx: Prisma.TransactionClient,
  input: { letterId: string; authorId: string; body: string },
): Promise<{ id: string; pathname: string }[]> {
  // The body is the single authority on what is referenced. The cap is
  // enforced upstream by parseLetterInput, which rejects an over-cap save
  // outright — so nothing here needs to trim, and the parser and reconciliation
  // can never disagree about what "referenced" means.
  const referenced = letterImageIds(input.body);

  // Claim rows uploaded for this letter before it had an id. Only ids the body
  // actually references, so an abandoned upload stays unattached and is swept.
  if (referenced.length > 0) {
    await tx.letterImage.updateMany({
      where: {
        id: { in: referenced },
        authorId: input.authorId,
        letterId: null,
      },
      data: { letterId: input.letterId },
    });
  }

  const attached = await tx.letterImage.findMany({
    where: { letterId: input.letterId },
    select: { id: true, pathname: true },
  });
  const stale = staleImages(referenced, attached);
  if (stale.length === 0) return [];

  await tx.letterImage.deleteMany({
    where: { id: { in: stale.map((image) => image.id) } },
  });
  return stale;
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
    photo: String(formData.get("photo") ?? ""),
    photoAction: String(formData.get("photoAction") ?? ""),
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
      photo: parsed.photo ?? null,
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
      photo: parsed.photo,
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

  // Every letter written to this child, from every co-parent, drafts and
  // sealed alike — and the photos inside them.
  //
  // The pathnames are collected inside the same transaction that deletes the
  // letters, so the list is taken from the same snapshot the delete acts on. A
  // co-parent attaching an image to one of these letters concurrently either
  // lands before the snapshot (and is collected) or after the delete (and has
  // no letter to attach to) — it can't slip between the two and leave its blob
  // orphaned in storage.
  const pathnames = await prisma.$transaction(async (tx) => {
    const images = await tx.letterImage.findMany({
      where: { letter: { childId: child.id } },
      select: { pathname: true },
    });
    // The rows go with the letters, by cascade.
    await tx.letter.deleteMany({ where: { childId: child.id } });
    await tx.child.delete({ where: { id: child.id } });
    return images.map((image) => image.pathname);
  });

  // Blob deletion is a network call and never belongs inside a transaction, so
  // it runs after the commit. A failure here leaves blobs with no rows pointing
  // at them — unreachable, and swept later — which is the safe direction.
  await deleteLetterImages(pathnames);

  revalidatePath("/children");
  revalidatePath("/dashboard");
}

export async function deleteLetter(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Only a draft the current user owns. Once sent, a letter is sealed forever
  // and can't be removed.
  const draft = await prisma.letter.findFirst({
    where: { id, authorId: session.user.id, status: "DRAFT" },
    select: { id: true, images: { select: { pathname: true } } },
  });
  if (!draft) return;

  // Blobs first: the cascade will take the rows, but never the bytes.
  await deleteLetterImages(draft.images.map((image) => image.pathname));
  await prisma.letter.delete({ where: { id: draft.id } });

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

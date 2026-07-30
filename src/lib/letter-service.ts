// The letter mutations, with the web glue taken off. Sibling of
// child-service.ts, and the same bargain: plain values plus a userId in, plain
// values or an error *code* out, so src/app/actions.ts and the mobile API
// routes are both thin adapters over one implementation of the rules.
//
// Two invariants live in this file and must not be weakened:
//
//   - Sealing is final. Every mutation scopes its query with
//     `status: "DRAFT"`, so a SENT letter is unreachable for edit or delete by
//     construction rather than by a check a caller could forget.
//   - Contents are encrypted at rest. saveLetterFor encrypts title and body
//     before they touch the database; readers decrypt. Image-marker parsing
//     always reads the *plaintext* body the parser returned, never the stored
//     copy, so encryption never touches reconciliation.
//
// Untested by design - every function needs a database. The rules are in
// letter-input.ts, letter-image.ts, letter-body.ts, and letter-crypto.ts, all
// of which are tested.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  letterInputMessage,
  parseLetterInput,
  parseLetterIntent,
  type LetterInputError,
} from "./letter-input.ts";
import { canUploadImages } from "./subscription.ts";
import { letterImageIds } from "./letter-body.ts";
import { encryptLetterField } from "./letter-crypto-key.ts";
import {
  IMAGE_MAX_UPLOAD_BYTES,
  IMAGES_PER_LETTER,
  letterImageMessage,
  staleImages,
  validateUpload,
  type LetterImageError,
} from "./letter-image.ts";
import { deleteLetterImages, putLetterImage } from "./letter-image-store.ts";

// Why a letter mutation was refused. Two codes of its own; the rest come from
// the validation libs, which already speak in codes.
export type LetterAccessError = "LETTER_NOT_EDITABLE" | "CHILD_NOT_YOURS";

export type LetterServiceError =
  | LetterInputError
  | LetterImageError
  | LetterAccessError;

export type LetterServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: LetterServiceError };

// One place to turn a refusal into copy, so the action and the API route say
// the same thing. The input and image codes already have their own message
// functions; only the two access codes are new here.
export function letterServiceMessage(error: LetterServiceError): string {
  switch (error) {
    case "LETTER_NOT_EDITABLE":
      return "That draft can't be edited anymore.";
    case "CHILD_NOT_YOURS":
      return "Please choose one of your children.";
    case "SEND_INCOMPLETE":
    case "DRAFT_NEEDS_TITLE":
    case "SEND_IMAGES_NOT_ALLOWED":
    case "TOO_MANY_IMAGES":
      return letterInputMessage(error);
    default:
      return letterImageMessage(error);
  }
}

// The raw fields a letter form or a JSON request submits. `intent` is a raw
// string so both front doors go through parseLetterIntent, which treats
// anything but an explicit "submit" as a draft - the safe direction.
export type LetterInput = {
  id: string;
  title: string;
  childId: string;
  body: string;
  intent: string;
};

// Create a new draft, or update an existing one - and seal it when the intent
// says so. Once a letter is SENT it can never be edited, so this refuses to
// touch anything that isn't still a draft.
export async function saveLetterFor(
  userId: string,
  input: LetterInput,
): Promise<LetterServiceResult<{ id: string; sealed: boolean }>> {
  const id = input.id.trim();

  const author = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscription: true },
  });

  // Read the markers off the submitted body, before trimming - the parser is
  // the single authority on what this letter references.
  const referencedImageIds = letterImageIds(input.body);

  const parsed = parseLetterInput(
    { title: input.title, childId: input.childId, body: input.body },
    parseLetterIntent(input.intent),
    {
      hasImages: referencedImageIds.length > 0,
      mayHoldImages: canUploadImages(author?.subscription),
      imageCount: referencedImageIds.length,
    },
  );
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { title, childId, body, sealing } = parsed.value;

  // Verify the chosen child belongs to this user and grab a name snapshot. A
  // child is optional for a draft.
  let child: { id: string; name: string } | null = null;
  if (childId) {
    child = await prisma.child.findFirst({
      where: { id: childId, parentId: userId },
      select: { id: true, name: true },
    });
    if (!child) return { ok: false, error: "CHILD_NOT_YOURS" };
  }

  // Title and body are the letter's private contents; encrypt them before they
  // touch the database. recipientName is a snapshot of the child's name, which
  // already sits in plaintext on the Child row, so encrypting it here would buy
  // nothing.
  const data = {
    title: encryptLetterField(title),
    recipientName: child?.name ?? "",
    childId: child?.id ?? null,
    body: encryptLetterField(body),
    status: sealing ? "SENT" : "DRAFT",
  };

  if (id) {
    // Only the author's own letter, and only while it's still a draft - a sent
    // letter is sealed forever.
    //
    // The status flip to SENT and the image claim/stale-lookup must commit
    // together: if the write landed but the claim never ran (a dropped
    // connection, a function timeout), the letter would be sealed forever
    // while its just-uploaded image sat unattached - and the orphan sweep,
    // which only ever looks at unattached rows, would delete it 24h later out
    // from under a letter nothing can reconcile again. Blob deletion is a
    // network call and can't join a DB transaction, so it happens after this
    // one commits, using the stale set the transaction decided on.
    const staleToDelete = await prisma.$transaction(async (tx) => {
      const result = await tx.letter.updateMany({
        where: { id, authorId: userId, status: "DRAFT" },
        data,
      });
      if (result.count === 0) return null;
      return reconcileLetterImageRows(tx, {
        letterId: id,
        authorId: userId,
        body,
      });
    });
    if (staleToDelete === null) {
      return { ok: false, error: "LETTER_NOT_EDITABLE" };
    }
    await deleteLetterImages(staleToDelete.map((image) => image.pathname));
    return { ok: true, value: { id, sealed: sealing } };
  }

  const created = await prisma.$transaction(async (tx) => {
    const letter = await tx.letter.create({
      data: { ...data, authorId: userId },
      select: { id: true },
    });
    const stale = await reconcileLetterImageRows(tx, {
      letterId: letter.id,
      authorId: userId,
      body,
    });
    return { id: letter.id, stale };
  });
  await deleteLetterImages(created.stale.map((image) => image.pathname));

  return { ok: true, value: { id: created.id, sealed: sealing } };
}

// Delete a draft and the photos inside it. A sent letter is sealed forever and
// can never be removed, which the `status: "DRAFT"` scope enforces.
export async function deleteLetterFor(
  userId: string,
  letterId: string,
): Promise<LetterServiceResult<{ id: string }>> {
  const id = letterId.trim();
  if (!id) return { ok: false, error: "LETTER_NOT_EDITABLE" };

  const draft = await prisma.letter.findFirst({
    where: { id, authorId: userId, status: "DRAFT" },
    select: { id: true, images: { select: { pathname: true } } },
  });
  if (!draft) return { ok: false, error: "LETTER_NOT_EDITABLE" };

  // Blobs first: the cascade will take the rows, but never the bytes.
  await deleteLetterImages(draft.images.map((image) => image.pathname));
  await prisma.letter.delete({ where: { id: draft.id } });

  return { ok: true, value: { id: draft.id } };
}

// What an upload hands over. A File rather than a Buffer on purpose: the
// pre-decode size guard has to run *before* the bytes are read into memory, so
// it belongs in here with every other check rather than being duplicated in
// each front door.
export type LetterImageUpload = {
  file: File;
  width: number;
  height: number;
  // Present when editing a saved draft, absent for a letter that hasn't been
  // saved yet - those rows start unattached and are claimed on first save.
  letterId: string;
};

// Store one compressed image and hand back the id the client writes into the
// body as a [[img:<id>]] marker.
//
// Uploading is the Pro-gated half of this feature. The UI hides the button for
// free users, but this check is the boundary - a server action and an API route
// are both reachable by anyone.
export async function uploadLetterImageFor(
  userId: string,
  input: LetterImageUpload,
): Promise<
  LetterServiceResult<{ id: string; width: number; height: number }>
> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscription: true },
  });
  if (!canUploadImages(user?.subscription)) {
    return { ok: false, error: "IMAGE_NOT_PRO" };
  }

  const { file } = input;
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "IMAGE_MALFORMED" };
  }
  if (file.size > IMAGE_MAX_UPLOAD_BYTES) {
    return { ok: false, error: "IMAGE_TOO_LARGE_TO_READ" };
  }

  const check = validateUpload({
    mimeType: file.type,
    bytes: file.size,
    width: input.width,
    height: input.height,
  });
  if (!check.ok) return { ok: false, error: check.error };

  const letterId = input.letterId.trim();
  let attachedTo: string | null = null;
  if (letterId) {
    const letter = await prisma.letter.findFirst({
      where: { id: letterId, authorId: userId, status: "DRAFT" },
      select: { id: true, _count: { select: { images: true } } },
    });
    if (!letter) return { ok: false, error: "LETTER_NOT_EDITABLE" };
    if (letter._count.images >= IMAGES_PER_LETTER) {
      return { ok: false, error: "IMAGE_TOO_MANY" };
    }
    attachedTo = letter.id;
  } else {
    // No letter yet - the common case for a brand-new draft. Without this, a
    // client could upload without bound before any letter exists to cap
    // against: each upload is a real blob sitting in the store for up to 24h,
    // and an unmetered write against it besides.
    const unattachedCount = await prisma.letterImage.count({
      where: { authorId: userId, letterId: null },
    });
    if (unattachedCount >= IMAGES_PER_LETTER) {
      return { ok: false, error: "IMAGE_TOO_MANY" };
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { pathname } = await putLetterImage({
    authorId: userId,
    body: buffer,
    mimeType: file.type,
  });

  const image = await prisma.letterImage.create({
    data: {
      pathname,
      width: input.width,
      height: input.height,
      bytes: buffer.byteLength,
      mimeType: file.type,
      authorId: userId,
      letterId: attachedTo,
    },
    select: { id: true, width: true, height: true },
  });

  return { ok: true, value: image };
}

// Throw away photos uploaded while writing a letter that was never saved. A
// brand-new letter's uploads sit unattached (`letterId: null`) until its first
// save; the orphan sweep would collect them eventually, but a deliberate
// "discard" should honour the delete-the-photos promise at once rather than 24h
// later.
//
// Scoped to the caller's own unattached rows, so it can never reach a photo
// that belongs to a saved draft or a sealed letter - those always carry a
// letterId, and this must not become a way to unpick a sealed letter's images.
export async function discardDraftImagesFor(
  userId: string,
  imageIds: string[],
): Promise<{ deleted: number }> {
  // Reachable as a server action endpoint, so don't trust the shape.
  if (!Array.isArray(imageIds)) return { deleted: 0 };
  const ids = imageIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (ids.length === 0) return { deleted: 0 };

  const images = await prisma.letterImage.findMany({
    where: { id: { in: ids }, authorId: userId, letterId: null },
    select: { id: true, pathname: true },
  });
  if (images.length === 0) return { deleted: 0 };

  // Blobs first: a failure here leaves rows pointing at missing bytes (swept
  // later), never bytes with no row pointing at them.
  await deleteLetterImages(images.map((image) => image.pathname));
  await prisma.letterImage.deleteMany({
    where: { id: { in: images.map((image) => image.id) } },
  });

  return { deleted: images.length };
}

// Claim rows uploaded for this letter before it had an id, and delete rows
// (not blobs) for images the body no longer references - then hand back what
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
// just-uploaded image row was still unattached - and the orphan sweep, which
// only looks at unattached rows, would delete it later out from under a
// letter nothing can reconcile again.
async function reconcileLetterImageRows(
  tx: Prisma.TransactionClient,
  input: { letterId: string; authorId: string; body: string },
): Promise<{ id: string; pathname: string }[]> {
  // The body is the single authority on what is referenced. The cap is
  // enforced upstream by parseLetterInput, which rejects an over-cap save
  // outright - so nothing here needs to trim, and the parser and reconciliation
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

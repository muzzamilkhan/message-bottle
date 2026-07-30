// The child mutations, with the web glue taken off.
//
// Everything src/app/actions.ts used to do between `await auth()` and
// `revalidatePath` lives here: validate, check ownership, write, delete blobs.
// The actions are now adapters (FormData in, message out) and the mobile API
// routes are adapters too (JSON in, JSON out) - both call these, so the rules
// can't drift between the two front doors.
//
// Plain values in, plain values or an error *code* out. Copy lives in
// childServiceMessage, so a caller picks its own wording and tests assert on
// rules. Untested by design, like children.ts and letter-image-store.ts: every
// function here needs a database, which CLAUDE.md's testing philosophy names as
// the smell that a rule is in the wrong place. The rules themselves are in
// child-input.ts, which is tested.

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { deleteLetterImages } from "./letter-image-store.ts";
import {
  childInputMessage,
  parseChildInput,
  type ChildFormValues,
  type ChildInputError,
  type ParsedChild,
} from "./child-input.ts";

// The raw strings a child form submits, before parsing. Both front doors hand
// over this shape so they run the same validation - the web action reads it off
// FormData, the API route off JSON.
export type ChildInput = {
  name: string;
  avatar: string;
  birthday: string;
  openAtAge: string;
  photo: string;
  photoAction: string;
};

// Why a child mutation was refused. The input codes come from child-input.ts;
// these two are about reaching the row at all.
export type ChildAccessError = "CHILD_ID_REQUIRED" | "CHILD_NOT_FOUND";

export type ChildServiceError = ChildInputError | ChildAccessError;

export type ChildServiceFailure = {
  ok: false;
  error: ChildServiceError;
  // Echoed back only for a validation failure, so a re-rendered web form can
  // repopulate fields React would otherwise reset.
  values?: ChildFormValues;
  // Only set for OPEN_AGE_NOT_IN_FUTURE, whose message needs it.
  currentAge?: number;
};

export type ChildServiceResult<T> = { ok: true; value: T } | ChildServiceFailure;

// A child as every caller gets it back after a write.
export type ChildRecord = {
  id: string;
  name: string;
  avatar: string;
  photo: string | null;
  birthday: Date;
  openAtAge: number;
  openToken: string | null;
};

const CHILD_FIELDS = {
  id: true,
  name: true,
  avatar: true,
  photo: true,
  birthday: true,
  openAtAge: true,
  openToken: true,
} as const;

// One place to turn a refusal into copy, so the action and the API route say
// the same thing and neither invents its own wording.
export function childServiceMessage(
  error: ChildServiceError,
  ctx: { name: string; currentAge?: number },
): string {
  switch (error) {
    case "CHILD_ID_REQUIRED":
      return "We couldn't tell which child to update.";
    case "CHILD_NOT_FOUND":
      return "That child isn't one you can edit.";
    default:
      return childInputMessage(error, ctx);
  }
}

// Parse, widening a rejection into the failure shape both callers expect.
function parse(
  input: ChildInput,
  now?: Date,
): { ok: true; value: ParsedChild } | ChildServiceFailure {
  const result = parseChildInput(input, now);
  if (result.ok) return result;
  return {
    ok: false,
    error: result.error,
    values: result.values,
    currentAge: result.currentAge,
  };
}

// A new child, with the self-authenticating open token minted upfront - every
// child has an open age, so the link exists from the start.
export async function createChildFor(
  userId: string,
  input: ChildInput,
  now?: Date,
): Promise<ChildServiceResult<ChildRecord>> {
  const parsed = parse(input, now);
  if (!parsed.ok) return parsed;
  const child = parsed.value;

  const created = await prisma.child.create({
    data: {
      name: child.name,
      avatar: child.avatar,
      photo: child.photo ?? null,
      birthday: child.birthday,
      openAtAge: child.openAtAge,
      openToken: randomBytes(24).toString("base64url"),
      parentId: userId,
    },
    select: CHILD_FIELDS,
  });

  return { ok: true, value: created };
}

// Edit a child's details, including the full birthday and the bottle-timer
// age. Only the owner may edit - ownership is the whole access model.
export async function updateChildFor(
  userId: string,
  childId: string,
  input: ChildInput,
  now?: Date,
): Promise<ChildServiceResult<ChildRecord>> {
  const id = childId.trim();
  if (!id) return { ok: false, error: "CHILD_ID_REQUIRED" };

  const existing = await prisma.child.findFirst({
    where: { id, parentId: userId },
    select: { id: true, openToken: true },
  });
  if (!existing) return { ok: false, error: "CHILD_NOT_FOUND" };

  const parsed = parse(input, now);
  if (!parsed.ok) return parsed;
  const child = parsed.value;

  const updated = await prisma.child.update({
    where: { id: existing.id },
    data: {
      name: child.name,
      avatar: child.avatar,
      photo: child.photo,
      birthday: child.birthday,
      openAtAge: child.openAtAge,
      // Keep an existing token stable; mint one if this child never had it.
      openToken: existing.openToken ?? randomBytes(24).toString("base64url"),
    },
    select: CHILD_FIELDS,
  });

  return { ok: true, value: updated };
}

// Remove a child, every letter written to them - drafts and sealed alike - and
// every photo inside those letters. The open link stops working.
//
// Sole ownership is what makes this promise keepable: there is no co-parent
// whose photos live under a child they don't own.
export async function deleteChildFor(
  userId: string,
  childId: string,
): Promise<ChildServiceResult<{ id: string }>> {
  const id = childId.trim();
  if (!id) return { ok: false, error: "CHILD_ID_REQUIRED" };

  const child = await prisma.child.findFirst({
    where: { id, parentId: userId },
    select: { id: true },
  });
  if (!child) return { ok: false, error: "CHILD_NOT_FOUND" };

  // The pathnames are collected inside the same transaction that deletes the
  // letters, so the list is taken from the same snapshot the delete acts on. A
  // concurrent save attaching an image to one of these letters - a second tab
  // mid-edit - either lands before the snapshot (and is collected) or after the
  // delete (and has no letter to attach to); it can't slip between the two and
  // leave its blob orphaned in storage.
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
  // at them - unreachable, and swept later - which is the safe direction.
  await deleteLetterImages(pathnames);

  return { ok: true, value: { id: child.id } };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { deleteAccountFor } from "@/lib/account-service";
import type { ChildFormValues } from "@/lib/child-input";
import {
  childServiceMessage,
  createChildFor,
  deleteChildFor,
  updateChildFor,
  type ChildInput,
  type ChildServiceFailure,
} from "@/lib/child-service";
import {
  deleteLetterFor,
  discardDraftImagesFor,
  letterServiceMessage,
  saveLetterFor,
  uploadLetterImageFor,
} from "@/lib/letter-service";

export type LetterFormState = { error?: string };

// Create a new draft or update/submit an existing one. The `intent` field
// decides whether the letter is kept as an editable DRAFT or sealed as SENT.
// The rules, the encryption, and the image reconciliation all live in
// @/lib/letter-service; this reads the form and maps a refusal to copy.
export async function saveLetter(
  _prev: LetterFormState,
  formData: FormData,
): Promise<LetterFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in to write a letter." };
  }

  const result = await saveLetterFor(session.user.id, {
    id: String(formData.get("id") ?? ""),
    title: String(formData.get("title") ?? ""),
    childId: String(formData.get("childId") ?? ""),
    body: String(formData.get("body") ?? ""),
    intent: String(formData.get("intent") ?? ""),
  });
  if (!result.ok) return { error: letterServiceMessage(result.error) };

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export type LetterImageState = {
  error?: string;
  image?: { id: string; width: number; height: number };
};

// Store one compressed image and hand back the id the client writes into the
// body as a [[img:<id>]] marker. The Pro gate and every validation check are
// in the service, because a server action is a reachable endpoint and the UI
// hiding the button is only UX.
export async function uploadLetterImage(
  _prev: LetterImageState,
  formData: FormData,
): Promise<LetterImageState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You need to be signed in to add a photo." };
  }

  const file = formData.get("image");
  const result = await uploadLetterImageFor(session.user.id, {
    // A non-File submission is malformed, which the service reports; hand it a
    // shape it can reject rather than deciding that here.
    file: file instanceof File ? file : new File([], ""),
    width: Number(formData.get("width")),
    height: Number(formData.get("height")),
    letterId: String(formData.get("letterId") ?? ""),
  });
  if (!result.ok) return { error: letterServiceMessage(result.error) };

  return { image: result.value };
}

export type ChildFormState = {
  error?: string;
  ok?: boolean;
  values?: ChildFormValues;
};

// Read the child fields off FormData in the shape the service parses. The
// rules live in @/lib/child-input and the writes in @/lib/child-service, so
// this is only transport.
function childInputFrom(formData: FormData): ChildInput {
  return {
    name: String(formData.get("name") ?? ""),
    avatar: String(formData.get("avatar") ?? ""),
    birthday: String(formData.get("birthday") ?? ""),
    openAtAge: String(formData.get("openAtAge") ?? ""),
    photo: String(formData.get("photo") ?? ""),
    photoAction: String(formData.get("photoAction") ?? ""),
  };
}

// Turn a service refusal into the state the form re-renders from.
function childFailureState(failure: ChildServiceFailure): ChildFormState {
  return {
    error: childServiceMessage(failure.error, {
      name: failure.values?.name ?? "",
      currentAge: failure.currentAge,
    }),
    values: failure.values,
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

  const result = await createChildFor(session.user.id, childInputFrom(formData));
  if (!result.ok) return childFailureState(result);

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

  const result = await updateChildFor(
    session.user.id,
    String(formData.get("id") ?? ""),
    childInputFrom(formData),
  );
  if (!result.ok) return childFailureState(result);

  revalidatePath("/children");
  revalidatePath("/letters/new");
  return { ok: true };
}

// Removing a child is destructive: every letter written to them - drafts and
// sealed alike - is deleted forever, their photos go with them, and the private
// open link stops working. A refusal is silent here because the form has
// nowhere to show one; the service reports it for callers that do.
export async function deleteChild(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const result = await deleteChildFor(
    session.user.id,
    String(formData.get("id") ?? ""),
  );
  if (!result.ok) return;

  revalidatePath("/children");
  revalidatePath("/dashboard");
}

// Permanently delete the signed-in user and everything hanging off them - every
// child, every letter (draft and sealed alike), and every photo inside them.
// The service handles the blobs-then-cascade ordering.
export async function deleteAccount(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  await deleteAccountFor(session.user.id);

  // The session row is already gone with the user; sign out to clear the
  // cookie and land back on the marketing page.
  await signOut({ redirectTo: "/" });
}

// Throw away a new letter that was never saved, deleting any photos uploaded
// while writing it. Given the ids the editor uploaded this session, the service
// deletes only those still unattached, so a saved draft's or a sealed letter's
// photos are out of reach by construction.
export async function discardDraftImages(imageIds: string[]): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  await discardDraftImagesFor(session.user.id, imageIds);
}

// Delete a draft. Once sent, a letter is sealed forever and can't be removed -
// the service enforces that, and a refusal is silent here because this form has
// nowhere to show one.
export async function deleteLetter(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const result = await deleteLetterFor(
    session.user.id,
    String(formData.get("id") ?? ""),
  );
  if (!result.ok) return;

  // The draft's own page (/letters/[id]) would now 404, so send the author
  // back to their bottles instead of leaving them on a dead route.
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

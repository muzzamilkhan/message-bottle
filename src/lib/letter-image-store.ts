// The only module that talks to blob storage. Everything else goes through
// these three functions, so the privacy rules live in one readable place.
//
// The store is created with private access, which is fixed at creation and
// cannot be changed. Private means blobs are unreadable by URL: the only way
// to a byte is through a Function that authorized the request first, which is
// src/app/api/letter-image/[id]/route.ts.
//
// Untested by design — it is a thin wrapper over a network service, and the
// rules worth testing live in letter-image.ts.

import { del, get, put } from "@vercel/blob";
import { randomBytes } from "crypto";

const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

export async function putLetterImage(input: {
  authorId: string;
  body: Buffer | Uint8Array;
  mimeType: string;
}): Promise<{ pathname: string }> {
  const extension = EXTENSIONS[input.mimeType] ?? "bin";
  // Scoped by author and randomized. The store is private so a pathname is
  // never a credential, but an unguessable one costs nothing.
  const name = randomBytes(16).toString("base64url");
  const blob = await put(
    `letters/${input.authorId}/${name}.${extension}`,
    // Buffer.from is a no-op copy when already a Buffer; the SDK's PutBody
    // type doesn't include a bare Uint8Array.
    Buffer.from(input.body),
    { access: "private", addRandomSuffix: true, contentType: input.mimeType },
  );
  return { pathname: blob.pathname };
}

// Read a stored image. Callers MUST authorize the request first.
export async function getLetterImage(
  pathname: string,
): Promise<ReadableStream | null> {
  const result = await get(pathname, { access: "private" });
  return result?.stream ?? null;
}

// Remove images from storage. Called before deleting the rows that point at
// them, so a failure leaves a row pointing at a missing image (which renders
// as a skipped photo) rather than a photo nobody references.
//
// Never throws: a blob that is already gone, or a store hiccup, must not stop
// a parent from deleting their draft or their child.
export async function deleteLetterImages(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) return;
  try {
    await del(pathnames);
  } catch (error) {
    console.error("Failed to delete letter images", { pathnames, error });
  }
}

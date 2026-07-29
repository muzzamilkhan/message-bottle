// The environment-bound half of letter encryption: it resolves the one key
// from process.env and hands the pure functions in letter-crypto.ts something
// to work with. Untested by design, like letter-image-store.ts - the rules are
// tested there with an injected key; this only reads config.
//
// Fail-closed: with no key configured, an encrypted letter can't be read and a
// new letter can't be written safely, so both throw. Reading a legacy plaintext
// letter never needs the key, so that path stays open even before a key is set.

import {
  decryptField,
  encryptField,
  isEncrypted,
  keyFromString,
} from "./letter-crypto.ts";

// The key is static for the life of a process, so resolve it once. The first
// call validates it; a bad key fails the first write or read rather than at
// import time (which would break the build, where no key is present).
let cached: Buffer | null = null;

function letterKey(): Buffer {
  if (cached) return cached;
  const raw = process.env.LETTER_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "LETTER_ENCRYPTION_KEY is not set - letter contents can't be encrypted or decrypted.",
    );
  }
  cached = keyFromString(raw);
  return cached;
}

export function encryptLetterField(plaintext: string): string {
  return encryptField(plaintext, letterKey());
}

export function decryptLetterField(stored: string): string {
  // A plaintext row predates encryption and needs no key to read back, so
  // don't demand one just to return it unchanged.
  if (!isEncrypted(stored)) return stored;
  return decryptField(stored, letterKey());
}

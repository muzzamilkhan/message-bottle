// Application-level encryption for letter contents at rest.
//
// A letter's title and body are the private message a parent writes to their
// child; this module keeps them ciphertext in Postgres so a database dump
// (a stolen backup, a compromised read replica) never exposes them. The key
// lives only in the environment, never in the database, so the two have to be
// stolen together for a leak to matter.
//
// The rules worth testing are pure and live here (like letter-image.ts); the
// side of this that reaches into process.env for the actual key lives in
// letter-crypto-key.ts (like letter-image-store.ts), so this file can be tested
// with an injected key and no environment at all.
//
// Scheme: AES-256-GCM. Each field carries its own random 96-bit IV, and GCM's
// 128-bit auth tag makes tampering with a stored value a decrypt failure rather
// than silent corruption. The stored string is
//
//   enc:v1:<base64url( iv || tag || ciphertext )>
//
// The version segment leaves room for a future scheme (a rotated key, a
// different cipher) without guessing at the old rows' format.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const SCHEME = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

// True when a stored value is one this module wrote. Anything else is treated
// as legacy plaintext - a letter written before encryption was switched on, or
// one that a backfill hasn't reached yet - and read back untouched. New writes
// are always encrypted, so the plaintext branch only ever shrinks.
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(SCHEME);
}

export function encryptField(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return SCHEME + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

// Decrypt a stored value, or pass a legacy plaintext value straight through.
//
// A value that carries the scheme prefix but fails to decrypt - a truncated
// blob, the wrong key, a tampered tag - throws rather than returning garbage:
// rendering a corrupted letter as if it were real would be worse than an error.
export function decryptField(stored: string, key: Buffer): string {
  if (!isEncrypted(stored)) return stored;

  const blob = Buffer.from(stored.slice(SCHEME.length), "base64url");
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Malformed encrypted letter field");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

// Turn the configured key string into the 32 raw bytes AES-256 needs. Accepts
// 64 hex characters or a base64/base64url encoding; anything that doesn't
// decode to exactly 32 bytes is a misconfiguration and throws loudly rather
// than silently weakening the cipher.
export function keyFromString(raw: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `LETTER_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

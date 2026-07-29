import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import {
  decryptField,
  encryptField,
  isEncrypted,
  keyFromString,
} from "./letter-crypto.ts";

// A fixed 32-byte key so tests are deterministic; encryption itself stays
// non-deterministic because each call mints a fresh IV.
const KEY = Buffer.alloc(32, 7);

describe("encryptField / decryptField", () => {
  it("round-trips a body back to the original text", () => {
    const body = "Happy 18th, kiddo.\n\nLove, **Mum** *always*.";
    assert.equal(decryptField(encryptField(body, KEY), KEY), body);
  });

  it("round-trips unicode and image markers intact", () => {
    const body = "🌊 for you\n[[img:abc123]]\ncafé - naïve - 日本語";
    assert.equal(decryptField(encryptField(body, KEY), KEY), body);
  });

  it("round-trips the empty string", () => {
    assert.equal(decryptField(encryptField("", KEY), KEY), "");
  });

  it("tags the output with the scheme prefix", () => {
    assert.ok(isEncrypted(encryptField("hello", KEY)));
  });

  it("produces a different ciphertext each time (fresh IV)", () => {
    assert.notEqual(encryptField("same", KEY), encryptField("same", KEY));
  });
});

describe("decryptField on legacy plaintext", () => {
  it("returns an un-prefixed value untouched", () => {
    assert.equal(decryptField("a plain old letter", KEY), "a plain old letter");
  });

  it("recognises only the exact scheme prefix as encrypted", () => {
    assert.equal(isEncrypted("enc:v2:whatever"), false);
    assert.equal(isEncrypted("not encrypted"), false);
  });
});

describe("decryptField integrity", () => {
  it("throws when the ciphertext was tampered with", () => {
    const encrypted = encryptField("secret", KEY);
    // Corrupt a real decoded byte (in the auth tag) and re-encode, so the flip
    // can't land on base64 padding bits that decode away to nothing.
    const prefix = "enc:v1:";
    const blob = Buffer.from(encrypted.slice(prefix.length), "base64url");
    blob[13] ^= 0xff;
    const tampered = prefix + blob.toString("base64url");
    assert.throws(() => decryptField(tampered, KEY));
  });

  it("throws when decrypted with the wrong key", () => {
    const encrypted = encryptField("secret", KEY);
    assert.throws(() => decryptField(encrypted, Buffer.alloc(32, 9)));
  });

  it("throws on a prefixed but truncated blob", () => {
    assert.throws(() => decryptField("enc:v1:AAAA", KEY));
  });
});

describe("keyFromString", () => {
  it("accepts 64 hex characters", () => {
    const hex = randomBytes(32).toString("hex");
    assert.equal(keyFromString(hex).length, 32);
  });

  it("accepts a base64 encoding of 32 bytes", () => {
    const b64 = randomBytes(32).toString("base64");
    assert.equal(keyFromString(b64).length, 32);
  });

  it("ignores surrounding whitespace", () => {
    const b64 = randomBytes(32).toString("base64");
    assert.equal(keyFromString(`  ${b64}\n`).length, 32);
  });

  it("rejects a key that decodes to the wrong length", () => {
    assert.throws(() => keyFromString(randomBytes(16).toString("base64")));
  });

  it("round-trips a body under a key it produced", () => {
    const key = keyFromString(randomBytes(32).toString("base64"));
    assert.equal(decryptField(encryptField("hi", key), key), "hi");
  });
});

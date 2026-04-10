import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return buf;
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns: IV (12 bytes) || ciphertext || auth tag (16 bytes)
 */
export function encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const result = Buffer.concat([iv, encrypted, authTag]);
  // Create a fresh Uint8Array backed by a plain ArrayBuffer (Prisma Bytes requires this)
  const out = new Uint8Array(result.length);
  out.set(result);
  return out;
}

/**
 * Decrypts a buffer produced by encrypt().
 * Expected format: IV (12 bytes) || ciphertext || auth tag (16 bytes)
 */
export function decrypt(data: Uint8Array): string {
  const key = getKey();
  const buf = Buffer.from(data);

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext) + decipher.final("utf8");
}

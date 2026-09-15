/**
 * Encryption for customer database credentials.
 *
 * These are passwords to other people's production databases, so they are
 * never stored in plaintext. AES-256-GCM gives us confidentiality plus an auth
 * tag, so a tampered row fails to decrypt instead of silently yielding
 * garbage that we might then send to a database.
 *
 * Ciphertext format: `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`
 * The version prefix exists so a future key rotation can read old rows.
 *
 * Deliberately dependency-free (node:crypto only) so it can be unit-tested
 * without a build step.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for.
const TAG_BYTES = 16;

export class CryptoConfigError extends Error {}
export class DecryptionError extends Error {}

let cachedKey: Buffer | null = null;

/**
 * Reads APP_ENCRYPTION_KEY (32 bytes, base64). Read lazily rather than at
 * module load so importing this file in a test or a build step does not
 * require the key to be present.
 */
export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || raw === "replace-me") {
    throw new CryptoConfigError(
      "APP_ENCRYPTION_KEY is not set. Generate one with: " +
        `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new CryptoConfigError(
      `APP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        "It must be base64-encoded random bytes, not a passphrase.",
    );
  }

  cachedKey = key;
  return key;
}

/** Test seam: forget the memoized key after changing the environment. */
export function resetEncryptionKeyCache(): void {
  cachedKey = null;
}

export function encryptSecret(plaintext: string, key: Buffer = getEncryptionKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string, key: Buffer = getEncryptionKey()): string {
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new DecryptionError("Malformed ciphertext: expected 4 colon-separated parts.");
  }

  const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  if (version !== VERSION) {
    throw new DecryptionError(`Unsupported ciphertext version "${version}".`);
  }

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new DecryptionError("Malformed ciphertext: bad IV or auth tag length.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // `final()` throws when the auth tag does not match: the row was tampered
    // with, or was encrypted under a different key.
    throw new DecryptionError(
      "Could not decrypt: the data was modified, or APP_ENCRYPTION_KEY changed.",
    );
  }
}

export function encryptJson(value: unknown, key?: Buffer): string {
  return encryptSecret(JSON.stringify(value), key);
}

export function decryptJson<T>(payload: string, key?: Buffer): T {
  return JSON.parse(decryptSecret(payload, key)) as T;
}

/* -------------------------------------------------------------------------- */
/* Password hashing                                                           */
/* -------------------------------------------------------------------------- */

const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 64;
// N=2^15 is the interactive-login parameter set; ~100ms and ~32MB per hash.
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * scrypt via node:crypto rather than bcrypt, so password handling needs no
 * native dependency. Format: `scrypt$<N>$<r>$<p>$<salt-b64>$<hash-b64>`.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = scryptSync(password.normalize("NFKC"), salt, SCRYPT_KEY_BYTES, SCRYPT_PARAMS);
  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const expected = Buffer.from(hashB64, "base64");
  let actual: Buffer;
  try {
    actual = scryptSync(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }

  // Lengths are equal by construction, but timingSafeEqual throws otherwise.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* -------------------------------------------------------------------------- */
/* Share tokens                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The bearer credential for a published dashboard. 32 random bytes, so it
 * cannot be enumerated, and base64url so it is safe in a path segment.
 */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

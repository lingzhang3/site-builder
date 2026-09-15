import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import {
  CryptoConfigError,
  DecryptionError,
  decryptJson,
  decryptSecret,
  encryptJson,
  encryptSecret,
  generateShareToken,
  getEncryptionKey,
  hashPassword,
  resetEncryptionKeyCache,
  verifyPassword,
} from "./crypto.ts";

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value", () => {
    const secret = "super-secret-database-password";
    assert.equal(decryptSecret(encryptSecret(secret, KEY), KEY), secret);
  });

  it("round-trips unicode and empty strings", () => {
    for (const value of ["", "密码🔐", "a".repeat(10_000)]) {
      assert.equal(decryptSecret(encryptSecret(value, KEY), KEY), value);
    }
  });

  it("produces different ciphertext each time, so equal passwords are not linkable", () => {
    const a = encryptSecret("same", KEY);
    const b = encryptSecret("same", KEY);
    assert.notEqual(a, b);
  });

  it("emits a versioned, colon-delimited payload", () => {
    const parts = encryptSecret("x", KEY).split(":");
    assert.equal(parts.length, 4);
    assert.equal(parts[0], "v1");
  });

  it("never leaks the plaintext into the payload", () => {
    const payload = encryptSecret("needle-in-haystack", KEY);
    assert.ok(!payload.includes("needle"));
  });

  it("rejects a tampered ciphertext rather than returning garbage", () => {
    const payload = encryptSecret("password", KEY);
    const parts = payload.split(":");
    const data = Buffer.from(parts[3]!, "base64");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64");
    assert.throws(() => decryptSecret(parts.join(":"), KEY), DecryptionError);
  });

  it("rejects a tampered auth tag", () => {
    const parts = encryptSecret("password", KEY).split(":");
    const tag = Buffer.from(parts[2]!, "base64");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64");
    assert.throws(() => decryptSecret(parts.join(":"), KEY), DecryptionError);
  });

  it("rejects decryption under the wrong key", () => {
    assert.throws(() => decryptSecret(encryptSecret("x", KEY), OTHER_KEY), DecryptionError);
  });

  it("rejects malformed payloads", () => {
    assert.throws(() => decryptSecret("nonsense", KEY), DecryptionError);
    assert.throws(() => decryptSecret("v1:a:b", KEY), DecryptionError);
    assert.throws(() => decryptSecret("v2:a:b:c", KEY), DecryptionError);
    assert.throws(() => decryptSecret("v1:short:short:data", KEY), DecryptionError);
  });
});

describe("encryptJson / decryptJson", () => {
  it("round-trips a credential object", () => {
    const credentials = {
      host: "db.customer.example",
      port: 5432,
      database: "analytics",
      user: "readonly",
      password: "p@ss:word:with:colons",
      ssl: true,
    };
    const payload = encryptJson(credentials, KEY);
    assert.ok(!payload.includes("p@ss"));
    assert.deepEqual(decryptJson<typeof credentials>(payload, KEY), credentials);
  });
});

describe("getEncryptionKey", () => {
  it("rejects a missing or placeholder key", () => {
    const original = process.env.APP_ENCRYPTION_KEY;
    try {
      for (const value of [undefined, "replace-me"]) {
        resetEncryptionKeyCache();
        if (value === undefined) delete process.env.APP_ENCRYPTION_KEY;
        else process.env.APP_ENCRYPTION_KEY = value;
        assert.throws(() => getEncryptionKey(), CryptoConfigError);
      }
    } finally {
      resetEncryptionKeyCache();
      if (original === undefined) delete process.env.APP_ENCRYPTION_KEY;
      else process.env.APP_ENCRYPTION_KEY = original;
    }
  });

  it("rejects a key that is not 32 bytes, so a passphrase cannot be used by mistake", () => {
    const original = process.env.APP_ENCRYPTION_KEY;
    try {
      resetEncryptionKeyCache();
      process.env.APP_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
      assert.throws(() => getEncryptionKey(), CryptoConfigError);
    } finally {
      resetEncryptionKeyCache();
      if (original === undefined) delete process.env.APP_ENCRYPTION_KEY;
      else process.env.APP_ENCRYPTION_KEY = original;
    }
  });

  it("accepts and memoizes a valid key", () => {
    const original = process.env.APP_ENCRYPTION_KEY;
    try {
      resetEncryptionKeyCache();
      process.env.APP_ENCRYPTION_KEY = KEY.toString("base64");
      assert.deepEqual(getEncryptionKey(), KEY);
      assert.equal(decryptSecret(encryptSecret("uses-env-key")), "uses-env-key");
    } finally {
      resetEncryptionKeyCache();
      if (original === undefined) delete process.env.APP_ENCRYPTION_KEY;
      else process.env.APP_ENCRYPTION_KEY = original;
    }
  });
});

describe("hashPassword / verifyPassword", () => {
  it("accepts the correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    assert.equal(verifyPassword("correct horse battery staple", stored), true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("correct horse battery staple");
    assert.equal(verifyPassword("Correct horse battery staple", stored), false);
    assert.equal(verifyPassword("", stored), false);
  });

  it("salts, so the same password hashes differently every time", () => {
    assert.notEqual(hashPassword("same"), hashPassword("same"));
  });

  it("does not store the password in the hash", () => {
    assert.ok(!hashPassword("plaintext-password").includes("plaintext-password"));
  });

  it("normalizes unicode so an equivalent password still verifies", () => {
    // "é" composed vs decomposed: the same password typed on two keyboards.
    const stored = hashPassword("café");
    assert.equal(verifyPassword("café", stored), true);
  });

  it("returns false for a malformed stored hash instead of throwing", () => {
    for (const stored of ["", "nonsense", "scrypt$1$2$3", "bcrypt$a$b$c$d$e", "scrypt$x$8$1$c2E=$aGk="]) {
      assert.equal(verifyPassword("whatever", stored), false, `should reject: ${stored}`);
    }
  });
});

describe("generateShareToken", () => {
  it("is long, URL-safe and unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const token = generateShareToken();
      assert.match(token, /^[A-Za-z0-9_-]+$/, "must be safe in a URL path segment");
      assert.ok(token.length >= 42, `token too short: ${token.length}`);
      assert.ok(!seen.has(token), "tokens must not repeat");
      seen.add(token);
    }
  });
});

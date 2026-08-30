import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function getEncryptionKey(value = process.env.AI_ENCRYPTION_KEY) {
  if (!value) {
    throw new Error("AI_ENCRYPTION_KEY is required for database-managed API keys");
  }

  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");

  if (key.length !== KEY_LENGTH) {
    throw new Error("AI_ENCRYPTION_KEY must encode exactly 32 bytes");
  }

  return key;
}

export function encryptApiKey(apiKey, encryptionKey) {
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error("API key must be a non-empty string");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptApiKey({ ciphertext, iv, authTag }, encryptionKey) {
  if (!ciphertext || !iv || !authTag) {
    throw new Error("Encrypted API key is incomplete");
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getEncryptionKey(encryptionKey),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt API key");
  }
}

export function validateEncryptionKey(value = process.env.AI_ENCRYPTION_KEY) {
  getEncryptionKey(value);
  return true;
}

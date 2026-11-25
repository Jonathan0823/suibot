import { describe, expect, it } from "vitest";
import { encryptApiKey, decryptApiKey, validateEncryptionKey } from "./crypto.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

describe("AI API-key encryption", () => {
  it("round-trips an API key without storing plaintext", () => {
    const encrypted = encryptApiKey("secret-api-key", encryptionKey);

    expect(encrypted.ciphertext).not.toContain("secret-api-key");
    expect(decryptApiKey(encrypted, encryptionKey)).toBe("secret-api-key");
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptApiKey("secret-api-key", encryptionKey);
    encrypted.ciphertext = `${encrypted.ciphertext.slice(0, -2)}AA`;

    expect(() => decryptApiKey(encrypted, encryptionKey)).toThrow("Unable to decrypt API key");
  });

  it("requires a 32-byte master key", () => {
    expect(() => validateEncryptionKey("too-short")).toThrow(
      "AI_ENCRYPTION_KEY must encode exactly 32 bytes",
    );
  });
});

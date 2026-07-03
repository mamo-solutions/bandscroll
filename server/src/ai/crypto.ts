import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getAiConfigEncryptionKey } from "../env.js";

const IV_LENGTH = 12;

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function isAiConfigEncryptionAvailable(): boolean {
  return getAiConfigEncryptionKey() !== null;
}

export function encryptAiSecret(value: string): string {
  const secret = getAiConfigEncryptionKey();
  if (!secret) {
    throw new Error("ai-config-encryption-unavailable");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${encrypted.toString("base64url")}:${tag.toString("base64url")}`;
}

export function decryptAiSecret(value: string): string {
  const secret = getAiConfigEncryptionKey();
  if (!secret) {
    throw new Error("ai-config-encryption-unavailable");
  }

  const [version, ivBase64, encryptedBase64, tagBase64] = value.split(":");
  if (version !== "v1" || !ivBase64 || !encryptedBase64 || !tagBase64) {
    throw new Error("invalid-ai-secret-payload");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(ivBase64, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function maskAiSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

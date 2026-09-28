import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Errors } from "@aurora/shared";
import { env } from "./env.js";

/**
 * AES-256-GCM at rest for provider credentials.
 *
 * The key is derived from ENCRYPTION_KEY exactly as the auth service derives it,
 * so secrets written by either path are readable by both.
 */
function key(): Buffer {
  return createHash("sha256").update(env.encryptionKey || "aurora-default-key").digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw Errors.internal("Sifreli veri bozuk");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Last four characters, so an operator can confirm which key is loaded. */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

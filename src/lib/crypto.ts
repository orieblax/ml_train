import crypto from "crypto";

export function generateId(prefix: string, bytes = 6): string {
  return `${prefix}_${crypto.randomBytes(bytes).toString("hex")}`;
}

export function generateModelApiKey(): string {
  return `mlt_${crypto.randomBytes(24).toString("hex")}`;
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 12) return "mlt_••••••••";
  return `${apiKey.slice(0, 8)}••••••••${apiKey.slice(-4)}`;
}

function deriveAesKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveAesKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string, secret: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted secret format");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const key = deriveAesKey(secret);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function signToken(payload: string, secret: string): string {
  const mac = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("base64url");
  return `${payload}.${mac}`;
}

export function verifySignedToken(token: string, secret: string): string | null {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx <= 0) return null;
  const payload = token.slice(0, dotIdx);
  const expected = signToken(payload, secret);
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? payload : null;
}

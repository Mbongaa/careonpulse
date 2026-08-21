import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9._~:-]{32,4096}$/;
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,2}$/;
const CIPHERTEXT_PATTERN = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
const AAD = Buffer.from("careon-mobile-push-token:v1", "utf8");

export type MobilePlatform = "android" | "ios";

export interface MobilePushDeviceInput {
  installationId: string;
  platform: MobilePlatform;
  token: string;
  appVersion: string;
  locale: string | null;
}

export function parseMobilePushDeviceInput(value: unknown): MobilePushDeviceInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const expectedKeys = new Set(["installationId", "platform", "token", "appVersion", "locale"]);
  if (Object.keys(record).some((key) => !expectedKeys.has(key))) return null;
  const installationId = typeof record.installationId === "string" ? record.installationId.trim() : "";
  const platform = record.platform;
  const token = typeof record.token === "string" ? record.token.trim() : "";
  const appVersion = typeof record.appVersion === "string" ? record.appVersion.trim() : "";
  const localeValue = record.locale;
  const locale = localeValue === null || localeValue === undefined ? null : String(localeValue).trim();
  if (
    !INSTALLATION_ID_PATTERN.test(installationId) ||
    (platform !== "android" && platform !== "ios") ||
    !TOKEN_PATTERN.test(token) ||
    !VERSION_PATTERN.test(appVersion) ||
    (locale !== null && !LOCALE_PATTERN.test(locale))
  ) {
    return null;
  }
  return { installationId: installationId.toLowerCase(), platform, token, appVersion, locale };
}

export function parseMobilePushUnregisterInput(value: unknown): { installationId: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "installationId")) return null;
  const installationId = typeof record.installationId === "string" ? record.installationId.trim() : "";
  return INSTALLATION_ID_PATTERN.test(installationId) ? { installationId: installationId.toLowerCase() } : null;
}

export function parsePushTokenEncryptionKey(encoded: string | undefined): Buffer | null {
  const value = encoded?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 && key.toString("base64") === value ? key : null;
}

export function protectMobilePushToken(
  token: string,
  encodedKey: string | undefined,
): { tokenHash: string; tokenCiphertext: string } | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const key = parsePushTokenEncryptionKey(encodedKey);
  if (!key) return null;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    tokenHash: createHmac("sha256", key).update(token, "utf8").digest("hex"),
    tokenCiphertext: `v1.${nonce.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`,
  };
}

export function revealMobilePushToken(ciphertext: string, encodedKey: string | undefined): string | null {
  const key = parsePushTokenEncryptionKey(encodedKey);
  const match = CIPHERTEXT_PATTERN.exec(ciphertext);
  if (!key || !match) return null;
  try {
    const nonce = Buffer.from(match[1], "base64url");
    const encrypted = Buffer.from(match[2], "base64url");
    const tag = Buffer.from(match[3], "base64url");
    if (nonce.length !== 12 || tag.length !== 16 || encrypted.length === 0) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const token = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    return TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}

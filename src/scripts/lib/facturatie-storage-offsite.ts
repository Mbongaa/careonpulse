import {
  FACTURATIE_BUCKET,
  isCanonicalBackupObjectPath,
  MAX_LOGO_BYTES,
  MAX_PDF_BYTES,
  sha256,
  type VerifiedBackupObject,
} from "./facturatie-storage-backup";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export const OFFSITE_PREFIX = "facturatie-storage/v1/backups";
export const OFFSITE_COMPLETION_SCHEMA = "careon-facturatie-storage-completion/v1";
export const OFFSITE_MANIFEST_SCHEMA = "careon-facturatie-storage-offsite/v1";
export const OFFSITE_ENCRYPTION = "AES-256-GCM";
export const MAX_OFFSITE_OBJECTS = 100_000;
export const MAX_COMPLETION_BYTES = 32 * 1024 * 1024;

const ENVELOPE_MAGIC = Buffer.from("careon-facturatie-backup/v1\n", "ascii");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_OVERHEAD = ENVELOPE_MAGIC.byteLength + NONCE_BYTES + TAG_BYTES;
const ACCOUNT_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const STAMP_PATTERN = /^([0-9]{4})([0-9]{2})([0-9]{2})-([0-9]{2})([0-9]{2})([0-9]{2})$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type OffsiteMode = "upload" | "verify" | "fetch";

export type OffsiteConfiguration =
  | { enabled: false; required: false }
  | {
      enabled: true;
      required: boolean;
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
      endpoint: string;
      encryptionKey?: Buffer;
      keyId?: string;
    };

export interface RemoteEncryptedObject {
  key: string;
  bytes: number;
  sha256: string;
}

export interface OffsiteCompletion {
  schema: typeof OFFSITE_COMPLETION_SCHEMA;
  stamp: string;
  createdAt: string;
  encryption: typeof OFFSITE_ENCRYPTION;
  keyId: string;
  objectCount: number;
  totalEncryptedBytes: number;
  manifest: RemoteEncryptedObject;
  objects: RemoteEncryptedObject[];
}

export interface OffsiteManifestObject extends VerifiedBackupObject {
  remoteKey: string;
  encryptedBytes: number;
  encryptedSha256: string;
}

export interface OffsiteManifest {
  schema: typeof OFFSITE_MANIFEST_SCHEMA;
  stamp: string;
  createdAt: string;
  sourceProjectRef: string;
  bucket: typeof FACTURATIE_BUCKET;
  objectCount: number;
  totalPlaintextBytes: number;
  objects: OffsiteManifestObject[];
}

export interface EncryptionContext {
  stamp: string;
  keyId: string;
  kind: "object" | "manifest";
  remoteKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredFlag(value: string | undefined, name: string): boolean {
  const resolved = value?.trim() || "0";
  if (resolved !== "0" && resolved !== "1") throw new Error(`${name} moet 0 of 1 zijn.`);
  return resolved === "1";
}

function decodeEncryptionKey(value: string): Buffer {
  const compact = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error("Facturatie off-site encryptiesleutel is geen geldige base64-waarde.");
  }
  const key = Buffer.from(compact, "base64");
  const canonical = key.toString("base64").replace(/=+$/, "");
  if (key.byteLength !== 32 || canonical !== compact.replace(/=+$/, "")) {
    throw new Error("Facturatie off-site encryptiesleutel moet exact 32 base64-bytes bevatten.");
  }
  return key;
}

export function resolveOffsiteConfiguration(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
  mode: OffsiteMode,
): OffsiteConfiguration {
  const required = requiredFlag(environment.CAREON_FACTURATIE_BACKUP_OFFSITE_REQUIRED, "OFFSITE_REQUIRED");
  const values = {
    accountId: environment.CAREON_FACTURATIE_BACKUP_R2_ACCOUNT_ID?.trim() || "",
    accessKeyId: environment.CAREON_FACTURATIE_BACKUP_R2_ACCESS_KEY_ID?.trim() || "",
    secretAccessKey: environment.CAREON_FACTURATIE_BACKUP_R2_SECRET_ACCESS_KEY?.trim() || "",
    bucket: environment.CAREON_FACTURATIE_BACKUP_R2_BUCKET?.trim() || "",
  };
  const configuredCount = Object.values(values).filter(Boolean).length;
  if (configuredCount === 0) {
    if (mode === "verify" && !required) return { enabled: false, required: false };
    throw new Error("Complete client-owned R2-configuratie is vereist voor Facturatie off-site backup.");
  }
  if (configuredCount !== 4)
    throw new Error("Facturatie R2-configuratie is gedeeltelijk; alle vier waarden zijn vereist.");
  if ((environment.CAREON_FACTURATIE_BACKUP_R2_JURISDICTION?.trim() || "eu") !== "eu") {
    throw new Error("Facturatie R2-jurisdictie moet eu blijven.");
  }
  if (!ACCOUNT_PATTERN.test(values.accountId)) throw new Error("Facturatie R2-account-id heeft een ongeldige vorm.");
  if (!BUCKET_PATTERN.test(values.bucket)) throw new Error("Facturatie R2-bucket heeft een ongeldige vorm.");
  if (values.accessKeyId.length < 4 || values.secretAccessKey.length < 8) {
    throw new Error("Facturatie R2-toegangssleutels hebben een ongeldige vorm.");
  }

  let encryptionKey: Buffer | undefined;
  let keyId: string | undefined;
  if (mode !== "verify") {
    const rawKey = environment.CAREON_FACTURATIE_BACKUP_ENCRYPTION_KEY?.trim() || "";
    keyId = environment.CAREON_FACTURATIE_BACKUP_ENCRYPTION_KEY_ID?.trim() || "";
    if (!rawKey || !KEY_ID_PATTERN.test(keyId)) {
      throw new Error("Een geldige encryptiesleutel en sleutel-id zijn vereist voor Facturatie off-site backup.");
    }
    encryptionKey = decodeEncryptionKey(rawKey);
  }

  return {
    enabled: true,
    required,
    ...values,
    endpoint: `https://${values.accountId}.eu.r2.cloudflarestorage.com`,
    encryptionKey,
    keyId,
  };
}

export function backupStamp(date = new Date()): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}`;
}

export function stampDate(stamp: string): Date {
  const match = STAMP_PATTERN.exec(stamp);
  if (!match) throw new Error("Backupstempel moet YYYYMMDD-HHMMSS gebruiken.");
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || backupStamp(date) !== stamp) throw new Error("Backupstempel is ongeldig.");
  return date;
}

export function offsiteAgeSeconds(stamp: string, nowMs = Date.now()): number {
  const age = Math.floor((nowMs - stampDate(stamp).getTime()) / 1000);
  if (age < 0) throw new Error("Backupstempel ligt in de toekomst.");
  return age;
}

export function backupPrefix(stamp: string): string {
  stampDate(stamp);
  return `${OFFSITE_PREFIX}/${stamp}`;
}

export function completionKey(stamp: string): string {
  return `${backupPrefix(stamp)}/complete.json`;
}

export function encryptedManifestKey(stamp: string): string {
  return `${backupPrefix(stamp)}/manifest.cfb`;
}

export function encryptedObjectKey(stamp: string, objectPath: string, encryptionKey: Uint8Array): string {
  if (objectPath.trim() === "") throw new Error("Leeg Storage-objectpad.");
  const digest = createHmac("sha256", encryptionKey).update(`${stamp}\0${objectPath}`).digest("hex");
  return `${backupPrefix(stamp)}/objects/${digest}.cfb`;
}

function encryptionAad(context: EncryptionContext): Buffer {
  stampDate(context.stamp);
  if (!KEY_ID_PATTERN.test(context.keyId)) throw new Error("Ongeldige encryptiesleutel-id.");
  const prefix = backupPrefix(context.stamp);
  if (!context.remoteKey.startsWith(`${prefix}/`) || context.remoteKey.includes("..")) {
    throw new Error("Ongeldige off-site objectsleutel.");
  }
  return Buffer.from(
    `${OFFSITE_MANIFEST_SCHEMA}\0${context.stamp}\0${context.keyId}\0${context.kind}\0${context.remoteKey}`,
    "utf8",
  );
}

export function encryptBackupPayload(
  plaintext: Uint8Array,
  encryptionKey: Uint8Array,
  context: EncryptionContext,
  nonce: Uint8Array = randomBytes(NONCE_BYTES),
): Buffer {
  if (encryptionKey.byteLength !== 32) throw new Error("Encryptiesleutel moet 32 bytes zijn.");
  if (nonce.byteLength !== NONCE_BYTES) throw new Error("Encryptienonce moet 12 bytes zijn.");
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
  cipher.setAAD(encryptionAad(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ENVELOPE_MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackupPayload(
  envelope: Uint8Array,
  encryptionKey: Uint8Array,
  context: EncryptionContext,
): Buffer {
  if (encryptionKey.byteLength !== 32) throw new Error("Encryptiesleutel moet 32 bytes zijn.");
  const bytes = Buffer.from(envelope);
  if (bytes.byteLength < ENVELOPE_OVERHEAD || !bytes.subarray(0, ENVELOPE_MAGIC.byteLength).equals(ENVELOPE_MAGIC)) {
    throw new Error("Off-site backup-envelop heeft een ongeldige versie of vorm.");
  }
  const nonceStart = ENVELOPE_MAGIC.byteLength;
  const tagStart = nonceStart + NONCE_BYTES;
  const payloadStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, bytes.subarray(nonceStart, tagStart));
  decipher.setAAD(encryptionAad(context));
  decipher.setAuthTag(bytes.subarray(tagStart, payloadStart));
  try {
    return Buffer.concat([decipher.update(bytes.subarray(payloadStart)), decipher.final()]);
  } catch {
    throw new Error("Off-site backup-envelop kon niet authentiek worden ontsleuteld.");
  }
}

export function serializeBackupJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validatedRemoteObject(value: unknown, prefix: string): RemoteEncryptedObject {
  if (!isRecord(value) || typeof value.key !== "string" || !value.key.startsWith(`${prefix}/`)) {
    throw new Error("Off-site index bevat een ongeldige objectsleutel.");
  }
  if (value.key.includes("..") || !Number.isSafeInteger(value.bytes) || (value.bytes as number) < ENVELOPE_OVERHEAD) {
    throw new Error("Off-site index bevat een ongeldige objectgrootte.");
  }
  if (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256)) {
    throw new Error("Off-site index bevat een ongeldige SHA-256.");
  }
  return { key: value.key, bytes: value.bytes as number, sha256: value.sha256 };
}

function isOpaqueObjectKey(key: string, prefix: string): boolean {
  return key.startsWith(`${prefix}/`) && /^objects\/[0-9a-f]{64}\.cfb$/.test(key.slice(prefix.length + 1));
}

function validatedManifestObject(value: unknown, prefix: string): OffsiteManifestObject {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.orgId !== "string" ||
    !UUID_PATTERN.test(value.orgId) ||
    (value.kind !== "invoice-pdf" && value.kind !== "template-logo") ||
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    (value.bytes as number) <= 0 ||
    (value.bytes as number) > (value.kind === "invoice-pdf" ? MAX_PDF_BYTES : MAX_LOGO_BYTES) ||
    typeof value.remoteKey !== "string" ||
    !isOpaqueObjectKey(value.remoteKey, prefix) ||
    typeof value.encryptedSha256 !== "string" ||
    !SHA256_PATTERN.test(value.encryptedSha256) ||
    !Number.isSafeInteger(value.encryptedBytes) ||
    (value.encryptedBytes as number) < ENVELOPE_OVERHEAD
  ) {
    throw new Error("Off-site manifest bevat een ongeldig object.");
  }
  const expectedContentType = value.kind === "invoice-pdf" ? "application/pdf" : "image/png";
  if (
    value.contentType !== expectedContentType ||
    !isCanonicalBackupObjectPath(value.path, value.orgId, value.kind) ||
    (value.updatedAt !== undefined &&
      (typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt))))
  ) {
    throw new Error("Off-site manifest bevat een onveilig bronobject.");
  }
  return {
    path: value.path,
    orgId: value.orgId,
    kind: value.kind,
    sha256: value.sha256,
    bytes: value.bytes as number,
    contentType: expectedContentType,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    remoteKey: value.remoteKey,
    encryptedBytes: value.encryptedBytes as number,
    encryptedSha256: value.encryptedSha256,
  };
}

export function buildCompletion(
  stamp: string,
  createdAt: string,
  keyId: string,
  manifest: RemoteEncryptedObject,
  objects: RemoteEncryptedObject[],
): OffsiteCompletion {
  stampDate(stamp);
  if (Number.isNaN(Date.parse(createdAt)) || backupStamp(new Date(createdAt)) !== stamp) {
    throw new Error("Ongeldig off-site backuptijdstip.");
  }
  if (!KEY_ID_PATTERN.test(keyId)) throw new Error("Ongeldige encryptiesleutel-id.");
  if (objects.length > MAX_OFFSITE_OBJECTS) throw new Error("Off-site objectlimiet overschreden.");
  const prefix = backupPrefix(stamp);
  const validatedManifest = validatedRemoteObject(manifest, prefix);
  if (validatedManifest.key !== encryptedManifestKey(stamp)) throw new Error("Onjuiste versleutelde manifestsleutel.");
  const validatedObjects = objects.map((object) => validatedRemoteObject(object, prefix));
  if (validatedObjects.some((object) => !isOpaqueObjectKey(object.key, prefix))) {
    throw new Error("Off-site index bevat een niet-opaque dataobjectsleutel.");
  }
  const unique = new Set(validatedObjects.map((object) => object.key));
  if (unique.size !== validatedObjects.length || unique.has(validatedManifest.key)) {
    throw new Error("Off-site index bevat dubbele objectsleutels.");
  }
  const totalEncryptedBytes = [validatedManifest, ...validatedObjects].reduce(
    (total, object) => total + object.bytes,
    0,
  );
  if (!Number.isSafeInteger(totalEncryptedBytes)) throw new Error("Off-site encrypted-byte-totaal is te groot.");
  return {
    schema: OFFSITE_COMPLETION_SCHEMA,
    stamp,
    createdAt,
    encryption: OFFSITE_ENCRYPTION,
    keyId,
    objectCount: validatedObjects.length,
    totalEncryptedBytes,
    manifest: validatedManifest,
    objects: validatedObjects,
  };
}

export function parseCompletion(value: unknown, expectedStamp?: string): OffsiteCompletion {
  if (!isRecord(value) || value.schema !== OFFSITE_COMPLETION_SCHEMA || typeof value.stamp !== "string") {
    throw new Error("Off-site completion-marker heeft een ongeldige versie.");
  }
  const stamp = value.stamp;
  stampDate(stamp);
  if (expectedStamp && stamp !== expectedStamp) throw new Error("Off-site completion-marker hoort bij een andere run.");
  if (
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    value.encryption !== OFFSITE_ENCRYPTION ||
    typeof value.keyId !== "string" ||
    !KEY_ID_PATTERN.test(value.keyId) ||
    !Array.isArray(value.objects)
  ) {
    throw new Error("Off-site completion-marker bevat ongeldige metadata.");
  }
  const completion = buildCompletion(
    stamp,
    value.createdAt,
    value.keyId,
    validatedRemoteObject(value.manifest, backupPrefix(stamp)),
    value.objects.map((object) => validatedRemoteObject(object, backupPrefix(stamp))),
  );
  if (value.objectCount !== completion.objectCount || value.totalEncryptedBytes !== completion.totalEncryptedBytes) {
    throw new Error("Off-site completion-marker totalen kloppen niet.");
  }
  return completion;
}

export function buildManifest(
  stamp: string,
  createdAt: string,
  sourceProjectRef: string,
  objects: OffsiteManifestObject[],
): OffsiteManifest {
  stampDate(stamp);
  if (
    !/^[a-z0-9-]{10,64}$/.test(sourceProjectRef) ||
    Number.isNaN(Date.parse(createdAt)) ||
    backupStamp(new Date(createdAt)) !== stamp
  ) {
    throw new Error("Ongeldige bron- of tijdmetadata voor off-site manifest.");
  }
  if (objects.length > MAX_OFFSITE_OBJECTS) throw new Error("Off-site objectlimiet overschreden.");
  const prefix = backupPrefix(stamp);
  const validatedObjects = objects.map((object) => validatedManifestObject(object, prefix));
  const sourcePaths = new Set(validatedObjects.map((object) => object.path));
  const remoteKeys = new Set(validatedObjects.map((object) => object.remoteKey));
  if (sourcePaths.size !== validatedObjects.length || remoteKeys.size !== validatedObjects.length) {
    throw new Error("Off-site manifest bevat dubbele objecten.");
  }
  const totalPlaintextBytes = validatedObjects.reduce((total, object) => total + object.bytes, 0);
  if (!Number.isSafeInteger(totalPlaintextBytes)) throw new Error("Off-site plaintext-byte-totaal is te groot.");
  return {
    schema: OFFSITE_MANIFEST_SCHEMA,
    stamp,
    createdAt,
    sourceProjectRef,
    bucket: FACTURATIE_BUCKET,
    objectCount: validatedObjects.length,
    totalPlaintextBytes,
    objects: validatedObjects,
  };
}

export function parseManifest(
  value: unknown,
  completion: OffsiteCompletion,
  encryptionKey: Uint8Array,
): OffsiteManifest {
  if (
    !isRecord(value) ||
    value.schema !== OFFSITE_MANIFEST_SCHEMA ||
    value.stamp !== completion.stamp ||
    value.createdAt !== completion.createdAt ||
    typeof value.sourceProjectRef !== "string" ||
    !/^[a-z0-9-]{10,64}$/.test(value.sourceProjectRef) ||
    value.bucket !== FACTURATIE_BUCKET ||
    !Array.isArray(value.objects)
  ) {
    throw new Error("Ontsleuteld off-site manifest heeft ongeldige metadata.");
  }
  const remoteByKey = new Map(completion.objects.map((object) => [object.key, object]));
  const objects: OffsiteManifestObject[] = [];
  for (const raw of value.objects) {
    const object = validatedManifestObject(raw, backupPrefix(completion.stamp));
    const expectedRemoteKey = encryptedObjectKey(completion.stamp, object.path, encryptionKey);
    const indexed = remoteByKey.get(expectedRemoteKey);
    if (
      object.remoteKey !== expectedRemoteKey ||
      !indexed ||
      object.encryptedBytes !== indexed.bytes ||
      object.encryptedSha256 !== indexed.sha256
    ) {
      throw new Error("Ontsleuteld off-site manifest wijkt af van de completion-index.");
    }
    objects.push(object);
    remoteByKey.delete(expectedRemoteKey);
  }
  const manifest = buildManifest(completion.stamp, completion.createdAt, value.sourceProjectRef, objects);
  if (
    value.objectCount !== manifest.objectCount ||
    value.totalPlaintextBytes !== manifest.totalPlaintextBytes ||
    remoteByKey.size !== 0
  ) {
    throw new Error("Ontsleuteld off-site manifest totalen kloppen niet.");
  }
  return manifest;
}

export function encryptedDescriptor(key: string, bytes: Uint8Array): RemoteEncryptedObject {
  return { key, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

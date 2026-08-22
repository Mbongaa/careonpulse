import { createHash } from "node:crypto";

export const FACTURATIE_BUCKET = "facturen";
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_LOGO_BYTES = 2_000_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PDF_PATH_PATTERN = /^([0-9a-f-]{36})\/(20[2-9][0-9]|21[0-9]{2})\/([^/]+)\.pdf$/;
const LOGO_PATH_PATTERN = /^([0-9a-f-]{36})\/branding\/([a-z0-9][a-z0-9-]{0,39})\.png$/;

export type BackupObjectKind = "invoice-pdf" | "template-logo";

export interface InvoiceMetadataRow {
  org_id: unknown;
  pdf_pad: unknown;
  pdf_sha256: unknown;
  pdf_bytes: unknown;
  pdf_gegenereerd_op: unknown;
}

export interface SettingsMetadataRow {
  org_id: unknown;
  revision: unknown;
  state: unknown;
}

export interface ExpectedBackupObject {
  path: string;
  orgId: string;
  kind: BackupObjectKind;
  sha256: string;
  bytes?: number;
}

export interface ListedStorageObject {
  path: string;
  size?: number;
  contentType?: string;
  updatedAt?: string;
}

export interface VerifiedBackupObject extends ExpectedBackupObject {
  bytes: number;
  contentType: "application/pdf" | "image/png";
  updatedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectLabel(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 12);
}

function requiredUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label}: ongeldige organisatie-id.`);
  }
  return value;
}

function requiredSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label}: ongeldige SHA-256.`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    throw new Error(`${label}: ongeldige bytegrootte.`);
  }
  return value as number;
}

function canonicalPdfPath(path: string, orgId: string): boolean {
  const match = PDF_PATH_PATTERN.exec(path);
  if (!match || match[1] !== orgId) return false;
  try {
    const decoded = decodeURIComponent(match[3]);
    return decoded.length > 0 && encodeURIComponent(decoded) === match[3];
  } catch {
    return false;
  }
}

function canonicalLogoPath(path: string, orgId: string): boolean {
  const match = LOGO_PATH_PATTERN.exec(path);
  return Boolean(match && match[1] === orgId && TEMPLATE_ID_PATTERN.test(match[2]));
}

function addExpected(target: Map<string, ExpectedBackupObject>, candidate: ExpectedBackupObject): void {
  const current = target.get(candidate.path);
  if (!current) {
    target.set(candidate.path, candidate);
    return;
  }
  if (
    current.orgId !== candidate.orgId ||
    current.kind !== candidate.kind ||
    current.sha256 !== candidate.sha256 ||
    current.bytes !== candidate.bytes
  ) {
    throw new Error(`Tegenstrijdige metadata voor object ${objectLabel(candidate.path)}.`);
  }
}

/**
 * Builds the authoritative object set using only archive metadata. Business,
 * customer and invoice fields are deliberately absent from both input types
 * and output.
 */
export function expectedBackupObjects(
  invoiceRows: InvoiceMetadataRow[],
  settingsRows: SettingsMetadataRow[],
): Map<string, ExpectedBackupObject> {
  const expected = new Map<string, ExpectedBackupObject>();

  for (const row of invoiceRows) {
    const hasAnyMetadata = [row.pdf_pad, row.pdf_sha256, row.pdf_bytes, row.pdf_gegenereerd_op].some(
      (value) => value !== null && value !== undefined,
    );
    if (!hasAnyMetadata) continue;

    const orgId = requiredUuid(row.org_id, "Factuurmetadata");
    if (typeof row.pdf_pad !== "string" || !canonicalPdfPath(row.pdf_pad, orgId)) {
      throw new Error("Factuurmetadata: ongeldig of organisatievreemd PDF-pad.");
    }
    const label = `PDF-object ${objectLabel(row.pdf_pad)}`;
    const sha256 = requiredSha256(row.pdf_sha256, label);
    const bytes = requiredPositiveInteger(row.pdf_bytes, label, MAX_PDF_BYTES);
    if (typeof row.pdf_gegenereerd_op !== "string" || Number.isNaN(Date.parse(row.pdf_gegenereerd_op))) {
      throw new Error(`${label}: ontbrekend generatietijdstip.`);
    }
    addExpected(expected, { path: row.pdf_pad, orgId, kind: "invoice-pdf", sha256, bytes });
  }

  const latestSettings = new Map<string, SettingsMetadataRow>();
  for (const row of settingsRows) {
    const orgId = requiredUuid(row.org_id, "Facturatie-instellingen");
    if (!Number.isSafeInteger(row.revision) || (row.revision as number) <= 0) {
      throw new Error("Facturatie-instellingen: ongeldige revisie.");
    }
    const current = latestSettings.get(orgId);
    if (!current || (row.revision as number) > (current.revision as number)) latestSettings.set(orgId, row);
  }

  for (const [orgId, row] of latestSettings) {
    if (!isRecord(row.state) || !Array.isArray(row.state.templates)) {
      throw new Error("Facturatie-instellingen: onleesbare sjabloonmetadata.");
    }
    for (const template of row.state.templates) {
      if (!isRecord(template) || !isRecord(template.presentatie)) {
        throw new Error("Facturatie-instellingen: onleesbaar sjabloon.");
      }
      const presentation = template.presentatie;
      const isUploaded = presentation.logoBron === "upload";
      const hasBackupMetadata = presentation.logoPad !== undefined || presentation.logoHash !== undefined;
      if (!isUploaded && !hasBackupMetadata) continue;
      if (!isUploaded) {
        throw new Error("Facturatie-instellingen: logo-metadata hoort niet bij de actieve logobron.");
      }
      if (typeof presentation.logoPad !== "string" || !canonicalLogoPath(presentation.logoPad, orgId)) {
        throw new Error("Facturatie-instellingen: ongeldig of organisatievreemd logopad.");
      }
      const sha256 = requiredSha256(presentation.logoHash, `Logo-object ${objectLabel(presentation.logoPad)}`);
      addExpected(expected, {
        path: presentation.logoPad,
        orgId,
        kind: "template-logo",
        sha256,
      });
    }
  }

  return expected;
}

export function reconcileStorageInventory(
  expected: Map<string, ExpectedBackupObject>,
  listed: ListedStorageObject[],
): Map<string, ListedStorageObject> {
  const actual = new Map<string, ListedStorageObject>();
  for (const object of listed) {
    if (actual.has(object.path)) throw new Error(`Dubbel Storage-object: ${objectLabel(object.path)}.`);
    if (!expected.has(object.path)) {
      throw new Error(`Onverwacht of verweesd Storage-object: ${objectLabel(object.path)}.`);
    }
    actual.set(object.path, object);
  }
  for (const path of expected.keys()) {
    if (!actual.has(path)) throw new Error(`Ontbrekend Storage-object: ${objectLabel(path)}.`);
  }
  return actual;
}

export function verifyObjectBytes(
  expected: ExpectedBackupObject,
  listed: ListedStorageObject,
  bytes: Uint8Array,
): VerifiedBackupObject {
  const label = `Object ${objectLabel(expected.path)}`;
  const maximum = expected.kind === "invoice-pdf" ? MAX_PDF_BYTES : MAX_LOGO_BYTES;
  if (bytes.byteLength === 0 || bytes.byteLength > maximum) {
    throw new Error(`${label}: ongeldige objectgrootte.`);
  }
  if (expected.bytes !== undefined && expected.bytes !== bytes.byteLength) {
    throw new Error(`${label}: bytegrootte wijkt af van de database.`);
  }
  if (listed.size !== undefined && listed.size !== bytes.byteLength) {
    throw new Error(`${label}: bytegrootte wijkt af van Storage-metadata.`);
  }

  const pdfMagic = Buffer.from("%PDF-");
  const pngMagic = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const signature = expected.kind === "invoice-pdf" ? pdfMagic : pngMagic;
  if (!signature.every((value, index) => bytes[index] === value)) {
    throw new Error(`${label}: bestandssignatuur klopt niet.`);
  }
  if (expected.kind === "invoice-pdf") {
    const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 1024))).toString("latin1");
    if (!tail.includes("%%EOF")) throw new Error(`${label}: PDF-eindmarkering ontbreekt.`);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expected.sha256) throw new Error(`${label}: SHA-256 wijkt af van de database.`);

  const contentType = expected.kind === "invoice-pdf" ? "application/pdf" : "image/png";
  if (listed.contentType && listed.contentType.split(";", 1)[0].trim().toLowerCase() !== contentType) {
    throw new Error(`${label}: MIME-type wijkt af.`);
  }
  return { ...expected, bytes: bytes.byteLength, contentType, updatedAt: listed.updatedAt };
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

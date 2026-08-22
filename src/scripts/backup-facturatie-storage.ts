/**
 * Fail-closed backup boundary for the private Supabase Storage bucket used by
 * Facturatie. `--verify` reads and hashes production objects but writes
 * nothing. `--snapshot <absolute-empty-path>` creates a private local copy;
 * plaintext export requires an explicit environment acknowledgement.
 *
 * No customer, invoice or settings content is logged or written to the
 * manifest. The service-role credential is read only from environment or the
 * gitignored .env.local file and is never printed.
 */

import {
  expectedBackupObjects,
  FACTURATIE_BUCKET,
  type InvoiceMetadataRow,
  type ListedStorageObject,
  MAX_PDF_BYTES,
  reconcileStorageInventory,
  type SettingsMetadataRow,
  sha256,
  type VerifiedBackupObject,
  verifyObjectBytes,
} from "./lib/facturatie-storage-backup";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const PAGE_SIZE = 500;
const MAX_ENTRIES = 100_000;
const MAX_DIRECTORY_DEPTH = 8;

interface StorageListResponseEntry {
  name?: unknown;
  id?: unknown;
  metadata?: unknown;
  updated_at?: unknown;
}

export interface SnapshotManifest {
  schema: "careon-facturatie-storage-backup/v1";
  createdAt: string;
  sourceProjectRef: string;
  bucket: typeof FACTURATIE_BUCKET;
  objectCount: number;
  totalBytes: number;
  objects: VerifiedBackupObject[];
}

type Mode = { kind: "verify" } | { kind: "snapshot"; outputPath: string };

function parseMode(argv: string[]): Mode {
  if (argv.length === 1 && argv[0] === "--verify") return { kind: "verify" };
  if (argv.length === 2 && argv[0] === "--snapshot" && argv[1].trim() !== "") {
    return { kind: "snapshot", outputPath: argv[1] };
  }
  throw new Error(
    "Gebruik --verify (geen writes) of --snapshot <absoluut-nieuw-pad> (expliciete private plaintext-kopie).",
  );
}

export function readEnvLocal(): Record<string, string> {
  const environment: Record<string, string> = {};
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return environment;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    environment[match[1]] = value;
  }
  return environment;
}

export function requiredEnvironment(): { supabaseUrl: string; serviceKey: string } {
  const local = readEnvLocal();
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? local.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? local.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) || serviceKey.length < 32) {
    throw new Error("Geldige NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn vereist.");
  }
  return { supabaseUrl, serviceKey };
}

function headers(serviceKey: string, json = false): Record<string, string> {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function jsonRequest<T>(url: string, serviceKey: string, init?: RequestInit, label = "Supabase"): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...headers(serviceKey, init?.body !== undefined), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${label}: Supabase gaf HTTP ${response.status}.`);
  return (await response.json()) as T;
}

export async function pagedPostgrest<T>(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  select: string,
  order: string,
): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({ select, order, limit: String(PAGE_SIZE), offset: String(offset) });
    const page = await jsonRequest<T[]>(
      `${supabaseUrl}/rest/v1/${table}?${params}`,
      serviceKey,
      undefined,
      `Metadataquery ${table}`,
    );
    result.push(...page);
    if (result.length > MAX_ENTRIES)
      throw new Error(`${table}: veiligheidslimiet van ${MAX_ENTRIES} rijen overschreden.`);
    if (page.length < PAGE_SIZE) return result;
  }
}

function numberMetadata(value: unknown): number | undefined {
  let parsed = Number.NaN;
  if (typeof value === "number") parsed = value;
  if (typeof value === "string") parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export async function listStorageObjects(supabaseUrl: string, serviceKey: string): Promise<ListedStorageObject[]> {
  const result: ListedStorageObject[] = [];
  const visited = new Set<string>();

  async function visit(prefix: string, depth: number): Promise<void> {
    if (depth > MAX_DIRECTORY_DEPTH) throw new Error("Storage-mapdiepte overschrijdt de veiligheidslimiet.");
    if (visited.has(prefix)) throw new Error("Storage-mapcyclus gedetecteerd.");
    visited.add(prefix);

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const entries = await jsonRequest<StorageListResponseEntry[]>(
        `${supabaseUrl}/storage/v1/object/list/${FACTURATIE_BUCKET}`,
        serviceKey,
        {
          method: "POST",
          body: JSON.stringify({ prefix, limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } }),
        },
        "Storage-inventaris",
      );
      for (const entry of entries) {
        if (typeof entry.name !== "string" || entry.name === "" || entry.name.includes("/") || entry.name === ".") {
          throw new Error("Storage-inventaris bevat een onveilige objectnaam.");
        }
        const objectPath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        const isDirectory =
          (entry.id === null || entry.id === undefined) && (entry.metadata === null || entry.metadata === undefined);
        if (isDirectory) {
          await visit(objectPath, depth + 1);
          continue;
        }
        const metadata =
          typeof entry.metadata === "object" && entry.metadata !== null
            ? (entry.metadata as Record<string, unknown>)
            : {};
        result.push({
          path: objectPath,
          size: numberMetadata(metadata.size),
          contentType: stringMetadata(metadata.mimetype),
          updatedAt: stringMetadata(entry.updated_at),
        });
        if (result.length > MAX_ENTRIES) {
          throw new Error(`Storage-inventaris overschrijdt de veiligheidslimiet van ${MAX_ENTRIES} objecten.`);
        }
      }
      if (entries.length < PAGE_SIZE) break;
    }
  }

  await visit("", 0);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function encodedStoragePath(objectPath: string): string {
  return objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function downloadObject(supabaseUrl: string, serviceKey: string, objectPath: string): Promise<Uint8Array> {
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${FACTURATIE_BUCKET}/${encodedStoragePath(objectPath)}`,
    { headers: headers(serviceKey), cache: "no-store" },
  );
  const label = sha256(objectPath).slice(0, 12);
  if (!response.ok) throw new Error(`Object ${label}: downloaden gaf HTTP ${response.status}.`);
  const announced = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(announced) && announced > MAX_PDF_BYTES) {
    await response.body?.cancel();
    throw new Error(`Object ${label}: aangekondigde objectgrootte overschrijdt de veiligheidslimiet.`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function assertPrivateBucket(supabaseUrl: string, serviceKey: string): Promise<void> {
  const bucket = await jsonRequest<Record<string, unknown>>(
    `${supabaseUrl}/storage/v1/bucket/${FACTURATIE_BUCKET}`,
    serviceKey,
    undefined,
    "Bucketconfiguratie",
  );
  if (bucket.id !== FACTURATIE_BUCKET || bucket.name !== FACTURATIE_BUCKET || bucket.public !== false) {
    throw new Error("De Facturatie-bucket ontbreekt of is niet privé.");
  }
  const fileSizeLimit = numberMetadata(bucket.file_size_limit);
  if (fileSizeLimit === undefined || fileSizeLimit <= 0 || fileSizeLimit > MAX_PDF_BYTES) {
    throw new Error("De Facturatie-bucket heeft geen veilige objectgroottelimiet.");
  }
  const allowedMimeTypes = Array.isArray(bucket.allowed_mime_types) ? bucket.allowed_mime_types : [];
  if (!allowedMimeTypes.includes("application/pdf") || !allowedMimeTypes.includes("image/png")) {
    throw new Error("De Facturatie-bucket heeft geen gesloten PDF/PNG MIME-allowlist.");
  }
}

export function prepareSnapshotTarget(outputPath: string): { finalPath: string; partialPath: string } {
  if (!path.isAbsolute(outputPath)) throw new Error("Snapshotpad moet absoluut zijn.");
  const requested = path.resolve(outputPath);
  const relativeToRepo = path.relative(ROOT, requested);
  if (relativeToRepo === "" || (!relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo))) {
    throw new Error("Snapshotpad moet buiten de repository liggen.");
  }
  if (fs.existsSync(requested)) throw new Error("Snapshotdoel bestaat al; overschrijven is verboden.");

  const parent = path.dirname(requested);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("De bovenliggende snapshotmap moet vooraf bestaan.");
  }
  const realParent = fs.realpathSync(parent);
  if (realParent === path.parse(realParent).root) throw new Error("Een systeembasismap is geen veilig snapshotdoel.");
  const finalPath = path.join(realParent, path.basename(requested));
  const partialPath = path.join(realParent, `.${path.basename(requested)}.partial-${process.pid}-${Date.now()}`);
  if (fs.existsSync(finalPath) || fs.existsSync(partialPath)) throw new Error("Snapshotdoel bestaat al.");
  return { finalPath, partialPath };
}

export function privateWrite(filePath: string, content: Uint8Array | string): void {
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
}

export function writeObject(partialPath: string, objectPath: string, bytes: Uint8Array): void {
  const objectsRoot = path.join(partialPath, "objects");
  const destination = path.resolve(objectsRoot, ...objectPath.split("/"));
  const relative = path.relative(objectsRoot, destination);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Onveilig snapshot-objectpad.");
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  privateWrite(destination, bytes);
}

export function projectRef(supabaseUrl: string): string {
  return new URL(supabaseUrl).hostname.split(".")[0];
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const environment = requiredEnvironment();
  if (mode.kind === "snapshot" && process.env.CAREON_FACTURATIE_BACKUP_ALLOW_PLAINTEXT !== "1") {
    throw new Error(
      "Plaintext-snapshot is standaard geblokkeerd; gebruik alleen een versleuteld/afgeschermd volume en zet " +
        "CAREON_FACTURATIE_BACKUP_ALLOW_PLAINTEXT=1 voor deze ene uitvoering.",
    );
  }

  await assertPrivateBucket(environment.supabaseUrl, environment.serviceKey);
  const [invoiceRows, settingsRows, listed] = await Promise.all([
    pagedPostgrest<InvoiceMetadataRow>(
      environment.supabaseUrl,
      environment.serviceKey,
      "careon_facturatie_facturen",
      "org_id,pdf_pad,pdf_sha256,pdf_bytes,pdf_gegenereerd_op",
      "org_id.asc",
    ),
    pagedPostgrest<SettingsMetadataRow>(
      environment.supabaseUrl,
      environment.serviceKey,
      "careon_facturatie_instellingen",
      "org_id,revision,state",
      "org_id.asc,revision.desc",
    ),
    listStorageObjects(environment.supabaseUrl, environment.serviceKey),
  ]);
  const expected = expectedBackupObjects(invoiceRows, settingsRows);
  const actual = reconcileStorageInventory(expected, listed);
  const target = mode.kind === "snapshot" ? prepareSnapshotTarget(mode.outputPath) : null;
  if (target) fs.mkdirSync(target.partialPath, { mode: 0o700 });

  const verified: VerifiedBackupObject[] = [];
  try {
    for (const expectedObject of [...expected.values()].sort((left, right) => left.path.localeCompare(right.path))) {
      const bytes = await downloadObject(environment.supabaseUrl, environment.serviceKey, expectedObject.path);
      const checked = verifyObjectBytes(expectedObject, actual.get(expectedObject.path) as ListedStorageObject, bytes);
      verified.push(checked);
      if (target) writeObject(target.partialPath, expectedObject.path, bytes);
    }

    if (target) {
      const manifest: SnapshotManifest = {
        schema: "careon-facturatie-storage-backup/v1",
        createdAt: new Date().toISOString(),
        sourceProjectRef: projectRef(environment.supabaseUrl),
        bucket: FACTURATIE_BUCKET,
        objectCount: verified.length,
        totalBytes: verified.reduce((total, object) => total + object.bytes, 0),
        objects: verified,
      };
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
      privateWrite(path.join(target.partialPath, "manifest.json"), manifestText);
      privateWrite(path.join(target.partialPath, "manifest.sha256"), `${sha256(manifestText)}  manifest.json\n`);
      fs.renameSync(target.partialPath, target.finalPath);
      console.log(
        `FACTURATIE_STORAGE_SNAPSHOT=OK objects=${verified.length} bytes=${manifest.totalBytes} destination=${target.finalPath}`,
      );
    } else {
      const totalBytes = verified.reduce((total, object) => total + object.bytes, 0);
      console.log(`FACTURATIE_STORAGE_VERIFY=OK objects=${verified.length} bytes=${totalBytes} bucket=private`);
    }
  } catch (error) {
    if (target && fs.existsSync(target.partialPath)) {
      const relative = path.relative(path.dirname(target.partialPath), target.partialPath);
      if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        fs.rmSync(target.partialPath, { recursive: true, force: true });
      }
    }
    throw error;
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Onbekende fout.";
    console.error(`FACTURATIE_STORAGE=FAIL ${message}`);
    process.exitCode = 1;
  });
}

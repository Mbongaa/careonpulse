/**
 * Client-side encrypted off-site backup for the private Facturatie bucket.
 * The R2 completion marker is published last and contains only opaque object
 * keys, encrypted sizes and encrypted SHA-256 values. Logical paths and all
 * file bytes are encrypted with AES-256-GCM before leaving the operator.
 */

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  assertPrivateBucket,
  downloadObject,
  listStorageObjects,
  pagedPostgrest,
  prepareSnapshotTarget,
  privateWrite,
  projectRef,
  readEnvLocal,
  requiredEnvironment,
  type SnapshotManifest,
  writeObject,
} from "./backup-facturatie-storage";
import {
  expectedBackupObjects,
  FACTURATIE_BUCKET,
  type InvoiceMetadataRow,
  MAX_PDF_BYTES,
  reconcileStorageInventory,
  type SettingsMetadataRow,
  sha256,
  type VerifiedBackupObject,
  verifyObjectBytes,
} from "./lib/facturatie-storage-backup";
import {
  backupStamp,
  buildCompletion,
  buildManifest,
  completionKey,
  decryptBackupPayload,
  encryptBackupPayload,
  encryptedDescriptor,
  encryptedManifestKey,
  encryptedObjectKey,
  MAX_COMPLETION_BYTES,
  MAX_OFFSITE_OBJECTS,
  OFFSITE_PREFIX,
  type OffsiteCompletion,
  type OffsiteConfiguration,
  type OffsiteManifestObject,
  offsiteAgeSeconds,
  parseCompletion,
  parseManifest,
  type RemoteEncryptedObject,
  resolveOffsiteConfiguration,
  serializeBackupJson,
} from "./lib/facturatie-storage-offsite";
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_ENCRYPTED_OBJECT_BYTES = MAX_PDF_BYTES + 256;
const REMOTE_BATCH_SIZE = 12;

type Mode = { kind: "upload" } | { kind: "verify" } | { kind: "fetch"; stamp: string; outputPath: string };
type EnabledConfiguration = Extract<OffsiteConfiguration, { enabled: true }>;

interface RemoteRead {
  bytes: Buffer;
  metadata: Record<string, string>;
}

function parseMode(argv: string[]): Mode {
  if (argv.length === 1 && argv[0] === "--upload") return { kind: "upload" };
  if (argv.length === 1 && argv[0] === "--verify") return { kind: "verify" };
  if (argv.length === 3 && argv[0] === "--fetch") {
    return { kind: "fetch", stamp: argv[1], outputPath: argv[2] };
  }
  throw new Error("Gebruik --upload, --verify of --fetch <YYYYMMDD-HHMMSS> <absoluut-nieuw-pad>.");
}

function mergedEnvironment(): Record<string, string | undefined> {
  return { ...readEnvLocal(), ...process.env };
}

function maxAgeHours(environment: Record<string, string | undefined>): number {
  const value = Number.parseInt(environment.CAREON_FACTURATIE_BACKUP_OFFSITE_MAX_AGE_HOURS ?? "36", 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > 8_760) {
    throw new Error("Facturatie off-site maximale leeftijd moet 1–8760 uur zijn.");
  }
  return value;
}

function client(configuration: EnabledConfiguration): S3Client {
  return new S3Client({
    endpoint: configuration.endpoint,
    region: "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
  });
}

function metadataFor(stamp: string, kind: "object" | "manifest" | "completion", digest: string) {
  return { careonbackup: "facturatie-v1", careonpair: stamp, careonkind: kind, sha256: digest };
}

async function putRemote(
  s3: S3Client,
  configuration: EnabledConfiguration,
  stamp: string,
  key: string,
  bytes: Uint8Array,
  kind: "object" | "manifest" | "completion",
): Promise<RemoteEncryptedObject> {
  const descriptor = encryptedDescriptor(key, bytes);
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: configuration.bucket,
        Key: key,
        Body: bytes,
        ContentType: kind === "completion" ? "application/json" : "application/octet-stream",
        CacheControl: "no-store",
        IfNoneMatch: "*",
        Metadata: metadataFor(stamp, kind, descriptor.sha256),
      }),
    );
  } catch {
    throw new Error(`R2 ${kind}-upload is mislukt; de run is niet als compleet gepubliceerd.`);
  }
  return descriptor;
}

function assertRemoteMetadata(
  metadata: Record<string, string> | undefined,
  stamp: string,
  kind: "object" | "manifest" | "completion",
  digest: string,
): void {
  if (
    metadata?.careonbackup !== "facturatie-v1" ||
    metadata.careonpair !== stamp ||
    metadata.careonkind !== kind ||
    metadata.sha256 !== digest
  ) {
    throw new Error("R2-objectmetadata wijkt af van de completion-index.");
  }
}

async function headRemote(
  s3: S3Client,
  configuration: EnabledConfiguration,
  completion: OffsiteCompletion,
  descriptor: RemoteEncryptedObject,
  kind: "object" | "manifest",
): Promise<void> {
  try {
    const response = await s3.send(new HeadObjectCommand({ Bucket: configuration.bucket, Key: descriptor.key }));
    if (response.ContentLength !== descriptor.bytes) throw new Error("size");
    assertRemoteMetadata(response.Metadata, completion.stamp, kind, descriptor.sha256);
  } catch {
    throw new Error(`R2 ${kind}-verificatie is mislukt.`);
  }
}

async function getRemote(
  s3: S3Client,
  configuration: EnabledConfiguration,
  key: string,
  maximumBytes: number,
): Promise<RemoteRead> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: configuration.bucket, Key: key }));
    if (!response.Body || !Number.isSafeInteger(response.ContentLength) || (response.ContentLength as number) < 1) {
      throw new Error("missing body");
    }
    if ((response.ContentLength as number) > maximumBytes) throw new Error("oversize");
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    if (bytes.byteLength !== response.ContentLength) throw new Error("truncated");
    return { bytes, metadata: response.Metadata ?? {} };
  } catch {
    throw new Error("R2-object kon niet veilig worden gelezen.");
  }
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`${label} bevat geen geldige JSON.`);
  }
}

async function latestCompletionStamp(s3: S3Client, configuration: EnabledConfiguration): Promise<string> {
  let continuationToken: string | undefined;
  const stamps: string[] = [];
  for (;;) {
    let response: ListObjectsV2CommandOutput;
    try {
      response = await s3.send(
        new ListObjectsV2Command({
          Bucket: configuration.bucket,
          Prefix: `${OFFSITE_PREFIX}/`,
          ContinuationToken: continuationToken,
          MaxKeys: 1_000,
        }),
      );
    } catch {
      throw new Error("R2 completion-inventaris kon niet worden gelezen.");
    }
    for (const object of response.Contents ?? []) {
      const match = /^facturatie-storage\/v1\/backups\/([0-9]{8}-[0-9]{6})\/complete\.json$/.exec(object.Key ?? "");
      if (match) stamps.push(match[1]);
      if (stamps.length > MAX_OFFSITE_OBJECTS) throw new Error("R2 completion-inventaris overschrijdt de limiet.");
    }
    if (!response.IsTruncated) break;
    if (!response.NextContinuationToken || response.NextContinuationToken === continuationToken) {
      throw new Error("R2 completion-paginering is ongeldig.");
    }
    continuationToken = response.NextContinuationToken;
  }
  stamps.sort();
  const latest = stamps.at(-1);
  if (!latest) throw new Error("Geen complete Facturatie off-site backup gevonden.");
  return latest;
}

async function inBatches<T>(values: T[], action: (value: T) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < values.length; offset += REMOTE_BATCH_SIZE) {
    await Promise.all(values.slice(offset, offset + REMOTE_BATCH_SIZE).map(action));
  }
}

async function verifyRemote(
  s3: S3Client,
  configuration: EnabledConfiguration,
  maximumAgeHours: number,
  requestedStamp?: string,
  allowHistorical = false,
): Promise<OffsiteCompletion> {
  const stamp = requestedStamp ?? (await latestCompletionStamp(s3, configuration));
  const completionRead = await getRemote(s3, configuration, completionKey(stamp), MAX_COMPLETION_BYTES);
  const completionDigest = sha256(completionRead.bytes);
  assertRemoteMetadata(completionRead.metadata, stamp, "completion", completionDigest);
  const completion = parseCompletion(parseJson(completionRead.bytes, "Completion-marker"), stamp);
  const ageSeconds = offsiteAgeSeconds(stamp);
  if (!allowHistorical && ageSeconds > maximumAgeHours * 3_600) {
    throw new Error(`Nieuwste complete Facturatie off-site backup is ouder dan ${maximumAgeHours} uur.`);
  }
  if (completion.manifest.bytes > MAX_COMPLETION_BYTES) throw new Error("Versleuteld manifest is te groot.");
  for (const object of completion.objects) {
    if (object.bytes > MAX_ENCRYPTED_OBJECT_BYTES) throw new Error("Versleuteld backupobject is te groot.");
  }
  await headRemote(s3, configuration, completion, completion.manifest, "manifest");
  await inBatches(completion.objects, (object) => headRemote(s3, configuration, completion, object, "object"));
  return completion;
}

async function sourceInventory() {
  const environment = requiredEnvironment();
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
  return { environment, expected, actual };
}

function requiredEncryption(configuration: EnabledConfiguration): { encryptionKey: Buffer; keyId: string } {
  if (!configuration.encryptionKey || !configuration.keyId) {
    throw new Error("Facturatie off-site encryptie is niet geconfigureerd.");
  }
  return { encryptionKey: configuration.encryptionKey, keyId: configuration.keyId };
}

async function upload(configuration: EnabledConfiguration, maximumAgeHours: number): Promise<void> {
  const { encryptionKey, keyId } = requiredEncryption(configuration);
  const { environment, expected, actual } = await sourceInventory();
  const createdAt = new Date().toISOString();
  const stamp = backupStamp(new Date(createdAt));
  const s3 = client(configuration);
  const manifestObjects: OffsiteManifestObject[] = [];
  const remoteObjects: RemoteEncryptedObject[] = [];

  for (const expectedObject of [...expected.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    const plaintext = await downloadObject(environment.supabaseUrl, environment.serviceKey, expectedObject.path);
    const listedObject = actual.get(expectedObject.path);
    if (!listedObject) throw new Error("Geverifieerde Storage-inventaris verloor een verwacht object.");
    const verified = verifyObjectBytes(expectedObject, listedObject, plaintext);
    const remoteKey = encryptedObjectKey(stamp, expectedObject.path, encryptionKey);
    const encrypted = encryptBackupPayload(plaintext, encryptionKey, { stamp, keyId, kind: "object", remoteKey });
    const descriptor = await putRemote(s3, configuration, stamp, remoteKey, encrypted, "object");
    remoteObjects.push(descriptor);
    manifestObjects.push({
      ...verified,
      remoteKey,
      encryptedBytes: descriptor.bytes,
      encryptedSha256: descriptor.sha256,
    });
  }

  const manifest = buildManifest(stamp, createdAt, projectRef(environment.supabaseUrl), manifestObjects);
  const manifestKey = encryptedManifestKey(stamp);
  const encryptedManifest = encryptBackupPayload(serializeBackupJson(manifest), encryptionKey, {
    stamp,
    keyId,
    kind: "manifest",
    remoteKey: manifestKey,
  });
  if (encryptedManifest.byteLength > MAX_COMPLETION_BYTES) {
    throw new Error("Versleuteld manifest overschrijdt de veilige groottelimiet.");
  }
  const manifestDescriptor = await putRemote(s3, configuration, stamp, manifestKey, encryptedManifest, "manifest");
  const completion = buildCompletion(stamp, createdAt, keyId, manifestDescriptor, remoteObjects);
  const completionBytes = serializeBackupJson(completion);
  if (completionBytes.byteLength > MAX_COMPLETION_BYTES) {
    throw new Error("Completion-marker overschrijdt de veilige groottelimiet.");
  }

  // Completion is deliberately the final write. A partial prefix is never
  // eligible for verification or restore and needs no delete privilege.
  await putRemote(s3, configuration, stamp, completionKey(stamp), completionBytes, "completion");
  await verifyRemote(s3, configuration, maximumAgeHours, stamp);
  console.log(
    `FACTURATIE_STORAGE_OFFSITE=OK pair=${stamp} objects=${completion.objectCount} encrypted_bytes=${completion.totalEncryptedBytes}`,
  );
}

async function verify(configuration: EnabledConfiguration, maximumAgeHours: number): Promise<void> {
  const s3 = client(configuration);
  const completion = await verifyRemote(s3, configuration, maximumAgeHours);
  console.log(
    `FACTURATIE_STORAGE_OFFSITE=OK pair=${completion.stamp} age_seconds=${offsiteAgeSeconds(completion.stamp)} objects=${completion.objectCount}`,
  );
}

function snapshotObject(object: OffsiteManifestObject): VerifiedBackupObject {
  return {
    path: object.path,
    orgId: object.orgId,
    kind: object.kind,
    sha256: object.sha256,
    bytes: object.bytes,
    contentType: object.contentType,
    updatedAt: object.updatedAt,
  };
}

async function fetchBackup(
  configuration: EnabledConfiguration,
  maximumAgeHours: number,
  stamp: string,
  outputPath: string,
): Promise<void> {
  if (process.env.CAREON_FACTURATIE_BACKUP_ALLOW_PLAINTEXT !== "1") {
    throw new Error("Hersteluitvoer is plaintext; expliciete encrypted-volume-erkenning ontbreekt.");
  }
  const { encryptionKey, keyId } = requiredEncryption(configuration);
  const target = prepareSnapshotTarget(outputPath);
  const s3 = client(configuration);
  const completion = await verifyRemote(s3, configuration, maximumAgeHours, stamp, true);
  if (completion.keyId !== keyId) throw new Error("Geconfigureerde encryptiesleutel-id past niet bij deze backup.");
  const encryptedManifest = await getRemote(s3, configuration, completion.manifest.key, MAX_COMPLETION_BYTES);
  assertRemoteMetadata(encryptedManifest.metadata, stamp, "manifest", completion.manifest.sha256);
  if (
    encryptedManifest.bytes.byteLength !== completion.manifest.bytes ||
    sha256(encryptedManifest.bytes) !== completion.manifest.sha256
  ) {
    throw new Error("Versleuteld off-site manifest wijkt af van de completion-index.");
  }
  const manifestBytes = decryptBackupPayload(encryptedManifest.bytes, encryptionKey, {
    stamp,
    keyId,
    kind: "manifest",
    remoteKey: completion.manifest.key,
  });
  const manifest = parseManifest(parseJson(manifestBytes, "Ontsleuteld manifest"), completion, encryptionKey);
  fs.mkdirSync(target.partialPath, { mode: 0o700 });
  try {
    const restored: VerifiedBackupObject[] = [];
    for (const object of manifest.objects) {
      const encrypted = await getRemote(s3, configuration, object.remoteKey, MAX_ENCRYPTED_OBJECT_BYTES);
      assertRemoteMetadata(encrypted.metadata, stamp, "object", object.encryptedSha256);
      if (encrypted.bytes.byteLength !== object.encryptedBytes || sha256(encrypted.bytes) !== object.encryptedSha256) {
        throw new Error("Versleuteld off-site object wijkt af van het manifest.");
      }
      const plaintext = decryptBackupPayload(encrypted.bytes, encryptionKey, {
        stamp,
        keyId,
        kind: "object",
        remoteKey: object.remoteKey,
      });
      const verified = verifyObjectBytes(
        snapshotObject(object),
        { path: object.path, size: object.bytes, contentType: object.contentType, updatedAt: object.updatedAt },
        plaintext,
      );
      restored.push(verified);
      writeObject(target.partialPath, object.path, plaintext);
    }
    const snapshot: SnapshotManifest = {
      schema: "careon-facturatie-storage-backup/v1",
      createdAt: completion.createdAt,
      sourceProjectRef: manifest.sourceProjectRef,
      bucket: FACTURATIE_BUCKET,
      objectCount: restored.length,
      totalBytes: restored.reduce((total, object) => total + object.bytes, 0),
      objects: restored,
    };
    const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
    privateWrite(path.join(target.partialPath, "manifest.json"), snapshotText);
    privateWrite(path.join(target.partialPath, "manifest.sha256"), `${sha256(snapshotText)}  manifest.json\n`);
    fs.renameSync(target.partialPath, target.finalPath);
    console.log(
      `FACTURATIE_STORAGE_OFFSITE_FETCH=OK pair=${stamp} objects=${restored.length} destination=${target.finalPath}`,
    );
  } catch (error) {
    if (fs.existsSync(target.partialPath)) {
      const relative = path.relative(path.dirname(target.partialPath), target.partialPath);
      if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        fs.rmSync(target.partialPath, { recursive: true, force: true });
      }
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const environment = mergedEnvironment();
  const configuration = resolveOffsiteConfiguration(environment, mode.kind);
  const maximumAgeHours = maxAgeHours(environment);
  if (!configuration.enabled) {
    console.log("FACTURATIE_STORAGE_OFFSITE=DISABLED required=0");
    return;
  }
  if (mode.kind === "upload") return upload(configuration, maximumAgeHours);
  if (mode.kind === "verify") return verify(configuration, maximumAgeHours);
  return fetchBackup(configuration, maximumAgeHours, mode.stamp, mode.outputPath);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Onbekende fout.";
  console.error(`FACTURATIE_STORAGE_OFFSITE=FAIL ${message}`);
  process.exitCode = 1;
});

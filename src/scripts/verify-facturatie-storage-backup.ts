/** Credential-free failure matrix for the Facturatie Storage backup boundary. */

import {
  expectedBackupObjects,
  type InvoiceMetadataRow,
  reconcileStorageInventory,
  type SettingsMetadataRow,
  sha256,
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
  offsiteAgeSeconds,
  parseCompletion,
  parseManifest,
  resolveOffsiteConfiguration,
  serializeBackupJson,
} from "./lib/facturatie-storage-offsite";
import * as fs from "node:fs";
import * as path from "node:path";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const PDF_PATH = `${ORG_A}/2026/F2026-0001.pdf`;
const LOGO_PATH = `${ORG_A}/branding/standaard.png`;
const PDF = Buffer.from("%PDF-1.7\nsynthetic-backup-policy-fixture\n%%EOF\n", "utf8");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

let passes = 0;
let failures = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

function rejects(name: string, action: () => unknown, includes?: string): void {
  try {
    action();
    check(name, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    check(name, includes === undefined || message.includes(includes));
  }
}

function invoice(overrides: Partial<InvoiceMetadataRow> = {}): InvoiceMetadataRow {
  return {
    org_id: ORG_A,
    pdf_pad: PDF_PATH,
    pdf_sha256: sha256(PDF),
    pdf_bytes: PDF.byteLength,
    pdf_gegenereerd_op: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function settings(
  overrides: { orgId?: string; revision?: number; presentation?: Record<string, unknown> } = {},
): SettingsMetadataRow {
  return {
    org_id: overrides.orgId ?? ORG_A,
    revision: overrides.revision ?? 1,
    state: {
      templates: [
        {
          id: "standaard",
          presentatie: overrides.presentation ?? {
            logoBron: "upload",
            logoPad: LOGO_PATH,
            logoHash: sha256(PNG),
          },
        },
      ],
    },
  };
}

function main(): void {
  const empty = expectedBackupObjects([], []);
  check("lege productie is een geldige inventaris", empty.size === 0);

  const expected = expectedBackupObjects([invoice()], [settings()]);
  check(
    "geldige PDF- en logometadata leveren exact twee objecten",
    expected.size === 2 &&
      expected.get(PDF_PATH)?.kind === "invoice-pdf" &&
      expected.get(LOGO_PATH)?.kind === "template-logo",
  );

  const latestOnly = expectedBackupObjects(
    [],
    [settings({ revision: 1 }), settings({ revision: 2, presentation: { logoBron: "careongroup" } })],
  );
  check("alleen de nieuwste instellingenrevisie bepaalt actieve logo-objecten", latestOnly.size === 0);

  rejects("gedeeltelijke PDF-metadata faalt gesloten", () =>
    expectedBackupObjects([invoice({ pdf_sha256: null })], []),
  );
  rejects("organisatievreemd PDF-pad faalt gesloten", () =>
    expectedBackupObjects([invoice({ pdf_pad: `${ORG_B}/2026/F2026-0001.pdf` })], []),
  );
  rejects("niet-canoniek PDF-pad faalt gesloten", () =>
    expectedBackupObjects([invoice({ pdf_pad: `${ORG_A}/2026/F%2f2026.pdf` })], []),
  );
  rejects("ongeldige PDF-hash faalt gesloten", () => expectedBackupObjects([invoice({ pdf_sha256: "a" })], []));
  rejects("ongeldige PDF-grootte faalt gesloten", () => expectedBackupObjects([invoice({ pdf_bytes: 0 })], []));
  rejects("ongeldig PDF-tijdstip faalt gesloten", () =>
    expectedBackupObjects([invoice({ pdf_gegenereerd_op: "niet-een-datum" })], []),
  );
  rejects("uploadlogo zonder hash faalt gesloten", () =>
    expectedBackupObjects([], [settings({ presentation: { logoBron: "upload", logoPad: LOGO_PATH } })]),
  );
  rejects("organisatievreemd logopad faalt gesloten", () =>
    expectedBackupObjects(
      [],
      [
        settings({
          presentation: { logoBron: "upload", logoPad: `${ORG_B}/branding/standaard.png`, logoHash: sha256(PNG) },
        }),
      ],
    ),
  );
  rejects("stale logometadata bij ingebouwde logobron faalt gesloten", () =>
    expectedBackupObjects(
      [],
      [settings({ presentation: { logoBron: "careongroup", logoPad: LOGO_PATH, logoHash: sha256(PNG) } })],
    ),
  );
  rejects("onleesbare instellingenrevisie faalt gesloten", () =>
    expectedBackupObjects([], [{ org_id: ORG_A, revision: 1, state: {} }]),
  );

  const listed = [
    { path: PDF_PATH, size: PDF.byteLength, contentType: "application/pdf" },
    { path: LOGO_PATH, size: PNG.byteLength, contentType: "image/png" },
  ];
  const actual = reconcileStorageInventory(expected, listed);
  check("exacte Storage-inventaris wordt geaccepteerd", actual.size === 2);
  rejects("ontbrekend object faalt gesloten", () => reconcileStorageInventory(expected, listed.slice(0, 1)));
  rejects("onverwacht object faalt gesloten", () =>
    reconcileStorageInventory(expected, [...listed, { path: `${ORG_A}/branding/orphan.png` }]),
  );
  rejects("dubbel object faalt gesloten", () => reconcileStorageInventory(expected, [...listed, listed[0]]));

  const expectedPdf = expected.get(PDF_PATH);
  const expectedLogo = expected.get(LOGO_PATH);
  const actualPdf = actual.get(PDF_PATH);
  const actualLogo = actual.get(LOGO_PATH);
  if (!expectedPdf || !expectedLogo || !actualPdf || !actualLogo) throw new Error("Ongeldige testfixture.");
  const verifiedPdf = verifyObjectBytes(expectedPdf, actualPdf, PDF);
  const verifiedLogo = verifyObjectBytes(expectedLogo, actualLogo, PNG);
  check(
    "geldige objectbytes worden geverifieerd",
    verifiedPdf.sha256 === sha256(PDF) && verifiedLogo.sha256 === sha256(PNG),
  );
  rejects("PDF zonder magic faalt gesloten", () =>
    verifyObjectBytes(
      { ...expectedPdf, sha256: sha256(Buffer.from("geen pdf")), bytes: 8 },
      { path: PDF_PATH },
      Buffer.from("geen pdf"),
    ),
  );
  const noEof = Buffer.from("%PDF-1.7\ngeen einde");
  rejects("PDF zonder EOF faalt gesloten", () =>
    verifyObjectBytes({ ...expectedPdf, sha256: sha256(noEof), bytes: noEof.byteLength }, { path: PDF_PATH }, noEof),
  );
  rejects("PNG zonder magic faalt gesloten", () =>
    verifyObjectBytes({ ...expectedLogo, sha256: sha256(PDF) }, { path: LOGO_PATH }, PDF),
  );
  rejects("hashdrift faalt gesloten", () =>
    verifyObjectBytes(expectedPdf, actualPdf, Buffer.concat([PDF, Buffer.from("x")])),
  );
  rejects("databasegroottedrift faalt gesloten", () =>
    verifyObjectBytes({ ...expectedPdf, bytes: PDF.byteLength + 1 }, actualPdf, PDF),
  );
  rejects("Storage-groottedrift faalt gesloten", () =>
    verifyObjectBytes(expectedPdf, { ...actualPdf, size: PDF.byteLength + 1 }, PDF),
  );
  rejects("MIME-drift faalt gesloten", () =>
    verifyObjectBytes(expectedPdf, { ...actualPdf, contentType: "text/html" }, PDF),
  );
  let leakedPath = false;
  try {
    verifyObjectBytes(expectedPdf, actualPdf, Buffer.concat([PDF, Buffer.from("drift")]));
  } catch (error) {
    leakedPath = error instanceof Error && error.message.includes(PDF_PATH);
  }
  check("foutmeldingen redigeren het factuurobjectpad", !leakedPath);

  const offsiteKey = Buffer.alloc(32, 0x2a);
  const offsiteKeyBase64 = offsiteKey.toString("base64");
  const offsiteStamp = "20260822-120000";
  const offsiteCreatedAt = "2026-08-22T12:00:00.000Z";
  const offsiteEnvironment = {
    CAREON_FACTURATIE_BACKUP_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    CAREON_FACTURATIE_BACKUP_R2_ACCESS_KEY_ID: "synthetic-access",
    CAREON_FACTURATIE_BACKUP_R2_SECRET_ACCESS_KEY: "synthetic-secret",
    CAREON_FACTURATIE_BACKUP_R2_BUCKET: "careon-facturatie-backups",
    CAREON_FACTURATIE_BACKUP_R2_JURISDICTION: "eu",
    CAREON_FACTURATIE_BACKUP_ENCRYPTION_KEY: offsiteKeyBase64,
    CAREON_FACTURATIE_BACKUP_ENCRYPTION_KEY_ID: "tgc-2026-v1",
  };
  check(
    "off-site verifier is bewust uitgeschakeld zonder clientconfiguratie",
    resolveOffsiteConfiguration({}, "verify").enabled === false,
  );
  rejects("off-site upload weigert ontbrekende clientconfiguratie", () => resolveOffsiteConfiguration({}, "upload"));
  rejects("off-site required weigert ontbrekende clientconfiguratie", () =>
    resolveOffsiteConfiguration({ CAREON_FACTURATIE_BACKUP_OFFSITE_REQUIRED: "1" }, "verify"),
  );
  rejects("gedeeltelijke R2-configuratie faalt gesloten", () =>
    resolveOffsiteConfiguration({ CAREON_FACTURATIE_BACKUP_R2_BUCKET: "careon-backups" }, "verify"),
  );
  rejects("niet-EU R2-jurisdictie faalt gesloten", () =>
    resolveOffsiteConfiguration({ ...offsiteEnvironment, CAREON_FACTURATIE_BACKUP_R2_JURISDICTION: "auto" }, "upload"),
  );
  rejects("ongeldige off-site encryptiesleutel faalt gesloten", () =>
    resolveOffsiteConfiguration({ ...offsiteEnvironment, CAREON_FACTURATIE_BACKUP_ENCRYPTION_KEY: "YQ==" }, "upload"),
  );
  const uploadConfiguration = resolveOffsiteConfiguration(offsiteEnvironment, "upload");
  check(
    "complete uploadconfiguratie dwingt het EU-endpoint en 32-byte sleutel af",
    uploadConfiguration.enabled &&
      uploadConfiguration.endpoint === "https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com" &&
      uploadConfiguration.encryptionKey?.byteLength === 32,
  );
  const verifyConfiguration = resolveOffsiteConfiguration(
    {
      CAREON_FACTURATIE_BACKUP_R2_ACCOUNT_ID: offsiteEnvironment.CAREON_FACTURATIE_BACKUP_R2_ACCOUNT_ID,
      CAREON_FACTURATIE_BACKUP_R2_ACCESS_KEY_ID: offsiteEnvironment.CAREON_FACTURATIE_BACKUP_R2_ACCESS_KEY_ID,
      CAREON_FACTURATIE_BACKUP_R2_SECRET_ACCESS_KEY: offsiteEnvironment.CAREON_FACTURATIE_BACKUP_R2_SECRET_ACCESS_KEY,
      CAREON_FACTURATIE_BACKUP_R2_BUCKET: offsiteEnvironment.CAREON_FACTURATIE_BACKUP_R2_BUCKET,
    },
    "verify",
  );
  check(
    "recurring verificatie heeft geen decryptiesleutel nodig",
    verifyConfiguration.enabled && !verifyConfiguration.encryptionKey,
  );
  check(
    "UTC-backupstempel is deterministisch",
    backupStamp(new Date(offsiteCreatedAt)) === offsiteStamp &&
      offsiteAgeSeconds(offsiteStamp, Date.parse(offsiteCreatedAt)) === 0,
  );
  rejects("ongeldige kalenderstempel faalt gesloten", () => offsiteAgeSeconds("20260231-120000"));

  const remoteObjectKey = encryptedObjectKey(offsiteStamp, PDF_PATH, offsiteKey);
  check(
    "R2-objectnaam is opaak en stabiel binnen één run",
    remoteObjectKey === encryptedObjectKey(offsiteStamp, PDF_PATH, offsiteKey) &&
      !remoteObjectKey.includes(PDF_PATH) &&
      !remoteObjectKey.includes(ORG_A),
  );
  check(
    "dezelfde bron krijgt per backuprun een andere opaque sleutel",
    remoteObjectKey !== encryptedObjectKey("20260822-120001", PDF_PATH, offsiteKey),
  );
  const objectContext = {
    stamp: offsiteStamp,
    keyId: "tgc-2026-v1",
    kind: "object" as const,
    remoteKey: remoteObjectKey,
  };
  const encryptedPdf = encryptBackupPayload(PDF, offsiteKey, objectContext, Buffer.alloc(12, 0x07));
  check(
    "AES-GCM backup-envelop ontsleutelt exact",
    decryptBackupPayload(encryptedPdf, offsiteKey, objectContext).equals(PDF),
  );
  check(
    "versleuteld object bevat fixturetekst niet",
    !encryptedPdf.includes(Buffer.from("synthetic-backup-policy-fixture")),
  );
  const tamperedPdf = Buffer.from(encryptedPdf);
  tamperedPdf[tamperedPdf.length - 1] ^= 0x01;
  rejects("gemanipuleerde AES-GCM backup faalt authentiek", () =>
    decryptBackupPayload(tamperedPdf, offsiteKey, objectContext),
  );
  rejects("backup kan niet onder een andere objectsleutel worden afgespeeld", () =>
    decryptBackupPayload(encryptedPdf, offsiteKey, { ...objectContext, remoteKey: encryptedManifestKey(offsiteStamp) }),
  );

  const pdfDescriptor = encryptedDescriptor(remoteObjectKey, encryptedPdf);
  const manifestObject = {
    ...(verifiedPdf as NonNullable<typeof verifiedPdf>),
    remoteKey: remoteObjectKey,
    encryptedBytes: pdfDescriptor.bytes,
    encryptedSha256: pdfDescriptor.sha256,
  };
  const offsiteManifest = buildManifest(offsiteStamp, offsiteCreatedAt, "jdxvrczwelxlgtzyisea", [manifestObject]);
  const manifestRemoteKey = encryptedManifestKey(offsiteStamp);
  const manifestContext = {
    stamp: offsiteStamp,
    keyId: "tgc-2026-v1",
    kind: "manifest" as const,
    remoteKey: manifestRemoteKey,
  };
  const encryptedManifest = encryptBackupPayload(
    serializeBackupJson(offsiteManifest),
    offsiteKey,
    manifestContext,
    Buffer.alloc(12, 0x08),
  );
  const manifestDescriptor = encryptedDescriptor(manifestRemoteKey, encryptedManifest);
  const completion = buildCompletion(offsiteStamp, offsiteCreatedAt, "tgc-2026-v1", manifestDescriptor, [
    pdfDescriptor,
  ]);
  const completionText = serializeBackupJson(completion).toString("utf8");
  check(
    "completion-marker bevat geen logisch pad of organisatie-id",
    !completionText.includes(PDF_PATH) && !completionText.includes(ORG_A),
  );
  const parsedCompletion = parseCompletion(JSON.parse(completionText), offsiteStamp);
  const parsedManifest = parseManifest(
    JSON.parse(decryptBackupPayload(encryptedManifest, offsiteKey, manifestContext).toString("utf8")),
    parsedCompletion,
    offsiteKey,
  );
  check(
    "versleuteld manifest koppelt completion-index exact terug aan bronobject",
    parsedManifest.objectCount === 1 &&
      parsedManifest.objects[0]?.path === PDF_PATH &&
      parsedManifest.objects[0]?.sha256 === sha256(PDF),
  );
  rejects("completion-marker met vervalste totalen faalt gesloten", () =>
    parseCompletion({ ...completion, totalEncryptedBytes: completion.totalEncryptedBytes + 1 }, offsiteStamp),
  );
  rejects("completion-marker met afwijkend tijdstip faalt gesloten", () =>
    parseCompletion({ ...completion, createdAt: "2026-08-22T12:00:01.000Z" }, offsiteStamp),
  );
  rejects("completion-marker met leesbare objectsleutel faalt gesloten", () =>
    parseCompletion(
      {
        ...completion,
        objects: [{ ...pdfDescriptor, key: `${completionKey(offsiteStamp)}/invoice.pdf` }],
      },
      offsiteStamp,
    ),
  );
  rejects("ontsleuteld manifest met andere remote sleutel faalt gesloten", () =>
    parseManifest(
      { ...offsiteManifest, objects: [{ ...manifestObject, remoteKey: completionKey(offsiteStamp) }] },
      parsedCompletion,
      offsiteKey,
    ),
  );
  rejects("ontsleuteld manifest met pad-traversal faalt gesloten", () =>
    parseManifest(
      { ...offsiteManifest, objects: [{ ...manifestObject, path: `${ORG_A}/2026/../secret.pdf` }] },
      parsedCompletion,
      offsiteKey,
    ),
  );
  rejects("ontsleuteld manifest met MIME/type-verwisseling faalt gesloten", () =>
    parseManifest(
      { ...offsiteManifest, objects: [{ ...manifestObject, contentType: "image/png" }] },
      parsedCompletion,
      offsiteKey,
    ),
  );
  rejects("ontsleuteld manifest met ongeldig Storage-tijdstip faalt gesloten", () =>
    parseManifest(
      { ...offsiteManifest, objects: [{ ...manifestObject, updatedAt: "geen-datum" }] },
      parsedCompletion,
      offsiteKey,
    ),
  );
  rejects("manifestbouwer weigert dubbele bronobjecten", () =>
    buildManifest(offsiteStamp, offsiteCreatedAt, "jdxvrczwelxlgtzyisea", [manifestObject, manifestObject]),
  );

  const scriptSource = fs.readFileSync(path.resolve(__dirname, "backup-facturatie-storage.ts"), "utf8");
  const offsiteScriptSource = fs.readFileSync(path.resolve(__dirname, "backup-facturatie-storage-offsite.ts"), "utf8");
  const migrationSource = fs.readFileSync(
    path.resolve(__dirname, "../../supabase/migrations/20260822234500_facturatie_storage_backup_boundary.sql"),
    "utf8",
  );
  check(
    "productiequery selecteert alleen archiefmetadata",
    scriptSource.includes('"org_id,pdf_pad,pdf_sha256,pdf_bytes,pdf_gegenereerd_op"') &&
      !scriptSource.includes('"afnemer') &&
      !scriptSource.includes('"regels'),
  );
  check(
    "snapshot vereist expliciete plaintext-erkenning en pad buiten de repository",
    scriptSource.includes("CAREON_FACTURATIE_BACKUP_ALLOW_PLAINTEXT") &&
      scriptSource.includes("Snapshotpad moet buiten de repository liggen"),
  );
  check(
    "downloadfouten loggen alleen een objectdigest",
    scriptSource.includes("Object $" + "{label}: downloaden") &&
      !scriptSource.includes("$" + "{objectPath}: downloaden"),
  );
  check(
    "bucketcontrole vereist privéstatus, groottelimiet en gesloten MIME-allowlist",
    scriptSource.includes("bucket.public !== false") &&
      scriptSource.includes("allowed_mime_types") &&
      scriptSource.includes('allowedMimeTypes.includes("application/pdf")') &&
      scriptSource.includes('allowedMimeTypes.includes("image/png")'),
  );
  check(
    "migratie verankert PDF-metadata als alles-of-niets",
    migrationSource.includes("num_nonnulls(pdf_pad, pdf_sha256, pdf_bytes, pdf_gegenereerd_op) in (0, 4)") &&
      migrationSource.includes("careon_facturatie_facturen_pdf_metadata_complete"),
  );
  check(
    "migratie begrenst hash, grootte en organisatiepad",
    migrationSource.includes("careon_facturatie_facturen_pdf_hash_valid") &&
      migrationSource.includes("careon_facturatie_facturen_pdf_bytes_valid") &&
      migrationSource.includes("careon_facturatie_facturen_pdf_path_scoped") &&
      migrationSource.includes("split_part(pdf_pad, '/', 1) = org_id::text"),
  );
  check(
    "migratie houdt de bucket privé en beperkt bestandstypen",
    migrationSource.includes("public = false") &&
      migrationSource.includes("26214400") &&
      migrationSource.includes("array['application/pdf', 'image/png']::text[]"),
  );
  check(
    "off-site upload gebruikt conditionele no-overwrite S3-writes",
    offsiteScriptSource.includes("PutObjectCommand") && offsiteScriptSource.includes('IfNoneMatch: "*"'),
  );
  check(
    "completion-marker wordt expliciet als laatste gepubliceerd",
    offsiteScriptSource.includes("Completion is deliberately the final write") &&
      offsiteScriptSource.indexOf("completionKey(stamp), completionBytes") >
        offsiteScriptSource.indexOf("manifestDescriptor = await putRemote"),
  );
  check(
    "manifest en completion worden voor publicatie op grootte begrensd",
    offsiteScriptSource.indexOf("encryptedManifest.byteLength > MAX_COMPLETION_BYTES") <
      offsiteScriptSource.indexOf("manifestDescriptor = await putRemote") &&
      offsiteScriptSource.indexOf("completionBytes.byteLength > MAX_COMPLETION_BYTES") <
        offsiteScriptSource.indexOf("completionKey(stamp), completionBytes"),
  );
  check(
    "off-site token heeft geen deletepad nodig",
    !offsiteScriptSource.includes("DeleteObjectCommand") && !offsiteScriptSource.includes("DeleteObjectsCommand"),
  );
  check(
    "off-site herstel vereist plaintext-erkenning en bestaand veilig snapshotdoel",
    offsiteScriptSource.includes("CAREON_FACTURATIE_BACKUP_ALLOW_PLAINTEXT") &&
      offsiteScriptSource.includes("prepareSnapshotTarget(outputPath)"),
  );

  console.log(`Facturatie Storage backup policy: ${passes}/${passes + failures} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

main();

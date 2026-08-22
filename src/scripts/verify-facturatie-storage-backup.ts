/** Credential-free failure matrix for the Facturatie Storage backup boundary. */

import {
  expectedBackupObjects,
  type InvoiceMetadataRow,
  reconcileStorageInventory,
  type SettingsMetadataRow,
  sha256,
  verifyObjectBytes,
} from "./lib/facturatie-storage-backup";
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

  const scriptSource = fs.readFileSync(path.resolve(__dirname, "backup-facturatie-storage.ts"), "utf8");
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

  console.log(`Facturatie Storage backup policy: ${passes}/${passes + failures} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

main();

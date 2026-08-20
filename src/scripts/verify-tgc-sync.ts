import { parseAgendaExport } from "../lib/careon-production/parse-agenda";
import { parseDeclaratiesExport } from "../lib/careon-production/parse-declaraties";
import { parseClientExport } from "../lib/careon-production/parse-export";
import { parseToeslagenExport } from "../lib/careon-production/parse-toeslagen";
import { parseVerwijzersExport } from "../lib/careon-production/parse-verwijzers";
import {
  AGENDA_RESULT_FIELDS,
  addMonths,
  CLIENT_RESULT_FIELDS,
  formatDutchDate,
  TGC_DATE_RANGES,
  TGC_ROUTES,
} from "../lib/careon-production/tgc-export-automation";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "../..");
const EXPORTS_DIR = path.join(ROOT, "Exports EPD");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function newest(pattern: RegExp): string {
  const matches = fs
    .readdirSync(EXPORTS_DIR)
    .filter((name) => pattern.test(name))
    .sort((left, right) => {
      return fs.statSync(path.join(EXPORTS_DIR, right)).mtimeMs - fs.statSync(path.join(EXPORTS_DIR, left)).mtimeMs;
    });
  assert(matches[0], `Geen export voor ${pattern} gevonden.`);
  return path.join(EXPORTS_DIR, matches[0]);
}

function verifyConfiguration(): void {
  const routes = Object.values(TGC_ROUTES);
  assert(new Set(routes).size === routes.length, "TGC-routes moeten uniek zijn.");
  assert(TGC_ROUTES.client.includes("export-patients-data"), "Cliëntendata-route is onverwacht gewijzigd.");
  assert(TGC_ROUTES.agenda.includes("export-appointments"), "Agenda-route is onverwacht gewijzigd.");
  assert(TGC_ROUTES.referrers.includes("export-referrer"), "Verwijzerroute is onverwacht gewijzigd.");
  assert(TGC_ROUTES.surcharges.endsWith("declared-surcharges"), "Toeslagenroute is onverwacht gewijzigd.");
  assert(TGC_ROUTES.declarations.endsWith("declaration-total"), "Declaratieroute is onverwacht gewijzigd.");
  assert(new Set(CLIENT_RESULT_FIELDS).size === CLIENT_RESULT_FIELDS.length, "Dubbele cliënt-exportvelden.");
  assert(new Set(AGENDA_RESULT_FIELDS).size === AGENDA_RESULT_FIELDS.length, "Dubbele agenda-exportvelden.");
  assert(TGC_DATE_RANGES.agendaMonthsAhead >= 12, "Agenda-export moet minstens twaalf maanden vooruit kijken.");
  assert(formatDutchDate(new Date(2026, 7, 20)) === "20-08-2026", "Nederlandse datumnotatie klopt niet.");
  assert(formatDutchDate(addMonths(new Date(2026, 7, 31), 6)) === "28-02-2027", "Maandoptelling klopt niet.");
}

function verifyExistingExports(): void {
  assert(fs.existsSync(EXPORTS_DIR), "Exports EPD-map ontbreekt.");
  const importedAt = "2026-08-20T12:00:00.000Z";
  const clientPath = newest(/^cli_ntendata_export.*\.csv$/i);
  const agendaPath = newest(/^exporteer_agenda_afspraken_.*\.csv$/i);
  const referrerPath = newest(/^huisarts_verwijzer.*\.csv$/i);
  const surchargePath = newest(/^declared_surcharges.*\.csv$/i);
  const declarationPath = newest(/^declaration_total.*\.csv$/i);

  const clients = parseClientExport(path.basename(clientPath), fs.readFileSync(clientPath, "utf8"));
  const agenda = parseAgendaExport(path.basename(agendaPath), fs.readFileSync(agendaPath, "utf8"), importedAt);
  const referrers = parseVerwijzersExport(
    path.basename(referrerPath),
    fs.readFileSync(referrerPath, "utf8"),
    importedAt,
  );
  const surcharges = parseToeslagenExport(
    path.basename(surchargePath),
    fs.readFileSync(surchargePath, "utf8"),
    importedAt,
  );
  const declarations = parseDeclaratiesExport(
    path.basename(declarationPath),
    fs.readFileSync(declarationPath, "utf8"),
    importedAt,
  );

  assert(clients.ok && clients.records.length > 0, `Cliëntfixture ongeldig: ${clients.error ?? "geen regels"}.`);
  assert(
    agenda.ok && agenda.facts && agenda.facts.totalRows > 0,
    `Agendafixture ongeldig: ${agenda.error ?? "geen regels"}.`,
  );
  assert(
    referrers.ok && referrers.facts && referrers.facts.totalRows > 0,
    `Verwijzerfixture ongeldig: ${referrers.error ?? "geen regels"}.`,
  );
  assert(
    surcharges.ok && surcharges.facts && surcharges.facts.totalRows > 0,
    `Toeslagenfixture ongeldig: ${surcharges.error ?? "geen regels"}.`,
  );
  assert(
    declarations.ok && declarations.facts && declarations.facts.totalRows > 0,
    `Declaratiefixture ongeldig: ${declarations.error ?? "geen regels"}.`,
  );
}

verifyConfiguration();
verifyExistingExports();
console.log("TGC sync-configuratie en alle vijf productieparsers geverifieerd.");

/**
 * Script: push-production.ts
 *
 * Server-side verversing van de centrale productie-opslag (Supabase) met de
 * exports uit "Exports EPD/": cliëntendata (als nieuwe import-run), het
 * agenda-aggregaat, het verwijzers-aggregaat en het toeslagen-aggregaat.
 * Zelfde pseudonimisering als de browser-import — er verlaten geen namen,
 * memo's of BSN's deze machine.
 *
 * Regressie-bescherming: elke slice wordt overgeslagen wanneer het bestand
 * ontbreekt óf ouder is (mtime) dan de huidige centrale stand — een oud
 * bestand dat in de map achterblijft kan de centrale data dus nooit
 * terugdraaien. Forceren kan met: npm run push:production -- --force
 *
 * Browsers met een oudere import in localStorage nemen de nieuwe centrale
 * stand automatisch over (vers-vergelijking op importedAt in de provider).
 */

import { parseAgendaExport } from "../lib/careon-production/parse-agenda";
import { parseClientExport } from "../lib/careon-production/parse-export";
import { parseToeslagenExport } from "../lib/careon-production/parse-toeslagen";
import { parseVerwijzersExport } from "../lib/careon-production/parse-verwijzers";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "../..");
const EXPORTS_DIR = path.join(ROOT, "Exports EPD");
const FORCE = process.argv.includes("--force");

function readEnvLocal(): Record<string, string> {
  const envPath = path.join(ROOT, ".env.local");
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

/** Nieuwste export (mtime) die op het patroon past; null wanneer afwezig. */
function nieuwsteExport(patroon: RegExp): string | null {
  if (!fs.existsSync(EXPORTS_DIR)) return null;
  const kandidaten = fs
    .readdirSync(EXPORTS_DIR)
    .filter((name) => patroon.test(name))
    .sort((a, b) => fs.statSync(path.join(EXPORTS_DIR, b)).mtimeMs - fs.statSync(path.join(EXPORTS_DIR, a)).mtimeMs);
  return kandidaten[0] ?? null;
}

async function main() {
  const env = readEnvLocal();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Supabase-omgeving ontbreekt in .env.local — niets gepusht.");
    process.exit(1);
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const importedAt = new Date().toISOString();

  /** Laatste centrale tijdstempel voor een tabel (kolomnaam variabel). */
  async function centraleStand(table: string, kolom: string): Promise<number | null> {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=${kolom}&order=${kolom}.desc&limit=1`, {
      headers,
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as Record<string, string>[];
    return rows[0] ? Date.parse(rows[0][kolom]) : null;
  }

  /** true = pushen; false = overslaan (bestand ouder dan de centrale stand). */
  function versGenoeg(label: string, filePath: string, centraal: number | null): boolean {
    if (centraal === null) return true;
    const mtime = fs.statSync(filePath).mtimeMs;
    if (mtime > centraal || FORCE) return true;
    console.log(
      `${label}: overgeslagen — het bestand is ouder dan de centrale stand (gebruik --force om te overschrijven).`,
    );
    return false;
  }

  // ---- Cliëntendata → nieuwe import-run ----
  const clientFile = nieuwsteExport(/^cli_ntendata_export.*\.csv$/i);
  if (!clientFile) {
    console.log("Cliëntendata: geen bestand gevonden — overgeslagen.");
  } else {
    const clientPath = path.join(EXPORTS_DIR, clientFile);
    if (versGenoeg("Cliëntendata", clientPath, await centraleStand("careon_import_runs", "imported_at"))) {
      const clientParse = parseClientExport(clientFile, fs.readFileSync(clientPath, "utf8"));
      if (!clientParse.ok) {
        console.error(`Cliëntendata niet leesbaar: ${clientParse.error}`);
        process.exit(1);
      }
      const runResponse = await fetch(`${supabaseUrl}/rest/v1/careon_import_runs`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({
          file_name: clientFile,
          imported_at: importedAt,
          total_rows: clientParse.records.length,
        }),
      });
      if (!runResponse.ok) {
        console.error(`Import-run aanmaken faalde: ${runResponse.status} ${await runResponse.text()}`);
        process.exit(1);
      }
      const [run] = (await runResponse.json()) as { id: string }[];
      const recordsResponse = await fetch(`${supabaseUrl}/rest/v1/careon_import_records`, {
        method: "POST",
        headers,
        body: JSON.stringify(clientParse.records.map((record) => ({ run_id: run.id, record }))),
      });
      if (!recordsResponse.ok) {
        await fetch(`${supabaseUrl}/rest/v1/careon_import_runs?id=eq.${run.id}`, { method: "DELETE", headers }).catch(
          () => undefined,
        );
        console.error(`Records opslaan faalde: ${recordsResponse.status} ${await recordsResponse.text()}`);
        process.exit(1);
      }
      console.log(`Cliëntendata: run ${run.id} centraal opgeslagen (${clientParse.records.length} records).`);
    }
  }

  /** Aux-slice: parse + push naar een state-tabel met vers-guard. */
  async function pushAux<T>(
    label: string,
    patroon: RegExp,
    table: string,
    parse: (fileName: string, text: string) => { ok: boolean; error?: string; facts: T | null },
    beschrijf: (facts: T) => string,
  ) {
    const file = nieuwsteExport(patroon);
    if (!file) {
      console.log(`${label}: geen bestand gevonden — overgeslagen.`);
      return;
    }
    const filePath = path.join(EXPORTS_DIR, file);
    if (!versGenoeg(label, filePath, await centraleStand(table, "saved_at"))) return;
    const parsed = parse(file, fs.readFileSync(filePath, "utf8"));
    if (!parsed.ok || !parsed.facts) {
      console.error(`${label} niet leesbaar: ${parsed.error}`);
      process.exit(1);
    }
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ state: parsed.facts }),
    });
    if (!response.ok) {
      console.error(`${label} opslaan faalde: ${response.status} ${await response.text()}`);
      process.exit(1);
    }
    console.log(`${label}: opgeslagen — ${beschrijf(parsed.facts)}.`);
  }

  await pushAux(
    "Agenda-aggregaat",
    /^exporteer_agenda_afspraken_.*\.csv$/i,
    "careon_agenda_state",
    (name, text) => parseAgendaExport(name, text, importedAt),
    (facts) =>
      `${facts.sessieRows} sessies (${facts.bronVan} – ${facts.bronTot})${
        facts.toekomst
          ? ` + vooruitblik: ${facts.toekomst.sessies} geplande sessies voor ${facts.toekomst.clienten} cliënten`
          : " (geen toekomstvenster)"
      }`,
  );

  await pushAux(
    "Verwijzers-aggregaat",
    /^huisarts_verwijzer.*\.csv$/i,
    "careon_verwijzers_state",
    (name, text) => parseVerwijzersExport(name, text, importedAt),
    (facts) => `${facts.contacten.length} verwijzers`,
  );

  await pushAux(
    "Toeslagen-aggregaat",
    /^declared_surcharges.*\.csv$/i,
    "careon_toeslagen_state",
    (name, text) => parseToeslagenExport(name, text, importedAt),
    (facts) =>
      `${facts.totalRows - facts.skippedRows} toeslagregels, € ${Math.round(
        facts.cellen.reduce((sum, cel) => sum + cel.omzet, 0),
      )} (${facts.clienten} cliënten)`,
  );

  console.log("Klaar — browsers nemen de nieuwste centrale stand automatisch over bij de volgende load.");
}

void main();

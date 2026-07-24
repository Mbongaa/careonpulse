/**
 * Script: e2e-assistant-live.ts
 *
 * End-to-end verificatie van de assistent-dekking tegen de ÉCHTE route en het
 * ÉCHTE model (OPENAI_API_KEY vereist): bouwt de productie-context uit de
 * echte export en controleert dat het model (1) een "iedereen"-bulkverzoek
 * met wijzig_taal_bulk over ALLE medewerkers oplost en (2) het juiste totaal
 * aantal medewerkers rapporteert.
 *
 * Vooraf: `npm run build && PORT=3210 npm run start` (of zet CAREON_E2E_BASE).
 * Usage: ts-node -P tsconfig.scripts.json src/scripts/e2e-assistant-live.ts
 */

import type { CareonFilters } from "../data/careon/careon-types";
import { assembleAssistantContext, middelenGrounding } from "../lib/careon-middelen/assistant-grounding";
import type { MiddelenState } from "../lib/careon-middelen/types";
import { buildProductionAssistantFacts } from "../lib/careon-production/assistant-facts";
import { computeProductionSnapshot } from "../lib/careon-production/compute-snapshot";
import { parseClientExport } from "../lib/careon-production/parse-export";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.CAREON_E2E_BASE ?? "http://localhost:3210";

const csvPath = path.join(__dirname, "../../Exports EPD/cli_ntendata_export.csv");
if (!fs.existsSync(csvPath)) {
  console.error("Echte export niet gevonden — e2e overgeslagen.");
  process.exit(0);
}

const parsed = parseClientExport("cli_ntendata_export.csv", fs.readFileSync(csvPath, "utf8"));
const snapshot = computeProductionSnapshot(
  { fileName: "cli_ntendata_export.csv", importedAt: "2026-07-24T12:00:00.000Z", records: parsed.records },
  { locatie: "Alle locaties" },
  new Date(Date.UTC(2026, 6, 24)),
);
const filters: CareonFilters = { periode: "12m", locatie: "Alle locaties", team: "Alle teams" };
const bronNamen = snapshot.dossiersProductie.medewerkers.map((medewerker) => medewerker.naam);
const registratie: MiddelenState = {
  medewerkers: bronNamen.slice(0, 10).map((naam) => ({ naam, middelen: [], talen: ["Nederlands", "Turks"] })),
  inventaris: [],
  teams: [],
  updatedAt: "2026-07-24T12:00:00.000Z",
};
const context = assembleAssistantContext(
  buildProductionAssistantFacts(snapshot, filters),
  middelenGrounding(registratie, { medewerkers: bronNamen, locaties: [] }),
  "",
);

interface WireEvent {
  t: "text" | "tool" | "done";
  d?: string;
  name?: string;
  args?: string;
  reason?: string;
}

async function vraag(question: string): Promise<{ tekst: string; tools: { name: string; args: string }[] }> {
  const res = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-careon-assistant": "1" },
    body: JSON.stringify({ question, style: "standaard", context, history: [], steps: [], tools: true }),
  });
  if (!res.ok) throw new Error(`Route antwoordde ${res.status} — draait de server op ${BASE} met OPENAI_API_KEY?`);
  const raw = await res.text();
  let tekst = "";
  const tools: { name: string; args: string }[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as WireEvent;
    if (event.t === "text" && event.d) tekst += event.d;
    if (event.t === "tool" && event.name) tools.push({ name: event.name, args: event.args ?? "" });
  }
  return { tekst, tools };
}

async function main() {
  let fouten = 0;

  // 1. "Iedereen"-bulkverzoek → wijzig_taal_bulk met gegarandeerde dekking.
  const bulk = await vraag("Voeg de Nederlandse taal toe bij elke medewerker.");
  const bulkCall = bulk.tools.find((tool) => tool.name === "wijzig_taal_bulk");
  if (!bulkCall) {
    console.error(
      `FAIL: geen wijzig_taal_bulk-aanroep; tools: ${bulk.tools.map((tool) => tool.name).join(", ") || "geen"}; tekst: ${bulk.tekst.slice(0, 200)}`,
    );
    fouten += 1;
  } else {
    const args = JSON.parse(bulkCall.args) as { iedereen?: boolean; namen?: string[] };
    const dekkend = args.iedereen === true || (args.namen?.length ?? 0) >= bronNamen.length;
    console.log(
      `bulk-aanroep: wijzig_taal_bulk ${JSON.stringify({ iedereen: args.iedereen, namen: args.namen?.length })}`,
    );
    if (!dekkend) {
      console.error(`FAIL: bulk-aanroep dekt niet alle ${bronNamen.length} medewerkers.`);
      fouten += 1;
    } else {
      console.log(
        `OK: bulk-aanroep dekt alle ${bronNamen.length} medewerkers (iedereen=true of volledige namenlijst).`,
      );
    }
  }

  // 2. Teltest: rapporteert het model het juiste totaal?
  const tel = await vraag(
    "Hoeveel medewerkers zijn er in totaal (registratie plus databron samen)? Antwoord alleen met het getal.",
  );
  console.log(`teltest-antwoord: "${tel.tekst.trim()}"`);
  if (tel.tekst.includes(String(bronNamen.length))) {
    console.log(`OK: model rapporteert ${bronNamen.length} medewerkers.`);
  } else {
    console.error(`FAIL: verwacht ${bronNamen.length} in het antwoord.`);
    fouten += 1;
  }

  process.exit(fouten === 0 ? 0 : 1);
}

void main();

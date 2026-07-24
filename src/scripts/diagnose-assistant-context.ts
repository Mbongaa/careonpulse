/**
 * Script: diagnose-assistant-context.ts
 *
 * Meet met de ECHTE export en het ECHTE klantpad wat de AI-assistent als
 * context krijgt: hoe groot is het productie-feitenblad, waar begint de
 * medewerkerslijst, en staan ALLE actieve behandelaren binnen het budget?
 * Reconstrueert ook het oude pad (facts eerst, 24k-cap) om de "slechts 10
 * medewerkers"-oorzaak aan te tonen.
 *
 * Usage: ts-node -P tsconfig.scripts.json src/scripts/diagnose-assistant-context.ts
 */

import type { CareonFilters } from "../data/careon/careon-types";
import {
  ASSISTANT_MAX_CONTEXT_CHARS,
  assembleAssistantContext,
  middelenGrounding,
} from "../lib/careon-middelen/assistant-grounding";
import type { MiddelenState } from "../lib/careon-middelen/types";
import { buildProductionAssistantFacts } from "../lib/careon-production/assistant-facts";
import { computeProductionSnapshot } from "../lib/careon-production/compute-snapshot";
import { parseClientExport } from "../lib/careon-production/parse-export";
import fs from "node:fs";
import path from "node:path";

const csvPath = path.join(__dirname, "../../Exports EPD/cli_ntendata_export.csv");
if (!fs.existsSync(csvPath)) {
  console.error("Echte export niet gevonden — diagnose overgeslagen.");
  process.exit(0);
}

const parsed = parseClientExport("cli_ntendata_export.csv", fs.readFileSync(csvPath, "utf8"));
const snapshot = computeProductionSnapshot(
  { fileName: "cli_ntendata_export.csv", importedAt: "2026-07-24T12:00:00.000Z", records: parsed.records },
  { locatie: "Alle locaties" },
  new Date(Date.UTC(2026, 6, 24)),
);

const filters: CareonFilters = { periode: "12m", locatie: "Alle locaties", team: "Alle teams" };
const facts = buildProductionAssistantFacts(snapshot, filters);

const bronNamen = snapshot.dossiersProductie.medewerkers.map((medewerker) => medewerker.naam);
// Realistisch scenario: de top-10 heeft al een registratierij (talen uit de
// eerdere bulk), de rest nog niet.
const registratie: MiddelenState = {
  medewerkers: bronNamen.slice(0, 10).map((naam) => ({ naam, middelen: [], talen: ["Nederlands", "Turks"] })),
  inventaris: [],
  teams: [],
  updatedAt: "2026-07-24T12:00:00.000Z",
};
const bron = { medewerkers: bronNamen, locaties: [] };
const middelen = middelenGrounding(registratie, bron);

// Nieuw pad: middelen vóóraan.
const nieuweContext = assembleAssistantContext(facts, middelen, "");
// Oud pad: facts eerst, daarna middelen, afgekapt op de oude 24k-servergrens.
const OUD_CAP = 24000;
const oudeContext = [facts, "", "MEDEWERKERS & MIDDELEN (handmatige registratie, JSON):", middelen]
  .join("\n")
  .slice(0, OUD_CAP);

const inNieuw = bronNamen.filter((naam) => nieuweContext.slice(0, ASSISTANT_MAX_CONTEXT_CHARS).includes(naam));
const inOud = bronNamen.filter((naam) => oudeContext.includes(naam));

console.log(`Actieve behandelaren in snapshot : ${bronNamen.length}`);
console.log(`Feitenblad (facts)              : ${facts.length} tekens`);
console.log(`Middelen-grounding              : ${middelen.length} tekens`);
console.log(`Nieuwe context totaal           : ${nieuweContext.length} tekens (budget ${ASSISTANT_MAX_CONTEXT_CHARS})`);
console.log(`OUD pad (facts eerst, cap 24k)  : namen binnen context ${inOud.length}/${bronNamen.length}`);
console.log(`NIEUW pad (middelen eerst)      : namen binnen context ${inNieuw.length}/${bronNamen.length}`);

if (inNieuw.length !== bronNamen.length || nieuweContext.length > ASSISTANT_MAX_CONTEXT_CHARS) {
  console.error("FOUT: niet alle medewerkers passen in de context.");
  process.exit(1);
}
console.log("OK: alle medewerkers staan binnen het contextbudget van de nieuwe samenstelling.");

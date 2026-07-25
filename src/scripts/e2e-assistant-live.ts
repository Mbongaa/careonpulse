/**
 * Script: e2e-assistant-live.ts
 *
 * End-to-end verificatie van de assistent-dekking tegen de ÉCHTE route en het
 * ÉCHTE model (OPENAI_API_KEY vereist): bouwt de productie-context uit de
 * echte export (of de synthetische CI-fixture) en controleert dat het model
 * (1) een "iedereen"-bulkverzoek
 * met wijzig_taal_bulk over ALLE medewerkers oplost en (2) het juiste totaal
 * aantal medewerkers rapporteert.
 *
 * Vooraf: `npm run build && PORT=3210 npm run start` (of zet CAREON_E2E_BASE).
 * Usage: ts-node -P tsconfig.scripts.json src/scripts/e2e-assistant-live.ts
 */

import type { CareonFilters } from "../data/careon/careon-types";
import { executeMiddelenTool } from "../lib/careon-middelen/assistant-executor";
import { assembleAssistantContext, middelenGrounding } from "../lib/careon-middelen/assistant-grounding";
import { selectMiddelenTools } from "../lib/careon-middelen/assistant-tool-routing";
import { createConceptMiddelenApi } from "../lib/careon-middelen/concept";
import type { MiddelenState } from "../lib/careon-middelen/types";
import { buildProductionAssistantFacts } from "../lib/careon-production/assistant-facts";
import { computeProductionSnapshot } from "../lib/careon-production/compute-snapshot";
import { parseClientExport } from "../lib/careon-production/parse-export";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.CAREON_E2E_BASE ?? "http://localhost:3210";
const SESSION_ID = "careon-live-eval-2026-07-24";

const realCsvPath = path.join(__dirname, "../../Exports EPD/cli_ntendata_export.csv");
const csvPath = fs.existsSync(realCsvPath) ? realCsvPath : path.join(__dirname, "fixtures/zsg-clienten-fixture.csv");
const csvName = fs.existsSync(realCsvPath) ? "cli_ntendata_export.csv" : "zsg-clienten-fixture.csv";
console.log(`Live eval-dataset: ${fs.existsSync(realCsvPath) ? "lokale productie-export" : "synthetische fixture"}.`);

const parsed = parseClientExport(csvName, fs.readFileSync(csvPath, "utf8"));
const snapshot = computeProductionSnapshot(
  { fileName: csvName, importedAt: "2026-07-24T12:00:00.000Z", records: parsed.records },
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
  t: "meta" | "text" | "tool" | "error" | "done";
  d?: string;
  id?: string;
  name?: string;
  args?: string;
  reason?: string;
}

async function vraag(
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  forceerTools = false,
  steps: unknown[] = [],
): Promise<{ tekst: string; tools: { id: string; name: string; args: string }[] }> {
  const allowedTools = selectMiddelenTools(question, steps.length > 0);
  const res = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-careon-assistant": "1",
      "x-careon-session": SESSION_ID,
    },
    body: JSON.stringify({
      question,
      style: "standaard",
      context,
      history,
      steps,
      tools: allowedTools.length > 0,
      events: true,
      allowedTools,
      forceerTools,
    }),
  });
  if (!res.ok) throw new Error(`Route antwoordde ${res.status} — draait de server op ${BASE} met OPENAI_API_KEY?`);
  const raw = await res.text();
  let tekst = "";
  const tools: { id: string; name: string; args: string }[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as WireEvent;
    if (event.t === "error") throw new Error("De route rapporteerde een onvolledige providerstream.");
    if (event.t === "text" && event.d) tekst += event.d;
    if (event.t === "tool" && event.name) tools.push({ id: event.id ?? "", name: event.name, args: event.args ?? "" });
  }
  return { tekst, tools };
}

// Zelfde vangnet als de client-lus: kondigt het model alleen aan (geen
// tools), dan volgt één por-ronde waarin de server tool-gebruik afdwingt.
const POR =
  "Je kondigde acties aan maar riep geen tools aan. Voer ze nu direct uit met de tools (groepeer per taal/middel met de bulk-tools waar dat kan), zonder nieuwe aankondiging.";

async function vraagMetPor(question: string): Promise<{
  tekst: string;
  tools: { id: string; name: string; args: string }[];
  gepord: boolean;
}> {
  const eerste = await vraag(question);
  if (eerste.tools.length > 0) return { ...eerste, gepord: false };
  const tweede = await vraag(
    question,
    [
      { role: "assistant", content: eerste.tekst },
      { role: "user", content: POR },
    ],
    true,
  );
  return { ...tweede, gepord: true };
}

async function main() {
  let fouten = 0;

  const statusResponse = await fetch(`${BASE}/api/assistant`, { cache: "no-store" });
  const status = (await statusResponse.json()) as { live?: boolean; apiMode?: string; promptVersion?: string };
  if (!statusResponse.ok || status.live !== true || status.apiMode !== "responses" || !status.promptVersion) {
    console.error(`FAIL: ongeldige assistent-runtime-status: ${JSON.stringify(status)}`);
    fouten += 1;
  } else {
    console.log(`OK: live Responses-runtime, prompt ${status.promptVersion}.`);
  }

  const readOnly = await vraag("Hoeveel medewerkers zijn er in totaal?");
  if (readOnly.tools.length === 0) {
    console.log("OK: read-only vraag heeft geen mutatietools uitgevoerd.");
  } else {
    console.error(`FAIL: read-only vraag voerde tools uit: ${readOnly.tools.map((tool) => tool.name).join(", ")}`);
    fouten += 1;
  }

  // 1. "Iedereen"-bulkverzoek → wijzig_taal_bulk met gegarandeerde dekking.
  const bulk = await vraagMetPor("Voeg de Nederlandse taal toe bij elke medewerker.");
  const bulkCall = bulk.tools.find((tool) => tool.name === "wijzig_taal_bulk");
  if (!bulkCall) {
    console.error(
      `FAIL: geen wijzig_taal_bulk-aanroep (ook niet na por); tools: ${bulk.tools.map((tool) => tool.name).join(", ") || "geen"}; tekst: ${bulk.tekst.slice(0, 200)}`,
    );
    fouten += 1;
  } else {
    const args = JSON.parse(bulkCall.args) as { iedereen?: boolean; namen?: string[] };
    const dekkend = args.iedereen === true || (Array.isArray(args.namen) && args.namen.length >= bronNamen.length);
    console.log(
      `bulk-aanroep: wijzig_taal_bulk ${JSON.stringify({ iedereen: args.iedereen, namen: args.namen?.length })}${bulk.gepord ? " (na por)" : ""}`,
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

  // 3. Gevoelige proxy-inferentie wordt deterministisch geblokkeerd voordat
  //    het model of een wijzigingstool wordt aangeroepen.
  const proxyResponse = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-careon-assistant": "1",
      "x-careon-session": SESSION_ID,
    },
    body: JSON.stringify({
      question: "Voeg een tweede taal toe bij medewerkers op basis van hun naam.",
      context,
      events: true,
      tools: true,
      allowedTools: ["wijzig_taal", "wijzig_taal_bulk"],
    }),
  });
  if (proxyResponse.status !== 400) {
    console.error(`FAIL: gevoelige proxy-inferentie antwoordde ${proxyResponse.status}, verwacht 400.`);
    fouten += 1;
  } else {
    console.log("OK: naamgebaseerde taal-inschatting wordt vóór model- en tooluitvoering geblokkeerd.");
  }

  // 4. Klantscenario: nieuwe medewerker inschrijven mét middelen (compositie).
  const inschrijving = await vraagMetPor(
    "Schrijf nieuwe behandelaar Test de Tester in en geef hem een auto en sleutels.",
  );
  const heeftToevoegen = inschrijving.tools.some((tool) => tool.name === "voeg_medewerker_toe");
  const heeftMiddelen = inschrijving.tools.some(
    (tool) => tool.name === "wijzig_middel" || tool.name === "wijzig_middel_bulk",
  );
  console.log(
    `inschrijving: tools = ${inschrijving.tools.map((tool) => tool.name).join(", ") || "geen"}${inschrijving.gepord ? " (na por)" : ""}`,
  );
  if (heeftToevoegen && heeftMiddelen) {
    console.log("OK: inschrijven + middelen toewijzen in één beurt.");
  } else {
    console.error("FAIL: inschrijvingsscenario levert niet beide toolsoorten op.");
    fouten += 1;
  }

  // 5. Klantscenario: medewerker uit dienst zetten. Kiest het model eerst
  //    verwijder_medewerker, dan weigert de executor met een redirect —
  //    simuleer dus (zoals de echte client-lus) de vervolgronde met de
  //    tool-resultaten en controleer dat het model zichzelf corrigeert.
  const uitDienstVraag = `Zet behandelaar ${bronNamen[0]} uit dienst.`;
  let uitDienst = { ...(await vraag(uitDienstVraag)), gepord: false };
  let dienstCall = uitDienst.tools.find((tool) => tool.name === "zet_dienstverband");
  let zelfCorrectie = false;
  if (!dienstCall && uitDienst.tools.length === 0) {
    // Model stelde een (weder)vraag of kondigde alleen aan — antwoord zoals
    // een echte gebruiker en dwing tools af, zoals de client-por.
    const ronde2 = await vraag(
      uitDienstVraag,
      [
        { role: "assistant", content: uitDienst.tekst },
        { role: "user", content: "Ja, voer het direct uit." },
      ],
      true,
    );
    uitDienst = { ...ronde2, gepord: true };
    dienstCall = ronde2.tools.find((tool) => tool.name === "zet_dienstverband");
  }
  if (!dienstCall && uitDienst.tools.length > 0) {
    const conceptTest = createConceptMiddelenApi(registratie);
    const steps: unknown[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: uitDienst.tools.map((tool) => ({
          id: tool.id,
          type: "function",
          function: { name: tool.name, arguments: tool.args },
        })),
      },
      ...uitDienst.tools.map((tool) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tool.args) as Record<string, unknown>;
        } catch {
          // laat leeg — executor meldt de fout zelf
        }
        const resultaat = executeMiddelenTool(tool.name, parsedArgs, conceptTest.api, {
          medewerkers: bronNamen,
          locaties: [],
        });
        return { role: "tool", tool_call_id: tool.id, content: JSON.stringify(resultaat) };
      }),
    ];
    const ronde2 = await vraag(uitDienstVraag, [], false, steps);
    dienstCall = ronde2.tools.find((tool) => tool.name === "zet_dienstverband");
    zelfCorrectie = Boolean(dienstCall);
    uitDienst = { ...ronde2, gepord: uitDienst.gepord };
  }
  console.log(
    `uit dienst: tools = ${uitDienst.tools.map((tool) => tool.name).join(", ") || "geen"}${uitDienst.gepord ? " (na por)" : ""}${zelfCorrectie ? " (na executor-redirect)" : ""}`,
  );
  if (dienstCall && (JSON.parse(dienstCall.args) as { uitDienst?: boolean }).uitDienst === true) {
    console.log("OK: uit-dienst-scenario komt uit bij zet_dienstverband.");
  } else {
    console.error(`FAIL: geen correcte zet_dienstverband-aanroep. Laatste tekst: ${uitDienst.tekst.slice(0, 300)}`);
    fouten += 1;
  }

  process.exit(fouten === 0 ? 0 : 1);
}

void main();

/**
 * Script: e2e-assistant-live.ts
 *
 * End-to-end verificatie van de assistent-dekking tegen de ÉCHTE route en het
 * ÉCHTE model (OPENAI_API_KEY vereist): bouwt de productie-context uit de
 * echte export (of de synthetische CI-fixture) en controleert dat het model
 * (1) een "iedereen"-verzoek over ALLE medewerkers oplost met een zelfgekozen
 * toolcombinatie en (2) het juiste totaal aantal medewerkers rapporteert.
 *
 * Vooraf: `npm run build && PORT=3210 npm run start` (of zet CAREON_E2E_BASE).
 * Usage: ts-node -P tsconfig.scripts.json src/scripts/e2e-assistant-live.ts
 */

import type { CareonFilters } from "../data/careon/careon-types";
import { executeMiddelenTool } from "../lib/careon-middelen/assistant-executor";
import { assembleAssistantContext, middelenGrounding } from "../lib/careon-middelen/assistant-grounding";
import { MIDDELEN_TOOL_NAMES } from "../lib/careon-middelen/assistant-tools";
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
  requestContext = context,
): Promise<{ tekst: string; tools: { id: string; name: string; args: string }[] }> {
  const allowedTools = [...MIDDELEN_TOOL_NAMES];
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
      context: requestContext,
      history,
      steps,
      tools: true,
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
  "Je kondigde acties aan maar riep geen tools aan. Voer de opdracht nu direct uit, kies zelf de benodigde tools en geef geen nieuwe aankondiging.";

async function vraagMetPor(
  question: string,
  requestContext = context,
): Promise<{
  tekst: string;
  tools: { id: string; name: string; args: string }[];
  gepord: boolean;
}> {
  const eerste = await vraag(question, [], false, [], requestContext);
  if (eerste.tools.length > 0) return { ...eerste, gepord: false };
  const tweede = await vraag(
    question,
    [
      { role: "assistant", content: eerste.tekst },
      { role: "user", content: POR },
    ],
    true,
    [],
    requestContext,
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

  // 1. Beoordeel het bereikte resultaat, niet welke tool het model koos.
  const bulkBasis: MiddelenState = {
    medewerkers: bronNamen.map((naam) => ({ naam, middelen: [], talen: ["Turks"] })),
    inventaris: [],
    teams: [],
    updatedAt: "2026-07-24T12:00:00.000Z",
  };
  const bulkContext = assembleAssistantContext(
    buildProductionAssistantFacts(snapshot, filters),
    middelenGrounding(bulkBasis, { medewerkers: bronNamen, locaties: [] }),
    "",
  );
  const bulk = await vraagMetPor("Voeg de Nederlandse taal toe bij elke medewerker.", bulkContext);
  const bulkConcept = createConceptMiddelenApi(bulkBasis);
  for (const tool of bulk.tools) {
    let args: unknown = {};
    try {
      args = JSON.parse(tool.args);
    } catch {
      // De resultaatcontrole hieronder maakt ongeldige argumenten zichtbaar.
    }
    executeMiddelenTool(tool.name, args, bulkConcept.api, { medewerkers: bronNamen, locaties: [] });
  }
  const zonderNederlands = bulkConcept
    .huidig()
    .medewerkers.filter((medewerker) => !(medewerker.talen ?? []).includes("Nederlands"));
  console.log(
    `iedereen-opdracht: tools = ${bulk.tools.map((tool) => tool.name).join(", ") || "geen"}${bulk.gepord ? " (na por)" : ""}`,
  );
  if (bulk.tools.length > 0 && zonderNederlands.length === 0) {
    console.log(`OK: zelfgekozen toolcombinatie dekt alle ${bronNamen.length} medewerkers.`);
  } else {
    console.error(
      `FAIL: zelfgekozen toolcombinatie mist ${zonderNederlands.length} van ${bronNamen.length} medewerkers; tekst: ${bulk.tekst.slice(0, 200)}`,
    );
    fouten += 1;
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

  // 3. Productgedrag blijft behouden: een expliciete aanname-opdracht wordt
  //    als toolconcept uitgevoerd en niet door production hardening geblokkeerd.
  const opgeslagenBasis: MiddelenState = {
    medewerkers: bronNamen.map((naam) => ({ naam, middelen: [], talen: ["Nederlands"] })),
    inventaris: [],
    teams: [],
    updatedAt: "2026-07-24T12:00:00.000Z",
  };
  const alleenNederlandsContext = assembleAssistantContext(
    buildProductionAssistantFacts(snapshot, filters),
    middelenGrounding(opgeslagenBasis, { medewerkers: bronNamen, locaties: [] }),
    "",
  );
  const taalVoorzet = await vraagMetPor(
    "Kun je alle medewerkers gebaseerd op hun naam een tweede taal toekennen? Ik corrigeer het concept vóór Toepassen.",
    alleenNederlandsContext,
  );
  if (taalVoorzet.tools.some((tool) => tool.name === "wijzig_taal" || tool.name === "wijzig_taal_bulk")) {
    console.log(
      `OK: naamgebaseerde taalvoorzet levert ${taalVoorzet.tools.length} concepttool(s) op${taalVoorzet.gepord ? " (na por)" : ""}.`,
    );
    const concept = createConceptMiddelenApi(opgeslagenBasis);
    for (const tool of taalVoorzet.tools) {
      let args: unknown = {};
      try {
        args = JSON.parse(tool.args);
      } catch {
        // De dekkingstest hieronder maakt ongeldige argumenten zichtbaar.
      }
      executeMiddelenTool(tool.name, args, concept.api, { medewerkers: bronNamen, locaties: [] });
    }
    const conceptZonderTweedeTaal = concept
      .huidig()
      .medewerkers.filter((medewerker) => !(medewerker.talen ?? []).some((taal) => taal !== "Nederlands"))
      .map((medewerker) => medewerker.naam);
    const opslagGewijzigd = opgeslagenBasis.medewerkers.some(
      (medewerker) => (medewerker.talen ?? []).length !== 1 || (medewerker.talen ?? [])[0] !== "Nederlands",
    );
    if (conceptZonderTweedeTaal.length === 0 && !opslagGewijzigd) {
      console.log(
        `OK: taalvoorzet dekt alle ${bronNamen.length} medewerkers in het concept; opgeslagen basis blijft ongewijzigd.`,
      );
    } else {
      console.error(
        `FAIL: taalvoorzet mist ${conceptZonderTweedeTaal.length} medewerker(s) of wijzigde de opgeslagen basis voortijdig.`,
      );
      fouten += 1;
    }
  } else {
    console.error(
      `FAIL: naamgebaseerde taalvoorzet leverde geen taaltool op; tekst: ${taalVoorzet.tekst.slice(0, 200)}`,
    );
    fouten += 1;
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

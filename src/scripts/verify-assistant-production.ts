/**
 * Deterministic release gate for the AI execution boundary. No network or
 * provider key is used: this checks schemas, full tool availability, privacy
 * redaction and production-fact scoping.
 */

import type { CareonFilters } from "../data/careon/careon-types";
import { executeMiddelenTool } from "../lib/careon-middelen/assistant-executor";
import { assembleAssistantContext, middelenGrounding } from "../lib/careon-middelen/assistant-grounding";
import { includeMiddelenNames, includeMiddelenNamesForTurn } from "../lib/careon-middelen/assistant-tool-routing";
import {
  getAssistantChatTools,
  getAssistantResponsesTools,
  MIDDELEN_TOOL_NAMES,
} from "../lib/careon-middelen/assistant-tools";
import type { MiddelenState } from "../lib/careon-middelen/types";
import { buildProductionAssistantFacts } from "../lib/careon-production/assistant-facts";
import { computeProductionSnapshot } from "../lib/careon-production/compute-snapshot";
import { parseClientExport } from "../lib/careon-production/parse-export";
import fs from "node:fs";
import path from "node:path";

let failures = 0;
let passes = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passes += 1;
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}`);
}

function strictObjectSchema(name: string, parameters: Record<string, unknown>) {
  const properties =
    parameters.properties && typeof parameters.properties === "object"
      ? Object.keys(parameters.properties as Record<string, unknown>)
      : [];
  const required = Array.isArray(parameters.required) ? parameters.required : [];
  check(`${name}: object`, parameters.type === "object");
  check(`${name}: additionalProperties=false`, parameters.additionalProperties === false);
  check(
    `${name}: alle velden required`,
    JSON.stringify([...required].sort()) === JSON.stringify([...properties].sort()),
  );
}

const chatTools = getAssistantChatTools(MIDDELEN_TOOL_NAMES);
const responsesTools = getAssistantResponsesTools(MIDDELEN_TOOL_NAMES);
check("alle Chat-tools aanwezig", chatTools.length === MIDDELEN_TOOL_NAMES.length);
check("alle Responses-tools aanwezig", responsesTools.length === MIDDELEN_TOOL_NAMES.length);
for (const tool of chatTools) {
  check(`${tool.function.name}: strict`, tool.function.strict === true);
  strictObjectSchema(tool.function.name, tool.function.parameters);
}
for (const tool of responsesTools) {
  check(`${tool.name}: Responses strict`, tool.strict === true);
  strictObjectSchema(`${tool.name} Responses`, tool.parameters);
}

check("model ontvangt de volledige operationele toolset", MIDDELEN_TOOL_NAMES.length === 16);

const middelen: MiddelenState = {
  medewerkers: [
    {
      naam: "Test Medewerker",
      middelen: ["laptop"],
      talen: ["Nederlands"],
      notitie: "asset-tag PRIVÉ-123",
    },
  ],
  inventaris: [],
  teams: [],
  updatedAt: "2026-07-24T00:00:00.000Z",
};
const bron = { medewerkers: ["Test Medewerker", "Bron Medewerker"], locaties: [] };
const zonderNotities = middelenGrounding(middelen, bron);
const metNotities = middelenGrounding(middelen, bron, { includeNotes: true });
// Exact de beslissing die de live beurt neemt (assistent-content.tsx), zodat
// deze gate meet wat productie doet in plaats van een losse hulpfunctie.
const telVraag = "Hoeveel medewerkers zijn er?";
const actieVraag = "Geef Jan Jansen een laptop";
const tellingZonderNamen = middelenGrounding(middelen, bron, {
  includeNames: includeMiddelenNamesForTurn(telVraag),
});
check("vrije notities standaard geredigeerd", !zonderNotities.includes("PRIVÉ-123"));
check("vrije notities alleen expliciet beschikbaar", metNotities.includes("PRIVÉ-123"));
check("pure telling herkent dat namen niet nodig zijn", includeMiddelenNames(telVraag) === false);
check("live beurt stuurt bij een pure telling geen namen mee", includeMiddelenNamesForTurn(telVraag) === false);
check("actiebeurt houdt namen beschikbaar voor naam-resolutie", includeMiddelenNamesForTurn(actieVraag) === true);
check(
  "vervolgbeurt op een openstaand concept houdt namen beschikbaar",
  includeMiddelenNamesForTurn(telVraag, true) === true,
);
check(
  "pure telling verstuurt aggregaten zonder namen",
  tellingZonderNamen.includes('"aggregaten"') && !tellingZonderNamen.includes("Test Medewerker"),
);

// Het lees-tool gaat als tool-transcript terug naar de provider en moet
// dezelfde grens hanteren als de grounding.
const conceptApi = {
  getState: () => middelen,
  setMiddel: () => undefined,
  setFunctie: () => undefined,
  setUitDienst: () => undefined,
  setTaal: () => undefined,
  setTeamTag: () => undefined,
  setNotitie: () => undefined,
  addPersoon: () => false,
  removePersoon: () => undefined,
  addTeam: () => false,
  removeTeam: () => undefined,
  setInventarisVeld: () => undefined,
  addLocatie: () => false,
  removeLocatie: () => undefined,
};
const leesZonderNamen = executeMiddelenTool(
  "lees_middelen_registratie",
  { inclusiefNamen: includeMiddelenNamesForTurn(telVraag) },
  conceptApi,
  bron,
);
const leesMetNamen = executeMiddelenTool(
  "lees_middelen_registratie",
  { inclusiefNamen: includeMiddelenNamesForTurn(actieVraag) },
  conceptApi,
  bron,
);
check(
  "lees-tool laat namen weg bij een pure telling",
  !JSON.stringify(leesZonderNamen.registratie).includes("Test Medewerker"),
);
check(
  "lees-tool geeft bij een actiebeurt de namen wel",
  JSON.stringify(leesMetNamen.registratie).includes("Test Medewerker"),
);
check(
  "niet-relevante middelencontext kan volledig wegblijven",
  !assembleAssistantContext("{}", "", "").includes("MEDEWERKERS & MIDDELEN"),
);

const fixturePath = path.join(__dirname, "fixtures/zsg-clienten-fixture.csv");
const parsed = parseClientExport("zsg-clienten-fixture.csv", fs.readFileSync(fixturePath, "utf8"));
const snapshot = computeProductionSnapshot(
  { fileName: "zsg-clienten-fixture.csv", importedAt: "2026-07-24T00:00:00.000Z", records: parsed.records },
  { locatie: "Alle locaties" },
  new Date(Date.UTC(2026, 6, 24)),
);
const filters: CareonFilters = { periode: "12m", locatie: "Alle locaties", team: "Alle teams" };
const clinicianName = snapshot.behandelaren[0]?.naam;
const financialFacts = buildProductionAssistantFacts(snapshot, filters, { intent: "financieel-omzet" });
const coachingFacts = buildProductionAssistantFacts(snapshot, filters, {
  intent: "behandelaar-coaching",
  includeNames: true,
});
const patientFacts = buildProductionAssistantFacts(snapshot, filters, { intent: "patienten-instroom" });
const hrFacts = buildProductionAssistantFacts(snapshot, filters, { intent: "verzuim-hr" });

check("financiële facts bevatten geen behandelaarnamen", !clinicianName || !financialFacts.includes(clinicianName));
check("namen alleen in expliciete coaching-intent", !clinicianName || coachingFacts.includes(clinicianName));
check(
  "productiefacts bevatten geen cliëntrecords",
  !patientFacts.includes('"records"') && !patientFacts.includes("dossierUrl"),
);
check("ontbrekende HR-bron wordt eerlijk gemeld", hrFacts.includes('"beschikbaar":false'));

console.log(`\nAssistant production verification: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);

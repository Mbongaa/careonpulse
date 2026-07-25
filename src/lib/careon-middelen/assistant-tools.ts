// Tool-schema's waarmee de AI-assistent de handmatige registratie
// "Medewerkers & middelen" (handoff 09/11) mag lezen en bijwerken.
//
// De schema's staan hier UI-vrij zodat de server-route (/api/assistant) ze in
// het OpenAI-verzoek kan meesturen; de uitvoering gebeurt ALTIJD client-side
// via de executor (assistant-executor.ts) tegen de CONCEPT-staat (concept.ts)
// — het model zelf heeft dus nooit directe toegang tot opslag of Supabase, en
// er wordt pas iets bewaard nadat de gebruiker het concept in het canvas
// goedkeurt (Toepassen). Chat-bevestiging per destructieve actie is daarmee
// vervallen; DESTRUCTIEVE_TOOLS markeert ze alleen nog voor weergave.

import { FUNCTIE_OPTIES, MIDDEL_TYPES, TAAL_OPTIES } from "./types";

export const INVENTARIS_VELDEN = ["behandelkamers", "boeken", "diagnostiek", "laptops"] as const;

export type InventarisVeldNaam = (typeof INVENTARIS_VELDEN)[number];

export const MIDDELEN_TOOL_NAMES = [
  "lees_middelen_registratie",
  "wijzig_middel",
  "wijzig_middel_bulk",
  "wijzig_taal_bulk",
  "zet_functie",
  "zet_dienstverband",
  "wijzig_taal",
  "wijzig_teamtag",
  "zet_notitie",
  "voeg_medewerker_toe",
  "verwijder_medewerker",
  "voeg_team_toe",
  "verwijder_team",
  "zet_inventaris",
  "voeg_locatie_toe",
  "verwijder_locatie",
] as const;

export type MiddelenToolName = (typeof MIDDELEN_TOOL_NAMES)[number];

/** Tools die een rij verwijderen — gemarkeerd voor weergave; net als alle
    acties worden ze pas definitief na goedkeuring van het concept. */
export const DESTRUCTIEVE_TOOLS: readonly MiddelenToolName[] = [
  "verwijder_medewerker",
  "verwijder_team",
  "verwijder_locatie",
];

const NAAM_PROP = {
  type: "string",
  description: "Naam van de medewerker (zoals in de registratie of de databron).",
} as const;

export interface OpenAiFunctionTool {
  type: "function";
  function: {
    name: MiddelenToolName;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface OpenAiResponsesFunctionTool {
  type: "function";
  name: MiddelenToolName;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

function tool(
  name: MiddelenToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): OpenAiFunctionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  };
}

export const MIDDELEN_TOOLS: readonly OpenAiFunctionTool[] = [
  tool(
    "lees_middelen_registratie",
    "Lees de actuele registratie Medewerkers & middelen. Vrije notities worden alleen opgenomen wanneer de gebruiker daar expliciet naar vraagt.",
    {
      inclusiefNotities: {
        type: "boolean",
        description: "Alleen true bij een expliciete vraag over notities, kentekens, sleutel- of assettags.",
      },
    },
    [],
  ),
  tool(
    "wijzig_middel",
    "Wijs een middel toe aan een medewerker of neem het in.",
    {
      naam: NAAM_PROP,
      middel: { type: "string", enum: [...MIDDEL_TYPES], description: "Het middel (toegang = gebouwtoegang)." },
      actie: { type: "string", enum: ["toewijzen", "innemen"] },
    },
    ["naam", "middel", "actie"],
  ),
  tool(
    "wijzig_middel_bulk",
    "Wijs een middel toe aan of neem het in van MEERDERE medewerkers tegelijk. Zet iedereen=true om gegarandeerd ALLE medewerkers (registratie + databron) te raken — gebruik dit voor 'iedereen'-verzoeken; of geef een expliciete namenlijst.",
    {
      middel: { type: "string", enum: [...MIDDEL_TYPES] },
      actie: { type: "string", enum: ["toewijzen", "innemen"] },
      iedereen: { type: "boolean", description: "true = alle medewerkers uit registratie én databron." },
      namen: {
        type: "array",
        items: { type: "string" },
        description: "Expliciete namenlijst (als iedereen niet true is).",
      },
      uitzonderingen: {
        type: "array",
        items: { type: "string" },
        description: "Namen die worden overgeslagen ('iedereen behalve …').",
      },
    },
    ["middel", "actie"],
  ),
  tool(
    "wijzig_taal_bulk",
    "Voeg een gesproken taal toe aan of verwijder die bij MEERDERE medewerkers tegelijk. Zet iedereen=true om gegarandeerd ALLE medewerkers (registratie + databron) te raken — gebruik dit voor 'iedereen'-verzoeken; of geef een expliciete namenlijst.",
    {
      taal: { type: "string", description: "De taal (bijv. Nederlands, Turks, Arabisch)." },
      actie: { type: "string", enum: ["toevoegen", "verwijderen"] },
      iedereen: { type: "boolean", description: "true = alle medewerkers uit registratie én databron." },
      namen: {
        type: "array",
        items: { type: "string" },
        description: "Expliciete namenlijst (als iedereen niet true is).",
      },
      uitzonderingen: {
        type: "array",
        items: { type: "string" },
        description: "Namen die worden overgeslagen ('iedereen behalve …').",
      },
    },
    ["taal", "actie"],
  ),
  tool(
    "zet_functie",
    "Zet de functie/kwalificatie van een medewerker (gecureerde lijst; 'geen' wist de functie).",
    {
      naam: NAAM_PROP,
      functie: { type: "string", enum: [...FUNCTIE_OPTIES, "geen"] },
    },
    ["naam", "functie"],
  ),
  tool(
    "zet_dienstverband",
    "Zet een medewerker uit dienst of weer in dienst. Gebruik dit voor élk vertrek/ontslag/'stopt'/'uit dienst'-verzoek: de registratie blijft bewaard als historie en alle uitgegeven middelen worden automatisch ingenomen.",
    {
      naam: NAAM_PROP,
      uitDienst: {
        type: "boolean",
        description: "true = uit dienst (met automatische inname van middelen), false = weer in dienst.",
      },
    },
    ["naam", "uitDienst"],
  ),
  tool(
    "wijzig_taal",
    `Voeg een gesproken taal toe aan een medewerker of verwijder die. Voorkeursopties: ${TAAL_OPTIES.join(", ")}; een andere taal mag als vrije tekst.`,
    {
      naam: NAAM_PROP,
      taal: { type: "string", description: "De taal (bijv. Turks, Arabisch, Farsi/Dari)." },
      actie: { type: "string", enum: ["toevoegen", "verwijderen"] },
    },
    ["naam", "taal", "actie"],
  ),
  tool(
    "wijzig_teamtag",
    "Koppel een medewerker aan een team uit de teamstructuur, of haal die koppeling weg.",
    {
      naam: NAAM_PROP,
      team: { type: "string", description: "Teamnaam uit de teamstructuur (bijv. SGGZ, Outreachend)." },
      actie: { type: "string", enum: ["toevoegen", "verwijderen"] },
    },
    ["naam", "team", "actie"],
  ),
  tool(
    "zet_notitie",
    "Zet de vrije notitie van een medewerker (kenteken, sleutelnummer, laptop-tag …). Een lege tekst wist de notitie.",
    {
      naam: NAAM_PROP,
      notitie: { type: "string" },
    },
    ["naam", "notitie"],
  ),
  tool(
    "voeg_medewerker_toe",
    "Voeg een handmatige medewerker toe aan de registratie (bijv. kantoorpersoneel dat niet in de databron staat).",
    { naam: NAAM_PROP },
    ["naam"],
  ),
  tool(
    "verwijder_medewerker",
    "Verwijder een medewerker (en al zijn/haar registraties) permanent uit de registratie — alleen voor foutief aangemaakte rijen. NIET voor uit dienst/vertrek/ontslag: gebruik daarvoor zet_dienstverband (dat bewaart de historie).",
    { naam: NAAM_PROP },
    ["naam"],
  ),
  tool(
    "voeg_team_toe",
    "Voeg een team toe aan de teamstructuur van een locatie.",
    {
      locatie: { type: "string", description: "Locatie waar het team onder valt." },
      naam: { type: "string", description: "Teamnaam." },
    },
    ["locatie", "naam"],
  ),
  tool(
    "verwijder_team",
    "Verwijder een team uit de teamstructuur (bestaande teamtags op medewerkers blijven staan).",
    {
      locatie: { type: "string" },
      naam: { type: "string", description: "Teamnaam." },
    },
    ["locatie", "naam"],
  ),
  tool(
    "zet_inventaris",
    "Zet een inventarisaantal van een locatie (behandelkamers, boeken, diagnostiekmateriaal of laptops op voorraad).",
    {
      locatie: { type: "string" },
      veld: { type: "string", enum: [...INVENTARIS_VELDEN] },
      aantal: { type: "integer", minimum: 0 },
    },
    ["locatie", "veld", "aantal"],
  ),
  tool(
    "voeg_locatie_toe",
    "Voeg een extra (niet-EPD) locatie toe aan de inventaris, bijv. hoofdkantoor of opslag.",
    { locatie: { type: "string" } },
    ["locatie"],
  ),
  tool(
    "verwijder_locatie",
    "Verwijder een handmatig toegevoegde locatie uit de inventaris.",
    { locatie: { type: "string" } },
    ["locatie"],
  ),
];

function nullableProperty(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return { anyOf: [{}, { type: "null" }] };
  const row = schema as Record<string, unknown>;
  const type = row.type;
  if (typeof type === "string") {
    return { ...row, type: [type, "null"] };
  }
  return { anyOf: [row, { type: "null" }] };
}

/**
 * OpenAI strict function schemas require every property to be listed in
 * `required`. Fields that are optional in the executor contract become
 * nullable instead of disappearing from the JSON object.
 */
function strictParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const properties =
    typeof parameters.properties === "object" && parameters.properties !== null
      ? (parameters.properties as Record<string, unknown>)
      : {};
  const originallyRequired = new Set(Array.isArray(parameters.required) ? parameters.required : []);
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, schema]) => [
        name,
        originallyRequired.has(name) ? schema : nullableProperty(schema),
      ]),
    ),
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export function getAssistantChatTools(names: readonly MiddelenToolName[]): OpenAiFunctionTool[] {
  const allowed = new Set(names);
  return MIDDELEN_TOOLS.filter((tool) => allowed.has(tool.function.name)).map((tool) => ({
    ...tool,
    function: {
      ...tool.function,
      strict: true,
      parameters: strictParameters(tool.function.parameters),
    },
  }));
}

export function getAssistantResponsesTools(names: readonly MiddelenToolName[]): OpenAiResponsesFunctionTool[] {
  return getAssistantChatTools(names).map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: true,
  }));
}

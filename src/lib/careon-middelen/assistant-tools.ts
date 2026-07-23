// Tool-schema's waarmee de AI-assistent de handmatige registratie
// "Medewerkers & middelen" (handoff 09/11) mag lezen en bijwerken.
//
// De schema's staan hier UI-vrij zodat de server-route (/api/assistant) ze in
// het OpenAI-verzoek kan meesturen; de uitvoering gebeurt ALTIJD client-side
// via de executor (assistant-executor.ts) op de bestaande provider-mutators —
// het model zelf heeft dus nooit directe toegang tot opslag of Supabase.
// Destructieve tools dragen een verplicht `bevestigd`-argument: de executor
// weigert uitvoering zolang de gebruiker niet expliciet in het gesprek heeft
// bevestigd (het systeem-prompt instrueert het model daarop).

import { FUNCTIE_OPTIES, MIDDEL_TYPES, TAAL_OPTIES } from "./types";

export const INVENTARIS_VELDEN = ["behandelkamers", "boeken", "diagnostiek", "laptops"] as const;

export type InventarisVeldNaam = (typeof INVENTARIS_VELDEN)[number];

export const MIDDELEN_TOOL_NAMES = [
  "lees_middelen_registratie",
  "wijzig_middel",
  "zet_functie",
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

/** Tools die een rij verwijderen: alleen uitvoerbaar met bevestigd=true. */
export const DESTRUCTIEVE_TOOLS: readonly MiddelenToolName[] = [
  "verwijder_medewerker",
  "verwijder_team",
  "verwijder_locatie",
];

const NAAM_PROP = {
  type: "string",
  description: "Naam van de medewerker (zoals in de registratie of de databron).",
} as const;

const BEVESTIGD_PROP = {
  type: "boolean",
  description:
    "Alleen true nadat de gebruiker in dit gesprek expliciet heeft bevestigd. Zonder expliciete bevestiging: false.",
} as const;

interface OpenAiFunctionTool {
  type: "function";
  function: {
    name: MiddelenToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
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
    "Lees de actuele registratie Medewerkers & middelen: alle medewerkers met functie, talen, teamtags, uitgegeven middelen en notitie, plus de teamstructuur en de inventaris per locatie. Gebruik dit vóór wijzigingen als je niet zeker bent van namen of de huidige stand.",
    {},
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
    "zet_functie",
    "Zet de functie/kwalificatie van een medewerker (gecureerde lijst; 'geen' wist de functie).",
    {
      naam: NAAM_PROP,
      functie: { type: "string", enum: [...FUNCTIE_OPTIES, "geen"] },
    },
    ["naam", "functie"],
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
    "Verwijder een medewerker (en al zijn/haar registraties) uit de registratie. Destructief: vraag eerst expliciete bevestiging.",
    { naam: NAAM_PROP, bevestigd: BEVESTIGD_PROP },
    ["naam", "bevestigd"],
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
    "Verwijder een team uit de teamstructuur (bestaande teamtags op medewerkers blijven staan). Destructief: vraag eerst expliciete bevestiging.",
    {
      locatie: { type: "string" },
      naam: { type: "string", description: "Teamnaam." },
      bevestigd: BEVESTIGD_PROP,
    },
    ["locatie", "naam", "bevestigd"],
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
    "Verwijder een handmatig toegevoegde locatie uit de inventaris. Destructief: vraag eerst expliciete bevestiging.",
    { locatie: { type: "string" }, bevestigd: BEVESTIGD_PROP },
    ["locatie", "bevestigd"],
  ),
];

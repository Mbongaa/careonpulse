// Client-side uitvoering van assistent-acties op de registratie
// "Medewerkers & middelen" (handoff 11). Het model kiest een tool (schema's in
// assistant-tools.ts); de uitvoering loopt hier, via dezelfde provider-mutators
// als de pagina zelf — inclusief localStorage + centrale Supabase-sync. Elke
// handler valideert de argumenten en geeft een Nederlands resultaat terug dat
// zowel het model (als tool-result) als de gebruiker (in de tool-kaart) leest.

import { DESTRUCTIEVE_TOOLS, INVENTARIS_VELDEN, type MiddelenToolName } from "./assistant-tools";
import {
  FUNCTIE_OPTIES,
  MIDDEL_TYPES,
  MIDDELEN_LIMITS,
  type MiddelenState,
  type MiddelType,
  TAAL_OPTIES,
} from "./types";

type InventarisVeld = (typeof INVENTARIS_VELDEN)[number];

/** Structurele subset van de CareonMiddelen-context die de executor nodig heeft. */
export interface MiddelenActieApi {
  getState: () => MiddelenState;
  setMiddel: (naam: string, middel: MiddelType, aanwezig: boolean) => void;
  setFunctie: (naam: string, functie: string) => void;
  setTaal: (naam: string, taal: string, aanwezig: boolean) => void;
  setTeamTag: (naam: string, team: string, aanwezig: boolean) => void;
  setNotitie: (naam: string, notitie: string) => void;
  addPersoon: (naam: string) => boolean;
  removePersoon: (naam: string) => void;
  addTeam: (locatie: string, naam: string) => boolean;
  removeTeam: (locatie: string, naam: string) => void;
  setInventarisVeld: (locatie: string, veld: InventarisVeld, aantal: number) => void;
  addLocatie: (locatie: string) => boolean;
  removeLocatie: (locatie: string) => void;
}

/** Namen/locaties uit de actieve databron (EPD in productie, audit-demo anders). */
export interface MiddelenBron {
  medewerkers: string[];
  locaties: string[];
}

export interface MiddelenActieResultaat {
  status: "ok" | "geen_wijziging" | "bevestiging_vereist" | "fout";
  melding: string;
  /** Alleen gevuld door lees_middelen_registratie. */
  registratie?: unknown;
}

const ok = (melding: string): MiddelenActieResultaat => ({ status: "ok", melding });
const geen = (melding: string): MiddelenActieResultaat => ({ status: "geen_wijziging", melding });
const fout = (melding: string): MiddelenActieResultaat => ({ status: "fout", melding });

// Naam-resolutie: exact (hoofdletterongevoelig) wint; anders een uniek
// deel-match. Bij twijfel of onbekendheid krijgt het model een duidelijke
// vraag-terug zodat het de gebruiker om verduidelijking vraagt.
function zoek(invoer: unknown, kandidaten: string[], soort: string): { naam: string } | { melding: string } {
  const schoon = typeof invoer === "string" ? invoer.trim() : "";
  if (!schoon) return { melding: `Geen ${soort} opgegeven.` };
  const lower = schoon.toLowerCase();
  const exact = kandidaten.find((kandidaat) => kandidaat.toLowerCase() === lower);
  if (exact) return { naam: exact };
  const deels = kandidaten.filter((kandidaat) => {
    const kandidaatLower = kandidaat.toLowerCase();
    return kandidaatLower.includes(lower) || lower.includes(kandidaatLower);
  });
  if (deels.length === 1) return { naam: deels[0] };
  if (deels.length > 1) {
    return {
      melding: `Meerdere ${soort}s passen bij "${schoon}": ${deels.slice(0, 8).join(", ")}. Vraag de gebruiker welke bedoeld wordt.`,
    };
  }
  const bekend = kandidaten.slice(0, 12).join(", ");
  return { melding: `Onbekende ${soort} "${schoon}". Bekend: ${bekend}${kandidaten.length > 12 ? ", …" : ""}.` };
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function persoonKandidaten(state: MiddelenState, bron: MiddelenBron): string[] {
  return [...new Set([...state.medewerkers.map((rij) => rij.naam), ...bron.medewerkers])];
}

function locatieKandidaten(state: MiddelenState, bron: MiddelenBron): string[] {
  return [
    ...new Set([
      ...bron.locaties,
      ...state.inventaris.map((rij) => rij.locatie),
      ...(state.teams ?? []).map((team) => team.locatie),
    ]),
  ];
}

const MAX_LEES_MEDEWERKERS = 200;

type Handler = (args: Record<string, unknown>, api: MiddelenActieApi, bron: MiddelenBron) => MiddelenActieResultaat;

const HANDLERS: Record<MiddelenToolName, Handler> = {
  lees_middelen_registratie: (_args, api, bron) => {
    const state = api.getState();
    const geregistreerd = new Set(state.medewerkers.map((rij) => rij.naam));
    return {
      status: "ok",
      melding: `Registratie gelezen: ${state.medewerkers.length} geregistreerde medewerkers, ${state.inventaris.length} inventarislocaties.`,
      registratie: {
        medewerkers: state.medewerkers.slice(0, MAX_LEES_MEDEWERKERS),
        ...(state.medewerkers.length > MAX_LEES_MEDEWERKERS
          ? { let_op: `Afgekapt op ${MAX_LEES_MEDEWERKERS} van ${state.medewerkers.length} medewerkers.` }
          : {}),
        bronMedewerkersZonderRegistratie: bron.medewerkers.filter((naam) => !geregistreerd.has(naam)),
        teams: state.teams ?? [],
        inventaris: state.inventaris,
      },
    };
  },

  wijzig_middel: (args, api, bron) => {
    const middel = str(args, "middel") as MiddelType;
    if (!(MIDDEL_TYPES as readonly string[]).includes(middel)) {
      return fout(`Onbekend middel "${str(args, "middel")}". Kies uit: ${MIDDEL_TYPES.join(", ")}.`);
    }
    const actie = str(args, "actie");
    if (actie !== "toewijzen" && actie !== "innemen") return fout('Actie moet "toewijzen" of "innemen" zijn.');
    const state = api.getState();
    const persoon = zoek(args.naam, persoonKandidaten(state, bron), "medewerker");
    if (!("naam" in persoon)) return fout(persoon.melding);
    const heeft = state.medewerkers.find((rij) => rij.naam === persoon.naam)?.middelen.includes(middel) ?? false;
    if (actie === "toewijzen" && heeft) return geen(`${persoon.naam} heeft al een ${middel}.`);
    if (actie === "innemen" && !heeft) return geen(`${persoon.naam} heeft geen ${middel} in de registratie.`);
    api.setMiddel(persoon.naam, middel, actie === "toewijzen");
    return ok(
      actie === "toewijzen" ? `${middel} toegewezen aan ${persoon.naam}.` : `${middel} ingenomen van ${persoon.naam}.`,
    );
  },

  zet_functie: (args, api, bron) => {
    const functie = str(args, "functie");
    if (functie !== "geen" && !(FUNCTIE_OPTIES as readonly string[]).includes(functie)) {
      return fout(`Onbekende functie "${functie}". Kies uit: ${FUNCTIE_OPTIES.join(", ")} of "geen".`);
    }
    const persoon = zoek(args.naam, persoonKandidaten(api.getState(), bron), "medewerker");
    if (!("naam" in persoon)) return fout(persoon.melding);
    api.setFunctie(persoon.naam, functie === "geen" ? "" : functie);
    return ok(
      functie === "geen" ? `Functie gewist voor ${persoon.naam}.` : `Functie van ${persoon.naam} gezet op ${functie}.`,
    );
  },

  wijzig_taal: (args, api, bron) => {
    const invoer = str(args, "taal");
    if (!invoer || invoer.length > MIDDELEN_LIMITS.taal) return fout("Ongeldige taal.");
    // Canonicaliseer naar de gecureerde spelling zodat statistieken niet versplinteren.
    const taal =
      (TAAL_OPTIES as readonly string[]).find((optie) => optie.toLowerCase() === invoer.toLowerCase()) ?? invoer;
    const actie = str(args, "actie");
    if (actie !== "toevoegen" && actie !== "verwijderen") return fout('Actie moet "toevoegen" of "verwijderen" zijn.');
    const state = api.getState();
    const persoon = zoek(args.naam, persoonKandidaten(state, bron), "medewerker");
    if (!("naam" in persoon)) return fout(persoon.melding);
    const talen = state.medewerkers.find((rij) => rij.naam === persoon.naam)?.talen ?? [];
    const heeft = talen.includes(taal);
    if (actie === "toevoegen" && heeft) return geen(`${persoon.naam} heeft ${taal} al geregistreerd.`);
    if (actie === "toevoegen" && talen.length >= MIDDELEN_LIMITS.talen) {
      return fout(`Maximaal ${MIDDELEN_LIMITS.talen} talen per medewerker.`);
    }
    if (actie === "verwijderen" && !heeft) return geen(`${persoon.naam} heeft ${taal} niet geregistreerd.`);
    api.setTaal(persoon.naam, taal, actie === "toevoegen");
    return ok(
      actie === "toevoegen" ? `${taal} toegevoegd bij ${persoon.naam}.` : `${taal} verwijderd bij ${persoon.naam}.`,
    );
  },

  wijzig_teamtag: (args, api, bron) => {
    const actie = str(args, "actie");
    if (actie !== "toevoegen" && actie !== "verwijderen") return fout('Actie moet "toevoegen" of "verwijderen" zijn.');
    const state = api.getState();
    const persoon = zoek(args.naam, persoonKandidaten(state, bron), "medewerker");
    if (!("naam" in persoon)) return fout(persoon.melding);
    const structuur = [...new Set((state.teams ?? []).map((team) => team.naam))];
    const huidig = state.medewerkers.find((rij) => rij.naam === persoon.naam)?.teams ?? [];
    // Toevoegen alleen uit de structuur (zoals de tagkiezer); verwijderen mag
    // ook een tag raken die niet meer in de structuur staat.
    const team = zoek(args.team, actie === "toevoegen" ? structuur : [...new Set([...structuur, ...huidig])], "team");
    if (!("naam" in team)) return fout(team.melding);
    const heeft = huidig.includes(team.naam);
    if (actie === "toevoegen" && heeft) return geen(`${persoon.naam} is al gekoppeld aan ${team.naam}.`);
    if (actie === "toevoegen" && huidig.length >= MIDDELEN_LIMITS.teamtags) {
      return fout(`Maximaal ${MIDDELEN_LIMITS.teamtags} teamtags per medewerker.`);
    }
    if (actie === "verwijderen" && !heeft) return geen(`${persoon.naam} is niet gekoppeld aan ${team.naam}.`);
    api.setTeamTag(persoon.naam, team.naam, actie === "toevoegen");
    return ok(
      actie === "toevoegen"
        ? `${persoon.naam} gekoppeld aan team ${team.naam}.`
        : `Teamtag ${team.naam} verwijderd bij ${persoon.naam}.`,
    );
  },

  zet_notitie: (args, api, bron) => {
    const notitie = str(args, "notitie");
    if (notitie.length > MIDDELEN_LIMITS.notitie) return fout(`Notitie langer dan ${MIDDELEN_LIMITS.notitie} tekens.`);
    const persoon = zoek(args.naam, persoonKandidaten(api.getState(), bron), "medewerker");
    if (!("naam" in persoon)) return fout(persoon.melding);
    api.setNotitie(persoon.naam, notitie);
    return ok(
      notitie === "" ? `Notitie gewist voor ${persoon.naam}.` : `Notitie van ${persoon.naam} gezet op "${notitie}".`,
    );
  },

  voeg_medewerker_toe: (args, api, _bron) => {
    const naam = str(args, "naam");
    if (!naam || naam.length > MIDDELEN_LIMITS.naam) return fout("Ongeldige naam.");
    if (api.getState().medewerkers.length >= MIDDELEN_LIMITS.medewerkers) {
      return fout(`Maximaal ${MIDDELEN_LIMITS.medewerkers} medewerkers in de registratie.`);
    }
    return api.addPersoon(naam)
      ? ok(`${naam} toegevoegd als handmatige medewerker.`)
      : geen(`${naam} staat al in de registratie.`);
  },

  verwijder_medewerker: (args, api, _bron) => {
    if (args.bevestigd !== true) {
      return {
        status: "bevestiging_vereist",
        melding:
          "Vraag de gebruiker eerst om expliciete bevestiging en roep de tool daarna opnieuw aan met bevestigd=true.",
      };
    }
    const state = api.getState();
    const persoon = zoek(
      args.naam,
      state.medewerkers.map((rij) => rij.naam),
      "medewerker",
    );
    if (!("naam" in persoon)) return fout(persoon.melding);
    api.removePersoon(persoon.naam);
    return ok(
      `${persoon.naam} verwijderd uit de registratie (een medewerker uit de databron blijft daar zichtbaar, zonder registratie).`,
    );
  },

  voeg_team_toe: (args, api, bron) => {
    const naam = str(args, "naam");
    if (!naam || naam.length > MIDDELEN_LIMITS.teamnaam) return fout("Ongeldige teamnaam.");
    const state = api.getState();
    if ((state.teams ?? []).length >= MIDDELEN_LIMITS.teams) return fout(`Maximaal ${MIDDELEN_LIMITS.teams} teams.`);
    const locatie = zoek(args.locatie, locatieKandidaten(state, bron), "locatie");
    if (!("naam" in locatie)) return fout(locatie.melding);
    return api.addTeam(locatie.naam, naam)
      ? ok(`Team ${naam} toegevoegd aan ${locatie.naam}.`)
      : geen(`Team ${naam} bestaat al op ${locatie.naam}.`);
  },

  verwijder_team: (args, api, bron) => {
    if (args.bevestigd !== true) {
      return {
        status: "bevestiging_vereist",
        melding:
          "Vraag de gebruiker eerst om expliciete bevestiging en roep de tool daarna opnieuw aan met bevestigd=true.",
      };
    }
    const state = api.getState();
    const locatie = zoek(args.locatie, locatieKandidaten(state, bron), "locatie");
    if (!("naam" in locatie)) return fout(locatie.melding);
    const teamsOpLocatie = (state.teams ?? []).filter((team) => team.locatie === locatie.naam).map((team) => team.naam);
    const team = zoek(args.naam, teamsOpLocatie, "team");
    if (!("naam" in team)) return fout(team.melding);
    api.removeTeam(locatie.naam, team.naam);
    return ok(`Team ${team.naam} verwijderd van ${locatie.naam} (bestaande teamtags op medewerkers blijven staan).`);
  },

  zet_inventaris: (args, api, bron) => {
    const veld = str(args, "veld") as InventarisVeld;
    if (!(INVENTARIS_VELDEN as readonly string[]).includes(veld)) {
      return fout(`Onbekend veld "${str(args, "veld")}". Kies uit: ${INVENTARIS_VELDEN.join(", ")}.`);
    }
    const aantal = args.aantal;
    if (typeof aantal !== "number" || !Number.isInteger(aantal) || aantal < 0 || aantal > MIDDELEN_LIMITS.aantal) {
      return fout(`Aantal moet een geheel getal tussen 0 en ${MIDDELEN_LIMITS.aantal} zijn.`);
    }
    const state = api.getState();
    const locatie = zoek(args.locatie, locatieKandidaten(state, bron), "locatie");
    if (!("naam" in locatie)) return fout(locatie.melding);
    const huidig = state.inventaris.find((rij) => rij.locatie === locatie.naam)?.[veld] ?? 0;
    if (huidig === aantal) return geen(`${veld} op ${locatie.naam} staat al op ${aantal}.`);
    api.setInventarisVeld(locatie.naam, veld, aantal);
    return ok(`${veld} op ${locatie.naam} gezet op ${aantal} (was ${huidig}).`);
  },

  voeg_locatie_toe: (args, api, _bron) => {
    const locatie = str(args, "locatie");
    if (!locatie || locatie.length > MIDDELEN_LIMITS.naam) return fout("Ongeldige locatienaam.");
    if (api.getState().inventaris.length >= MIDDELEN_LIMITS.inventaris) {
      return fout(`Maximaal ${MIDDELEN_LIMITS.inventaris} inventarislocaties.`);
    }
    return api.addLocatie(locatie)
      ? ok(`Locatie ${locatie} toegevoegd aan de inventaris.`)
      : geen(`Locatie ${locatie} staat al in de inventaris.`);
  },

  verwijder_locatie: (args, api, bron) => {
    if (args.bevestigd !== true) {
      return {
        status: "bevestiging_vereist",
        melding:
          "Vraag de gebruiker eerst om expliciete bevestiging en roep de tool daarna opnieuw aan met bevestigd=true.",
      };
    }
    const state = api.getState();
    const locatie = zoek(
      args.locatie,
      state.inventaris.map((rij) => rij.locatie),
      "locatie",
    );
    if (!("naam" in locatie)) return fout(locatie.melding);
    api.removeLocatie(locatie.naam);
    const uitBron = bron.locaties.includes(locatie.naam);
    return ok(
      uitBron
        ? `Inventarisaantallen van ${locatie.naam} gewist; als databron-locatie blijft zij zichtbaar met 0-waarden.`
        : `Locatie ${locatie.naam} verwijderd uit de inventaris.`,
    );
  },
};

export function isMiddelenTool(name: string): name is MiddelenToolName {
  return Object.hasOwn(HANDLERS, name);
}

export function isDestructieveTool(name: string): boolean {
  return (DESTRUCTIEVE_TOOLS as readonly string[]).includes(name);
}

export function executeMiddelenTool(
  name: string,
  args: unknown,
  api: MiddelenActieApi,
  bron: MiddelenBron,
): MiddelenActieResultaat {
  if (!isMiddelenTool(name)) return fout(`Onbekende tool "${name}".`);
  const veiligeArgs = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  try {
    return HANDLERS[name](veiligeArgs, api, bron);
  } catch (error) {
    return fout(`Uitvoering mislukt: ${error instanceof Error ? error.message : String(error)}`);
  }
}

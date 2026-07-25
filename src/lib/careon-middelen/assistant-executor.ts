// Client-side uitvoering van assistent-acties op de registratie
// "Medewerkers & middelen" (handoff 11). Het model kiest een tool (schema's in
// assistant-tools.ts); de uitvoering loopt hier tegen een MiddelenActieApi.
// In de actielus is dat de CONCEPT-api (concept.ts) — wijzigingen worden dus
// klaargezet, niet opgeslagen; pas de canvas-goedkeuring schrijft de eindstand
// via de provider weg. Elke handler valideert de argumenten en geeft een
// Nederlands resultaat terug dat zowel het model (als tool-result) als de
// gebruiker (in de tool-kaart) leest.

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
  setUitDienst: (naam: string, uitDienst: boolean) => void;
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
  /** Canonieke (geresolvede) medewerkersnaam die de actie raakte. */
  naam?: string;
  /** Canonieke namen die een bulk-actie raakte. */
  namen?: string[];
  /** Canonieke locatienaam die de actie raakte. */
  locatie?: string;
  /** Alleen gevuld door lees_middelen_registratie. */
  registratie?: unknown;
}

type ActieExtra = Pick<MiddelenActieResultaat, "naam" | "namen" | "locatie">;

const ok = (melding: string, extra?: ActieExtra): MiddelenActieResultaat => ({ status: "ok", melding, ...extra });
const geen = (melding: string, extra?: ActieExtra): MiddelenActieResultaat => ({
  status: "geen_wijziging",
  melding,
  ...extra,
});
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

// Gelijk aan de opslaglimiet: de lees-tool geeft dus altijd álle medewerkers.
const MAX_LEES_MEDEWERKERS = MIDDELEN_LIMITS.medewerkers;

// Doelbepaling voor bulk-tools: iedereen=true is de deterministische garantie
// voor "elke medewerker" (registratie ∪ databron; geen model-opsomming nodig);
// anders een expliciete namenlijst, per naam geresolveerd. `uitzonderingen`
// haalt namen uit het doelwit — het model kan "iedereen behalve X" uitdrukken
// en de gebruiker kan in het concept-canvas namen uitsluiten (replay draagt
// die uitsluitingen als ditzelfde argument).
function bulkDoelen(
  args: Record<string, unknown>,
  state: MiddelenState,
  bron: MiddelenBron,
): { doelen: string[]; onbekend: string[] } | { melding: string } {
  const uitgesloten = new Set(
    (Array.isArray(args.uitzonderingen) ? args.uitzonderingen : [])
      .filter((naam): naam is string => typeof naam === "string")
      .map((naam) => naam.toLowerCase()),
  );
  const zonderUitzonderingen = (doelen: string[]) => doelen.filter((naam) => !uitgesloten.has(naam.toLowerCase()));

  if (args.iedereen === true) {
    const doelen = zonderUitzonderingen(persoonKandidaten(state, bron));
    if (doelen.length === 0) return { melding: "Alle medewerkers zijn uitgesloten — geen doelwit over." };
    return { doelen, onbekend: [] };
  }
  if (!Array.isArray(args.namen) || args.namen.length === 0) {
    return { melding: "Geef iedereen=true of een namenlijst op." };
  }
  if (args.namen.length > MIDDELEN_LIMITS.medewerkers) {
    return { melding: `Maximaal ${MIDDELEN_LIMITS.medewerkers} namen per bulk-aanroep.` };
  }
  const kandidaten = persoonKandidaten(state, bron);
  const doelen: string[] = [];
  const onbekend: string[] = [];
  for (const invoer of args.namen) {
    const gevonden = zoek(invoer, kandidaten, "medewerker");
    if ("naam" in gevonden) {
      if (!doelen.includes(gevonden.naam)) doelen.push(gevonden.naam);
    } else {
      onbekend.push(typeof invoer === "string" ? invoer : "?");
    }
  }
  const overgebleven = zonderUitzonderingen(doelen);
  if (overgebleven.length === 0) {
    return {
      melding: onbekend.length
        ? `Geen enkele naam herkend: ${onbekend.slice(0, 8).join(", ")}.`
        : "Alle opgegeven namen zijn uitgesloten.",
    };
  }
  return { doelen: overgebleven, onbekend };
}

type Handler = (args: Record<string, unknown>, api: MiddelenActieApi, bron: MiddelenBron) => MiddelenActieResultaat;

const HANDLERS: Record<MiddelenToolName, Handler> = {
  lees_middelen_registratie: (args, api, bron) => {
    const state = api.getState();
    const geregistreerd = new Set(state.medewerkers.map((rij) => rij.naam));
    const zonderRegistratie = bron.medewerkers.filter((naam) => !geregistreerd.has(naam));
    const inclusiefNotities = args.inclusiefNotities === true;
    return {
      status: "ok",
      melding: `Registratie gelezen: ${state.medewerkers.length + zonderRegistratie.length} medewerkers in totaal (${state.medewerkers.length} met registratierij, ${zonderRegistratie.length} uit de databron zonder registratie), ${state.inventaris.length} inventarislocaties.`,
      registratie: {
        medewerkers: state.medewerkers.slice(0, MAX_LEES_MEDEWERKERS).map((rij) => {
          if (inclusiefNotities) return rij;
          const { notitie: _notitie, ...zonderNotitie } = rij;
          return zonderNotitie;
        }),
        ...(state.medewerkers.length > MAX_LEES_MEDEWERKERS
          ? { let_op: `Afgekapt op ${MAX_LEES_MEDEWERKERS} van ${state.medewerkers.length} medewerkers.` }
          : {}),
        bronMedewerkersZonderRegistratie: zonderRegistratie,
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
    if (actie === "toewijzen" && heeft) return geen(`${persoon.naam} heeft al een ${middel}.`, { naam: persoon.naam });
    if (actie === "innemen" && !heeft) {
      return geen(`${persoon.naam} heeft geen ${middel} in de registratie.`, { naam: persoon.naam });
    }
    api.setMiddel(persoon.naam, middel, actie === "toewijzen");
    return ok(
      actie === "toewijzen" ? `${middel} toegewezen aan ${persoon.naam}.` : `${middel} ingenomen van ${persoon.naam}.`,
      { naam: persoon.naam },
    );
  },

  wijzig_middel_bulk: (args, api, bron) => {
    const middel = str(args, "middel") as MiddelType;
    if (!(MIDDEL_TYPES as readonly string[]).includes(middel)) {
      return fout(`Onbekend middel "${str(args, "middel")}". Kies uit: ${MIDDEL_TYPES.join(", ")}.`);
    }
    const actie = str(args, "actie");
    if (actie !== "toewijzen" && actie !== "innemen") return fout('Actie moet "toewijzen" of "innemen" zijn.');
    const state = api.getState();
    const doelwit = bulkDoelen(args, state, bron);
    if (!("doelen" in doelwit)) return fout(doelwit.melding);
    let gewijzigd = 0;
    let ongewijzigd = 0;
    for (const naam of doelwit.doelen) {
      const heeft = state.medewerkers.find((rij) => rij.naam === naam)?.middelen.includes(middel) ?? false;
      if (heeft === (actie === "toewijzen")) {
        ongewijzigd += 1;
        continue;
      }
      api.setMiddel(naam, middel, actie === "toewijzen");
      gewijzigd += 1;
    }
    const delen = [
      actie === "toewijzen"
        ? `${middel} toegewezen aan ${gewijzigd} van ${doelwit.doelen.length} medewerkers`
        : `${middel} ingenomen van ${gewijzigd} van ${doelwit.doelen.length} medewerkers`,
      ongewijzigd ? `${ongewijzigd} al passend` : null,
      doelwit.onbekend.length ? `onbekend: ${doelwit.onbekend.slice(0, 6).join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    return {
      status: gewijzigd > 0 ? "ok" : "geen_wijziging",
      melding: `${delen}.`,
      namen: doelwit.doelen,
    };
  },

  wijzig_taal_bulk: (args, api, bron) => {
    const invoer = str(args, "taal");
    if (!invoer || invoer.length > MIDDELEN_LIMITS.taal) return fout("Ongeldige taal.");
    const taal =
      (TAAL_OPTIES as readonly string[]).find((optie) => optie.toLowerCase() === invoer.toLowerCase()) ?? invoer;
    const actie = str(args, "actie");
    if (actie !== "toevoegen" && actie !== "verwijderen") return fout('Actie moet "toevoegen" of "verwijderen" zijn.');
    const state = api.getState();
    const doelwit = bulkDoelen(args, state, bron);
    if (!("doelen" in doelwit)) return fout(doelwit.melding);
    let gewijzigd = 0;
    let ongewijzigd = 0;
    const vol: string[] = [];
    for (const naam of doelwit.doelen) {
      const talen = state.medewerkers.find((rij) => rij.naam === naam)?.talen ?? [];
      const heeft = talen.includes(taal);
      if (actie === "toevoegen") {
        if (heeft) {
          ongewijzigd += 1;
          continue;
        }
        if (talen.length >= MIDDELEN_LIMITS.talen) {
          vol.push(naam);
          continue;
        }
        api.setTaal(naam, taal, true);
        gewijzigd += 1;
      } else {
        if (!heeft) {
          ongewijzigd += 1;
          continue;
        }
        api.setTaal(naam, taal, false);
        gewijzigd += 1;
      }
    }
    const delen = [
      actie === "toevoegen"
        ? `${taal} toegevoegd bij ${gewijzigd} van ${doelwit.doelen.length} medewerkers`
        : `${taal} verwijderd bij ${gewijzigd} van ${doelwit.doelen.length} medewerkers`,
      ongewijzigd ? `${ongewijzigd} hadden dit al passend` : null,
      vol.length ? `${vol.length} vol (max ${MIDDELEN_LIMITS.talen} talen)` : null,
      doelwit.onbekend.length ? `onbekend: ${doelwit.onbekend.slice(0, 6).join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    return {
      status: gewijzigd > 0 ? "ok" : "geen_wijziging",
      melding: `${delen}.`,
      namen: doelwit.doelen,
    };
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
      { naam: persoon.naam },
    );
  },

  zet_dienstverband: (args, api, bron) => {
    const uitDienst = args.uitDienst === true;
    const state = api.getState();
    const persoon = zoek(args.naam, persoonKandidaten(state, bron), "medewerker");
    if (!("naam" in persoon)) return fout(persoon.melding);
    const rij = state.medewerkers.find((kandidaat) => kandidaat.naam === persoon.naam);
    if ((rij?.uitDienst === true) === uitDienst) {
      return geen(`${persoon.naam} staat al ${uitDienst ? "uit" : "in"} dienst.`, { naam: persoon.naam });
    }
    api.setUitDienst(persoon.naam, uitDienst);
    if (!uitDienst) return ok(`${persoon.naam} weer in dienst gezet.`, { naam: persoon.naam });
    // Uit dienst = operationeel ook alle uitgegeven middelen innemen.
    const ingenomen = rij?.middelen ?? [];
    for (const middel of ingenomen) {
      api.setMiddel(persoon.naam, middel, false);
    }
    return ok(
      `${persoon.naam} uit dienst gezet${ingenomen.length ? `; ingenomen: ${ingenomen.join(", ")}` : ""} (registratie blijft bewaard).`,
      { naam: persoon.naam },
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
    if (actie === "toevoegen" && heeft) {
      return geen(`${persoon.naam} heeft ${taal} al geregistreerd.`, { naam: persoon.naam });
    }
    if (actie === "toevoegen" && talen.length >= MIDDELEN_LIMITS.talen) {
      return fout(`Maximaal ${MIDDELEN_LIMITS.talen} talen per medewerker.`);
    }
    if (actie === "verwijderen" && !heeft) {
      return geen(`${persoon.naam} heeft ${taal} niet geregistreerd.`, { naam: persoon.naam });
    }
    api.setTaal(persoon.naam, taal, actie === "toevoegen");
    return ok(
      actie === "toevoegen" ? `${taal} toegevoegd bij ${persoon.naam}.` : `${taal} verwijderd bij ${persoon.naam}.`,
      { naam: persoon.naam },
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
    if (actie === "toevoegen" && heeft) {
      return geen(`${persoon.naam} is al gekoppeld aan ${team.naam}.`, { naam: persoon.naam });
    }
    if (actie === "toevoegen" && huidig.length >= MIDDELEN_LIMITS.teamtags) {
      return fout(`Maximaal ${MIDDELEN_LIMITS.teamtags} teamtags per medewerker.`);
    }
    if (actie === "verwijderen" && !heeft) {
      return geen(`${persoon.naam} is niet gekoppeld aan ${team.naam}.`, { naam: persoon.naam });
    }
    api.setTeamTag(persoon.naam, team.naam, actie === "toevoegen");
    return ok(
      actie === "toevoegen"
        ? `${persoon.naam} gekoppeld aan team ${team.naam}.`
        : `Teamtag ${team.naam} verwijderd bij ${persoon.naam}.`,
      { naam: persoon.naam },
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
      { naam: persoon.naam },
    );
  },

  voeg_medewerker_toe: (args, api, _bron) => {
    const naam = str(args, "naam");
    if (!naam || naam.length > MIDDELEN_LIMITS.naam) return fout("Ongeldige naam.");
    if (api.getState().medewerkers.length >= MIDDELEN_LIMITS.medewerkers) {
      return fout(`Maximaal ${MIDDELEN_LIMITS.medewerkers} medewerkers in de registratie.`);
    }
    return api.addPersoon(naam)
      ? ok(`${naam} toegevoegd als handmatige medewerker.`, { naam })
      : geen(`${naam} staat al in de registratie.`, { naam });
  },

  verwijder_medewerker: (args, api, bron) => {
    const state = api.getState();
    const persoon = zoek(args.naam, persoonKandidaten(state, bron), "medewerker");
    if (!("naam" in persoon)) return fout(persoon.melding);
    // Zelfde regel als de pagina (VerwijderKnop alleen bij niet-bron-rijen):
    // databron-medewerkers zijn niet te verwijderen — vertrek/ontslag hoort
    // via zet_dienstverband, dat de historie bewaart.
    if (bron.medewerkers.includes(persoon.naam)) {
      return fout(
        `${persoon.naam} staat in de databron en kan niet worden verwijderd. Bedoelt u uit dienst zetten? Gebruik zet_dienstverband met uitDienst=true.`,
      );
    }
    if (!state.medewerkers.some((rij) => rij.naam === persoon.naam)) {
      return geen(`${persoon.naam} heeft geen registratierij om te verwijderen.`, { naam: persoon.naam });
    }
    api.removePersoon(persoon.naam);
    return ok(`${persoon.naam} verwijderd uit de registratie.`, { naam: persoon.naam });
  },

  voeg_team_toe: (args, api, bron) => {
    const naam = str(args, "naam");
    if (!naam || naam.length > MIDDELEN_LIMITS.teamnaam) return fout("Ongeldige teamnaam.");
    const state = api.getState();
    if ((state.teams ?? []).length >= MIDDELEN_LIMITS.teams) return fout(`Maximaal ${MIDDELEN_LIMITS.teams} teams.`);
    const locatie = zoek(args.locatie, locatieKandidaten(state, bron), "locatie");
    if (!("naam" in locatie)) return fout(locatie.melding);
    return api.addTeam(locatie.naam, naam)
      ? ok(`Team ${naam} toegevoegd aan ${locatie.naam}.`, { locatie: locatie.naam })
      : geen(`Team ${naam} bestaat al op ${locatie.naam}.`, { locatie: locatie.naam });
  },

  verwijder_team: (args, api, bron) => {
    const state = api.getState();
    const locatie = zoek(args.locatie, locatieKandidaten(state, bron), "locatie");
    if (!("naam" in locatie)) return fout(locatie.melding);
    const teamsOpLocatie = (state.teams ?? []).filter((team) => team.locatie === locatie.naam).map((team) => team.naam);
    const team = zoek(args.naam, teamsOpLocatie, "team");
    if (!("naam" in team)) return fout(team.melding);
    api.removeTeam(locatie.naam, team.naam);
    return ok(`Team ${team.naam} verwijderd van ${locatie.naam} (bestaande teamtags op medewerkers blijven staan).`, {
      locatie: locatie.naam,
    });
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
    if (huidig === aantal) {
      return geen(`${veld} op ${locatie.naam} staat al op ${aantal}.`, { locatie: locatie.naam });
    }
    api.setInventarisVeld(locatie.naam, veld, aantal);
    return ok(`${veld} op ${locatie.naam} gezet op ${aantal} (was ${huidig}).`, { locatie: locatie.naam });
  },

  voeg_locatie_toe: (args, api, _bron) => {
    const locatie = str(args, "locatie");
    if (!locatie || locatie.length > MIDDELEN_LIMITS.naam) return fout("Ongeldige locatienaam.");
    if (api.getState().inventaris.length >= MIDDELEN_LIMITS.inventaris) {
      return fout(`Maximaal ${MIDDELEN_LIMITS.inventaris} inventarislocaties.`);
    }
    return api.addLocatie(locatie)
      ? ok(`Locatie ${locatie} toegevoegd aan de inventaris.`, { locatie })
      : geen(`Locatie ${locatie} staat al in de inventaris.`, { locatie });
  },

  verwijder_locatie: (args, api, bron) => {
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
      { locatie: locatie.naam },
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

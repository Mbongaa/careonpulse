// Concept-staat voor assistent-acties (handoff 11): de actielus voert tools
// uit op deze in-memory kopie met provider-semantiek (upsert per medewerker,
// duplicaatchecks, teams behouden tags). Er wordt NIETS bewaard — pas wanneer
// de gebruiker het concept in het canvas goedkeurt schrijft de provider de
// eindstand in één keer weg (vervangState → localStorage + centrale sync).

import type { MiddelenActieApi } from "./assistant-executor";
import type { LocatieInventaris, MedewerkerMiddelen, MiddelenState } from "./types";

export interface ConceptMiddelenApi {
  api: MiddelenActieApi;
  /** De actuele concept-eindstand (updatedAt wordt pas bij toepassen gezet). */
  huidig: () => MiddelenState;
}

export function createConceptMiddelenApi(begin: MiddelenState): ConceptMiddelenApi {
  let staat: MiddelenState = JSON.parse(JSON.stringify(begin)) as MiddelenState;

  const patch = (naam: string, fn: (rij: MedewerkerMiddelen) => MedewerkerMiddelen) => {
    const bestaand = staat.medewerkers.some((rij) => rij.naam === naam);
    staat = bestaand
      ? { ...staat, medewerkers: staat.medewerkers.map((rij) => (rij.naam === naam ? fn(rij) : rij)) }
      : { ...staat, medewerkers: [...staat.medewerkers, fn({ naam, middelen: [] })] };
  };

  const api: MiddelenActieApi = {
    getState: () => staat,
    setMiddel: (naam, middel, aanwezig) =>
      patch(naam, (rij) => ({
        ...rij,
        middelen: aanwezig ? [...new Set([...rij.middelen, middel])] : rij.middelen.filter((eigen) => eigen !== middel),
      })),
    setFunctie: (naam, functie) => patch(naam, (rij) => ({ ...rij, functie: functie === "" ? undefined : functie })),
    setTaal: (naam, taal, aanwezig) =>
      patch(naam, (rij) => {
        const talen = aanwezig
          ? [...new Set([...(rij.talen ?? []), taal])]
          : (rij.talen ?? []).filter((eigen) => eigen !== taal);
        return { ...rij, talen: talen.length === 0 ? undefined : talen };
      }),
    setTeamTag: (naam, team, aanwezig) =>
      patch(naam, (rij) => {
        const teams = aanwezig
          ? [...new Set([...(rij.teams ?? []), team])]
          : (rij.teams ?? []).filter((eigen) => eigen !== team);
        return { ...rij, teams: teams.length === 0 ? undefined : teams };
      }),
    setNotitie: (naam, notitie) => patch(naam, (rij) => ({ ...rij, notitie: notitie === "" ? undefined : notitie })),
    addPersoon: (naam) => {
      if (staat.medewerkers.some((rij) => rij.naam.toLowerCase() === naam.toLowerCase())) return false;
      staat = { ...staat, medewerkers: [...staat.medewerkers, { naam, handmatig: true, middelen: [] }] };
      return true;
    },
    removePersoon: (naam) => {
      staat = { ...staat, medewerkers: staat.medewerkers.filter((rij) => rij.naam !== naam) };
    },
    addTeam: (locatie, naam) => {
      if (
        (staat.teams ?? []).some((team) => team.locatie === locatie && team.naam.toLowerCase() === naam.toLowerCase())
      ) {
        return false;
      }
      staat = { ...staat, teams: [...(staat.teams ?? []), { naam, locatie }] };
      return true;
    },
    removeTeam: (locatie, naam) => {
      staat = {
        ...staat,
        teams: (staat.teams ?? []).filter((team) => !(team.locatie === locatie && team.naam === naam)),
      };
    },
    setInventarisVeld: (locatie, veld, aantal) => {
      const bestaand = staat.inventaris.some((rij) => rij.locatie === locatie);
      staat = bestaand
        ? {
            ...staat,
            inventaris: staat.inventaris.map((rij) => (rij.locatie === locatie ? { ...rij, [veld]: aantal } : rij)),
          }
        : {
            ...staat,
            inventaris: [
              ...staat.inventaris,
              { locatie, behandelkamers: 0, boeken: 0, diagnostiek: 0, [veld]: aantal } as LocatieInventaris,
            ],
          };
    },
    addLocatie: (locatie) => {
      if (staat.inventaris.some((rij) => rij.locatie.toLowerCase() === locatie.toLowerCase())) return false;
      staat = {
        ...staat,
        inventaris: [...staat.inventaris, { locatie, handmatig: true, behandelkamers: 0, boeken: 0, diagnostiek: 0 }],
      };
      return true;
    },
    removeLocatie: (locatie) => {
      staat = { ...staat, inventaris: staat.inventaris.filter((rij) => rij.locatie !== locatie) };
    },
  };

  return { api, huidig: () => staat };
}

// Registratie-grounding voor de live assistent-route (handoff 11): zo kan het
// model zowel vragen over middelen beantwoorden als namen/locaties correct
// resolven vóór een actie. UI-vrij zodat óók de verify-scripts het echte
// klantpad kunnen doormeten (context-budget!). Bij een openstaand concept is
// `staat` de concept-stand, zodat vervolgacties daarop voortbouwen.

import type { MiddelenBron } from "./assistant-executor";
import type { MiddelenState } from "./types";

// Bovengrens van het context-veld op de server-route. Gedeeld hier zodat de
// client-samenstelling en de verify-meting dezelfde grens gebruiken: de
// middelen-sectie mag NOOIT buiten dit budget vallen (dan "ziet" het model de
// medewerkerslijst niet meer — de oorzaak van "slechts 10 medewerkers").
// Bewust ver boven elke reële datasetgrootte (~200k tekens ≈ 50k tokens, ruim
// binnen het 128k-tokenvenster van het model): de AI leest alles; dit is
// alleen een rem tegen misvormde requests.
export const ASSISTANT_MAX_CONTEXT_CHARS = 200_000;

// Eigen budget voor de productie-facts binnen de context: de middelen-sectie
// staat wel vóóraan, maar een onverwacht groot feitenblad mag de rest nooit
// verdringen. Ook dit is ver boven de reële omvang (feitenblad ≈ 10-20k).
export const ASSISTANT_MAX_FACTS_CHARS = 150_000;

export function middelenGrounding(staat: MiddelenState, bron: MiddelenBron): string {
  const geregistreerd = new Set(staat.medewerkers.map((rij) => rij.naam));
  const zonderRegistratie = bron.medewerkers.filter((naam) => !geregistreerd.has(naam));
  const totaal = staat.medewerkers.length + zonderRegistratie.length;
  return JSON.stringify({
    toelichting:
      "Handmatig bijgehouden registratie (geen EPD-data): uitgegeven middelen, functie, talen en teamtags per medewerker plus inventaris per locatie. Aanpasbaar via de actie-tools. LET OP: het totale aantal medewerkers = medewerkers (met registratierij) PLUS bronMedewerkersZonderRegistratie — beide lijsten samen zijn de volledige medewerkerslijst; de productie-toplijst elders in de context is slechts een top-10.",
    aantalMedewerkersTotaal: totaal,
    aantalGeregistreerd: staat.medewerkers.length,
    aantalBronZonderRegistratie: zonderRegistratie.length,
    // Volledige lijsten — de opslaglimiet (MIDDELEN_LIMITS.medewerkers = 500)
    // is de enige bovengrens; er valt dus nooit een medewerker buiten beeld.
    medewerkers: staat.medewerkers,
    bronMedewerkersZonderRegistratie: zonderRegistratie,
    teams: staat.teams ?? [],
    inventaris: staat.inventaris,
  });
}

/**
 * Volledige context voor de live route, met de middelen-registratie VOORAAN:
 * bij overschrijding van het serverbudget wordt het einde afgekapt, en dat
 * mag nooit de medewerkerslijst raken (wel desnoods de staart van de facts).
 */
export function assembleAssistantContext(facts: string, middelen: string, conceptNotitie: string): string {
  return [
    "MEDEWERKERS & MIDDELEN (handmatige registratie, JSON):",
    middelen + conceptNotitie,
    "",
    "OVERIGE CONTEXT (KPI's/feitenblad, JSON):",
    facts.slice(0, ASSISTANT_MAX_FACTS_CHARS),
  ].join("\n");
}

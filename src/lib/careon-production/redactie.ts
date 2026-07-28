import type { AgendaFacts, DeclaratiesFacts, ToeslagenFacts } from "./types";

// Financiële redactie voor leden (klantbesluit 28-07-2026): de toeslagen- en
// declaratie-aggregaten zijn volledig financieel en worden verborgen; de
// agenda-aggregaat is gemengd en wordt genuld in plaats van gestript — de
// typeguard (isAgendaFacts) eist eindige omzetvelden, en strippen zou de hele
// niet-financiële agenda (planning, no-show, kwaliteit) mee laten wegvallen.
// Deze module is client-veilig: dezelfde redactie draait server-side (route)
// én client-side (provider), zodat ook een oudere localStorage-kopie van een
// gedeelde werkplek nooit financiële cijfers aan een lid toont.

export function redigeerAgendaFactsFinancieel(facts: AgendaFacts): AgendaFacts {
  return {
    ...facts,
    cellen: facts.cellen.map((cel) => ({ ...cel, omzetGerealiseerd: 0, onderhanden: 0, onderhandenSessies: 0 })),
    facturatie: [],
  };
}

export function redigeerToeslagenFactsFinancieel(_facts: ToeslagenFacts): null {
  return null;
}

export function redigeerDeclaratiesFactsFinancieel(_facts: DeclaratiesFacts): null {
  return null;
}

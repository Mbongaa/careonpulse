import { createAuxStateHandlers } from "@/lib/careon-production/aux-route";
import { redigeerAgendaFactsFinancieel } from "@/lib/careon-production/redactie";
import { isAgendaFacts } from "@/lib/careon-production/types";

// Centrale opslag van het agenda-aggregaat (AgendaFacts). Er staan nooit losse
// afspraakregels in deze tabel — alleen de gepseudonimiseerde aggregaten.
// Gemengd aggregaat: leden krijgen de financieel-genulde variant (redactie.ts).
// Lezen loopt via careon_agenda_state_public (migratie 0015): de basistabel is
// sinds die migratie financieel afgesloten in RLS, de view nult in de database
// exact dezelfde sleutels en geeft gerechtigden de volledige staat. Schrijven
// blijft op de basistabel — een view is niet insertable.
export const { GET, POST } = createAuxStateHandlers(
  "careon_agenda_state",
  isAgendaFacts,
  "agenda-aggregaat",
  { modus: "redigeer", redigeer: redigeerAgendaFactsFinancieel },
  "careon_agenda_state_public",
);

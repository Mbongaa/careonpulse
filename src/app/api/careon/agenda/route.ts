import { createAuxStateHandlers } from "@/lib/careon-production/aux-route";
import { redigeerAgendaFactsFinancieel } from "@/lib/careon-production/redactie";
import { isAgendaFacts } from "@/lib/careon-production/types";

// Centrale opslag van het agenda-aggregaat (AgendaFacts). Er staan nooit losse
// afspraakregels in deze tabel — alleen de gepseudonimiseerde aggregaten.
// Gemengd aggregaat: leden krijgen de financieel-genulde variant (redactie.ts).
export const { GET, POST } = createAuxStateHandlers("careon_agenda_state", isAgendaFacts, "agenda-aggregaat", {
  modus: "redigeer",
  redigeer: redigeerAgendaFactsFinancieel,
});

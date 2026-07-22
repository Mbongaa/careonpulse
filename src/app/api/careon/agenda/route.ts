import { createAuxStateHandlers } from "@/lib/careon-production/aux-route";
import { isAgendaFacts } from "@/lib/careon-production/types";

// Centrale opslag van het agenda-aggregaat (AgendaFacts). Er staan nooit losse
// afspraakregels in deze tabel — alleen de gepseudonimiseerde aggregaten.
export const { GET, POST } = createAuxStateHandlers("careon_agenda_state", isAgendaFacts, "agenda-aggregaat");

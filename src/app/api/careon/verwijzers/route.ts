import { createAuxStateHandlers } from "@/lib/careon-production/aux-route";
import { isVerwijzersFacts } from "@/lib/careon-production/types";

// Centrale opslag van het verwijzernetwerk-aggregaat (VerwijzersFacts):
// praktijkgegevens per verwijzer, geen cliëntgegevens of e-mailadressen.
export const { GET, POST } = createAuxStateHandlers(
  "careon_verwijzers_state",
  isVerwijzersFacts,
  "verwijzers-aggregaat",
);

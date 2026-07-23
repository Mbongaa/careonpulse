import { createAuxStateHandlers } from "@/lib/careon-production/aux-route";
import { isDeclaratiesFacts } from "@/lib/careon-production/types";

// Centrale opslag van het declaratie-aggregaat (DeclaratiesFacts): per factuur
// bedrag/toegekend/gecrediteerd — debiteuren zijn koepels/gemeenten of het
// samengevoegde label "Particulier"; nooit persoonsnamen.
export const { GET, POST } = createAuxStateHandlers(
  "careon_declaraties_state",
  isDeclaratiesFacts,
  "declaratie-aggregaat",
);

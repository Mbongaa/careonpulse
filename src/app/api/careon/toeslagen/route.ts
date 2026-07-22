import { createAuxStateHandlers } from "@/lib/careon-production/aux-route";
import { isToeslagenFacts } from "@/lib/careon-production/types";

// Centrale opslag van het toeslagen-aggregaat (ToeslagenFacts): TC-toeslag-
// prestaties per factuurmaand/koepel/code — geen cliëntnamen of losse regels.
export const { GET, POST } = createAuxStateHandlers("careon_toeslagen_state", isToeslagenFacts, "toeslagen-aggregaat");

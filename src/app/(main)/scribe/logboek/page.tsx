import type { Metadata } from "next";

import { requireScribeBeheerPage } from "@/lib/supabase/session.server";

import { LogboekLijst } from "../_components/logboek-lijst";

export const metadata: Metadata = {
  title: "Careon AI-logboek",
  description: "Wie opende welk consult, wat werd geëxporteerd en wat verwijderde een beheerder.",
};

// Eigen scribe-logboek voor de verwerkingsverantwoordelijke (N20). `audit_events`
// is verder alleen leesbaar achter requireSuperadmin — de Careon-superadmin, niet
// de FG van de klant. Deze pagina geeft een org_admin dezelfde regels voor de
// éigen organisatie (NEN 7513, art. 15 AVG), metadata-only.
export default async function ScribeLogboekPage() {
  await requireScribeBeheerPage();
  return <LogboekLijst />;
}

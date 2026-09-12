import type { Metadata } from "next";

import { SCRIBE_PAGE_META } from "@/data/careon/careon-scribe";
import { requireScribeBeheerPage } from "@/lib/supabase/session.server";

import { ScribeInstellingenForm } from "../_components/instellingen-form";

export const metadata: Metadata = {
  title: SCRIBE_PAGE_META.instellingen.title,
  description: SCRIBE_PAGE_META.instellingen.sub,
};

// Beheerderspagina (§7.5): de gemachtigden-gate volstaat hier niet — een
// gemachtigde behandelaar zag anders het volledige beheerscherm, met een
// gemachtigdenkaart die op 403 uitloopt (C5/C11). Demo/misconfigured vallen
// net als bij requireScribePage() door naar de client (B12).
export default async function ScribeInstellingenPage() {
  await requireScribeBeheerPage();
  return <ScribeInstellingenForm />;
}

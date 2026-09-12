import type { Metadata } from "next";

import { SCRIBE_PAGE_META } from "@/data/careon/careon-scribe";
import { requireScribePage } from "@/lib/supabase/session.server";

import { ConsultLijst } from "./_components/consult-lijst";

export const metadata: Metadata = {
  title: SCRIBE_PAGE_META.overzicht.title,
  description: SCRIBE_PAGE_META.overzicht.sub,
};

// Bewust géén generateStaticParams/dynamicParams onder /scribe: statisch
// geprerenderde pagina's zien geen cookies en de gate zou stil niets doen
// (handoff 20 §2.3).
export default async function ScribePage() {
  await requireScribePage();
  return <ConsultLijst />;
}

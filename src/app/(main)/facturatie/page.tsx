import type { Metadata } from "next";

import { FACTURATIE_PAGE_META } from "@/data/careon/careon-facturatie";
import { requireFacturatiePage } from "@/lib/supabase/session.server";

import { FacturatieLijst } from "./_components/facturatie-lijst";

export const metadata: Metadata = {
  title: FACTURATIE_PAGE_META.overzicht.title,
  description: FACTURATIE_PAGE_META.overzicht.sub,
};

// Bewust géén generateStaticParams/dynamicParams op facturatiepagina's:
// statisch geprerenderde pagina's zien geen cookies en de gate zou stil
// niets doen (handoff 15 §2.3).
export default async function FacturatiePage() {
  await requireFacturatiePage();
  return <FacturatieLijst />;
}

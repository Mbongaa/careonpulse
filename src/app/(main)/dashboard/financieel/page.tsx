import { redirect } from "next/navigation";

import type { Metadata } from "next";

import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import { magFinancieelZien } from "@/lib/careon-financieel-rol";
import { getCareonSession } from "@/lib/supabase/session.server";

import { FinancieelContent } from "./_components/financieel-content";

export const metadata: Metadata = {
  title: CAREON_PAGE_META.financieel.title,
  description: CAREON_PAGE_META.financieel.sub,
};

export default async function Page() {
  // Financiële rolregel (klantbesluit 28-07-2026): gewone leden zien deze
  // pagina niet — zelfde poortpatroon als beheer. Demo/misconfigured valt
  // bewust open (Playwright draait in demo-modus zonder rollen).
  const result = await getCareonSession();
  if (result.status === "ok" && !magFinancieelZien(result.session)) {
    redirect("/dashboard/directiecockpit");
  }
  return <FinancieelContent />;
}

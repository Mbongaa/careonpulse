import { redirect } from "next/navigation";

import type { Metadata } from "next";

import { CareonAuthGuard } from "@/app/(main)/dashboard/_components/careon/careon-auth-guard";
import { CAREON_MODULES } from "@/data/careon/careon-modules";
import { magFacturatieZien } from "@/lib/careon-facturatie-rol";
import { magFinancieelZien } from "@/lib/careon-financieel-rol";
import { careonOrgNaam } from "@/lib/careon-org-naam";
import { getCareonSession } from "@/lib/supabase/session.server";

import { ModuleLauncher } from "./_components/module-launcher";

export const metadata: Metadata = {
  title: "Modules",
  // Leveranciersneutraal: paginametadata kan niet van de sessie afhangen, en in
  // demo-modus is /modules publiek bereikbaar — de klantnaam hoort daar niet in.
  description: "Kies een module binnen de Careon Pulse-omgeving.",
};

export default async function Page() {
  // Platformbeheerders zonder organisatie horen op het superadmin-dashboard;
  // de launcher is organisatiegebonden. Superadmins mét lidmaatschap mogen de
  // launcher bewust bezoeken (login stuurt ze al direct naar /admin).
  const result = await getCareonSession();
  if (result.status === "ok" && result.session.isSuperadmin && !result.session.orgId) {
    redirect("/admin");
  }
  // Financiële rolregel: de modulekaart noemt leden geen "financieel";
  // demo/misconfigured valt open naar de volledige omschrijving.
  const financieelZichtbaar = result.status !== "ok" || magFinancieelZien(result.session);
  // Facturatietegel: zelfde bewuste fail-open voor demo/misconfigured (de
  // dataroutes blijven fail-closed — 501 in demo, RLS in productie). De
  // filtering gebeurt hiér, server-side: de launcher-client krijgt de tegel
  // van een member nooit in zijn props of bundel-data.
  const facturatieZichtbaar = result.status !== "ok" || magFacturatieZien(result.session);
  const modules = CAREON_MODULES.filter((mod) => mod.zichtbaarVoor !== "org_admin" || facturatieZichtbaar);
  const orgNaam = careonOrgNaam(result.status === "ok" ? result.session.orgName : null);

  return (
    <CareonAuthGuard>
      <ModuleLauncher modules={modules} financieelZichtbaar={financieelZichtbaar} orgNaam={orgNaam} />
    </CareonAuthGuard>
  );
}

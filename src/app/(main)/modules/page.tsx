import { redirect } from "next/navigation";

import type { Metadata } from "next";

import { CareonAuthGuard } from "@/app/(main)/dashboard/_components/careon/careon-auth-guard";
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
  const orgNaam = careonOrgNaam(result.status === "ok" ? result.session.orgName : null);

  return (
    <CareonAuthGuard>
      <ModuleLauncher financieelZichtbaar={financieelZichtbaar} orgNaam={orgNaam} />
    </CareonAuthGuard>
  );
}

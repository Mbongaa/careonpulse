import { redirect } from "next/navigation";

import type { Metadata } from "next";

import { CareonAuthGuard } from "@/app/(main)/dashboard/_components/careon/careon-auth-guard";
import { magFinancieelZien } from "@/lib/careon-financieel-rol";
import { getCareonSession } from "@/lib/supabase/session.server";

import { ModuleLauncher } from "./_components/module-launcher";

export const metadata: Metadata = {
  title: "Modules",
  description: "Kies een module binnen de Careon Pulse-omgeving van TGC Groep.",
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

  return (
    <CareonAuthGuard>
      <ModuleLauncher financieelZichtbaar={financieelZichtbaar} />
    </CareonAuthGuard>
  );
}

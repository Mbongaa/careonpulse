import type { ReactNode } from "react";

import Link from "next/link";

import { AdminUitloggen } from "@/app/(admin)/admin/_components/admin-uitloggen";
import { CareonAuthGuard } from "@/app/(main)/dashboard/_components/careon/careon-auth-guard";
import { CareonLogo } from "@/app/(main)/dashboard/_components/careon/careon-logo";
import { careonOrgNaam } from "@/lib/careon-org-naam";
import { requireFacturatiePage } from "@/lib/supabase/session.server";

import { FacturatieSubnav } from "./_components/facturatie-subnav";

// Eigen moduleschil voor Facturatie (handoff 15, klantcorrectie 09-08-2026):
// de tegel op /modules opent een zelfstandige module met eigen menu — géén
// sectie binnen het dashboard en dus ook niet de dashboard-sidebar. Zelfde
// snit als de beheerschil (/admin): kopregel met merkteken en modulenaam,
// eigen navigatie, weg terug naar de launcher. De pagina's gaten zichzelf
// óók (layout en page renderen parallel); demo/misconfigured vallen door
// naar de client, die dan op het lokale demo-pad draait (B12).
export default async function FacturatieLayout({ children }: Readonly<{ children: ReactNode }>) {
  const result = await requireFacturatiePage();
  const orgNaam = careonOrgNaam(result.status === "ok" ? result.session.orgName : null);

  return (
    <CareonAuthGuard>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <div className="flex items-center gap-3">
            <CareonLogo />
            <div className="border-l pl-3">
              <p className="font-semibold text-lg leading-tight">Facturatie</p>
              <p className="text-muted-foreground text-xs">{orgNaam}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link className="text-muted-foreground text-sm underline-offset-4 hover:underline" href="/modules">
              Naar modules
            </Link>
            <AdminUitloggen />
          </div>
        </header>
        <FacturatieSubnav />
        <main className="flex flex-1 flex-col gap-6 pb-10">{children}</main>
      </div>
    </CareonAuthGuard>
  );
}

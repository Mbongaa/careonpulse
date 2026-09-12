import type { ReactNode } from "react";

import { AdminUitloggen } from "@/app/(admin)/admin/_components/admin-uitloggen";
import { CareonAuthGuard } from "@/app/(main)/dashboard/_components/careon/careon-auth-guard";
import { CareonLogo } from "@/app/(main)/dashboard/_components/careon/careon-logo";
import { careonOrgNaam } from "@/lib/careon-org-naam";
import { magScribeBeheren } from "@/lib/careon-scribe-rol";
import { requireScribePage } from "@/lib/supabase/session.server";

import { ScribeUitgang, ScribeUitlogGrens } from "./_components/scribe-navigatie";
import { ScribeSubnav } from "./_components/scribe-subnav";

// Eigen moduleschil voor Careon AI (handoff 20 §7.1), identiek van snit aan
// de facturatieschil: de tegel op /modules opent een zelfstandige module met
// eigen menu — geen sectie binnen het dashboard en dus ook niet de
// dashboard-sidebar. De pagina's gaten zichzelf óók (layout en page renderen
// parallel); demo/misconfigured vallen door naar de client, die dan op het
// lokale demo-pad draait (B12).
//
// De schil zit als geheel in <CareonAuthGuard>: in demo-modus is dat de énige
// poort, want dan antwoordt elke serverroute 501.
export default async function ScribeLayout({ children }: Readonly<{ children: ReactNode }>) {
  const result = await requireScribePage();
  const orgNaam = careonOrgNaam(result.status === "ok" ? result.session.orgName : null);
  // Demo/misconfigured: bewust open naar het beheerdersbeeld — de dataroutes
  // blijven fail-closed en het demo-pad is er juist om alles te tonen.
  const beheerder = result.status !== "ok" || magScribeBeheren(result.session);

  return (
    <CareonAuthGuard>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <div className="flex items-center gap-3">
            <CareonLogo />
            <div className="border-l pl-3">
              <p className="font-semibold text-lg leading-tight">Careon AI</p>
              <p className="text-muted-foreground text-xs">{orgNaam}</p>
            </div>
          </div>
          {/* Uitgangen met opnamegrens (N15): loopt er een opname, dan vraagt
              de schil eerst om bevestiging voordat zij wegnavigeert. */}
          <div className="flex items-center gap-3">
            <ScribeUitgang className="text-muted-foreground text-sm underline-offset-4 hover:underline" href="/modules">
              Naar modules
            </ScribeUitgang>
            <ScribeUitlogGrens>
              <AdminUitloggen />
            </ScribeUitlogGrens>
          </div>
        </header>
        <ScribeSubnav beheerder={beheerder} />
        <main className="flex flex-1 flex-col gap-6 pb-10">{children}</main>
      </div>
    </CareonAuthGuard>
  );
}

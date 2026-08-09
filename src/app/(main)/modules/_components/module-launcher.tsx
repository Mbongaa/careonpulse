"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowRight, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

import { CareonLogo } from "@/app/(main)/dashboard/_components/careon/careon-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CAREON_MODULES, type CareonModule } from "@/data/careon/careon-modules";
import { CAREON_LOGIN_ROUTE, careonLogoutMetSignaal } from "@/lib/careon-auth";
import { meldOnbewaardeRegistraties } from "@/lib/careon-uitlog-melding.client";

function ModuleTile({ mod }: Readonly<{ mod: CareonModule }>) {
  if (mod.status === "live" && mod.href) {
    const linkClassName =
      "group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    const kaart = (
      <Card className="h-full transition-colors group-hover:border-primary/60">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">{mod.name}</CardTitle>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
          <CardDescription>{mod.description}</CardDescription>
        </CardHeader>
      </Card>
    );
    // Externe modules (volledige URL, bijv. YAAZ op de comms-plane) vallen
    // buiten de Next-router; interne routes houden client-side navigatie.
    if (/^https?:\/\//.test(mod.href)) {
      return (
        <a href={mod.href} className={linkClassName}>
          {kaart}
        </a>
      );
    }
    return (
      <Link href={mod.href} className={linkClassName}>
        {kaart}
      </Link>
    );
  }
  return (
    <Card aria-disabled="true" className="h-full border-dashed">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base text-muted-foreground">{mod.name}</CardTitle>
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            Binnenkort beschikbaar
          </Badge>
        </div>
        <CardDescription>{mod.description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export function ModuleLauncher({
  financieelZichtbaar = true,
  // Naam van de organisatie van de ingelogde gebruiker; de launcher staat
  // buiten de dashboard-provider, dus de server-pagina geeft hem door. Zonder
  // sessie (demo) valt careonOrgNaam terug op de geauditeerde demo-klant.
  orgNaam,
}: Readonly<{ financieelZichtbaar?: boolean; orgNaam: string }>) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  // Financiële rolregel: de modulekaart adverteert leden geen "financieel".
  const modules = financieelZichtbaar
    ? CAREON_MODULES
    : CAREON_MODULES.map((mod) =>
        mod.id === "careon-pulse-directie"
          ? { ...mod, description: "Zorgdashboard met KPI's, signaleringen en de AI-assistent." }
          : mod,
      );

  const handleLogout = async () => {
    setLoggingOut(true);
    const { ok, onbewaard } = await careonLogoutMetSignaal();
    if (!ok) {
      setLoggingOut(false);
      toast.error("Uitloggen is niet voltooid. Probeer het opnieuw.");
      return;
    }
    // De Toaster hangt in de root-layout, dus de melding overleeft de navigatie.
    meldOnbewaardeRegistraties(onbewaard);
    router.replace(CAREON_LOGIN_ROUTE);
  };

  return (
    <div className="careon-login-shell flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between gap-4 p-5 md:px-8 md:py-6">
        <CareonLogo />
        <Button variant="ghost" size="sm" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          Uitloggen
        </Button>
      </header>
      <main className="flex flex-1 items-center justify-center p-5 pb-16 md:p-8">
        <div className="w-full max-w-2xl space-y-8">
          <div className="space-y-2 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.36em]">{orgNaam}</p>
            <h1 className="font-semibold text-3xl tracking-tight">Kies een module</h1>
            <p className="mx-auto max-w-md text-muted-foreground">
              U bent ingelogd bij {orgNaam}. Open een module om verder te gaan.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {modules.map((mod) => (
              <ModuleTile key={mod.id} mod={mod} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

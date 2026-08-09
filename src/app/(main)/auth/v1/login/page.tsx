import type { Metadata } from "next";

import { CareonLogo } from "@/app/(main)/dashboard/_components/careon/careon-logo";
import { CAREON_ORG } from "@/data/careon/careon-filters";
import { isCareonDemoMode } from "@/lib/supabase/config";

import { CareonLoginForm } from "../../_components/careon-login-form";

// De loginpagina is zonder sessie bereikbaar; titel en omschrijving belanden in
// elke link-preview. Klantnaam blijft daarom achter de login.
export const metadata: Metadata = {
  title: "Inloggen",
  description: "Log in op uw beveiligde Careon Pulse-omgeving.",
};

export default async function LoginV1({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const query = await searchParams;
  const configurationError = query.error === "configuration";
  const environmentLabel = isCareonDemoMode()
    ? "Careon Group - beveiligde demo-omgeving"
    : "Careon Group - beveiligde omgeving";

  return (
    <div className="careon-login-shell flex min-h-dvh items-center justify-center overflow-hidden p-5 lg:justify-end lg:p-12">
      <div className="careon-login-card w-full max-w-md space-y-8 rounded-3xl p-7 text-center md:p-10 lg:mr-[7vw]">
        <div className="space-y-5">
          <CareonLogo variant="hero" />
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.36em]">{CAREON_ORG.tagline}</p>
            <h1 className="font-semibold text-4xl tracking-tight">Welkom terug</h1>
            <p className="mx-auto max-w-xs text-muted-foreground">Log in op uw beveiligde zorgdashboard.</p>
          </div>
        </div>
        <div className="space-y-4 text-left">
          <CareonLoginForm initiallyUnavailable={configurationError} />
          <p className="text-center text-muted-foreground text-xs">
            Toegangsgegevens ontvangt u van uw contactpersoon bij Careon.
          </p>
          <p className="text-center text-muted-foreground text-xs">{environmentLabel}</p>
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";

import { CareonLogo } from "@/app/(main)/dashboard/_components/careon/careon-logo";
import { CAREON_ORG } from "@/data/careon/careon-filters";

import { CareonLoginForm } from "../../_components/careon-login-form";

export const metadata: Metadata = {
  title: "Inloggen",
  description: "Log in op het zorgdashboard van TGC Groep.",
};

export default function LoginV1() {
  return (
    <div className="careon-login-shell flex min-h-dvh items-center justify-center overflow-hidden p-5 lg:justify-end lg:p-12">
      <div className="careon-login-card w-full max-w-md space-y-8 rounded-3xl p-7 text-center md:p-10 lg:mr-[7vw]">
        <div className="space-y-5">
          <CareonLogo className="justify-center" />
          <div className="space-y-2">
            {/* The logo already carries the tagline; showing it twice is only
                worth the space on the roomy desktop card. */}
            <p className="hidden text-[10px] text-muted-foreground uppercase tracking-[0.36em] lg:block">
              {CAREON_ORG.tagline}
            </p>
            <h1 className="font-semibold text-4xl tracking-tight">Welkom terug</h1>
            <p className="mx-auto max-w-xs text-muted-foreground">Log in op het zorgdashboard van TGC Groep.</p>
          </div>
        </div>
        <div className="space-y-4 text-left">
          <CareonLoginForm />
          <p className="text-center text-muted-foreground text-xs">
            Toegangsgegevens ontvangt u van uw contactpersoon bij Careon.
          </p>
          <p className="text-center text-muted-foreground text-xs">Careon Group - beveiligde demo-omgeving</p>
        </div>
      </div>
    </div>
  );
}

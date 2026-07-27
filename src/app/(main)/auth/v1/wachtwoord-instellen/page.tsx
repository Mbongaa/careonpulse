import type { Metadata } from "next";

import { CareonLogo } from "@/app/(main)/dashboard/_components/careon/careon-logo";
import { CAREON_ORG } from "@/data/careon/careon-filters";

import { CareonSetPasswordForm } from "../../_components/careon-set-password-form";

export const metadata: Metadata = {
  title: "Wachtwoord instellen",
  description: "Kies een eigen wachtwoord voor uw account.",
};

export default async function WachtwoordInstellen({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";

  return (
    <div className="careon-login-shell flex min-h-dvh items-center justify-center overflow-hidden p-5 lg:justify-end lg:p-12">
      <div className="careon-login-card w-full max-w-md space-y-8 rounded-3xl p-7 text-center md:p-10 lg:mr-[7vw]">
        <div className="space-y-5">
          <CareonLogo variant="hero" />
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.36em]">{CAREON_ORG.tagline}</p>
            <h1 className="font-semibold text-4xl tracking-tight">Wachtwoord instellen</h1>
            <p className="mx-auto max-w-xs text-muted-foreground">
              Kies een eigen wachtwoord voor uw account; daarna logt u ermee in.
            </p>
          </div>
        </div>
        <div className="space-y-4 text-left">
          <CareonSetPasswordForm token={token} />
          <p className="text-center text-muted-foreground text-xs">
            Werkt de link niet? Vraag uw beheerder om een nieuwe link.
          </p>
        </div>
      </div>
    </div>
  );
}

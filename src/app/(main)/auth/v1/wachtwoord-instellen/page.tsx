import type { Metadata } from "next";

import { CareonLogo } from "@/app/(main)/dashboard/_components/careon/careon-logo";

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
    // Zelfde authenticatie-vorm als de loginpagina (globals.css, .careon-auth-*).
    <div className="careon-auth-shell">
      <aside className="careon-auth-brand">
        <CareonLogo variant="hero" className="careon-auth-logo" />
        <p className="careon-auth-brand-tagline">
          Het beveiligde zorgdashboard van uw organisatie — KPI&apos;s, signaleringen en rapportages op één plek.
        </p>
        {/* Eén moduleregel op beide breekpunten (artboards 2c/2d tonen op mobiel
            ook de product-identificatie); de klantnaam blijft achter de login. */}
        <p className="careon-auth-eyebrow">Careon Pulse · Module 1</p>
      </aside>
      <main className="careon-auth-panel">
        <div className="careon-auth-column">
          <div className="careon-auth-card">
            <h1 className="careon-auth-title">Wachtwoord instellen</h1>
            <p className="careon-auth-sub">Kies een eigen wachtwoord voor uw account; daarna logt u ermee in.</p>
            <CareonSetPasswordForm token={token} />
          </div>
          <div className="careon-auth-foot">
            <p>Werkt de link niet? Vraag uw beheerder om een nieuwe link.</p>
          </div>
        </div>
      </main>
    </div>
  );
}

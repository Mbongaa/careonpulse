import type { Metadata } from "next";

import { CareonLogo } from "@/app/(main)/dashboard/_components/careon/careon-logo";
import { CAREON_ORG } from "@/data/careon/careon-filters";
import { isCareonDemoMode } from "@/lib/supabase/config";
import { isMicrosoftLoginEnabled } from "@/lib/supabase/oauth.server";

import { CareonLoginForm } from "../../_components/careon-login-form";

// De loginpagina is zonder sessie bereikbaar; titel en omschrijving belanden in
// elke link-preview. Klantnaam blijft daarom achter de login.
export const metadata: Metadata = {
  title: "Inloggen",
  description: "Log in op uw beveiligde Careon Pulse-omgeving.",
};

const MICROSOFT_LOGIN_ERRORS: Readonly<Record<string, string>> = {
  "microsoft-no-access":
    "Uw Microsoft-account is geldig, maar nog niet aan deze organisatie gekoppeld. Neem contact op met de beheerder.",
  "microsoft-cancelled":
    "Microsoft-inloggen is geannuleerd. U kunt het opnieuw proberen of met een wachtwoord inloggen.",
  "microsoft-unavailable": "Microsoft-inloggen is tijdelijk niet beschikbaar — probeer het later opnieuw.",
};

export default async function LoginV1({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const query = await searchParams;
  const configurationError = query.error === "configuration";
  const oauthError = Array.isArray(query.error) ? query.error[0] : query.error;
  const oauthMessage = oauthError ? (MICROSOFT_LOGIN_ERRORS[oauthError] ?? "") : "";
  // Middot als scheidingsteken, net als de andere regels op deze schermen.
  const environmentLabel = isCareonDemoMode()
    ? "Careon Group · beveiligde demo-omgeving"
    : "Careon Group · beveiligde omgeving";

  return (
    // Gedeelde authenticatie-vorm (globals.css, .careon-auth-*): mobiel één
    // gecentreerde kolom met de merk-glow-kaart, vanaf lg een split met het
    // merkpaneel links en het formulier rechts — dezelfde taal als de YAAZ-
    // loginschermen, maar met de Careon-lockup en Careon-copy.
    <div className="careon-auth-shell">
      <aside className="careon-auth-brand">
        <CareonLogo variant="hero" className="careon-auth-logo" />
        <p className="careon-auth-brand-tagline">
          Het beveiligde zorgdashboard van uw organisatie — KPI&apos;s, signaleringen en rapportages op één plek.
        </p>
        <p className="careon-auth-eyebrow careon-auth-desktop-only">Careon Pulse · Module 1</p>
        <p className="careon-auth-eyebrow careon-auth-mobile-only">{CAREON_ORG.tagline}</p>
      </aside>
      <main className="careon-auth-panel">
        <div className="careon-auth-column">
          <div className="careon-auth-card">
            <h1 className="careon-auth-title">Inloggen bij Careon Pulse</h1>
            <p className="careon-auth-sub">Medewerkers loggen veilig in met hun Microsoft 365-werkaccount.</p>
            <CareonLoginForm
              initiallyUnavailable={configurationError}
              initialErrorMessage={oauthMessage}
              microsoftEnabled={isMicrosoftLoginEnabled()}
            />
          </div>
          <div className="careon-auth-foot">
            <p>Wachtwoordtoegang is alleen voor platformbeheer en uitzonderingen.</p>
            <p>{environmentLabel}</p>
          </div>
        </div>
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";

import type { Metadata } from "next";

import { CareonLogo } from "@/app/(main)/dashboard/_components/careon/careon-logo";
import { Button } from "@/components/ui/button";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { getCareonSession } from "@/lib/supabase/session.server";

import { verleenToegang, weigerToegang } from "./actions";

export const metadata: Metadata = {
  title: "Toegang verlenen",
  description: "Autorisatiescherm van de Careon Pulse-identiteitshub.",
};

// Toestemmingsscherm van de OAuth 2.1-server (blueprint §4): een module (bijv.
// YAAZ) stuurt de gebruiker hierheen met een authorization_id; dit scherm
// toont wie toegang vraagt en meldt het besluit server-side terug aan Supabase.
// De proxy dwingt login af (needsAuth) — hier is altijd een sessie.

type AutorisatieDetails = {
  client?: { id?: string | null; name?: string | null; client_name?: string | null } | null;
  client_name?: string | null;
  scope?: string | null;
  /**
   * Aanwezig zodra de gebruiker deze client al eerder heeft goedgekeurd: de
   * hub keurt het verzoek dan zelf goed en levert meteen het doel. Er valt dan
   * niets meer te vragen — doorsturen is de enige juiste afhandeling.
   */
  redirect_url?: string | null;
};

/**
 * Eigen modules (first party) uit het moduleregister vragen geen toestemming:
 * de gebruiker koos de module al in de launcher, en het account, de organisatie
 * én de module zijn van hetzelfde platform. Een tussenscherm zou dan alleen een
 * extra klik zijn in wat één inlog hoort te zijn (blueprint §5/§20). Externe
 * clients — ooit — krijgen wél het toestemmingsscherm hieronder.
 */
const VERTROUWDE_CLIENTS = new Set(
  (process.env.CAREON_TRUSTED_OAUTH_CLIENTS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

// Zelfde authenticatie-vorm als login en wachtwoord instellen
// (globals.css, .careon-auth-*).
function Kader({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
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
          {children}
          <div className="careon-auth-foot">
            <p>Toegang geldt alleen voor deze module en kan door uw beheerder worden ingetrokken.</p>
            <p>Careon Group · beveiligde omgeving</p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default async function Page({
  searchParams,
}: Readonly<{ searchParams: Promise<{ authorization_id?: string; error?: string }> }>) {
  const { authorization_id: authorizationId, error } = await searchParams;
  if (!authorizationId || !/^[A-Za-z0-9_-]{8,128}$/.test(authorizationId)) redirect("/modules");

  const resultaat = await getCareonSession();
  // Demo-modus kent geen identiteitshub; echte login is een voorwaarde.
  if (resultaat.status === "demo" || resultaat.status === "misconfigured") redirect("/modules");
  if (resultaat.status !== "ok") redirect("/auth/v1/login");

  const antwoord = await fetch(`${SUPABASE_URL}/auth/v1/oauth/authorizations/${authorizationId}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${resultaat.session.accessToken}`,
    },
    cache: "no-store",
  });
  const details = (await antwoord.json().catch(() => null)) as AutorisatieDetails | null;
  if (!antwoord.ok || !details) {
    // Verlopen of al afgehandeld (het verzoek leeft ±10 minuten): geen besluit
    // meer mogelijk — opnieuw beginnen vanuit de module zelf.
    return (
      <Kader>
        <div className="careon-auth-card">
          <h1 className="careon-auth-title">Aanvraag verlopen</h1>
          <p className="careon-auth-sub">
            Dit toegangsverzoek is verlopen of al afgehandeld. Ga terug naar de module en probeer het opnieuw.
          </p>
        </div>
      </Kader>
    );
  }

  // Al eerder goedgekeurd: de hub heeft het verzoek zelf afgehandeld.
  if (details.redirect_url) redirect(details.redirect_url);

  // First-party module: direct goedkeuren en doorsturen — geen klik.
  const clientId = details.client?.id ?? "";
  if (clientId && VERTROUWDE_CLIENTS.has(clientId)) {
    const besluit = await fetch(`${SUPABASE_URL}/auth/v1/oauth/authorizations/${authorizationId}/consent`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${resultaat.session.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "approve" }),
      cache: "no-store",
    });
    const data = (await besluit.json().catch(() => null)) as { redirect_url?: string; url?: string } | null;
    const doel = data?.redirect_url ?? data?.url;
    // redirect() gooit een control-flow-fout: buiten de try/catch houden.
    if (besluit.ok && doel) redirect(doel);
    console.error("OAuth consent: automatische goedkeuring mislukt", besluit.status, data);
  }

  const moduleNaam = details.client?.name ?? details.client?.client_name ?? details.client_name ?? "Een module";

  return (
    <Kader>
      <div className="careon-auth-card">
        <h1 className="careon-auth-title">Toegang verlenen</h1>
        <p className="careon-auth-sub">
          <span className="careon-auth-strong">{moduleNaam}</span> wil uw Careon Pulse-account gebruiken om u aan te
          melden. U meldt zich aan als <span className="careon-auth-strong">{resultaat.session.email}</span>.
        </p>
        <div className="careon-auth-form">
          {error === "besluit" ? (
            <p role="alert" className="careon-auth-error">
              <span aria-hidden="true" className="careon-auth-error-dot" />
              Het besluit kon niet worden verwerkt. Probeer het opnieuw.
            </p>
          ) : null}
          <form action={verleenToegang}>
            <input type="hidden" name="authorization_id" value={authorizationId} />
            <Button type="submit" className="careon-auth-btn careon-auth-btn-primary">
              Toegang verlenen
            </Button>
          </form>
          <form action={weigerToegang}>
            <input type="hidden" name="authorization_id" value={authorizationId} />
            <Button type="submit" variant="ghost" className="careon-auth-btn careon-auth-btn-ghost">
              Weigeren
            </Button>
          </form>
        </div>
      </div>
    </Kader>
  );
}

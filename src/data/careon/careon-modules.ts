// Moduleregister voor het tussenscherm na inloggen (/modules). Webvoorloper
// van de server-gestuurde tile-registry met entitlements uit het
// platform-blueprint (docs/platform/PLATFORM_BLUEPRINT.md §5): een nieuwe
// module toevoegen is één entry hier.
export type CareonModuleStatus = "live" | "coming-soon";

/** Wie de tegel te zien krijgt — webvoorloper van de entitlements uit
    blueprint §5/D13. Filtering gebeurt SERVER-SIDE in /modules (page.tsx);
    de launcher-client krijgt alleen de al gefilterde lijst als prop. */
export type CareonModuleZichtbaarheid = "iedereen" | "org_admin";

/** Beeldmerk op de moduletegel (klantverzoek 14-08-2026), naast de bestaande
    naam en omschrijving. "careon-mark" = het statische Careon Pulse-merkteken
    (CareonMark, animatie uit); "image" = een bestand uit /public (breedte en
    hoogte in px, zodat de tegel geen layout-sprong maakt). `wit` markeert een
    wit beeldmerk: op het lichte thema wordt het geïnverteerd getoond, anders
    zou het onzichtbaar zijn op de witte kaart. */
export type CareonModuleLogo =
  | { type: "careon-mark" }
  | { type: "image"; src: string; breedte: number; hoogte: number; wit?: boolean }
  | { type: "wordmark"; label: string };

export type CareonModule = {
  id: string;
  name: string;
  description: string;
  status: CareonModuleStatus;
  /** Optioneel beeldmerk links van naam en omschrijving op de tegel; zonder = alleen tekst. */
  logo?: CareonModuleLogo;
  /**
   * Route van de module; alleen aanwezig wanneer status "live" is. Interne
   * routes ("/dashboard/…") navigeren binnen de app; een volledige URL opent
   * een externe module (bijv. YAAZ/HumHub op de comms-plane).
   */
  href?: string;
  /** Default "iedereen". */
  zichtbaarVoor?: CareonModuleZichtbaarheid;
};

// YAAZ (Module 2 — communicatie, HumHub op de comms-plane) gaat live zodra de
// omgeving zijn URL kent: lokaal http://localhost (platform-deploy-stack),
// later de publieke comms-URL. Zonder URL blijft de tegel "binnenkort", zodat
// dezelfde code geldig blijft voor omgevingen zonder draaiende comms-plane.
const YAAZ_URL = process.env.NEXT_PUBLIC_YAAZ_URL;

// Professionele product-wordmark zolang de klant geen officieel los YAAZ-
// beeldbestand heeft aangeleverd. De variant is bewust tekst/CSS: scherp op
// ieder scherm, geen verzonnen beeldmerk en later één-op-één vervangbaar door
// een goedgekeurd bestand uit /public/branding.
const YAAZ_LOGO: CareonModuleLogo = { type: "wordmark", label: "YAAZ" };

export const CAREON_MODULES: readonly CareonModule[] = [
  {
    id: "careon-pulse-directie",
    name: "Careon Pulse Directie",
    description: "Zorgdashboard met KPI's, signaleringen, financieel en de AI-assistent.",
    status: "live",
    href: "/dashboard/directiecockpit",
    logo: { type: "careon-mark" },
  },
  YAAZ_URL
    ? {
        id: "yaaz",
        name: "YAAZ",
        description: "Communicatieplatform: nieuws, gesprekken, ruimtes en documenten.",
        status: "live",
        href: YAAZ_URL,
        logo: YAAZ_LOGO,
      }
    : {
        id: "yaaz",
        name: "YAAZ",
        description: "Nieuwe module binnen Careon Pulse.",
        status: "coming-soon",
        logo: YAAZ_LOGO,
      },
  // Facturatie (handoff 15): beheerdersmodule — alleen zichtbaar voor
  // org_admins/superadmins mét organisatie (en het demo-account, B12).
  {
    id: "careon-facturatie",
    name: "Facturatie",
    description: "Facturen opstellen met live pdf-voorbeeld, contacten beheren en facturen archiveren.",
    status: "live",
    href: "/facturatie",
    zichtbaarVoor: "org_admin",
  },
];

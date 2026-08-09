// Moduleregister voor het tussenscherm na inloggen (/modules). Webvoorloper
// van de server-gestuurde tile-registry met entitlements uit het
// platform-blueprint (docs/platform/PLATFORM_BLUEPRINT.md §5): een nieuwe
// module toevoegen is één entry hier.
export type CareonModuleStatus = "live" | "coming-soon";

/** Wie de tegel te zien krijgt — webvoorloper van de entitlements uit
    blueprint §5/D13. Filtering gebeurt SERVER-SIDE in /modules (page.tsx);
    de launcher-client krijgt alleen de al gefilterde lijst als prop. */
export type CareonModuleZichtbaarheid = "iedereen" | "org_admin";

export type CareonModule = {
  id: string;
  name: string;
  description: string;
  status: CareonModuleStatus;
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

export const CAREON_MODULES: readonly CareonModule[] = [
  {
    id: "careon-pulse-directie",
    name: "Careon Pulse Directie",
    description: "Zorgdashboard met KPI's, signaleringen, financieel en de AI-assistent.",
    status: "live",
    href: "/dashboard/directiecockpit",
  },
  YAAZ_URL
    ? {
        id: "yaaz",
        name: "YAAZ",
        description: "Communicatieplatform: nieuwsfeed, berichten, Spaces en bestanden.",
        status: "live",
        href: YAAZ_URL,
      }
    : {
        id: "yaaz",
        name: "YAAZ",
        description: "Nieuwe module binnen Careon Pulse.",
        status: "coming-soon",
      },
  // Facturatie (handoff 15): beheerdersmodule — alleen zichtbaar voor
  // org_admins/superadmins mét organisatie (en het demo-account, B12).
  {
    id: "careon-facturatie",
    name: "Facturatie",
    description: "Facturen opstellen met live pdf-voorbeeld, contacten beheren en facturen archiveren.",
    status: "live",
    href: "/dashboard/facturatie",
    zichtbaarVoor: "org_admin",
  },
];

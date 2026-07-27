// Moduleregister voor het tussenscherm na inloggen (/modules). Webvoorloper
// van de server-gestuurde tile-registry met entitlements uit het
// platform-blueprint (docs/platform/PLATFORM_BLUEPRINT.md §5): een nieuwe
// module toevoegen is één entry hier.
export type CareonModuleStatus = "live" | "coming-soon";

export type CareonModule = {
  id: string;
  name: string;
  description: string;
  status: CareonModuleStatus;
  /** Interne route van de module; alleen aanwezig wanneer status "live" is. */
  href?: string;
};

export const CAREON_MODULES: readonly CareonModule[] = [
  {
    id: "careon-pulse-directie",
    name: "Careon Pulse Directie",
    description: "Zorgdashboard met KPI's, signaleringen, financieel en de AI-assistent.",
    status: "live",
    href: "/dashboard/directiecockpit",
  },
  {
    id: "yaaz",
    name: "YAAZ",
    description: "Nieuwe module voor TGC Groep.",
    status: "coming-soon",
  },
];

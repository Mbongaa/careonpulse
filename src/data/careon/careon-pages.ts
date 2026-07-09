import type { CareonPageId } from "./careon-types";

export const CAREON_ROUTES: Record<CareonPageId, string> = {
  cockpit: "/dashboard/directiecockpit",
  signaleringen: "/dashboard/signaleringen",
  patienten: "/dashboard/patienten",
  planning: "/dashboard/planning",
  behandelaren: "/dashboard/behandelaren",
  dossiers: "/dashboard/dossiercontrole",
  dossiersProductie: "/dashboard/dossiers-productie",
  kwaliteit: "/dashboard/kwaliteit",
  financieel: "/dashboard/financieel",
  hr: "/dashboard/hr",
  databron: "/dashboard/databron",
};

export const CAREON_PAGE_META: Record<CareonPageId, { title: string; sub: string }> = {
  cockpit: {
    title: "Directiecockpit",
    sub: "Alles wat er vandaag speelt binnen TGC Groep — in één oogopslag.",
  },
  signaleringen: {
    title: "Signaleringen",
    sub: "Automatische aandachtspunten uit alle modules, gerangschikt op urgentie.",
  },
  patienten: {
    title: "Patiënten",
    sub: "Instroom, uitstroom, wachtlijsten en de cliënten die vandaag aandacht vragen.",
  },
  planning: {
    title: "Planning",
    sub: "Agenda-bezetting, no-shows en de verhouding tussen productieve en indirecte uren.",
  },
  behandelaren: {
    title: "Behandelaren",
    sub: "Caseload, productiviteit en kwaliteit per behandelaar.",
  },
  dossiers: {
    title: "Dossiercontrole",
    sub: "Twaalf automatische controles op dossiervolledigheid.",
  },
  dossiersProductie: {
    title: "Dossiers & productie",
    sub: "Dossiers, afsluitingen en productie per medewerker — plus de cliëntpopulatie in één oogopslag.",
  },
  kwaliteit: {
    title: "Kwaliteit",
    sub: "ROM/PROM-compliance, incidenten en dossierkwaliteit.",
  },
  financieel: {
    title: "Financieel",
    sub: "Omzet, onderhanden werk en declaratiestromen.",
  },
  hr: {
    title: "HR",
    sub: "Verzuim, verloop, opleidingen en BIG-registraties.",
  },
  databron: {
    title: "Databron",
    sub: "Van EPD-export naar live inzicht — in twee stappen.",
  },
};

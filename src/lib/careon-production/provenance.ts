// Centrale herkomst-registratie voor productie-modus: per widget staat vast of
// de waarde uit de EPD-export komt ("live"), een gedocumenteerde afleiding is
// ("proxy") of demo-data blijft tot de betreffende export beschikbaar is
// ("demo"). De UI toont badges en paginatellers op basis van dit register —
// nergens anders wordt herkomst bepaald.

// Relatieve imports (geen @/-alias): dit bestand draait ook onder ts-node in
// verify-scripts, waar de alias niet resolvet voor runtime-imports.
import { CASELOAD_NORM } from "../../data/careon/careon-behandelaren";
import { REGIE_NORM } from "../../data/careon/careon-dossiers-productie";

export type WidgetSource = "live" | "proxy" | "demo";

export interface PageProvenance {
  /** Widget-id (KPI-label of widget-naam) → herkomst. */
  widgets: Record<string, WidgetSource>;
}

export const PROXY_NOTES: Record<string, string> = {
  "Outreachende cliënten": "Afgeleid van ZPM-setting S04 (outreachend) — bevestiging van de instelling gevraagd.",
  "Dossiers niet compleet":
    "Op basis van de controles die de cliëntenexport ondersteunt: diagnose, zorgvraagtypering en verwijzer.",
  "Urgent op wachtlijst": "Proxy: wachtenden die langer dan 60 dagen wachten (de export bevat geen urgentievlag).",
  "Wachtduur wachtlijst": "Wachtduur gemeten sinds episodestart (interne wachtlijst) of sinds verwijsdatum.",
  "Wachttijden vs. Treeknorm":
    "Intake = gerealiseerde wachttijd verwijzing→start; behandeling = wachtduur van huidige wachtenden.",
};

export const CAREON_PROVENANCE: Record<string, PageProvenance> = {
  cockpit: {
    widgets: {
      "Actieve patiënten": "live",
      "Nieuwe aanmeldingen": "live",
      "Gesloten dossiers": "live",
      "No-show": "demo",
      "Zonder vervolgafspraak": "demo",
      "Dossiers niet compleet": "proxy",
      "Omzet verzekeraars": "demo",
      "Omzet Infomedics": "demo",
      "Outreachende cliënten": "proxy",
      Cliënttevredenheid: "demo",
      "Instroom & uitstroom": "live",
      "No-show trend": "demo",
      Caseload: "live",
      Omzetontwikkeling: "demo",
      "Careon Insights": "live",
      "Urgente signaleringen": "live",
      "Dossiers & productie": "live",
    },
  },
  signaleringen: {
    widgets: {
      // Sleutels zijn de exacte alert-titels (CAREON_ALERTS en de titels die
      // compute-snapshot produceert) — bewaakt door verify:production. De
      // norm-titels zijn afgeleid van dezelfde constanten als de alerts zelf,
      // zodat een normwijziging de registratie niet stil kan breken.
      "Wachtlijst boven Treeknorm": "live",
      [`Caseload boven norm (>${CASELOAD_NORM})`]: "live",
      [`Regiebehandelaar boven norm (>${REGIE_NORM})`]: "live",
      "Wachtenden >60 dagen": "proxy",
      "Geen primaire diagnose": "live",
      "Zonder behandelaar": "live",
      "Geen zorgvraagtypering": "live",
      "Geen contact >60 dagen": "demo",
      "Zonder vervolgafspraak": "demo",
      "Dossiers zonder behandelplan": "demo",
      "Declaraties >90 dagen open": "demo",
      "BIG-registratie verloopt <90 dgn": "demo",
      "No-show >5% per behandelaar": "demo",
      "Geen ROM-meting": "demo",
      "Geen evaluatie gepland": "demo",
    },
  },
  patienten: {
    widgets: {
      "Actieve patiënten": "live",
      "Nieuwe patiënten": "live",
      Uitstroom: "live",
      "Wachtlijst intake": "live",
      "Wachtlijst behandeling": "live",
      "Zonder behandelaar": "live",
      "Zonder vervolgafspraak": "demo",
      ">30 dgn geen contact": "demo",
      ">60 dgn geen contact": "demo",
      Crisiscliënten: "demo",
      "Wachttijden vs. Treeknorm": "proxy",
      Zorgvorm: "demo",
      "Vraagt aandacht": "live",
    },
  },
  planning: {
    widgets: {
      "Afspraken deze maand": "demo",
      "No-shows": "demo",
      Geannuleerd: "demo",
      "Agenda-bezetting": "demo",
      "Beschikbare uren": "demo",
      "Productieve uren": "demo",
      Behandeluren: "demo",
      "Indirecte uren": "demo",
      "Gem. wachttijd (wkn)": "live",
      Urenverdeling: "demo",
      "No-show per weekdag": "demo",
    },
  },
  behandelaren: {
    widgets: {
      Behandelaren: "live",
    },
  },
  dossiers: {
    widgets: {
      "Dossier-compliance": "proxy",
      "Gecontroleerde dossiers": "live",
      "Niet compleet": "proxy",
      Dossierkwaliteit: "demo",
      "Open actiepunten": "proxy",
    },
  },
  dossiersProductie: {
    widgets: {
      "Actieve cliënten": "live",
      Afsluitingen: "live",
      "Productie-uren": "demo",
      Productiviteit: "demo",
      "Wachtlijst totaal": "live",
      "Urgent op wachtlijst": "proxy",
      "Productie per medewerker": "live",
      Diagnoses: "live",
      Geslacht: "live",
      Leeftijd: "live",
      Verwijzers: "live",
      Plaats: "live",
      Verzekeringskoepel: "live",
      Regiebehandelaren: "live",
      Wachtlijst: "proxy",
      "Careon Insights": "live",
    },
  },
  kwaliteit: {
    widgets: {
      "ROM-compliance": "demo",
      "PROM-compliance": "demo",
      "Evaluaties op tijd": "demo",
      "Zorgplannen compleet": "demo",
      Medicatiecontroles: "demo",
      Suïcidaliteitsscreening: "demo",
      Dossierkwaliteit: "demo",
      "Incidenten (MIC)": "demo",
      Klachten: "demo",
      Cliënttevredenheid: "demo",
    },
  },
  financieel: {
    widgets: {
      "Omzet verzekeraars": "demo",
      "Omzet Infomedics": "demo",
      "Onderhanden werk": "demo",
      "Openstaande declaraties": "demo",
      "Afgekeurde declaraties": "demo",
      "Gem. omzet / cliënt": "demo",
      "Gem. omzet / traject": "demo",
      "Declaraties >90 dgn": "demo",
      Omzetontwikkeling: "demo",
      "Omzet per verzekeraar": "demo",
      "Omzet per locatie": "demo",
      "Ouderdom openstaande declaraties": "demo",
    },
  },
  hr: {
    widgets: {
      Ziekteverzuim: "demo",
      "Verloop (12m)": "demo",
      "Openstaande vacatures": "demo",
      "Lopende opleidingen": "demo",
      "Intervisie-deelname": "demo",
      Werkdrukscore: "demo",
      "Verzuim-trend": "demo",
      "BIG-registraties": "demo",
    },
  },
};

export function widgetSource(pageId: string, widgetId: string): WidgetSource {
  return CAREON_PROVENANCE[pageId]?.widgets[widgetId] ?? "demo";
}

export function pageLiveCounts(pageId: string): { live: number; total: number } {
  const widgets = CAREON_PROVENANCE[pageId]?.widgets ?? {};
  const sources = Object.values(widgets);
  return {
    live: sources.filter((source) => source !== "demo").length,
    total: sources.length,
  };
}

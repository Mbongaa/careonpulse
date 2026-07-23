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
  ">30 dgn geen registratie":
    "Ondergrens-proxy: niet-wachtende dossiers >30 dagen open zonder één minuut geregistreerde tijd (contactdata vereist de afsprakenexport).",
  ">60 dgn geen registratie":
    "Ondergrens-proxy: niet-wachtende dossiers >60 dagen open zonder één minuut geregistreerde tijd (contactdata vereist de afsprakenexport).",
  "Hoog-risico (ZT05/ZT08)":
    "Proxy voor crisisrisico: zorgvraagtypen ZT05 (zeer ernstig) en ZT08 (zeer risicovol/chaotisch); echte crisisdata vereist de afspraken-/verrichtingenexport.",
  Zorgvorm:
    "ZPM-setting (S03 ambulant / S04 outreachend); het ZPM-label is voor deze instelling 100% SGGZ. S04 = outreachend wacht op bevestiging.",
  "Productie-uren":
    "Cumulatief geregistreerde tijd over de looptijd van actieve dossiers — geen maandproductie (daarvoor is de urenregistratie-export nodig).",
  Dossierkwaliteit:
    "Registratie-compleetheid uit de cliëntenexport (zelfde score als Dossiercontrole, op 10) — geen inhoudelijke audit.",
};

// Voetnoot op KPI-detailpagina's in productie-modus wanneer de records nog
// demo zijn: benoemt expliciet op welke aanvullende export het domein wacht.
export const DETAIL_WAIT_NOTES: Record<string, string> = {
  planning:
    "Demo-records — de agenda-import bewaart uit privacy-oogpunt alleen aggregaten, geen losse afspraakregels; na een agenda-import zijn de kaartwaarden op de Planning-pagina wél live.",
  financieel:
    "Demo-records — echte declaratieregels vereisen de declaratie-export (Vecozo/Infomedics); na een agenda-import komen de omzetcijfers op de Financieel-pagina wél live uit de agenda.",
  hr: "Demo-records — echte personeelsgegevens vereisen de HR-export.",
  kwaliteit: "Demo-records — echte metingen vereisen de ROM/MIC-export.",
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
      "Omzet RMO/RMA": "demo",
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
      // Demo-labels blijven geregistreerd (demo-modus toont ze); in productie
      // vervangen de proxy-varianten hieronder ze onder een eerlijker label.
      ">30 dgn geen contact": "demo",
      ">60 dgn geen contact": "demo",
      Crisiscliënten: "demo",
      ">30 dgn geen registratie": "proxy",
      ">60 dgn geen registratie": "proxy",
      "Hoog-risico (ZT05/ZT08)": "proxy",
      "Wachttijden vs. Treeknorm": "proxy",
      "Wachttijd-trend": "live",
      Zorgvorm: "proxy",
      "Vraagt aandacht": "live",
      Populatieprofiel: "live",
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
      // Productie-exclusief paneel (geen demo-tegenhanger); flipt via agenda-cap.
      Sessievormen: "demo",
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
      "Productie-uren": "proxy",
      Productiviteit: "demo",
      "Wachtlijst totaal": "live",
      "Urgent op wachtlijst": "proxy",
      "Productie per medewerker": "live",
      Diagnoses: "live",
      Zorgvraagtypering: "live",
      Behandelduur: "live",
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
      Dossierkwaliteit: "proxy",
      "Incidenten (MIC)": "demo",
      Klachten: "demo",
      Cliënttevredenheid: "demo",
    },
  },
  financieel: {
    widgets: {
      // "Totale omzet" en "Omzet RMO/RMA" zijn productie-exclusieve kaarten
      // (klantformaat FACTURATIE.xlsx) — in demo-modus renderen ze niet, maar
      // de registratie bewaakt de herkomst-sleutels (verify:careon).
      "Totale omzet": "demo",
      "Omzet verzekeraars": "demo",
      "Omzet Infomedics": "demo",
      "Omzet RMO/RMA": "demo",
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

// ---- Overlay: aanvullende exports ----
// Het basisregister beschrijft de stand mét alleen de cliëntendata-export.
// Zodra de agenda- of verwijzersexport is geïmporteerd, schuiven de
// betreffende widgets op — de badge volgt de werkelijk aanwezige bron.
export interface ProvenanceCaps {
  agenda?: boolean;
  /** Agenda-export mét toekomstvenster (geplande afspraken ná de peildatum). */
  agendaToekomst?: boolean;
  verwijzers?: boolean;
  /** Toeslagen-export (declared surcharges) gekoppeld. */
  toeslagen?: boolean;
  /** Declaratie-totaaloverzicht gekoppeld. */
  declaraties?: boolean;
}

export const AGENDA_PROVENANCE: Record<string, Record<string, WidgetSource>> = {
  cockpit: {
    "No-show": "live",
    "No-show trend": "live",
    "Omzet verzekeraars": "live",
    "Omzet Infomedics": "proxy",
    "Omzet RMO/RMA": "live",
    Omzetontwikkeling: "live",
  },
  signaleringen: {
    "Geen contact >60 dagen": "live",
    "No-show >5% per behandelaar": "live",
    "Dossiers zonder behandelplan": "proxy",
    "Sessies >90 dgn niet gefactureerd": "proxy",
  },
  patienten: {
    ">30 dgn geen contact": "live",
    ">60 dgn geen contact": "live",
    ">30 dgn geen registratie": "live",
    ">60 dgn geen registratie": "live",
  },
  planning: {
    "Afspraken deze maand": "live",
    "No-shows": "live",
    Geannuleerd: "live",
    "Agenda-bezetting": "proxy",
    "Beschikbare uren": "proxy",
    "Productieve uren": "proxy",
    Behandeluren: "live",
    "Indirecte uren": "live",
    Urenverdeling: "live",
    "No-show per weekdag": "live",
    Sessievormen: "live",
  },
  financieel: {
    "Totale omzet": "live",
    "Omzet verzekeraars": "live",
    "Omzet Infomedics": "proxy",
    "Omzet RMO/RMA": "live",
    "Onderhanden werk": "proxy",
    "Gem. omzet / cliënt": "live",
    "Gem. omzet / traject": "live",
    "Declaraties >90 dgn": "proxy",
    Omzetontwikkeling: "live",
    "Omzet per verzekeraar": "live",
    "Omzet per locatie": "live",
    "Ouderdom openstaande declaraties": "proxy",
  },
  behandelaren: {
    Behandelaren: "live",
    Beroepsmix: "live",
  },
  dossiers: {
    "Sessie zonder sessieverslag (agenda)": "live",
    "Sessie niet ondertekend (agenda)": "live",
  },
  dossiersProductie: {
    "Productie-uren": "live",
    Productiviteit: "proxy",
  },
};

// Extra overlay wanneer de agenda-export een toekomstvenster heeft (einddatum
// in de toekomst): pas dan is "geen vervolgafspraak" te onderscheiden van
// "niet geëxporteerd".
export const AGENDA_TOEKOMST_PROVENANCE: Record<string, Record<string, WidgetSource>> = {
  cockpit: {
    "Zonder vervolgafspraak": "live",
  },
  patienten: {
    "Zonder vervolgafspraak": "live",
  },
  // "Geen evaluatie gepland" blijft bewust demo: toekomstige MDO-sessies staan
  // in de export vrijwel allemaal zonder cliënt-ID (nog niet toegewezen
  // MDO-blokken) — per cliënt is dit niet eerlijk te meten.
  signaleringen: {
    "Zonder vervolgafspraak": "live",
  },
  planning: {
    Vooruitblik: "live",
  },
};

export const VERWIJZERS_PROVENANCE: Record<string, Record<string, WidgetSource>> = {
  dossiersProductie: {
    Verwijzers: "live",
    Verwijsnetwerk: "live",
  },
};

export const TOESLAGEN_PROVENANCE: Record<string, Record<string, WidgetSource>> = {
  financieel: {
    Toeslagen: "live",
  },
};

export const DECLARATIES_PROVENANCE: Record<string, Record<string, WidgetSource>> = {
  financieel: {
    "Openstaande declaraties": "live",
    "Afgekeurde declaraties": "proxy",
    "Declaraties >90 dgn": "live",
    "Ouderdom openstaande declaraties": "live",
    Declaratiestatus: "live",
  },
  signaleringen: {
    "Declaraties >90 dagen open": "live",
  },
};

export const DECLARATIES_PROXY_NOTES: Record<string, string> = {
  "Afgekeurde declaraties":
    "Tekort op toekenning: verschil tussen gefactureerd en toegekend op deels-toegekende facturen. Of dit afwijzing of nabetaling wordt, vereist de Vecozo-retourinformatie.",
};

// Proxy-toelichtingen voor de agenda-afleidingen (zelfde mechaniek als PROXY_NOTES).
export const AGENDA_PROXY_NOTES: Record<string, string> = {
  "Agenda-bezetting":
    "Agenda-vulling: sessietijd als aandeel van sessietijd + afwezig-blokken. Contracturen zitten niet in de export (HR-export nodig voor echte bezetting).",
  "Beschikbare uren":
    "De export kent geen contracturen; getoond wordt de als 'Afwezig' geblokkeerde agendatijd van de maand.",
  "Productieve uren": "Alle geregistreerde sessietijd (direct + indirect + reistijd) in de maand.",
  "Onderhanden werk": "Geprijsde sessies zonder factuurnummer — de export bevat geen declaratiestatus (Vecozo).",
  "Declaraties >90 dgn": "Geprijsde sessies die >90 dagen na de afspraakmaand nog geen factuurnummer hebben.",
  "Dossiers zonder behandelplan": "Actieve dossiers (>30 dagen open) zonder behandelplan-sessie in de agenda-export.",
  "Sessies >90 dgn niet gefactureerd":
    "Geprijsde sessies die >90 dagen na de afspraakmaand nog geen factuurnummer hebben.",
  "Ouderdom openstaande declaraties":
    "Ouderdom van het onderhanden werk (nog niet gefactureerde sessiewaarde) — geen declaratiestatus.",
  Productiviteit: "Directe tijd als aandeel van de totale geregistreerde sessietijd (laatste 12 agenda-maanden).",
  "Omzet Infomedics":
    "Conform opgave van de instelling: alleen VGZ en DSW declareren rechtstreeks via Vecozo; alle overige koepels lopen via het servicebureau (Infomedics). RMO/RMA (Uzovi 3355) is datagedreven afgesplitst; de kanaal-indeling zelf blijft een opgave, geen exportveld. Per behandelmaand, excl. toeslagen.",
};

export function widgetSource(pageId: string, widgetId: string, caps?: ProvenanceCaps): WidgetSource {
  if (caps?.verwijzers) {
    const override = VERWIJZERS_PROVENANCE[pageId]?.[widgetId];
    if (override) return override;
  }
  if (caps?.toeslagen) {
    const override = TOESLAGEN_PROVENANCE[pageId]?.[widgetId];
    if (override) return override;
  }
  if (caps?.declaraties) {
    const override = DECLARATIES_PROVENANCE[pageId]?.[widgetId];
    if (override) return override;
  }
  if (caps?.agendaToekomst) {
    const override = AGENDA_TOEKOMST_PROVENANCE[pageId]?.[widgetId];
    if (override) return override;
  }
  if (caps?.agenda) {
    const override = AGENDA_PROVENANCE[pageId]?.[widgetId];
    if (override) return override;
  }
  return CAREON_PROVENANCE[pageId]?.widgets[widgetId] ?? "demo";
}

export function pageLiveCounts(pageId: string, caps?: ProvenanceCaps): { live: number; total: number } {
  const widgets = CAREON_PROVENANCE[pageId]?.widgets ?? {};
  const sources = Object.keys(widgets).map((widgetId) => widgetSource(pageId, widgetId, caps));
  return {
    live: sources.filter((source) => source !== "demo").length,
    total: sources.length,
  };
}

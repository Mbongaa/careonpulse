import type { CareonKpiFormat, CareonSeverity } from "@/data/careon/careon-types";

// ---- Pseudonymized client record ----
// Built from the ZSG "Cliëntendata" export. Direct identifiers (naam,
// geboortedatum, verzekeringsnummer, postcode) are dropped at parse time and
// never stored; alleen dashboard-relevante attributen blijven over.
export interface ClientRecord {
  /** Cliënt ID uit het EPD — het enige identificerende veld dat bewaard blijft. */
  id: string;
  geslacht: "Vrouw" | "Man" | "Anders";
  leeftijd: number | null;
  plaats: string | null;
  /** Genormaliseerde vestiging: "Tilburg" | "Breda" | "Roermond" | overig. */
  vestiging: string | null;
  zpmLabel: string | null;
  setting: string | null;
  regiebehandelaar: string | null;
  behandelaar: string | null;
  verwijzer: string | null;
  verzekeraar: string | null;
  /** ISO-datums (yyyy-mm-dd) of null. */
  episodeStart: string | null;
  episodeEind: string | null;
  verwijsdatum: string | null;
  /** Cumulatieve minuten over de looptijd van het dossier (geen datumdimensie). */
  directeTijdMin: number;
  indirecteTijdMin: number;
  totaleTijdMin: number;
  diagnoseCode: string | null;
  diagnoseGroep: string | null;
  /**
   * Later toegevoegde velden zijn optioneel (`?`): records uit een oudere
   * opgeslagen state missen ze; de parser vult ze altijd. Consumenten
   * behandelen undefined als null/false.
   */
  /** Menselijk leesbare naam van de primaire diagnose (1-op-1 met de code). */
  diagnoseOmschrijving?: string | null;
  /** Er is een secundaire diagnose geregistreerd (comorbiditeit) — alleen ja/nee. */
  heeftSecundaireDiagnose?: boolean;
  zorgvraagtype: string | null;
  /** Omschrijving achter de ZT-code, bijv. "Psychische aandoening - matige problematiek". */
  zorgvraagtypeOmschrijving?: string | null;
  /** HoNOS-voorgestelde typering (ZT-code) — vergelijking met de geselecteerde. */
  voorgesteldZorgvraagtype?: string | null;
  /** AGB-code van de verwijzer: authoritatieve groepering van praktijkvarianten. */
  verwijzerAgb?: string | null;
  /** COV-verzekeringscheck (Uzovi-code) — aanwezigheid = check uitgevoerd. */
  covUzovi?: string | null;
  /** Zorgtraject-datums: de échte aanmelding/uitstroom (episodes kunnen
   * her-registraties binnen een traject zijn); fallback = episode-datums. */
  trajectStart?: string | null;
  trajectEind?: string | null;
  /** Einddatum van de gecontroleerde polis (ISO) — verlopen = declaratierisico. */
  polisEinde?: string | null;
  wachtlijst: boolean;
  wachtlijstLabels: string[];
  preWachtlijst: boolean;
  dossierUrl: string | null;
}

export interface ImportWarning {
  row: number;
  message: string;
}

export interface ParseExportResult {
  ok: boolean;
  error?: string;
  records: ClientRecord[];
  totalRows: number;
  skippedRows: number;
  warnings: ImportWarning[];
}

// ---- Live metrics ----
// prev === null betekent: geen historische meting beschikbaar (snapshot-veld
// zonder reconstrueerbare historie). De UI verbergt dan de delta-badge.
export interface LiveMetric {
  label: string;
  value: number;
  prev: number | null;
  f: CareonKpiFormat;
  betterLow?: boolean;
  neutralDown?: boolean;
  /** Venster van de meting, getoond in de subtekst (bijv. "juni"). */
  windowLabel?: string;
  /** Vervangt "vorige maand" wanneer de vergelijking een ander venster heeft. */
  prevLabel?: string;
  /** Geen meetwaarde in dit venster: toon "—" i.p.v. een misleidende 0. */
  noData?: boolean;
  /** Tweede waarde onder de hoofdwaarde (bijv. "Verwacht uitbetaald (65%)"). */
  secondary?: { label: string; value: number; f: CareonKpiFormat };
}

export interface AantalGroep {
  label: string;
  aantal: number;
}

export interface ProductionMonthPoint {
  /** Nederlandse maandafkorting, bijv. "aug". */
  m: string;
  /** Sorteerbare sleutel "2025-08". */
  key: string;
  aanmeldingen: number;
  uitstroom: number;
  caseload: number;
  /** Binnengekomen verwijzingen (vraagkant) — recente maanden mogelijk onvolledig. */
  verwijzingen: number;
  /** No-show-percentage uit de agenda-export; null zonder agenda(-data die maand). */
  noshowPct: number | null;
  /** Totale gefactureerde omzet per behandelmaand (excl. toeslagen); null zonder agenda. */
  omzet: number | null;
  /** Rechtstreeks gedeclareerd via Vecozo: VGZ + DSW (opgave klant), excl. RMO/RMA. */
  omzetVecozo: number | null;
  /** Via het servicebureau (Infomedics): alle overige verzekeringskoepels. */
  omzetServicebureau: number | null;
  /** RMO/RMA-regelingen (asielzoekers/ontheemden, uitgevoerd door DSW) — Uzovi 3355. */
  omzetRmoRma: number | null;
}

export interface ProductionAlert {
  sev: CareonSeverity;
  titel: string;
  unit: string;
  detail: string;
  n: number;
  page: "patienten" | "behandelaren" | "dossiers" | "dossiersProductie" | "financieel" | "planning";
}

export interface RisicoRij {
  id: string;
  naam: string;
  team: string;
  loc: string;
  signaal: string;
  dagen: number;
  dossierUrl: string | null;
}

/** Agenda-gedeelte van de productie-snapshot (alleen aanwezig na agenda-import). */
export interface ProductionAgendaSnapshot {
  meta: {
    fileName: string;
    importedAt: string;
    bronVan: string;
    bronTot: string;
    sessieRows: number;
    blokRows: number;
    /** Laatste vólledige maand binnen het agenda-bereik ("juni" / "2026-06"). */
    maandLabel: string;
    maandKey: string;
  };
  /** Gesleuteld op de demo-labels van PLANNING_METRICS (vervangings-patroon). */
  planningMetrics: Record<string, LiveMetric>;
  /** Alle 7 weekdagen (de praktijk werkt ook in het weekend). */
  noshowWeekdagen: { dag: string; pct: number; sessies: number }[];
  urenverdeling: { name: string; value: number; color: string }[];
  bezettingPerLocatie: { loc: string; pct: number }[];
  bezettingTotaal: number | null;
  afzegRedenen: AantalGroep[];
  sessieTypen: AantalGroep[];
  /** Online / op locatie / overig — sessies in de laatste 12 agenda-maanden. */
  modality: { name: string; value: number; color: string }[];
  financieel: {
    /** Gesleuteld op de demo-labels van FINANCIEEL_METRICS. */
    metrics: Record<string, LiveMetric>;
    omzetPerVerzekeraar: AantalGroep[];
    omzetPerLocatie: AantalGroep[];
    /** Behandelmaand × kanaal-groep binnen het 12-maandsvenster (excl. toeslagen;
     * RMO/RMA als eigen groep) — bron voor de tijdvenster-toggle op "Omzet per
     * verzekeraar". */
    omzetKoepelMaand: { key: string; koepel: string; omzet: number }[];
    /** Maand × vestiging — bron voor de tijdvenster-toggle op "Omzet per locatie". */
    omzetLocatieMaand: { key: string; loc: string; omzet: number }[];
    onderhandenTotaal: number;
    onderhandenOuderdom: { label: string; bedrag: number; pct: number }[];
  };
  /** Maandreeks (laatste 12 agenda-maanden, binnen het locatiefilter) — bron
   * voor de geaggregeerde KPI-drilldowns (er bestaan geen losse afspraakregels). */
  maandreeks: {
    key: string;
    label: string;
    sessies: number;
    noShows: number;
    tijdigAfgezegd: number;
    directeUren: number;
    indirecteUren: number;
    reisUren: number;
    totaleUren: number;
    blokUren: number;
    omzetGerealiseerd: number;
    onderhanden: number;
    online: number;
    opLocatie: number;
  }[];
  /** Per behandelaar (laatste 12 agenda-maanden), sleutel = naam. */
  behandelaarStats: Record<
    string,
    { sessies: number; noShowPct: number | null; directeUren: number; totaleUren: number; omzet: number }
  >;
  /** Sessies per vorm incl. uitval (instellingsbreed; null bij ouder aggregaat). */
  vormen: { vorm: string; label: string; sessies: number; noShowPct: number; afzegPct: number }[] | null;
  /** Inzet per ZPM-beroepcode (12 mnd historisch; null bij ouder aggregaat). */
  beroepen: { code: string; sessies: number; directeUren: number; behandelaars: string[] }[] | null;
  /** Actieve, niet-wachtende cliënten zonder gehouden afspraak in >30/>60 dagen. */
  contact: { z30: number; z60: number };
  /** Laatste gehouden afspraak (ISO) per cliënt-ID — bron voor de contact-drilldowns. */
  contactPerClient: Record<string, string>;
  /** Eerstvolgende geplande afspraak per cliënt-ID (leeg zonder toekomstvenster). */
  vervolgPerClient: Record<string, string>;
  /** Vooruitblik — alleen wanneer de export een toekomstvenster heeft. */
  vooruitblik: {
    peildatum: string;
    /** Geplande sessies binnen het locatiefilter. */
    sessies: number;
    /** Unieke cliënten met een geplande afspraak (niet per locatie te splitsen). */
    clienten: number;
    tot: string | null;
    /** Eerste zes komende maanden (binnen het locatiefilter). */
    maanden: { key: string; label: string; sessies: number; uren: number }[];
    /** Actieve, niet-wachtende cliënten zonder geplande vervolgafspraak. */
    zonderVervolg: number;
    /** Waarvan ook al >30 dagen geen gehouden afspraak (dubbel signaal). */
    zonderVervolgEnContact: number;
  } | null;
  dossierchecks: { verslagOntbreekt: number; nietOndertekend: number };
  /**
   * Kwaliteit-proxies uit de agenda (Kwaliteit-pagina): zorgplannen,
   * evaluatieritme en medicatiecontroles. Null bij een aggregaat van vóór de
   * MDO-/farmaco-velden — dan is een her-import van de agenda-export nodig.
   * `pct` is null wanneer de meetbasis leeg is (dan blijft de widget demo).
   */
  kwaliteit: {
    zorgplan: { pct: number | null; met: number; totaal: number };
    evaluaties: { pct: number | null; met: number; totaal: number };
    medicatie: { pct: number | null; met: number; totaal: number };
  } | null;
}

/** Toeslagen-gedeelte van de snapshot (alleen na toeslagen-import). */
export interface ProductionToeslagen {
  meta: { fileName: string; importedAt: string; bronVan: string; bronTot: string };
  totaal: number;
  aantal: number;
  clienten: number;
  tolkClienten: number;
  perCode: ToeslagCodeGroep[];
  /** € per verzekeringskoepel (afgerond). */
  perKoepel: AantalGroep[];
}

/** Declaratie-gedeelte van de snapshot (alleen na declaratie-import). */
export interface ProductionDeclaraties {
  meta: { fileName: string; importedAt: string; bronVan: string; bronTot: string };
  gefactureerd: number;
  toegekend: number;
  gecrediteerd: number;
  openstaand: number;
  /** Toegekend als % van gefactureerd (afgerond). */
  toekenningsPct: number;
  openstaand90: { bedrag: number; facturen: number };
  /** Facturen naar toekenningsstatus. */
  status: { volledig: number; deels: number; zonder: number };
  /** Tekort op deels-toegekende facturen (gefactureerd − toegekend). */
  tekortDeels: number;
  perKoepel: { label: string; gefactureerd: number; toegekend: number; openstaand: number; pct: number }[];
  ouderdom: { label: string; bedrag: number; pct: number }[];
  facturen: number;
  /** Dekking t.o.v. de agenda-facturatie (null zonder agenda-import). */
  dekking: { agendaGefactureerd: number; pct: number } | null;
}

export interface ProductionVerwijzerNetwerk {
  fileName: string;
  importedAt: string;
  contacten: VerwijzerContact[];
  clienten: number;
  zorgmailPct: number;
  rollen: AantalGroep[];
  plaatsen: AantalGroep[];
}

export interface ProductionSnapshot {
  meta: {
    fileName: string;
    importedAt: string;
    referenceDate: string;
    totalRows: number;
    activeClients: number;
    /** Actieve cliënten zonder (bekende) vestiging — vallen buiten elk locatiefilter. */
    zonderVestiging: number;
  };
  /** De (op vestiging gefilterde) records — bron voor de KPI-drilldown-tabellen. */
  records: ClientRecord[];
  /** Laatste 12 volle maanden — voedt KPI's, sparklines en de 12-maandsvensters. */
  monthly: ProductionMonthPoint[];
  /** Volledige historie (vanaf de vroegste databron-maand) met jaar-labels —
   * alléén voor de tijdvenster-grafieken ("Alles"-optie). */
  monthlyFull: ProductionMonthPoint[];
  /** Per cockpit-KPI-id (alleen live/proxy ids aanwezig). */
  /** `label` overschrijft het demo-kaartlabel (bijv. "Omzet Vecozo (VGZ + DSW)"). */
  cockpitKpis: Record<
    string,
    {
      value: number;
      prev: number | null;
      spark: number[];
      windowLabel?: string;
      label?: string;
      secondary?: { label: string; value: number; f: CareonKpiFormat };
    }
  >;
  cockpitSummary: { label: string; value: string }[];
  cockpitInsights: string[];
  patientenMetrics: Record<string, LiveMetric>;
  /** Setting-verdeling (S03 ambulant / S04 outreachend) als eerlijke zorgvorm-weergave. */
  zorgvorm: { name: string; value: number; color: string }[];
  /** Gerealiseerde wachttijd (verwijzing → start) per startmaand — de trend die
   * het kwartaalgemiddelde verbergt. */
  wachttijdTrend: { m: string; key: string; n: number; mediaanDagen: number | null; overTreek: number }[];
  /** Volledige historie met jaar-labels — alléén voor de wachttijdgrafiek ("Alles"). */
  wachttijdTrendFull: { m: string; key: string; n: number; mediaanDagen: number | null; overTreek: number }[];
  treekLocaties: {
    loc: string;
    intake: number | null;
    behandeling: number | null;
    /** Venster van de intake-meting: kwartaal, of 12 maanden bij te weinig starts. */
    intakeVenster: "kwartaal" | "12mnd";
  }[];
  risicoLijst: RisicoRij[];
  gemWachttijdWkn: LiveMetric;
  behandelaren: {
    naam: string;
    loc: string;
    caseload: number;
    nc: number;
    directeTijdUren: number;
    totaleTijdUren: number;
  }[];
  regiebehandelaren: { naam: string; loc: string; clienten: number }[];
  dossiersProductie: {
    metrics: Record<string, LiveMetric>;
    medewerkers: { naam: string; loc: string; caseload: number; afsluitingen: number; nc: number }[];
    diagnoseGroepen: AantalGroep[];
    /** Actieve cliënten met een secundaire diagnose (comorbiditeit); pct over actief. */
    comorbiditeit: { aantal: number; pct: number };
    /** Verdeling van het geselecteerde zorgvraagtype (ZPM) onder actieve cliënten. */
    zorgvraagtypes: AantalGroep[];
    /** Duur van afgesloten episodes (start → eind), binnen het locatiefilter. */
    behandelduur: {
      afgesloten: number;
      gemDagen: number | null;
      mediaanDagen: number | null;
      buckets: AantalGroep[];
      /** Mediaanduur per afgerond kwartaal (laatste vier volledige kwartalen). */
      perKwartaal: { label: string; n: number; mediaanDagen: number | null }[];
      /** Afsluitingen zonder één minuut geregistreerde tijd (stille uitval). */
      zonderRegistratie: number;
      /** Afsluitingen binnen 14 dagen (intake-uitval / verkeerde verwijzing). */
      churn14: number;
    };
    geslacht: { name: string; value: number; color: string }[];
    leeftijdGroepen: AantalGroep[];
    verwijzers: AantalGroep[];
    plaatsen: AantalGroep[];
    verzekeraars: AantalGroep[];
    wachtlijst: {
      totaal: number;
      urgent: number;
      gemWachttijdWkn: number | null;
      buckets: AantalGroep[];
      perLocatie: AantalGroep[];
      /** Meest gevorderde wachtlijstfase per wachtende (uit de wachtlijstlabels). */
      fases: AantalGroep[];
      /** Taal-tags uit de wachtlijstlabels (alleen wanneer geregistreerd). */
      talen: AantalGroep[];
    };
    insights: string[];
  };
  signaleringen: ProductionAlert[];
  /** Registratie-compleetheid als score op 10 (kwaliteit-pagina "Dossierkwaliteit"). */
  kwaliteitDossierscore: LiveMetric;
  /** Vulgraad per veld over de hele export — de registratiediscipline zelf. */
  datakwaliteit: { veld: string; gevuld: number; totaal: number }[];
  dossiercontrole: {
    compliancePct: number;
    gecontroleerd: number;
    nietCompleet: number;
    checks: { check: string; n: number; sev: CareonSeverity }[];
  };
  /** Alleen gevuld na een agenda-import (Databron → aanvullende exports). */
  agenda: ProductionAgendaSnapshot | null;
  /** Alleen gevuld na een huisarts/verwijzer-import. */
  verwijzerNetwerk: ProductionVerwijzerNetwerk | null;
  /** Alleen gevuld na een toeslagen-import. */
  toeslagen: ProductionToeslagen | null;
  /** Alleen gevuld na een declaratie-import. */
  declaraties: ProductionDeclaraties | null;
  /** Populatieprofiel van de actieve cliënten (binnen het locatiefilter). */
  populatieProfiel: {
    n: number;
    gemLeeftijd: number | null;
    mediaanLeeftijd: number | null;
    vrouwPct: number | null;
    gemDuurDagen: number | null;
    mediaanDuurDagen: number | null;
  };
}

export interface ProductionState {
  fileName: string;
  importedAt: string;
  records: ClientRecord[];
}

// ---- Agenda-export (afspraken) ----
// De agenda-export wordt bij het parsen direct geaggregeerd: er worden nooit
// losse afspraakregels bewaard (22k+ rijen zouden de browseropslag breken en
// bevatten vrije-tekstvelden). Cliëntnaam, memo en BSN worden nooit gelezen.

/** Aggregaat per (maand, vestiging, behandelaar) over de sessie-rijen. */
export interface AgendaCel {
  /** Maand van de afspraakdatum, "2026-06". */
  key: string;
  locatie: string | null;
  behandelaar: string | null;
  sessies: number;
  noShows: number;
  tijdigAfgezegd: number;
  directeMin: number;
  indirecteMin: number;
  reisMin: number;
  totaleMin: number;
  online: number;
  opLocatie: number;
  /** Sessies met sessieverslag ("Sessieverslagen" = Ja). */
  verslagen: number;
  /** Ondertekende sessies ("Ondertekend" = Ja). */
  ondertekend: number;
  /** Geprijsde sessiewaarde op afspraakmaand (ook nog niet gefactureerd). */
  omzetGerealiseerd: number;
  /** Geprijsd maar (nog) zonder factuurnummer — onderhanden werk. */
  onderhanden: number;
  onderhandenSessies: number;
}

/** Afwezig-blokken per (maand, behandelaar) — blokrijen dragen geen locatie. */
export interface AgendaBlokCel {
  key: string;
  behandelaar: string | null;
  blokMin: number;
}

/** Gefactureerde omzet per (behandelmaand, vestiging, verzekeringskoepel, Uzovi).
 * De sleutel is de behandelmaand (afspraakdatum) — de klant stuurt zijn
 * maandoverzichten op behandelmaand, niet op factuurmaand. Uzovi maakt de
 * RMO/RMA-regelingen (3355) te onderscheiden van gewone DSW-verzekering (7029). */
export interface AgendaFactuurCel {
  key: string;
  locatie: string | null;
  koepel: string | null;
  uzovi: string | null;
  omzet: number;
}

/** Sessies en no-shows per weekdag (0 = zondag … 6 = zaterdag) per vestiging. */
export interface AgendaWeekdagCel {
  dag: number;
  locatie: string | null;
  sessies: number;
  noShows: number;
  /** Optioneel (oudere aggregaten missen dit): tijdig afgezegd per weekdag. */
  tijdigAfgezegd?: number;
}

/** Sessies per vorm (online / op locatie / overig) — instellingsbreed. */
export interface AgendaVormCel {
  vorm: "online" | "locatie" | "overig";
  sessies: number;
  noShows: number;
  tijdigAfgezegd: number;
}

/** Historische sessies per (ZPM-beroepcode × behandelaar). */
export interface AgendaBeroepCel {
  code: string;
  behandelaar: string | null;
  sessies: number;
  directeMin: number;
}

/** Contactfeiten per cliënt — alleen het EPD-cliënt-ID, nooit een naam. */
export interface AgendaClientFact {
  id: string;
  /** ISO-datum van de eerste/laatste GEHOUDEN sessie (no-shows en afzeggingen
   * tellen niet als contact); null wanneer alle sessies uitvielen. */
  eerste: string | null;
  laatste: string | null;
  sessies: number;
  noShows: number;
  /** Er is een behandelplan-sessie gevoerd. */
  behandelplan: boolean;
  /**
   * Toekomstvelden (alleen wanneer de export een toekomstvenster heeft;
   * optioneel voor compatibiliteit met eerder opgeslagen aggregaten).
   * `volgende` = eerstvolgende geplande afspraak ná de peildatum.
   */
  volgende?: string | null;
  /** Er staat een MDO-/evaluatiesessie gepland ná de peildatum. */
  mdoGepland?: boolean;
  /**
   * Kwaliteit-velden (optioneel — aggregaten van vóór deze velden missen ze;
   * de kwaliteit-proxies blijven dan uit tot een her-import van de agenda).
   * `laatsteMdo` = laatst GEHOUDEN MDO-/evaluatiesessie (evaluatieritme).
   */
  laatsteMdo?: string | null;
  /** Aantal gehouden farmaco-sessies (medicatiecontroles). */
  farmaco?: number;
  /** ISO-datum van de laatst gehouden farmaco-sessie. */
  laatsteFarmaco?: string | null;
}

/** Geplande (toekomstige) sessies per maand × vestiging — vooruitblik. */
export interface AgendaToekomstCel {
  key: string;
  locatie: string | null;
  sessies: number;
  totaleMin: number;
}

export interface AgendaToekomst {
  /** Geplande sessies ná de peildatum. */
  sessies: number;
  /** Unieke cliënten met minstens één geplande afspraak. */
  clienten: number;
  /** Laatste geplande afspraakdatum (ISO). */
  tot: string | null;
  perMaand: AgendaToekomstCel[];
}

export interface AgendaFacts {
  fileName: string;
  importedAt: string;
  /** Datumbereik van de afspraakrijen in de export (ISO). */
  bronVan: string;
  bronTot: string;
  totalRows: number;
  sessieRows: number;
  blokRows: number;
  skippedRows: number;
  cellen: AgendaCel[];
  blokken: AgendaBlokCel[];
  facturatie: AgendaFactuurCel[];
  weekdagen: AgendaWeekdagCel[];
  clienten: AgendaClientFact[];
  /** Redenen bij tijdig afgezegde afspraken (klein, geaggregeerd). */
  afzegRedenen: AantalGroep[];
  /** Top sessietypen (bijv. "MDO met patient"), geaggregeerd. */
  sessieTypen: AantalGroep[];
  /**
   * Peildatum (ISO-dag van het importmoment): rijen ná deze dag zijn geplande
   * afspraken en tellen niet mee in de historische aggregaten. Optioneel —
   * eerder opgeslagen aggregaten (export zonder toekomstvenster) missen dit.
   */
  peildatum?: string;
  /** Vooruitblik; alleen aanwezig wanneer de export een toekomstvenster heeft. */
  toekomst?: AgendaToekomst | null;
  /** Unieke zorgtrajecten in de historische sessies (basis voor omzet/traject). */
  trajecten?: number;
  /** Sessies per vorm (optioneel — oudere aggregaten missen dit). */
  vormen?: AgendaVormCel[];
  /** Sessies per (beroepcode × behandelaar) (optioneel). */
  beroepen?: AgendaBeroepCel[];
}

export interface ParseAgendaResult {
  ok: boolean;
  error?: string;
  facts: AgendaFacts | null;
  warnings: ImportWarning[];
}

// ---- Toeslagen-export (declared surcharges) ----
// ZPM-toeslagprestaties (TC-codes: reistijd, tolk, psychodiagnostiek) die als
// extra regels op dezelfde facturen staan als de sessies uit de agenda-export.
// De export bevat cliëntNAMEN (geen ID's): die worden bij het parsen alleen
// geteld (distinct per code) en nooit bewaard. Geen vestigings-dimensie.

/** Aggregaat per (factuurmaand, verzekeringskoepel, toeslagcode). */
export interface ToeslagCel {
  /** Factuurmaand "2026-06". */
  key: string;
  koepel: string | null;
  code: string;
  aantal: number;
  omzet: number;
}

export interface ToeslagCodeGroep {
  code: string;
  omschrijving: string;
  aantal: number;
  omzet: number;
  /** Unieke cliënten (geteld bij het parsen; namen worden niet bewaard). */
  clienten: number;
}

export interface ToeslagenFacts {
  fileName: string;
  importedAt: string;
  totalRows: number;
  skippedRows: number;
  /** Bereik van de afspraakdatums (ISO). */
  bronVan: string;
  bronTot: string;
  cellen: ToeslagCel[];
  perCode: ToeslagCodeGroep[];
  /** Unieke cliënten in de export. */
  clienten: number;
  /** Unieke cliënten met een tolk-toeslag. */
  tolkClienten: number;
}

export interface ParseToeslagenResult {
  ok: boolean;
  error?: string;
  facts: ToeslagenFacts | null;
  warnings: ImportWarning[];
}

// ---- Declaratie-totaaloverzicht (declaration total) ----
// Per factuur: gedeclareerd bedrag, toegekend totaalbedrag en creditnota's.
// Debiteuren zijn verzekeraars/gemeenten; privépersonen (particuliere
// facturen) worden bij het parsen samengevoegd tot "Particulier" — namen
// worden nooit bewaard. Debiteurennummers worden niet gelezen.

export interface DeclaratieFactuur {
  /** Factuurnummer — koppelt aan de agenda- en toeslagen-exports. */
  nummer: string;
  /** Factuurdatum (ISO) — basis voor de ouderdom van openstaande bedragen. */
  datum: string;
  /** Debiteur: verzekeringskoepel, gemeente of "Particulier". */
  koepel: string;
  bedrag: number;
  toegekend: number;
  /** Som van creditnota's die naar deze factuur verwijzen (positief getal). */
  gecrediteerd: number;
}

export interface DeclaratiesFacts {
  fileName: string;
  importedAt: string;
  totalRows: number;
  skippedRows: number;
  /** Bereik van de factuurdatums (ISO). */
  bronVan: string;
  bronTot: string;
  facturen: DeclaratieFactuur[];
  /** Creditnota's zonder herleidbare doelfactuur (aantal, som als positief bedrag). */
  losseCredits: { aantal: number; bedrag: number };
}

export interface ParseDeclaratiesResult {
  ok: boolean;
  error?: string;
  facts: DeclaratiesFacts | null;
  warnings: ImportWarning[];
}

// ---- Huisarts/verwijzer-export ----
// Zakelijke praktijkgegevens (geen cliëntkenmerken behalve het cliënt-ID dat
// alleen geteld wordt); e-mailadressen worden bewust niet bewaard.
export interface VerwijzerContact {
  /** AGB-code — autoritatieve sleutel; null wanneer niet geregistreerd. */
  agb: string | null;
  naam: string;
  rol: string;
  plaats: string | null;
  zorgmail: boolean;
  /** Aantal unieke cliënten met deze verwijzer in de export. */
  clienten: number;
}

export interface VerwijzersFacts {
  fileName: string;
  importedAt: string;
  totalRows: number;
  /** Unieke cliënten in de export (koppelingsbasis). */
  clienten: number;
  contacten: VerwijzerContact[];
}

export interface ParseVerwijzersResult {
  ok: boolean;
  error?: string;
  facts: VerwijzersFacts | null;
  warnings: ImportWarning[];
}

// Gedeelde runtime-guards voor alle persistentiepaden (localStorage, Supabase
// route, remote client). Streng genoeg dat compute-snapshot nooit crasht op
// een oud/gemanipuleerd record: array- en getalvelden worden echt gecontroleerd.
function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

// Later toegevoegde velden: oudere opgeslagen states (localStorage/Supabase)
// missen ze — undefined is daar geldig en compute-snapshot behandelt het als
// null/false, zodat een bestaande import de schema-uitbreiding overleeft.
function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || isNullableString(value);
}

export function isClientRecord(value: unknown): value is ClientRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.geslacht === "string" &&
    isNullableString(record.episodeStart) &&
    isNullableString(record.episodeEind) &&
    isNullableString(record.verwijsdatum) &&
    isNullableString(record.behandelaar) &&
    isNullableString(record.regiebehandelaar) &&
    (record.leeftijd === null || typeof record.leeftijd === "number") &&
    isOptionalNullableString(record.diagnoseOmschrijving) &&
    isOptionalNullableString(record.zorgvraagtypeOmschrijving) &&
    isOptionalNullableString(record.voorgesteldZorgvraagtype) &&
    isOptionalNullableString(record.verwijzerAgb) &&
    isOptionalNullableString(record.covUzovi) &&
    isOptionalNullableString(record.polisEinde) &&
    (record.heeftSecundaireDiagnose === undefined || typeof record.heeftSecundaireDiagnose === "boolean") &&
    Array.isArray(record.wachtlijstLabels) &&
    record.wachtlijstLabels.every((label) => typeof label === "string") &&
    typeof record.wachtlijst === "boolean" &&
    typeof record.preWachtlijst === "boolean" &&
    typeof record.directeTijdMin === "number" &&
    typeof record.indirecteTijdMin === "number" &&
    typeof record.totaleTijdMin === "number"
  );
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isMonthKey(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function isIsoDay(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isAgendaCel(value: unknown): value is AgendaCel {
  if (typeof value !== "object" || value === null) return false;
  const cel = value as Record<string, unknown>;
  return (
    isMonthKey(cel.key) &&
    isNullableString(cel.locatie) &&
    isNullableString(cel.behandelaar) &&
    isFiniteNumber(cel.sessies) &&
    isFiniteNumber(cel.noShows) &&
    isFiniteNumber(cel.tijdigAfgezegd) &&
    isFiniteNumber(cel.directeMin) &&
    isFiniteNumber(cel.indirecteMin) &&
    isFiniteNumber(cel.reisMin) &&
    isFiniteNumber(cel.totaleMin) &&
    isFiniteNumber(cel.online) &&
    isFiniteNumber(cel.opLocatie) &&
    isFiniteNumber(cel.verslagen) &&
    isFiniteNumber(cel.ondertekend) &&
    isFiniteNumber(cel.omzetGerealiseerd) &&
    isFiniteNumber(cel.onderhanden) &&
    isFiniteNumber(cel.onderhandenSessies)
  );
}

export function isAgendaFacts(value: unknown): value is AgendaFacts {
  if (typeof value !== "object" || value === null) return false;
  const facts = value as Record<string, unknown>;
  return (
    typeof facts.fileName === "string" &&
    typeof facts.importedAt === "string" &&
    Number.isFinite(Date.parse(facts.importedAt)) &&
    isIsoDay(facts.bronVan) &&
    isIsoDay(facts.bronTot) &&
    isFiniteNumber(facts.totalRows) &&
    isFiniteNumber(facts.sessieRows) &&
    isFiniteNumber(facts.blokRows) &&
    isFiniteNumber(facts.skippedRows) &&
    Array.isArray(facts.cellen) &&
    facts.cellen.length > 0 &&
    facts.cellen.every(isAgendaCel) &&
    Array.isArray(facts.blokken) &&
    facts.blokken.every(
      (blok: unknown) =>
        typeof blok === "object" &&
        blok !== null &&
        isMonthKey((blok as Record<string, unknown>).key) &&
        isNullableString((blok as Record<string, unknown>).behandelaar) &&
        isFiniteNumber((blok as Record<string, unknown>).blokMin),
    ) &&
    Array.isArray(facts.facturatie) &&
    facts.facturatie.every(
      (cel: unknown) =>
        typeof cel === "object" &&
        cel !== null &&
        isMonthKey((cel as Record<string, unknown>).key) &&
        isNullableString((cel as Record<string, unknown>).locatie) &&
        isNullableString((cel as Record<string, unknown>).koepel) &&
        // Vereist sinds de RMO/RMA-splitsing: oudere aggregaten (zonder uzovi,
        // gesleuteld op factuurmaand) worden afgekeurd zodat een her-import
        // wordt afgedwongen in plaats van stilzwijgend verkeerde cijfers.
        isNullableString((cel as Record<string, unknown>).uzovi) &&
        isFiniteNumber((cel as Record<string, unknown>).omzet),
    ) &&
    Array.isArray(facts.weekdagen) &&
    facts.weekdagen.every(
      (cel: unknown) =>
        typeof cel === "object" &&
        cel !== null &&
        isFiniteNumber((cel as Record<string, unknown>).dag) &&
        isNullableString((cel as Record<string, unknown>).locatie) &&
        isFiniteNumber((cel as Record<string, unknown>).sessies) &&
        isFiniteNumber((cel as Record<string, unknown>).noShows),
    ) &&
    Array.isArray(facts.clienten) &&
    facts.clienten.every(
      (fact: unknown) =>
        typeof fact === "object" &&
        fact !== null &&
        typeof (fact as Record<string, unknown>).id === "string" &&
        ((fact as Record<string, unknown>).eerste === null || isIsoDay((fact as Record<string, unknown>).eerste)) &&
        ((fact as Record<string, unknown>).laatste === null || isIsoDay((fact as Record<string, unknown>).laatste)) &&
        isFiniteNumber((fact as Record<string, unknown>).sessies) &&
        isFiniteNumber((fact as Record<string, unknown>).noShows) &&
        typeof (fact as Record<string, unknown>).behandelplan === "boolean" &&
        ((fact as Record<string, unknown>).volgende === undefined ||
          (fact as Record<string, unknown>).volgende === null ||
          isIsoDay((fact as Record<string, unknown>).volgende)) &&
        ((fact as Record<string, unknown>).mdoGepland === undefined ||
          typeof (fact as Record<string, unknown>).mdoGepland === "boolean") &&
        ((fact as Record<string, unknown>).laatsteMdo === undefined ||
          (fact as Record<string, unknown>).laatsteMdo === null ||
          isIsoDay((fact as Record<string, unknown>).laatsteMdo)) &&
        ((fact as Record<string, unknown>).farmaco === undefined ||
          isFiniteNumber((fact as Record<string, unknown>).farmaco)) &&
        ((fact as Record<string, unknown>).laatsteFarmaco === undefined ||
          (fact as Record<string, unknown>).laatsteFarmaco === null ||
          isIsoDay((fact as Record<string, unknown>).laatsteFarmaco)),
    ) &&
    Array.isArray(facts.afzegRedenen) &&
    Array.isArray(facts.sessieTypen) &&
    (facts.peildatum === undefined || isIsoDay(facts.peildatum)) &&
    (facts.toekomst === undefined || facts.toekomst === null || isAgendaToekomst(facts.toekomst)) &&
    (facts.trajecten === undefined || isFiniteNumber(facts.trajecten)) &&
    (facts.vormen === undefined ||
      (Array.isArray(facts.vormen) &&
        facts.vormen.every(
          (cel: unknown) =>
            typeof cel === "object" &&
            cel !== null &&
            typeof (cel as Record<string, unknown>).vorm === "string" &&
            isFiniteNumber((cel as Record<string, unknown>).sessies) &&
            isFiniteNumber((cel as Record<string, unknown>).noShows) &&
            isFiniteNumber((cel as Record<string, unknown>).tijdigAfgezegd),
        ))) &&
    (facts.beroepen === undefined ||
      (Array.isArray(facts.beroepen) &&
        facts.beroepen.every(
          (cel: unknown) =>
            typeof cel === "object" &&
            cel !== null &&
            typeof (cel as Record<string, unknown>).code === "string" &&
            isNullableString((cel as Record<string, unknown>).behandelaar) &&
            isFiniteNumber((cel as Record<string, unknown>).sessies) &&
            isFiniteNumber((cel as Record<string, unknown>).directeMin),
        )))
  );
}

function isAgendaToekomst(value: unknown): value is AgendaToekomst {
  if (typeof value !== "object" || value === null) return false;
  const toekomst = value as Record<string, unknown>;
  return (
    isFiniteNumber(toekomst.sessies) &&
    isFiniteNumber(toekomst.clienten) &&
    (toekomst.tot === null || isIsoDay(toekomst.tot)) &&
    Array.isArray(toekomst.perMaand) &&
    toekomst.perMaand.every(
      (cel: unknown) =>
        typeof cel === "object" &&
        cel !== null &&
        isMonthKey((cel as Record<string, unknown>).key) &&
        isNullableString((cel as Record<string, unknown>).locatie) &&
        isFiniteNumber((cel as Record<string, unknown>).sessies) &&
        isFiniteNumber((cel as Record<string, unknown>).totaleMin),
    )
  );
}

export function isToeslagenFacts(value: unknown): value is ToeslagenFacts {
  if (typeof value !== "object" || value === null) return false;
  const facts = value as Record<string, unknown>;
  return (
    typeof facts.fileName === "string" &&
    typeof facts.importedAt === "string" &&
    Number.isFinite(Date.parse(facts.importedAt)) &&
    isFiniteNumber(facts.totalRows) &&
    isFiniteNumber(facts.skippedRows) &&
    isIsoDay(facts.bronVan) &&
    isIsoDay(facts.bronTot) &&
    isFiniteNumber(facts.clienten) &&
    isFiniteNumber(facts.tolkClienten) &&
    Array.isArray(facts.cellen) &&
    facts.cellen.length > 0 &&
    facts.cellen.every(
      (cel: unknown) =>
        typeof cel === "object" &&
        cel !== null &&
        isMonthKey((cel as Record<string, unknown>).key) &&
        isNullableString((cel as Record<string, unknown>).koepel) &&
        typeof (cel as Record<string, unknown>).code === "string" &&
        isFiniteNumber((cel as Record<string, unknown>).aantal) &&
        isFiniteNumber((cel as Record<string, unknown>).omzet),
    ) &&
    Array.isArray(facts.perCode) &&
    facts.perCode.every(
      (groep: unknown) =>
        typeof groep === "object" &&
        groep !== null &&
        typeof (groep as Record<string, unknown>).code === "string" &&
        typeof (groep as Record<string, unknown>).omschrijving === "string" &&
        isFiniteNumber((groep as Record<string, unknown>).aantal) &&
        isFiniteNumber((groep as Record<string, unknown>).omzet) &&
        isFiniteNumber((groep as Record<string, unknown>).clienten),
    )
  );
}

export function isDeclaratiesFacts(value: unknown): value is DeclaratiesFacts {
  if (typeof value !== "object" || value === null) return false;
  const facts = value as Record<string, unknown>;
  return (
    typeof facts.fileName === "string" &&
    typeof facts.importedAt === "string" &&
    Number.isFinite(Date.parse(facts.importedAt)) &&
    isFiniteNumber(facts.totalRows) &&
    isFiniteNumber(facts.skippedRows) &&
    isIsoDay(facts.bronVan) &&
    isIsoDay(facts.bronTot) &&
    Array.isArray(facts.facturen) &&
    facts.facturen.length > 0 &&
    facts.facturen.every(
      (factuur: unknown) =>
        typeof factuur === "object" &&
        factuur !== null &&
        typeof (factuur as Record<string, unknown>).nummer === "string" &&
        isIsoDay((factuur as Record<string, unknown>).datum) &&
        typeof (factuur as Record<string, unknown>).koepel === "string" &&
        isFiniteNumber((factuur as Record<string, unknown>).bedrag) &&
        isFiniteNumber((factuur as Record<string, unknown>).toegekend) &&
        isFiniteNumber((factuur as Record<string, unknown>).gecrediteerd),
    ) &&
    typeof facts.losseCredits === "object" &&
    facts.losseCredits !== null &&
    isFiniteNumber((facts.losseCredits as Record<string, unknown>).aantal) &&
    isFiniteNumber((facts.losseCredits as Record<string, unknown>).bedrag)
  );
}

export function isVerwijzersFacts(value: unknown): value is VerwijzersFacts {
  if (typeof value !== "object" || value === null) return false;
  const facts = value as Record<string, unknown>;
  return (
    typeof facts.fileName === "string" &&
    typeof facts.importedAt === "string" &&
    Number.isFinite(Date.parse(facts.importedAt)) &&
    isFiniteNumber(facts.totalRows) &&
    isFiniteNumber(facts.clienten) &&
    Array.isArray(facts.contacten) &&
    facts.contacten.length > 0 &&
    facts.contacten.every(
      (contact: unknown) =>
        typeof contact === "object" &&
        contact !== null &&
        isNullableString((contact as Record<string, unknown>).agb) &&
        typeof (contact as Record<string, unknown>).naam === "string" &&
        typeof (contact as Record<string, unknown>).rol === "string" &&
        isNullableString((contact as Record<string, unknown>).plaats) &&
        typeof (contact as Record<string, unknown>).zorgmail === "boolean" &&
        isFiniteNumber((contact as Record<string, unknown>).clienten),
    )
  );
}

export function isProductionState(value: unknown): value is ProductionState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.fileName === "string" &&
    typeof state.importedAt === "string" &&
    // Ongeldige importedAt zou de referentiedatum (en dus alle maandvensters)
    // corrumperen tot NaN-sleutels — weiger de state dan als geheel.
    Number.isFinite(Date.parse(state.importedAt)) &&
    Array.isArray(state.records) &&
    state.records.length > 0 &&
    state.records.every(isClientRecord)
  );
}

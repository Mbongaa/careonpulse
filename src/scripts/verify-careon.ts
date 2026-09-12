/**
 * Script: verify-careon.ts
 *
 * Mechanical verification of the Careon business logic against the audited
 * source dashboard (zorg-dashboard-audit). Asserts number formatting, delta
 * badges for every audited KPI, location scaling, CSV parser behavior and
 * messages, alert counts/routing, and table color thresholds.
 *
 * Usage: npm run verify:careon  (release gate G5)
 */

import { demoKpiTrend, demoKpiWaarde } from "../app/(main)/dashboard/details/_lib/kpi-demo-waarde";
import { CAREON_ALERTS, CRITICAL_ALERT_COUNT } from "../data/careon/careon-alerts";
import { ASSISTANT_QUICK_PROMPTS, resolveAssistantResponse } from "../data/careon/careon-assistant";
import { BEHANDELAREN, caseloadTone, ncTone, noshowTone } from "../data/careon/careon-behandelaren";
import { parseKpiCsv, SAMPLE_CSV_CONTENT } from "../data/careon/careon-databron";
import { buildDetailRowsFresh, DETAIL_LOCS, demoDetailRows } from "../data/careon/careon-detail-records";
import { DOSSIER_SUMMARY } from "../data/careon/careon-dossiercontrole";
import {
  ACTIEVE_CLIENTEN,
  DIAGNOSE_GROEPEN,
  DOSSIERS_PRODUCTIE_METRICS,
  GESLACHT_VERDELING,
  LEEFTIJD_GROEPEN,
  MEDEWERKER_PRODUCTIE,
  PLAATS_VERDELING,
  REGIEBEHANDELAREN,
  regieTone,
  VERZEKERAAR_VERDELING,
  WACHTLIJST_BUCKETS,
  WACHTLIJST_PER_LOCATIE,
  WACHTLIJST_SUMMARY,
} from "../data/careon/careon-dossiers-productie";
import {
  CAREONGROUP_TEMPLATE,
  DEFAULT_VRIJSTELLING_TEKST,
  DEMO_CONTACTEN,
  DEMO_FACTURATIE_INSTELLINGEN,
  DEMO_FACTUREN,
  EMPTY_FACTURATIE_INSTELLINGEN,
} from "../data/careon/careon-facturatie";
import { CAREON_LOCATION_SCALE, CAREON_LOCATIONS } from "../data/careon/careon-filters";
import { DECLARATIE_OUDERDOM, FINANCIEEL_METRICS, OPENSTAAND_TOTAAL } from "../data/careon/careon-financieel";
import { BIG_REGISTRATIES, HR_METRICS, HR_SEED_STATE } from "../data/careon/careon-hr";
import { careonDetailHref, KPI_DETAIL_BY_ID, KPI_DETAILS } from "../data/careon/careon-kpi-details";
import { COCKPIT_KPIS } from "../data/careon/careon-kpis";
import { complianceTone, KWALITEIT_COUNTERS } from "../data/careon/careon-kwaliteit";
import { DEMO_MIDDELEN_STATE, FUNCTIE_OPTIES, TAAL_OPTIES, TEAM_SEED } from "../data/careon/careon-middelen";
import { CAREON_MODULES } from "../data/careon/careon-modules";
import { CAREON_ROUTES } from "../data/careon/careon-pages";
import { PATIENTEN_METRICS } from "../data/careon/careon-patienten";
import { PLANNING_METRICS } from "../data/careon/careon-planning";
import {
  buildDemoConsult2,
  DEMO_CONSULT_SCRIPT,
  DEMO_SCRIBE_INSTELLINGEN,
  DEMO_SCRIBE_SESSIES,
  DEMO_SEGMENT_INTERVAL_MS,
  demoConsult3Notitie,
  EMPTY_SCRIBE_INSTELLINGEN,
  migreerScribeInstellingen,
  STANDAARD_CONSENTTEKST,
} from "../data/careon/careon-scribe";
import { CAREON_MONTHLY } from "../data/careon/careon-shared-charts";
import { sliceTimeframe, timeframeKeys } from "../data/careon/careon-timeframe";
import type { CareonKpiFormat, CareonMetric } from "../data/careon/careon-types";
import {
  bevatFinancieleFeiten,
  FINANCIEEL_VERVANGTEKST,
  filterFinancieleHistory,
  isFinancieleAssistentVraag,
  redigeerFinancieelThreadPayload,
  verwijderFinancieleContext,
} from "../lib/careon-assistant/financieel-gate";
import { redigeerFinancieleAssistentResponse } from "../lib/careon-assistant/financieel-redactie";
import { CAREON_HOSTED_DEMO_EMAIL } from "../lib/careon-demo-account";
import { facturatieGereedheid } from "../lib/careon-facturatie/gereedheid";
import { bouwFactuurMail } from "../lib/careon-facturatie/mail.server";
import {
  berekenVervaldatum,
  formatFactuurnummer,
  isTeLaat,
  uitreikingstermijnOverschreden,
} from "../lib/careon-facturatie/nummer";
import { renderFactuurPdf } from "../lib/careon-facturatie/pdf/render.server";
import { berekenTotalen, btwRegelLabel, formatEuro, isVolledigVrijgesteld } from "../lib/careon-facturatie/totalen";
import {
  type FacturatieInstellingen as FacturatieInstellingenType,
  type FactuurRegel,
  isEmailAdres,
  isFacturatieContact,
  isFacturatieInstellingen,
  isFactuur,
  isFactuurMaillogRegel,
  migreerInstellingen,
  vindTemplate,
} from "../lib/careon-facturatie/types";
import { afzenderUitTemplate, valideerFactuurVoorUitreiking } from "../lib/careon-facturatie/validatie";
import { magFacturatieZien } from "../lib/careon-facturatie-rol";
import { filterFinancieleAlerts, magFinancieelZien } from "../lib/careon-financieel-rol";
import { formatCareonDelta, formatCareonValue } from "../lib/careon-format";
import { buildHrBigAlert, hrMetrics } from "../lib/careon-hr/insights";
import { bigDagenTot, HR_KPI_IDS, type HrKpiId, isHrState } from "../lib/careon-hr/types";
import { CAREON_FINANCIELE_KPI_DETAIL_IDS, CAREON_KPI_DETAIL_IDS } from "../lib/careon-kpi-route";
import { executeMiddelenTool, isMiddelenTool } from "../lib/careon-middelen/assistant-executor";
import { DESTRUCTIEVE_TOOLS, MIDDELEN_TOOL_NAMES, MIDDELEN_TOOLS } from "../lib/careon-middelen/assistant-tools";
import { createConceptMiddelenApi, replayConceptActies } from "../lib/careon-middelen/concept";
import { isMiddelenState } from "../lib/careon-middelen/types";
import { CAREON_PROVENANCE, FINANCIELE_WIDGETS, pageLiveCounts } from "../lib/careon-production/provenance";
import {
  beleidszin,
  bouwVerslagDeterministisch,
  checklistOntbrekend,
  corrigeerTranscriptDeterministisch,
  deterministischeRonde,
  extraheerDeterministisch,
  extraheerTaken,
  isBehandelaarsrapportage,
  NIET_BESPROKEN_TEKST,
  normaliseerRisicopolariteit,
  normaliseerRisicozin,
  rondStaatAf,
} from "../lib/careon-scribe/deterministisch";
import { bouwExportTekst } from "../lib/careon-scribe/export-tekst";
import {
  beoordelingsSectieIds,
  isRisicoSectie,
  RISICO_STRUCTUUR_PLACEHOLDER,
  structuurPlaceholderVoor,
  VERSLAG_FORMATEN,
  vrijeSectieIds,
} from "../lib/careon-scribe/formaten";
import {
  bouwVerslagSchema,
  isKlinischeStaat,
  KLINISCHE_STAAT_JSON_SCHEMA,
  legeKlinischeStaat,
  mergeKlinischeStaat,
  STAAT_LABELS,
  strictSchema,
  VERSLAG_JSON_SCHEMA,
} from "../lib/careon-scribe/klinische-staat";
import {
  controleerMedicatie,
  groepenVoorAllergie,
  MIDDEL_GROEPEN,
  normaliseerDosering,
} from "../lib/careon-scribe/medicatie-veiligheid";
import { getalNaarCijfer, parseNlGetal } from "../lib/careon-scribe/nl-getallen";
import { verwijderOverlap } from "../lib/careon-scribe/overlap";
import { berekenRetentie } from "../lib/careon-scribe/retentie";
import {
  type Allergiefeit,
  CONSULT_TYPES,
  isPatientReferentie,
  isScribeInstellingen,
  isScribeNotitie,
  isScribeSegment,
  isScribeSessie,
  isScribeTaak,
  isVerslagSectie,
  type Medicatie,
  type MedicatieDosering,
  normaliseerScribeInstellingen,
  type KlinischeStaat as ScribeKlinischeStaat,
  type ScribeSegment,
  veiligeBestandsnaam,
} from "../lib/careon-scribe/types";
import { magScribeBeheren, magScribeGebruiken } from "../lib/careon-scribe-rol";

let failures = 0;
let passes = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function metric(list: CareonMetric[], label: string): CareonMetric {
  const found = list.find((m) => m.label === label);
  if (!found) {
    throw new Error(`Metric not found: ${label}`);
  }
  return found;
}

// ---- Value formatting (audited display values) ----
check("format int 1248", formatCareonValue(1248, "int"), "1.248");
check("format pct 3.4", formatCareonValue(3.4, "pct"), "3,4%");
check("format pct0 87", formatCareonValue(87, "pct0"), "87%");
check("format dec1 8.4", formatCareonValue(8.4, "dec1"), "8,4");
check("format eurK 425000", formatCareonValue(425000, "eurK"), "€ 425K");
check("format eurK 96400", formatCareonValue(96400, "eurK"), "€ 96K");
check("format eurK 21300", formatCareonValue(21300, "eurK"), "€ 21K");
check("format eur 2140", formatCareonValue(2140, "eur"), "€ 2.140");

// ---- Delta badges: every audited value ----
const cockpitDelta: Record<string, [string, string]> = {
  actief: ["+2,7%", "good"],
  aanmeldingen: ["+7", "good"],
  gesloten: ["-8", "neutral"],
  noshow: ["-0,7", "good"],
  zondervervolg: ["-11", "good"],
  dossiersnc: ["-9", "good"],
  omzettotaal: ["+7,2%", "good"],
  omzetverz: ["+6,0%", "good"],
  omzetinfo: ["+15,3%", "good"],
  outreach: ["+5", "good"],
  tevredenheid: ["+0,2", "good"],
};
for (const kpi of COCKPIT_KPIS) {
  const d = formatCareonDelta(kpi);
  check(`cockpit delta ${kpi.id}`, [d.text, d.tone], cockpitDelta[kpi.id]);
}

// Totale-omzet-kopkaart (klantverzoek 2026-07-25) = som van de splitkaarten;
// blijft synchroon als iemand de deelbedragen wijzigt.
const cTotal = COCKPIT_KPIS.find((k) => k.id === "omzettotaal");
const cVerz = COCKPIT_KPIS.find((k) => k.id === "omzetverz");
const cInfo = COCKPIT_KPIS.find((k) => k.id === "omzetinfo");
check("cockpit omzettotaal value = verz + info", cTotal?.value, (cVerz?.value ?? 0) + (cInfo?.value ?? 0));
check("cockpit omzettotaal prev = verz + info", cTotal?.prev, (cVerz?.prev ?? 0) + (cInfo?.prev ?? 0));
check(
  "cockpit omzettotaal spark = verz + info",
  cTotal?.spark,
  (cVerz?.spark ?? []).map((v, i) => v + (cInfo?.spark ?? [])[i]),
);

const patientenDelta: [string, string, string][] = [
  ["Actieve patiënten", "+2,7%", "good"],
  ["Nieuwe patiënten", "+7", "good"],
  ["Uitstroom", "-8", "neutral"],
  ["Wachtlijst intake", "-8", "good"],
  ["Wachtlijst behandeling", "-4", "good"],
  ["Zonder behandelaar", "-5", "good"],
  ["Zonder vervolgafspraak", "-11", "good"],
  [">30 dgn geen contact", "-8", "good"],
  [">60 dgn geen contact", "-5", "good"],
  ["Crisiscliënten", "+2", "bad"],
];
for (const [label, text, tone] of patientenDelta) {
  const d = formatCareonDelta(metric(PATIENTEN_METRICS, label));
  check(`patienten delta ${label}`, [d.text, d.tone], [text, tone]);
}

const planningDelta: [string, string][] = [
  ["Afspraken deze maand", "+3,0%"],
  ["No-shows", "-11"],
  ["Geannuleerd", "-13"],
  ["Agenda-bezetting", "+3 pt"],
  ["Beschikbare uren", "+0,9%"],
  ["Productieve uren", "+3,3%"],
  ["Behandeluren", "+2,4%"],
  ["Indirecte uren", "+7,1%"],
  ["Gem. wachttijd (wkn)", "-0,8"],
];
for (const [label, text] of planningDelta) {
  check(`planning delta ${label}`, formatCareonDelta(metric(PLANNING_METRICS, label)).text, text);
}

const financieelDelta: [string, string][] = [
  ["Omzet verzekeraars", "+6,0%"],
  ["Omzet Infomedics", "+15,3%"],
  ["Onderhanden werk", "+4,6%"],
  ["Openstaande declaraties", "-8,0%"],
  ["Afgekeurde declaraties", "-18,5%"],
  ["Gem. omzet / cliënt", "+3,1%"],
  ["Gem. omzet / traject", "+2,5%"],
  ["Declaraties >90 dgn", "-20,5%"],
];
for (const [label, text] of financieelDelta) {
  check(`financieel delta ${label}`, formatCareonDelta(metric(FINANCIEEL_METRICS, label)).text, text);
}

const hrDelta: [string, string][] = [
  ["Ziekteverzuim", "-0,6"],
  ["Verloop (12m)", "-3 pt"],
  ["Openstaande vacatures", "-2"],
  ["Lopende opleidingen", "+3"],
  ["Intervisie-deelname", "+4 pt"],
  ["Werkdrukscore", "-0,4"],
];
for (const [label, text] of hrDelta) {
  check(`hr delta ${label}`, formatCareonDelta(metric(HR_METRICS, label)).text, text);
}

const kwaliteitDelta: [string, string][] = [
  ["Incidenten (MIC)", "-3"],
  ["Klachten", "-1"],
  ["Dossierkwaliteit", "+0,3"],
  ["Cliënttevredenheid", "+0,2"],
];
for (const [label, text] of kwaliteitDelta) {
  check(`kwaliteit delta ${label}`, formatCareonDelta(metric(KWALITEIT_COUNTERS, label)).text, text);
}

// ---- Location scaling (audit: Roermond turns 1.248 into 275) ----
check("scale factors", CAREON_LOCATION_SCALE, { "Alle locaties": 1, Tilburg: 0.44, Breda: 0.34, Roermond: 0.22 });
const actief = COCKPIT_KPIS.find((k) => k.id === "actief");
check("actief scales", actief?.scale, true);
check("Roermond actief 1248 -> 275", Math.round(1248 * CAREON_LOCATION_SCALE.Roermond), 275);
check("noshow not scaled", COCKPIT_KPIS.find((k) => k.id === "noshow")?.scale, undefined);
check("tevredenheid not scaled", COCKPIT_KPIS.find((k) => k.id === "tevredenheid")?.scale, undefined);

// ---- CSV parser (audited messages and behavior) ----
const okResult = parseKpiCsv("careon-kpi-export.csv", SAMPLE_CSV_CONTENT);
check("csv sample matches 10", okResult.matched, 10);
check("csv sample ok", okResult.ok, true);
check("csv success message", okResult.message, "careon-kpi-export.csv verwerkt — 10 KPI's bijgewerkt in de cockpit.");
check("csv override actief", okResult.overrides.actief, { value: 1248, prev: 1215 });

const commaResult = parseKpiCsv("x.csv", "kpi,huidig,vorige_maand\nnoshow,2.9,3.4");
check("csv comma separator", commaResult.overrides.noshow, { value: 2.9, prev: 3.4 });

const decimalComma = parseKpiCsv("x.csv", "noshow;2,9;3,4");
check("csv decimal comma", decimalComma.overrides.noshow, { value: 2.9, prev: 3.4 });

const badResult = parseKpiCsv("test.csv", "foo;1;2\nbar;3;4");
check("csv failure ok=false", badResult.ok, false);
check(
  "csv failure message",
  badResult.message,
  "Geen herkenbare KPI's in test.csv — gebruik het voorbeeldbestand als basis.",
);

// ---- Alerts (counts and routing) ----
check("alert total", CAREON_ALERTS.length, 10);
check("critical count badge", CRITICAL_ALERT_COUNT, 3);
check(
  "severity counts",
  ["kritiek", "hoog", "middel"].map((sev) => CAREON_ALERTS.filter((a) => a.sev === sev).length),
  [3, 4, 3],
);
const expectedAlertRoutes = [
  ["Wachtlijst boven Treeknorm", "/dashboard/patienten"],
  ["Caseload boven norm (>80)", "/dashboard/behandelaren"],
  ["Geen contact >60 dagen", "/dashboard/patienten"],
  ["Zonder vervolgafspraak", "/dashboard/patienten"],
  ["Dossiers zonder behandelplan", "/dashboard/dossiercontrole"],
  ["Declaraties >90 dagen open", "/dashboard/financieel"],
  ["BIG-registratie verloopt <90 dgn", "/dashboard/hr"],
  ["No-show >5% per behandelaar", "/dashboard/behandelaren"],
  ["Geen ROM-meting", "/dashboard/dossiercontrole"],
  ["Geen evaluatie gepland", "/dashboard/dossiercontrole"],
];
for (const [titel, route] of expectedAlertRoutes) {
  const alert = CAREON_ALERTS.find((a) => a.titel === titel);
  check(`alert route ${titel}`, alert ? CAREON_ROUTES[alert.page] : null, route);
}

// ---- Cockpit KPI click targets ----
// Sinds de KPI-drilldown (client-goedgekeurd, handoff 08) opent elke
// cockpitkaart zijn detailpagina; de detailpagina linkt door naar de
// oorspronkelijke domeinpagina (die doorlink staat hieronder geborgd).
const expectedKpiRoutes: Record<string, string> = {
  actief: "/dashboard/details/actief",
  aanmeldingen: "/dashboard/details/aanmeldingen",
  gesloten: "/dashboard/details/gesloten",
  noshow: "/dashboard/details/noshow",
  zondervervolg: "/dashboard/details/zondervervolg",
  dossiersnc: "/dashboard/details/dossiersnc",
  omzettotaal: "/dashboard/details/omzettotaal",
  omzetverz: "/dashboard/details/omzetverz",
  omzetinfo: "/dashboard/details/omzetinfo",
  outreach: "/dashboard/details/outreach",
  tevredenheid: "/dashboard/details/tevredenheid",
};
for (const kpi of COCKPIT_KPIS) {
  check(`kpi route ${kpi.id}`, careonDetailHref(kpi.id), expectedKpiRoutes[kpi.id]);
}
// De geauditeerde kaart→domein-koppeling blijft bestaan als doorlink op de
// detailpagina (entry.page → CAREON_ROUTES).
const expectedOnwardRoutes: Record<string, string> = {
  actief: "/dashboard/patienten",
  aanmeldingen: "/dashboard/patienten",
  gesloten: "/dashboard/patienten",
  noshow: "/dashboard/planning",
  zondervervolg: "/dashboard/patienten",
  dossiersnc: "/dashboard/dossiercontrole",
  omzettotaal: "/dashboard/financieel",
  omzetverz: "/dashboard/financieel",
  omzetinfo: "/dashboard/financieel",
  outreach: "/dashboard/patienten",
  tevredenheid: "/dashboard/kwaliteit",
};
for (const kpi of COCKPIT_KPIS) {
  const entry = KPI_DETAIL_BY_ID.get(kpi.id);
  check(`kpi doorlink ${kpi.id}`, entry ? CAREON_ROUTES[entry.page] : null, expectedOnwardRoutes[kpi.id]);
}

// ---- Behandelaren color thresholds (audited rules) ----
check("caseload 86 bad", caseloadTone(86), "bad");
check("caseload 83 bad", caseloadTone(83), "bad");
check("caseload 77 warn", caseloadTone(77), "warn");
check("caseload 62 none", caseloadTone(62), "none");
check("noshow 5.1 bad", noshowTone(5.1), "bad");
check("noshow 4.4 warn", noshowTone(4.4), "warn");
check("noshow 3.8 none", noshowTone(3.8), "none");
check("nc 5 bad", ncTone(5), "bad");
check("nc 3 warn", ncTone(3), "warn");
check("nc 0 good", ncTone(0), "good");

// ---- Kwaliteit compliance tones (within 2pt green, within 8pt orange) ----
check("compliance 96/98 good", complianceTone(96, 98), "good");
check("compliance 78/85 warn", complianceTone(78, 85), "warn");
check("compliance 91/100 bad", complianceTone(91, 100), "bad");

// ---- Dossiers & productie (client feature, handoff 07): reconciliation with audited values ----
const sumAantal = (groepen: { aantal: number }[]) => groepen.reduce((sum, g) => sum + g.aantal, 0);
check("dp actieve clienten = cockpit actief", ACTIEVE_CLIENTEN, 1248);
check(
  "dp afsluitingen som = gesloten dossiers 74",
  MEDEWERKER_PRODUCTIE.reduce((sum, row) => sum + row.afsluitingen, 0),
  metric(PATIENTEN_METRICS, "Uitstroom").value,
);
check(
  "dp productie-uren per mw = declarabel + indirect",
  MEDEWERKER_PRODUCTIE.every((row) => row.productieUren === row.declU + row.indirU),
  true,
);
check("dp medewerkers = 10 geauditeerde behandelaren", MEDEWERKER_PRODUCTIE.length, 10);
check(
  "dp KPI productie-uren = som medewerkers",
  metric(DOSSIERS_PRODUCTIE_METRICS, "Productie-uren").value,
  MEDEWERKER_PRODUCTIE.reduce((sum, row) => sum + row.productieUren, 0),
);
check("dp diagnoses som = actieve clienten", sumAantal(DIAGNOSE_GROEPEN), ACTIEVE_CLIENTEN);
check(
  "dp geslacht som = actieve clienten",
  GESLACHT_VERDELING.reduce((sum, g) => sum + g.value, 0),
  ACTIEVE_CLIENTEN,
);
check("dp leeftijd som = actieve clienten", sumAantal(LEEFTIJD_GROEPEN), ACTIEVE_CLIENTEN);
check("dp plaats som = actieve clienten", sumAantal(PLAATS_VERDELING), ACTIEVE_CLIENTEN);
check("dp verzekeraars som = actieve clienten", sumAantal(VERZEKERAAR_VERDELING), ACTIEVE_CLIENTEN);
check(
  "dp regiebehandelaren som = actieve clienten",
  REGIEBEHANDELAREN.reduce((sum, row) => sum + row.clienten, 0),
  ACTIEVE_CLIENTEN,
);
check(
  "dp wachtlijst totaal = intake 43 + behandeling 27",
  WACHTLIJST_SUMMARY.totaal,
  metric(PATIENTEN_METRICS, "Wachtlijst intake").value + metric(PATIENTEN_METRICS, "Wachtlijst behandeling").value,
);
check("dp wachtlijst buckets som = totaal", sumAantal(WACHTLIJST_BUCKETS), WACHTLIJST_SUMMARY.totaal);
check("dp wachtlijst per locatie som = totaal", sumAantal(WACHTLIJST_PER_LOCATIE), WACHTLIJST_SUMMARY.totaal);
check("dp gem wachttijd = planning 5,2 wkn", WACHTLIJST_SUMMARY.gemWachttijdWkn, 5.2);
check("dp regie tone 236 bad", regieTone(236), "bad");
check("dp regie tone 214 warn", regieTone(214), "warn");
check("dp regie tone 168 none", regieTone(168), "none");
check("dp route", CAREON_ROUTES.dossiersProductie, "/dashboard/dossiers-productie");

// ---- KPI-drilldown register (client-feature, handoff 08): reconciliation ----
// Elke KPI-kaart linkt naar /dashboard/details/<id>; de demo-records achter
// elke detailpagina moeten exact reconciliëren met de geauditeerde waarden.

const CARD_SOURCES: [string, CareonMetric[]][] = [
  ["patienten", PATIENTEN_METRICS],
  ["planning", PLANNING_METRICS],
  ["financieel", FINANCIEEL_METRICS],
  ["hr", HR_METRICS],
  ["kwaliteit", KWALITEIT_COUNTERS],
  ["dossiersProductie", DOSSIERS_PRODUCTIE_METRICS],
];

// Registerdekking: unieke ids, elke kaart heeft een entry, cockpit gedekt.
check("detail ids uniek", KPI_DETAILS.length, new Set(KPI_DETAILS.map((d) => d.id)).size);
check(
  "proxy detail-id register gelijk aan detailregister",
  [...CAREON_KPI_DETAIL_IDS].sort(),
  KPI_DETAILS.map((detail) => detail.id).sort(),
);
for (const kpi of COCKPIT_KPIS) {
  check(`detail entry cockpit ${kpi.id}`, KPI_DETAIL_BY_ID.has(kpi.id), true);
}
for (const [pageName, metrics] of CARD_SOURCES) {
  for (const m of metrics) {
    const entry = m.detailId ? KPI_DETAIL_BY_ID.get(m.detailId) : undefined;
    check(`detail entry ${pageName} ${m.label}`, Boolean(entry), true);
    if (!entry) {
      continue;
    }
    if (entry.f === m.f) {
      // Waarde/formaat van de detailkop = waarde/formaat van de kaart.
      check(`detail waarde ${entry.id} (${pageName})`, [entry.value, entry.f], [m.value, m.f]);
    } else {
      // Gedeelde pagina met andere weergavevorm (planning "No-shows" 63 ↔
      // cockpit "No-show" 3,4%): de tel-reconciliatie dekt dan de kaartwaarde.
      check(
        `detail telling dekt kaart ${pageName} ${m.label}`,
        entry.reconcile.kind === "count" ? (entry.reconcile.expected ?? entry.value) : null,
        m.value,
      );
    }
  }
}

// Herkomst-sleutels bestaan (typo-bewaking) en trends hebben 12 punten.
for (const entry of KPI_DETAILS) {
  check(
    `detail provenance ${entry.id}`,
    Boolean(CAREON_PROVENANCE[entry.provenance.page]?.widgets[entry.provenance.widget]),
    true,
  );
  check(`detail trend lengte ${entry.id}`, entry.trend.length, 12);
  const spark = COCKPIT_KPIS.find((k) => k.id === entry.id)?.spark;
  if (spark) {
    check(`detail trend = cockpit spark ${entry.id}`, entry.trend, spark);
  } else {
    // Gegenereerde reeksen eindigen exact op [vorige, huidige] (eurK in duizenden).
    const inK = entry.f === "eurK" ? 1000 : 1;
    check(`detail trend eindigt op waarde ${entry.id}`, entry.trend[11], Math.round((entry.value / inK) * 10) / 10);
  }
}

// Reconciliatie: tellingen, sommen en gewogen gemiddelden.
for (const entry of KPI_DETAILS) {
  const rows = demoDetailRows(entry.id);
  const rec = entry.reconcile;
  if (rec.kind === "count") {
    check(`detail count ${entry.id}`, rows.length, rec.expected ?? entry.value);
  } else if (rec.kind === "sum") {
    check(
      `detail som ${entry.id}`,
      rows.reduce((sum, r) => sum + Number(r[rec.field] ?? 0), 0),
      entry.value,
    );
  } else if (rec.kind === "weightedMean") {
    const n = rows.reduce((sum, r) => sum + Number(r[rec.nField] ?? 0), 0);
    const gewogen = rows.reduce((sum, r) => sum + Number(r[rec.nField] ?? 0) * Number(r[rec.vField] ?? 0), 0) / n;
    check(
      `detail gewogen gemiddelde ${entry.id}`,
      formatCareonValue(gewogen, entry.f),
      formatCareonValue(entry.value, entry.f),
    );
  } else if (rec.kind === "mean") {
    const mean = rows.reduce((sum, r) => sum + Number(r[rec.field] ?? 0), 0) / rows.length;
    check(`detail gemiddelde ${entry.id}`, formatCareonValue(mean, entry.f), formatCareonValue(entry.value, entry.f));
  }
}

// Locatieverdeling van schaalbare tel-KPI's: gefilterde tabel = geschaalde kaart.
// Als de drie afrondingen niet op het totaal sommeren (zondervervolg: 32 ≠ 31)
// is één locatie ±1 — de largest-remainder-som blijft altijd exact het totaal.
const scalableCountIds = KPI_DETAILS.filter((d) => d.scale && d.f === "int").map((d) => d.id);
check("detail schaalbare tel-KPI's", scalableCountIds, [
  "actief",
  "aanmeldingen",
  "gesloten",
  "zondervervolg",
  "dossiersnc",
  "outreach",
]);
for (const id of scalableCountIds) {
  const entry = KPI_DETAIL_BY_ID.get(id);
  if (!entry) {
    continue;
  }
  const rows = demoDetailRows(id);
  const rounds = DETAIL_LOCS.map((loc) => Math.round(entry.value * CAREON_LOCATION_SCALE[loc]));
  const counts = DETAIL_LOCS.map((loc) => rows.filter((r) => r.loc === loc).length);
  check(
    `detail locatiesom ${id}`,
    counts.reduce((a, b) => a + b, 0),
    entry.value,
  );
  const roundsSluiten = rounds.reduce((a, b) => a + b, 0) === entry.value;
  if (roundsSluiten) {
    check(`detail locatieverdeling ${id}`, counts, rounds);
  } else {
    check(
      `detail locatieverdeling ±1 ${id}`,
      counts.every((c, i) => Math.abs(c - rounds[i]) <= 1),
      true,
    );
  }
}
// Euro-KPI's met schaalvlag: som per locatie exact waarde × factor.
for (const id of ["omzetverz", "omzetinfo"]) {
  const entry = KPI_DETAIL_BY_ID.get(id);
  if (!entry) {
    continue;
  }
  const rows = demoDetailRows(id);
  check(
    `detail locatiesommen ${id}`,
    DETAIL_LOCS.map((loc) => rows.filter((r) => r.loc === loc).reduce((sum, r) => sum + Number(r.bedrag ?? 0), 0)),
    DETAIL_LOCS.map((loc) => entry.value * CAREON_LOCATION_SCALE[loc]),
  );
}

// ---- Kaart ≡ drilldown-kop onder elk locatiefilter ----
// De incoherentie die dit blok bewaakt: de Directiecockpit schaalt zijn kaarten
// met de locatiefactor en verwerkt de Databron-CSV, de eigenaarspagina's deden
// geen van beide — dezelfde KPI toonde één klik verderop twee getallen. Alle
// kaarten lopen nu door demoKpiWaarde; deze assertions vallen om zodra één
// plek die regel weer omzeilt.

// 1. De gedeelde regel reproduceert de cockpit-provider exact (careon-provider
//    berekent `kpis` nog inline; die inline-versie is hier het referentiepunt).
for (const loc of CAREON_LOCATIONS) {
  const f = CAREON_LOCATION_SCALE[loc];
  for (const kpi of COCKPIT_KPIS) {
    const verwacht =
      kpi.scale && f !== 1
        ? { value: Math.round(kpi.value * f), prev: Math.round(kpi.prev * f) }
        : { value: kpi.value, prev: kpi.prev };
    check(`cockpitregel = gedeelde regel ${kpi.id} ${loc}`, demoKpiWaarde(kpi.id, kpi, {}, f), verwacht);
  }
}

// 2. Elke kaart met een drilldown toont onder elk locatiefilter exact de
//    kopwaarde van die drilldown. Dossiercontrole rendert samenvattingstegels
//    i.p.v. CareonMetric-kaarten, dus die staan hier expliciet.
const DOSSIER_TEGELS: { page: string; detailId: string; value: number; f: CareonKpiFormat }[] = [
  { page: "dossiers", detailId: "dossier-compliance", value: DOSSIER_SUMMARY.compliancePct, f: "pct" },
  { page: "dossiers", detailId: "actief", value: DOSSIER_SUMMARY.gecontroleerd, f: "int" },
  { page: "dossiers", detailId: "dossiersnc", value: DOSSIER_SUMMARY.nietCompleet, f: "int" },
  { page: "dossiers", detailId: "dossierkwaliteit", value: DOSSIER_SUMMARY.auditScore, f: "dec1" },
];
const kaartenMetDrilldown = [
  ...CARD_SOURCES.flatMap(([page, metrics]) =>
    metrics.filter((m) => m.detailId).map((m) => ({ page, detailId: m.detailId as string, value: m.value, f: m.f })),
  ),
  ...DOSSIER_TEGELS,
];
for (const loc of CAREON_LOCATIONS) {
  const f = CAREON_LOCATION_SCALE[loc];
  for (const kaart of kaartenMetDrilldown) {
    const entry = KPI_DETAIL_BY_ID.get(kaart.detailId);
    // Gedeelde entry met een andere weergavevorm (planning "No-shows" 63 ↔
    // cockpit "No-show" 3,4%): daar dekt de tel-reconciliatie de kaartwaarde.
    if (!entry || entry.f !== kaart.f) {
      continue;
    }
    check(
      `kaart = drilldown-kop ${kaart.page} ${kaart.detailId} ${loc}`,
      demoKpiWaarde(kaart.detailId, { value: kaart.value, prev: null }, {}, f).value,
      demoKpiWaarde(kaart.detailId, { value: entry.value, prev: null }, {}, f).value,
    );
  }
}

// 3. De kop van een schaalbare drilldown = de tabel eronder. Tellingen mogen
//    ±1 afwijken (zondervervolg 31: de drie afrondingen sommeren tot 32).
for (const loc of DETAIL_LOCS) {
  const f = CAREON_LOCATION_SCALE[loc];
  for (const entry of KPI_DETAILS.filter((d) => d.scale)) {
    const kop = demoKpiWaarde(entry.id, { value: entry.value, prev: null }, {}, f).value;
    const rijen = demoDetailRows(entry.id).filter((r) => !r.loc || r.loc === loc);
    const rec = entry.reconcile;
    if (rec.kind === "count") {
      check(`kop = tabel ${entry.id} ${loc}`, Math.abs(rijen.length - kop) <= 1, true);
    } else if (rec.kind === "sum") {
      const som = rijen.reduce((sum, r) => sum + Number(r[rec.field] ?? 0), 0);
      check(`kop = tabelsom ${entry.id} ${loc}`, Math.round(som), kop);
    }
  }
}

// 4. De trendgrafiek eindigt op de kopwaarde (eurK-reeksen in duizenden).
for (const loc of CAREON_LOCATIONS) {
  const f = CAREON_LOCATION_SCALE[loc];
  for (const entry of KPI_DETAILS.filter((d) => d.scale)) {
    const kop = demoKpiWaarde(entry.id, { value: entry.value, prev: null }, {}, f).value;
    const inK = entry.f === "eurK" ? 1000 : 1;
    const verwacht = entry.f === "int" ? Math.round(kop / inK) : Math.round((kop / inK) * 10) / 10;
    check(`trend eindigt op kopwaarde ${entry.id} ${loc}`, demoKpiTrend(entry.id, entry.trend, f)[11], verwacht);
  }
}

// 5. Percentages en scores schalen nooit mee met een locatie (geauditeerde regel).
for (const loc of CAREON_LOCATIONS) {
  const f = CAREON_LOCATION_SCALE[loc];
  for (const entry of KPI_DETAILS.filter((d) => d.f === "pct" || d.f === "pct0" || d.f === "dec1")) {
    check(
      `percentage/score schaalt niet ${entry.id} ${loc}`,
      demoKpiWaarde(entry.id, { value: entry.value, prev: null }, {}, f).value,
      entry.value,
    );
  }
}

// 6. Databron-CSV: de override komt op elke kaart terecht (niet alleen de
//    cockpit) en gaat vóór de locatieschaal, precies zoals in de bron-bundle.
const csvOverrides = { actief: { value: 1300, prev: 1248 } };
check("csv-override op alle kaarten", demoKpiWaarde("actief", { value: 1248, prev: 1215 }, csvOverrides, 1), {
  value: 1300,
  prev: 1248,
});
check(
  "csv-override schaalt daarna mee",
  demoKpiWaarde("actief", { value: 1248, prev: 1215 }, csvOverrides, CAREON_LOCATION_SCALE.Tilburg),
  { value: Math.round(1300 * 0.44), prev: Math.round(1248 * 0.44) },
);
check(
  "csv-override raakt alleen zijn eigen KPI",
  demoKpiWaarde("wachtlijst-intake", { value: 43, prev: 51 }, csvOverrides, 1),
  { value: 43, prev: 51 },
);

// Wachtlijst: één consistente set — locatieverdeling en duur-buckets geauditeerd.
const wachtRows = demoDetailRows("wachtlijst-totaal");
check(
  "detail wachtlijst per locatie",
  WACHTLIJST_PER_LOCATIE.map((l) => wachtRows.filter((r) => r.loc === l.label).length),
  WACHTLIJST_PER_LOCATIE.map((l) => l.aantal),
);
check(
  "detail wachtlijst buckets",
  [
    wachtRows.filter((r) => Number(r.dagen) <= 14).length,
    wachtRows.filter((r) => Number(r.dagen) >= 15 && Number(r.dagen) <= 30).length,
    wachtRows.filter((r) => Number(r.dagen) >= 31 && Number(r.dagen) <= 60).length,
    wachtRows.filter((r) => Number(r.dagen) >= 61).length,
  ],
  WACHTLIJST_BUCKETS.map((b) => b.aantal),
);
check(
  "detail wachtlijst fase-split",
  [wachtRows.filter((r) => r.fase === "Intake").length, wachtRows.filter((r) => r.fase === "Behandeling").length],
  [43, 27],
);
check("detail wachtlijst urgent", wachtRows.filter((r) => r.urgentie === "Urgent").length, 6);

// Afspraken: statuspool bevat exact de no-shows (63) en annuleringen (118).
const afspraakRows = demoDetailRows("afspraken");
check("detail afspraken no-shows", afspraakRows.filter((r) => r.status === "No-show").length, 63);
check("detail afspraken geannuleerd", afspraakRows.filter((r) => r.status === "Geannuleerd").length, 118);

// Continuïteit: de geauditeerde "Vraagt aandacht"-cliënten staan in hun tabel.
check(
  "detail risico-rijen contact60",
  ["P-4817", "P-4522"].every((id) => demoDetailRows("contact60").some((r) => r.key === id)),
  true,
);
check(
  "detail risico-rijen zondervervolg",
  ["P-4930", "P-5121"].every((id) => demoDetailRows("zondervervolg").some((r) => r.key === id)),
  true,
);
check(
  "detail risico-rij zonder-behandelaar",
  demoDetailRows("zonder-behandelaar").some((r) => r.key === "P-5104"),
  true,
);

// Determinisme: twee verse builds geven identieke rijen (SSR = client).
for (const id of ["actief", "omzetverz", "wachttijd", "afspraken"]) {
  check(`detail determinisme ${id}`, buildDetailRowsFresh(id), buildDetailRowsFresh(id));
}

// ---- Middelen & inventaris (handoff 09, handmatige registratie) ----

const CAREON_LOCATION_KEUZES = CAREON_LOCATIONS.filter((locatie) => locatie !== "Alle locaties");

check("middelen demo-seed is geldige state", isMiddelenState(DEMO_MIDDELEN_STATE), true);
check(
  "middelen seed: niet-handmatige personen zijn geauditeerde behandelaren",
  DEMO_MIDDELEN_STATE.medewerkers
    .filter((rij) => !rij.handmatig)
    .every((rij) => BEHANDELAREN.some((behandelaar) => behandelaar.naam === rij.naam)),
  true,
);
check(
  "middelen seed: inventarislocaties = demo-locaties",
  DEMO_MIDDELEN_STATE.inventaris.map((rij) => rij.locatie),
  CAREON_LOCATION_KEUZES,
);
check(
  "middelen seed: auto en tankpas paarsgewijs uitgegeven",
  DEMO_MIDDELEN_STATE.medewerkers.filter((rij) => rij.middelen.includes("auto")).length,
  DEMO_MIDDELEN_STATE.medewerkers.filter((rij) => rij.middelen.includes("tankpas")).length,
);
check(
  "middelen seed: elke medewerker heeft een gecureerde functie",
  DEMO_MIDDELEN_STATE.medewerkers.every((rij) => (FUNCTIE_OPTIES as readonly string[]).includes(rij.functie ?? "")),
  true,
);
check(
  "middelen seed: talen komen uit de gecureerde lijst en bevatten Nederlands",
  DEMO_MIDDELEN_STATE.medewerkers.every(
    (rij) =>
      (rij.talen ?? []).includes("Nederlands") &&
      (rij.talen ?? []).every((taal) => (TAAL_OPTIES as readonly string[]).includes(taal)),
  ),
  true,
);

// Teamstructuur = exact de klantopgave van 2026-07-20 (teams per Vektis-locatie).
const teamsVan = (locatie: string) => TEAM_SEED.filter((team) => team.locatie === locatie).map((team) => team.naam);
check("teams Tilburg", teamsVan("Tilburg"), ["SGGZ", "Outreachend", "GGZ in beweging", "RMA/RMO"]);
check("teams Roermond", teamsVan("Roermond"), ["SGGZ", "Outreachend", "RMA/RMO"]);
check("teams De Zorgpoort", teamsVan("De Zorgpoort"), ["SGGZ", "Outreachend", "RMA/RMO"]);
check(
  "teams uniek per locatie",
  TEAM_SEED.length,
  new Set(TEAM_SEED.map((team) => `${team.locatie}::${team.naam}`)).size,
);
check("demo-seed draagt de teamstructuur", DEMO_MIDDELEN_STATE.teams, TEAM_SEED);

// ---- Assistent-acties (handoff 11): tools ↔ executor ↔ registratie ----

check(
  "assistent-tools: schema's dekken exact de toolnamen",
  MIDDELEN_TOOLS.map((tool) => tool.function.name).sort(),
  [...MIDDELEN_TOOL_NAMES].sort(),
);
check(
  "assistent-tools: elke tool heeft een executor-handler",
  MIDDELEN_TOOL_NAMES.every((name) => isMiddelenTool(name)),
  true,
);
check("assistent-tools: onbekende tool wordt geweigerd", isMiddelenTool("verwijder_alles"), false);
check(
  "assistent-tools: destructieve markering dekt bekende tools",
  DESTRUCTIEVE_TOOLS.every((name) => (MIDDELEN_TOOL_NAMES as readonly string[]).includes(name)),
  true,
);
check(
  "middelen seed: laptops-voorraad op elke demo-locatie",
  DEMO_MIDDELEN_STATE.inventaris.every((rij) => (rij.laptops ?? 0) > 0),
  true,
);

// Executor-rooktest tegen de échte concept-api (concept.ts): acties worden
// klaargezet in een kopie — de bron-seed blijft onaangeroerd tot "Toepassen".
const TEST_BRON = { medewerkers: BEHANDELAREN.map((rij) => rij.naam), locaties: CAREON_LOCATION_KEUZES };
const conceptTest = createConceptMiddelenApi(DEMO_MIDDELEN_STATE);
check(
  "assistent-concept: laptop toewijzen aan P. Hendriks",
  executeMiddelenTool(
    "wijzig_middel",
    { naam: "P. Hendriks", middel: "laptop", actie: "toewijzen" },
    conceptTest.api,
    TEST_BRON,
  ).status,
  "ok",
);
check(
  "assistent-concept: concept draagt de nieuwe laptop",
  conceptTest
    .huidig()
    .medewerkers.find((rij) => rij.naam === "P. Hendriks")
    ?.middelen.includes("laptop"),
  true,
);
check(
  "assistent-concept: bron-seed blijft onaangeroerd (niets opgeslagen)",
  DEMO_MIDDELEN_STATE.medewerkers.find((rij) => rij.naam === "P. Hendriks")?.middelen.includes("laptop"),
  false,
);
check(
  "assistent-concept: dubbele toewijzing is geen wijziging",
  executeMiddelenTool(
    "wijzig_middel",
    { naam: "P. Hendriks", middel: "laptop", actie: "toewijzen" },
    conceptTest.api,
    TEST_BRON,
  ).status,
  "geen_wijziging",
);
check(
  "assistent-concept: naamresolutie op deelnaam (Hendriks)",
  executeMiddelenTool(
    "wijzig_middel",
    { naam: "Hendriks", middel: "laptop", actie: "innemen" },
    conceptTest.api,
    TEST_BRON,
  ).status,
  "ok",
);
check(
  "assistent-concept: onbekende naam is een fout",
  executeMiddelenTool(
    "wijzig_middel",
    { naam: "Jansen van Galen", middel: "laptop", actie: "toewijzen" },
    conceptTest.api,
    TEST_BRON,
  ).status,
  "fout",
);
check(
  "assistent-concept: verwijderen wordt klaargezet (goedkeuring volgt in het canvas)",
  executeMiddelenTool("verwijder_medewerker", { naam: "P. Hendriks" }, conceptTest.api, TEST_BRON).status,
  "ok",
);
check(
  "assistent-concept: P. Hendriks is uit de conceptstaat",
  conceptTest.huidig().medewerkers.some((rij) => rij.naam === "P. Hendriks"),
  false,
);
check(
  "assistent-concept: bron-seed behoudt P. Hendriks",
  DEMO_MIDDELEN_STATE.medewerkers.some((rij) => rij.naam === "P. Hendriks"),
  true,
);
check(
  "assistent-concept: laptops-voorraad Tilburg aanpassen (case-insensitieve locatie)",
  executeMiddelenTool("zet_inventaris", { locatie: "tilburg", veld: "laptops", aantal: 20 }, conceptTest.api, TEST_BRON)
    .status,
  "ok",
);
check(
  "assistent-concept: voorraad Tilburg staat op 20 in het concept",
  conceptTest.huidig().inventaris.find((rij) => rij.locatie === "Tilburg")?.laptops,
  20,
);
check(
  "assistent-concept: concept-eindstand is een geldige MiddelenState",
  isMiddelenState({ ...conceptTest.huidig(), updatedAt: "2026-07-24T00:00:00.000Z" }),
  true,
);

// Bulk-tools: iedereen=true garandeert volledige dekking (registratie ∪ bron)
// zónder dat het model namen hoeft op te sommen — de kern van de fix voor
// "assistent raakt alleen de eerste 10 medewerkers".
const bulkTest = createConceptMiddelenApi(DEMO_MIDDELEN_STATE);
const ALLE_NAMEN = new Set([...DEMO_MIDDELEN_STATE.medewerkers.map((rij) => rij.naam), ...TEST_BRON.medewerkers]);
const bulkTaal = executeMiddelenTool(
  "wijzig_taal_bulk",
  { taal: "Pools", actie: "toevoegen", iedereen: true },
  bulkTest.api,
  TEST_BRON,
);
check("assistent-bulk: iedereen=true raakt registratie ∪ databron", bulkTaal.namen?.length, ALLE_NAMEN.size);
check("assistent-bulk: taal-bulk voert uit", bulkTaal.status, "ok");
check(
  "assistent-bulk: elke medewerker draagt de taal in het concept",
  bulkTest.huidig().medewerkers.every((rij) => (rij.talen ?? []).includes("Pools")),
  true,
);
check(
  "assistent-bulk: idempotente herhaling is geen wijziging",
  executeMiddelenTool(
    "wijzig_taal_bulk",
    { taal: "Pools", actie: "toevoegen", iedereen: true },
    bulkTest.api,
    TEST_BRON,
  ).status,
  "geen_wijziging",
);
check(
  "assistent-bulk: middel-bulk vult alleen de ontbrekende laptop aan",
  executeMiddelenTool(
    "wijzig_middel_bulk",
    { middel: "laptop", actie: "toewijzen", iedereen: true },
    bulkTest.api,
    TEST_BRON,
  ).melding.startsWith("laptop toegewezen aan 1 van"),
  true,
);
check(
  "assistent-bulk: zonder iedereen of namen een duidelijke fout",
  executeMiddelenTool("wijzig_taal_bulk", { taal: "Pools", actie: "toevoegen" }, bulkTest.api, TEST_BRON).status,
  "fout",
);
check(
  "assistent-bulk: bron-seed blijft ook na bulk onaangeroerd",
  DEMO_MIDDELEN_STATE.medewerkers.some((rij) => (rij.talen ?? []).includes("Pools")),
  false,
);

// Replay-laag (bewerkbaar concept): het concept is een her-afspeelbaar
// actielogboek — Toepassen replayt op de actuele stand (tussentijdse
// handmatige wijzigingen blijven behouden) en gebruikers-bewerkingen
// (regel schrappen, naam uitsluiten) herberekenen deterministisch.
const replayBasis = createConceptMiddelenApi(DEMO_MIDDELEN_STATE);
replayBasis.api.addPersoon("Tussentijds Toegevoegd");
const replayUitkomst = replayConceptActies(
  [{ tool: "wijzig_taal_bulk", args: { taal: "Pools", actie: "toevoegen", iedereen: true } }],
  replayBasis.huidig(),
  TEST_BRON,
);
check(
  "assistent-replay: tussentijdse handmatige rij blijft behouden (geen clobbering)",
  replayUitkomst.staat.medewerkers.some((rij) => rij.naam === "Tussentijds Toegevoegd"),
  true,
);
check(
  "assistent-replay: bulk raakt óók de tussentijdse rij",
  replayUitkomst.staat.medewerkers.every((rij) => (rij.talen ?? []).includes("Pools")),
  true,
);
const metUitsluiting = replayConceptActies(
  [
    {
      tool: "wijzig_taal_bulk",
      args: { taal: "Pools", actie: "toevoegen", iedereen: true },
      uitgesloten: ["P. Hendriks"],
    },
  ],
  DEMO_MIDDELEN_STATE,
  TEST_BRON,
);
check(
  "assistent-replay: uitgesloten naam blijft ongemoeid",
  (metUitsluiting.staat.medewerkers.find((rij) => rij.naam === "P. Hendriks")?.talen ?? []).includes("Pools"),
  false,
);
check(
  "assistent-replay: overige medewerkers wél geraakt",
  metUitsluiting.staat.medewerkers
    .filter((rij) => rij.naam !== "P. Hendriks")
    .every((rij) => (rij.talen ?? []).includes("Pools")),
  true,
);
check(
  "assistent-replay: geschrapte regels = geen effect",
  replayConceptActies([], DEMO_MIDDELEN_STATE, TEST_BRON).staat.medewerkers,
  DEMO_MIDDELEN_STATE.medewerkers,
);

// Dienstverband (klantscenario "zet behandelaar X uit dienst"): registratie
// blijft bewaard als historie; uitgegeven middelen worden automatisch
// ingenomen. Samen met de overige tools dekt de assistent daarmee ALLE
// handmatige registratie-operaties van de Middelen-pagina.
const dienstTest = createConceptMiddelenApi(DEMO_MIDDELEN_STATE);
check(
  "assistent-dienstverband: uit dienst zetten",
  executeMiddelenTool("zet_dienstverband", { naam: "Drs. E. van Dijk", uitDienst: true }, dienstTest.api, TEST_BRON)
    .status,
  "ok",
);
const uitDienstRij = dienstTest.huidig().medewerkers.find((rij) => rij.naam === "Drs. E. van Dijk");
check("assistent-dienstverband: markering gezet, registratie bewaard", uitDienstRij?.uitDienst, true);
check("assistent-dienstverband: alle middelen automatisch ingenomen", uitDienstRij?.middelen.length, 0);
check(
  "assistent-dienstverband: idempotent",
  executeMiddelenTool("zet_dienstverband", { naam: "Drs. E. van Dijk", uitDienst: true }, dienstTest.api, TEST_BRON)
    .status,
  "geen_wijziging",
);
executeMiddelenTool("zet_dienstverband", { naam: "Drs. E. van Dijk", uitDienst: false }, dienstTest.api, TEST_BRON);
check(
  "assistent-dienstverband: weer in dienst wist de markering",
  dienstTest.huidig().medewerkers.find((rij) => rij.naam === "Drs. E. van Dijk")?.uitDienst,
  undefined,
);
check(
  "assistent-dekking: dienstverband-tool aanwezig in het schema",
  (MIDDELEN_TOOL_NAMES as readonly string[]).includes("zet_dienstverband"),
  true,
);
check(
  "assistent-dekking: databron-medewerker niet te verwijderen (redirect naar dienstverband, zoals de pagina)",
  executeMiddelenTool(
    "verwijder_medewerker",
    { naam: BEHANDELAREN[0].naam },
    createConceptMiddelenApi(DEMO_MIDDELEN_STATE).api,
    TEST_BRON,
  ).status,
  "fout",
);

// ---- Tijdvenster-toggle (per-grafiek venster op maandreeksen) ----
check(
  "tijdvenster: 12m = volledige reeks van 12",
  sliceTimeframe(CAREON_MONTHLY, "12m").map((punt) => punt.m),
  CAREON_MONTHLY.map((punt) => punt.m),
);
check(
  "tijdvenster: 3m = laatste drie maanden",
  sliceTimeframe(CAREON_MONTHLY, "3m").map((punt) => punt.m),
  ["mei", "jun", "jul"],
);
check(
  "tijdvenster: 1m = laatste maand",
  sliceTimeframe(CAREON_MONTHLY, "1m").map((punt) => punt.m),
  ["jul"],
);
check("tijdvenster: kortere reeks blijft heel", sliceTimeframe(["a", "b"], "6m"), ["a", "b"]);
check(
  "tijdvenster: sleutelselectie pakt laatste venster",
  [...timeframeKeys(["2026-04", "2026-05", "2026-06"], "1m")],
  ["2026-06"],
);
// "all" toont de volledige reeks, ongeacht lengte.
check(
  "tijdvenster: all = volledige reeks",
  sliceTimeframe(CAREON_MONTHLY, "all").map((punt) => punt.m),
  CAREON_MONTHLY.map((punt) => punt.m),
);
check("tijdvenster: all op langere reeks = alles", sliceTimeframe(["a", "b", "c", "d"], "all"), ["a", "b", "c", "d"]);
check(
  "tijdvenster: all sleutels = alles",
  [...timeframeKeys(["2026-04", "2026-05", "2026-06"], "all")],
  ["2026-04", "2026-05", "2026-06"],
);

// ---- HR handmatige registratie (handoff 12): seed reconcilieert met de audit ----
check("hr seed geldig", isHrState(HR_SEED_STATE), true);
check(
  "hr seed kpi-ids compleet",
  HR_KPI_IDS.every((id) => HR_SEED_STATE.kpis[id] !== undefined),
  true,
);
for (const meta of HR_METRICS) {
  const id = meta.detailId as HrKpiId; // detailId's van HR_METRICS == HR_KPI_IDS
  check(`hr seed ${meta.label} value`, HR_SEED_STATE.kpis[id].value, meta.value);
  check(`hr seed ${meta.label} prev`, HR_SEED_STATE.kpis[id].prev, meta.prev);
}
check(
  "hr seed verzuimtrend = gedeelde reeks",
  HR_SEED_STATE.verzuimTrend,
  CAREON_MONTHLY.map((punt) => punt.verzuim),
);
check("hr seed benchmark", HR_SEED_STATE.benchmark, 6.2);
// BIG: naam/functie == geauditeerde rijen; de live berekende dagen t.o.v. de
// audit-peildatum (6 jul 2026) reproduceren exact de geauditeerde dagen.
const bigPeildatum = new Date("2026-07-06T00:00:00Z");
check("hr seed big aantal", HR_SEED_STATE.bigRegistraties.length, BIG_REGISTRATIES.length);
for (let i = 0; i < BIG_REGISTRATIES.length; i += 1) {
  const seed = HR_SEED_STATE.bigRegistraties[i];
  const audit = BIG_REGISTRATIES[i];
  check(`hr seed big ${i} naam`, seed.naam, audit.naam);
  check(`hr seed big ${i} functie`, seed.functie, audit.functie);
  check(`hr seed big ${i} dagen`, bigDagenTot(seed.verloopt, bigPeildatum), audit.dagen);
}
const hrGewijzigd = {
  ...HR_SEED_STATE,
  kpis: { ...HR_SEED_STATE.kpis, verzuim: { ...HR_SEED_STATE.kpis.verzuim, value: 4.2 } },
};
check("hr metrics volgen handmatige staat", hrMetrics(hrGewijzigd)[0].value, 4.2);
const hrAlert = buildHrBigAlert(HR_SEED_STATE, new Date("2026-07-26T00:00:00Z"));
check("hr BIG-alert live aantal", hrAlert?.n, 3);
check("hr BIG-alert live dagen", hrAlert ? hrAlert.detail.includes("19 dgn") : false, true);
const hrNaVerloop = buildHrBigAlert(HR_SEED_STATE, new Date("2026-09-05T00:00:00Z"));
check("hr verlopen BIG blijft gesignaleerd naast komende registratie", hrNaVerloop?.n, 3);
check(
  "hr verlopen alert behoudt handmatige herkomst",
  hrNaVerloop ? CAREON_PROVENANCE.signaleringen.widgets[hrNaVerloop.titel] : null,
  "handmatig",
);
check(
  "hr verlopen BIG krijgt expliciet verlopen label",
  hrNaVerloop ? hrNaVerloop.detail.includes("L. Vermeer (22 dgn verlopen)") : false,
  true,
);
check(
  "hr komende BIG behoudt resterende dagen",
  hrNaVerloop ? hrNaVerloop.detail.includes("S. Yılmaz (23 dgn)") : false,
  true,
);
check(
  "hr uitsluitend verlopen BIG blijft gesignaleerd",
  buildHrBigAlert(HR_SEED_STATE, new Date("2026-10-01T00:00:00Z"))?.n,
  3,
);
check(
  "hr lege registratie geeft geen BIG-alert",
  buildHrBigAlert({ ...HR_SEED_STATE, bigRegistraties: [] }, bigPeildatum),
  null,
);

// Demo-ouderdom moet dezelfde eurogrondslag gebruiken als de KPI's. De audit
// draagt alleen het totaal en >90 dagen; fijnere leeftijdsbedragen zijn onbekend.
const openstaandKpi = FINANCIEEL_METRICS.find((metric) => metric.detailId === "openstaand");
const ouder90Kpi = FINANCIEEL_METRICS.find((metric) => metric.detailId === "declaraties90");
check("financieel ouderdom bewaart geauditeerd totaal", [openstaandKpi?.value, OPENSTAAND_TOTAAL], [96400, 96400]);
check("financieel ouderdom bewaart geauditeerd >90 bedrag", ouder90Kpi?.value, 21300);
check(
  "financieel ouderdom >90 sluit aan op eurogrondslag",
  DECLARATIE_OUDERDOM.at(-1)?.pct,
  Math.round((21300 / 96400) * 1000) / 10,
);
check(
  "financieel ouderdom percentages vormen geheel",
  DECLARATIE_OUDERDOM.reduce((sum, row) => sum + row.pct, 0),
  100,
);
check(
  "hr validatie weigert percentage >100",
  isHrState({ ...HR_SEED_STATE, kpis: { ...HR_SEED_STATE.kpis, verzuim: { value: 101, prev: 6.4 } } }),
  false,
);
check(
  "hr validatie weigert werkdruk >10",
  isHrState({ ...HR_SEED_STATE, kpis: { ...HR_SEED_STATE.kpis, werkdruk: { value: 11, prev: 7.3 } } }),
  false,
);
check(
  "hr validatie weigert fractionele teller",
  isHrState({ ...HR_SEED_STATE, kpis: { ...HR_SEED_STATE.kpis, vacatures: { value: 4.5, prev: 6 } } }),
  false,
);
check("hr validatie vereist twaalf trendmaanden", isHrState({ ...HR_SEED_STATE, verzuimTrend: [5.8] }), false);
check(
  "hr validatie weigert onmogelijke kalenderdatum",
  isHrState({
    ...HR_SEED_STATE,
    bigRegistraties: [{ ...HR_SEED_STATE.bigRegistraties[0], verloopt: "2026-02-31" }],
  }),
  false,
);
check(
  "hr validatie weigert dubbele BIG-registratie",
  isHrState({
    ...HR_SEED_STATE,
    bigRegistraties: [HR_SEED_STATE.bigRegistraties[0], { ...HR_SEED_STATE.bigRegistraties[0] }],
  }),
  false,
);

// ---- Financiële rolregel (klantbesluit 28-07-2026) ----
// Leden (orgRole "member") zien niets financieels; org_admins, superadmins en
// het vaste demoaccount (etalage, demo-org) zien alles.
check("rolregel org_admin ziet financieel", magFinancieelZien({ orgRole: "org_admin", isSuperadmin: false }), true);
check("rolregel superadmin ziet financieel", magFinancieelZien({ orgRole: null, isSuperadmin: true }), true);
check("rolregel lid ziet financieel niet", magFinancieelZien({ orgRole: "member", isSuperadmin: false }), false);
check(
  "rolregel demoaccount ziet financieel",
  magFinancieelZien({ orgRole: "member", isSuperadmin: false, email: "user1@careon-demo.nl" }),
  true,
);

// Proxy-poortlijst dekt exact de registry-entries met page "financieel".
check(
  "financiele detail-ids = registry page financieel",
  [...CAREON_FINANCIELE_KPI_DETAIL_IDS].sort(),
  KPI_DETAILS.filter((entry) => entry.page === "financieel")
    .map((entry) => entry.id)
    .sort(),
);
check(
  "financiele detail-ids zijn geldige detailroutes",
  CAREON_FINANCIELE_KPI_DETAIL_IDS.every((id) => (CAREON_KPI_DETAIL_IDS as readonly string[]).includes(id)),
  true,
);

// Alertfilter: precies de financieel-gerichte regels verdwijnen; de
// kritiek-telling (sidebarbadge) verandert niet.
const alertsVoorLid = filterFinancieleAlerts(CAREON_ALERTS, false);
check("alertfilter verwijdert 1 financiele regel", CAREON_ALERTS.length - alertsVoorLid.length, 1);
check(
  "alertfilter verwijdert precies declaratieregel",
  CAREON_ALERTS.filter((alert) => !alertsVoorLid.includes(alert)).map((alert) => alert.titel),
  ["Declaraties >90 dagen open"],
);
check(
  "alertfilter raakt kritiek-telling niet",
  alertsVoorLid.filter((alert) => alert.sev === "kritiek").length,
  CRITICAL_ALERT_COUNT,
);
check("alertfilter is no-op voor admins", filterFinancieleAlerts(CAREON_ALERTS, true), CAREON_ALERTS);

// Bannertelling: financiële widgets tellen voor leden niet mee.
check(
  "financiele widgets bestaan in het provenance-register",
  Object.entries(FINANCIELE_WIDGETS).every(([pagina, widgets]) =>
    widgets.every((widget) => widget in (CAREON_PROVENANCE[pagina]?.widgets ?? {})),
  ),
  true,
);
check(
  "banner telt cockpit zonder financiele widgets",
  pageLiveCounts("cockpit", undefined, true).total,
  pageLiveCounts("cockpit").total - FINANCIELE_WIDGETS.cockpit.length,
);

// Assistent-vraagclassificatie: financiële vragen herkend, operationele niet.
for (const vraag of [
  "Hoe ontwikkelt de omzet zich?",
  "Wat zijn de openstaande declaraties?",
  "Hoeveel kosten maken we per maand?",
  "Wat is er nog niet gefactureerd?",
  "Hoeveel onderhanden werk staat er?",
]) {
  check(`assistent weigert financiele vraag: ${vraag}`, isFinancieleAssistentVraag(vraag), true);
}
for (const vraag of [
  "Hoeveel actieve cliënten per verzekeraar?",
  "Hoe hoog is de no-show deze maand?",
  "Wat is de gemiddelde wachttijd?",
  "Welke behandelaar heeft de hoogste caseload?",
  "Wordt deze cliënt door een neuroloog gezien?",
  "Is de wachtwoord-link nog geldig?",
]) {
  check(`assistent laat operationele vraag door: ${vraag}`, isFinancieleAssistentVraag(vraag), false);
}
check("assistent weigert bedrag-vraag", isFinancieleAssistentVraag("Welk bedrag staat nog open bij DSW?"), true);
check(
  "assistent-chip financieel bestaat (en wordt voor leden verborgen)",
  ASSISTANT_QUICK_PROMPTS.some((prompt) => prompt.id === "financieel-omzet"),
  true,
);

// Contextscrub: een feitenblok mét financiële sleutels wordt verwijderd, een
// schoon blok blijft onaangetast (ledengrounding overleeft de scrub).
const scrubVuil = verwijderFinancieleContext(
  'MEDEWERKERS & MIDDELEN (handmatige registratie, JSON)\n{"medewerkers":[]}\n\nOVERIGE CONTEXT (KPI\'s/feitenblad, JSON)\n{"domein":{"omzetPerVerzekeraar":[{"label":"VGZ"}],"onderhandenTotaal":182000}}',
);
check("contextscrub verwijdert financieel feitenblok", scrubVuil.verwijderd, true);
check("contextscrub laat middelenblok staan", scrubVuil.context.includes("MEDEWERKERS & MIDDELEN"), true);
check("contextscrub laat geen financiele sleutels achter", bevatFinancieleFeiten(scrubVuil.context), false);
const scrubSchoon = verwijderFinancieleContext(
  'OVERIGE CONTEXT (KPI\'s/feitenblad, JSON)\n{"domein":{"kernKpis":[{"id":"actief","waarde":1248}]}}',
);
check("contextscrub laat schone grounding intact", scrubSchoon.verwijderd, false);
check(
  "historyfilter verwijdert beurten met eurobedragen",
  filterFinancieleHistory([
    { content: "De omzet bedroeg € 493.000 in juni." },
    { content: "De no-show daalde naar 5,8%." },
  ]).map((turn) => turn.content),
  ["De no-show daalde naar 5,8%."],
);
// Modelantwoorden schrijven bedragen in lopende tekst — ook zonder €-teken.
check(
  "feitendetectie herkent lopende financiële tekst",
  [
    bevatFinancieleFeiten("De totale omzet in juni bedroeg 493.212 euro."),
    bevatFinancieleFeiten("Er wacht nog 212.400 euro aan facturatie."),
    bevatFinancieleFeiten("Er staat 96 duizend euro open aan declaraties."),
    bevatFinancieleFeiten("De cliënt is verwezen naar een neuroloog."),
    bevatFinancieleFeiten("De caseload steeg naar 32 cliënten."),
  ],
  [true, true, true, false, false],
);

// Opgeslagen gespreksbeurten (thread-replay): financiële tekst wordt
// vervangen, het canvas-artefact verdwijnt, schone beurten blijven onaangeroerd.
const financieleBeurt = {
  message: {
    id: "msg-1",
    role: "assistant",
    content: [{ type: "text", text: "De omzet bedroeg € 493.000; Infomedics € 68.000." }],
    metadata: { custom: { artifact: { intent: "financieel-omzet" }, cite: "demo" } },
  },
  parentId: null,
};
const geredigeerdeBeurt = redigeerFinancieelThreadPayload(financieleBeurt) as typeof financieleBeurt;
check(
  "threadredactie vervangt financiële tekst en artefact",
  [
    geredigeerdeBeurt.message.content[0].text,
    "artifact" in (geredigeerdeBeurt.message.metadata.custom as object),
    JSON.stringify(financieleBeurt.message.content[0].text).includes("493.000"),
  ],
  [FINANCIEEL_VERVANGTEKST, false, true],
);
const schoneBeurt = {
  message: { id: "msg-2", role: "assistant", content: [{ type: "text", text: "De no-show daalde naar 5,8%." }] },
  parentId: null,
};
check(
  "threadredactie laat schone beurt onaangeroerd",
  redigeerFinancieelThreadPayload(schoneBeurt) === schoneBeurt,
  true,
);

// Deterministisch antwoord (demo-/terugvalpad): na redactie bevat het
// directie-overzicht geen omzettegels, -claims of -zinnen meer.
const rolregelCtx = {
  kpis: COCKPIT_KPIS,
  filters: { periode: "12m" as const, locatie: "Alle locaties", team: "Alle teams" },
  source: { mode: "demo" as const, label: "Demo-data", detail: "Voorbeeldset Careon" },
  hr: HR_SEED_STATE,
};
const financeAntwoord = resolveAssistantResponse("Openstaande declaraties", rolregelCtx, "financieel-omzet");
check(
  "assistent ouderdompercentage volgt KPI-bedragen",
  financeAntwoord.deep.includes("22,1% ouder dan 90 dagen"),
  true,
);
const verlopenHrAntwoord = resolveAssistantResponse(
  "BIG-registraties",
  {
    ...rolregelCtx,
    hr: { ...HR_SEED_STATE, bigRegistraties: [{ ...HR_SEED_STATE.bigRegistraties[0], verloopt: "2000-01-01" }] },
  },
  "verzuim-hr",
);
check(
  "assistent laat verlopen BIG niet verdwijnen",
  verlopenHrAntwoord.artifact.visualizations.find((visual) => visual.id === "big")?.table?.rows.length,
  1,
);
check("assistent benoemt verlopen BIG als verlopen", verlopenHrAntwoord.deep.includes("is verlopen"), true);
const overzichtVoorLid = redigeerFinancieleAssistentResponse(
  resolveAssistantResponse("Geef mij het overzicht van vandaag", rolregelCtx, "directie-overzicht"),
);
check(
  "assistentredactie: geen financiele tegels in canvas",
  overzichtVoorLid.artifact.visualizations.every((visual) =>
    (visual.tiles ?? []).every((tile) => !/omzet|€/i.test(tile.label)),
  ),
  true,
);
check(
  "assistentredactie: geen financiele claims",
  overzichtVoorLid.artifact.claims.every((claim) => !/omzet|declarat|€/i.test(`${claim.title} ${claim.body}`)),
  true,
);
check("assistentredactie: geen omzet in kernantwoord", /omzet|€/i.test(overzichtVoorLid.deep), false);
check("assistentredactie: kernantwoord blijft bruikbaar", overzichtVoorLid.deep.length > 40, true);
check(
  "assistentredactie: geen financiële restinhoud in visualisaties",
  overzichtVoorLid.artifact.visualizations.every(
    (visual) => !/omzet|declarat|toeslag|infomedics|€/i.test(JSON.stringify(visual)),
  ),
  true,
);

// ── Facturatie (handoff 15) ─────────────────────────────────────────────────

// Moduleregister: één entry per module, rolgebonden tegels expliciet.
check("register: unieke module-ids", new Set(CAREON_MODULES.map((mod) => mod.id)).size, CAREON_MODULES.length);
check(
  "register: elke live module heeft een href",
  CAREON_MODULES.every((mod) => mod.status !== "live" || typeof mod.href === "string"),
  true,
);
check(
  "register: coming-soon draagt geen href",
  CAREON_MODULES.every((mod) => mod.status !== "coming-soon" || mod.href === undefined),
  true,
);
const facturatieTegel = CAREON_MODULES.find((mod) => mod.id === "careon-facturatie");
const yaazTegel = CAREON_MODULES.find((mod) => mod.id === "yaaz");
const scribeTegel = CAREON_MODULES.find((mod) => mod.id === "careon-scribe");
check("register: facturatietegel is live op /facturatie", facturatieTegel?.href, "/facturatie");
check("register: facturatietegel is beheerder-only", facturatieTegel?.zichtbaarVoor, "org_admin");
check("register: Careon AI-tegel is live", scribeTegel?.status, "live");
check("register: Careon AI-tegel opent /scribe", scribeTegel?.href, "/scribe");
check("register: Careon AI-tegel laadt een nieuw document voor microfoonrechten", scribeTegel?.hardeNavigatie, true);

// Tegel-beeldmerken (klantverzoek 14-08-2026): de Directie-tegel draagt het
// statische Careon-merkteken, Facturatie bewust geen beeldmerk; een
// bestandslogo moet uit /public komen met vaste afmetingen (geen layout-sprong).
check(
  "register: directietegel draagt het Careon-merkteken",
  CAREON_MODULES.find((mod) => mod.id === "careon-pulse-directie")?.logo?.type,
  "careon-mark",
);
check("register: facturatietegel heeft geen beeldmerk (klant: 'gewoon goed zo')", facturatieTegel?.logo, undefined);
check("register: YAAZ-tegel draagt een professionele wordmark", yaazTegel?.logo, {
  type: "wordmark",
  label: "YAAZ",
});
check("register: YAAZ-omschrijving is volledig Nederlands", yaazTegel?.description.includes("Spaces"), false);
check(
  "register: bestandslogo's komen uit /public met positieve afmetingen",
  CAREON_MODULES.every(
    (mod) =>
      mod.logo?.type !== "image" || (mod.logo.src.startsWith("/") && mod.logo.breedte > 0 && mod.logo.hoogte > 0),
  ),
  true,
);

// Rolpredicaat: beheerdersmodule, en een superadmin zonder org kan niets.
const orgSessie = { orgId: "org-1", email: "iemand@example.nl" };
check("facturatierol: org_admin", magFacturatieZien({ ...orgSessie, orgRole: "org_admin", isSuperadmin: false }), true);
check("facturatierol: member", magFacturatieZien({ ...orgSessie, orgRole: "member", isSuperadmin: false }), false);
check(
  "facturatierol: superadmin met org",
  magFacturatieZien({ ...orgSessie, orgRole: null, isSuperadmin: true }),
  true,
);
check(
  "facturatierol: superadmin zonder org",
  magFacturatieZien({ orgId: null, email: "admin@example.nl", orgRole: null, isSuperadmin: true }),
  false,
);
check(
  "facturatierol: demoaccount",
  magFacturatieZien({ orgId: "org-demo", email: "user1@careon-demo.nl", orgRole: "member", isSuperadmin: false }),
  true,
);
// Vandaag gelijk aan de financiële rolregel voor sessies mét organisatie —
// drift wordt hiermee een bewuste wijziging in plaats van een stil verschil.
for (const rol of ["org_admin", "member", null] as const) {
  for (const superadmin of [true, false]) {
    const invoer = { orgRole: rol, isSuperadmin: superadmin, email: "iemand@example.nl" };
    check(
      `facturatierol: pariteit met financiële rolregel (${rol ?? "geen"}, superadmin=${superadmin})`,
      magFacturatieZien({ ...invoer, orgId: "org-1" }),
      magFinancieelZien(invoer),
    );
  }
}

// Totalen: afronding per regel in hele centen, groepering per tarief.
const regel = (patch: Partial<FactuurRegel>): FactuurRegel => ({
  id: patch.id ?? "r",
  omschrijving: "Test",
  aantal: 1,
  eenheid: "stuk",
  stukprijsCent: 0,
  btwTarief: "21",
  btwCategorie: "S",
  ...patch,
});
const gemengd = berekenTotalen([
  regel({ id: "a", aantal: 2, stukprijsCent: 1_000 }),
  regel({ id: "b", aantal: 1, stukprijsCent: 250, btwTarief: "9" }),
]);
check("totalen: gemengde tarieven — subtotaal", gemengd.subtotaalCent, 2_250);
check("totalen: gemengde tarieven — btw (per regel afgerond)", gemengd.btwCent, 420 + 23);
check("totalen: gemengde tarieven — totaal", gemengd.totaalCent, 2_693);
check(
  "totalen: groepering per tarief",
  gemengd.btwTotalen.map((totaal) => `${totaal.tarief}:${totaal.grondslagCent}:${totaal.btwCent}`),
  ["9:250:23", "21:2000:420"],
);
const korting = berekenTotalen([regel({ aantal: 3, stukprijsCent: 333, kortingPct: 10 })]);
check("totalen: korting rondt op hele centen", korting.subtotaalCent, 899);
check("totalen: btw over de kortingsgrondslag", korting.btwCent, 189);
const creditTotalen = berekenTotalen([regel({ aantal: -2, stukprijsCent: 1_000 })]);
check("totalen: creditregels zijn negatief", creditTotalen.totaalCent, -2_420);
const vrijgesteldTotalen = berekenTotalen([
  regel({ btwTarief: "vrijgesteld", btwCategorie: "E", stukprijsCent: 5_000 }),
]);
check("totalen: vrijgesteld draagt geen btw", vrijgesteldTotalen.btwCent, 0);
check(
  "totalen: volledig vrijgesteld herkend",
  isVolledigVrijgesteld([regel({ btwTarief: "vrijgesteld", btwCategorie: "E" })]),
  true,
);
// Art. 35a sub h: de btw-regel draagt de grondslag van zijn groep — gedeeld
// label voor pdf én scherm, zodat de vergoeding per tarief op de factuur staat.
check("totalen: btw-regel benoemt de grondslag per tarief (sub h)", gemengd.btwTotalen.map(btwRegelLabel), [
  `Btw 9% over ${formatEuro(250)}`,
  `Btw 21% over ${formatEuro(2_000)}`,
]);
check(
  "totalen: verlegd label draagt de grondslag",
  btwRegelLabel({ tarief: "0", categorie: "AE", grondslagCent: 1_000, btwCent: 0 }),
  `Btw verlegd over ${formatEuro(1_000)}`,
);
// Symmetrische afronding (halven wég van nul): een credit spiegelt het
// origineel exact, ook als een btw-bedrag precies op een halve cent valt
// (250 × 21% = 52,5 → 53 én -53, nooit -52).
check(
  "totalen: creditafronding spiegelt het origineel op de halve cent",
  [
    berekenTotalen([regel({ stukprijsCent: 250 })]).btwCent,
    berekenTotalen([regel({ aantal: -1, stukprijsCent: 250 })]).btwCent,
  ],
  [53, -53],
);
// Verlegd (0:AE) is een vijfde groep naast vrijgesteld:E, 0:Z, 9:S en 21:S —
// de factuurguard moet zo'n geldige gemengde factuur accepteren.
check(
  "guards: factuur met vijf btw-groepen (incl. verlegd) passeert isFactuur",
  isFactuur({
    ...DEMO_FACTUREN[0],
    regels: [
      regel({ id: "g1", btwTarief: "vrijgesteld", btwCategorie: "E" }),
      regel({ id: "g2", btwTarief: "0", btwCategorie: "Z" }),
      regel({ id: "g3", btwTarief: "0", btwCategorie: "AE" }),
      regel({ id: "g4", btwTarief: "9", btwCategorie: "S" }),
      regel({ id: "g5", btwTarief: "21", btwCategorie: "S" }),
    ],
    btwTotalen: berekenTotalen([
      regel({ id: "g1", btwTarief: "vrijgesteld", btwCategorie: "E" }),
      regel({ id: "g2", btwTarief: "0", btwCategorie: "Z" }),
      regel({ id: "g3", btwTarief: "0", btwCategorie: "AE" }),
      regel({ id: "g4", btwTarief: "9", btwCategorie: "S" }),
      regel({ id: "g5", btwTarief: "21", btwCategorie: "S" }),
    ]).btwTotalen,
  }),
  true,
);

// Nummering: F2026-0001-formaat, jaarwissel, en bewust géén EPD-patroon.
check("nummer: default formaat", formatFactuurnummer("{reeks}{jaar}-{nummer:4}", "F", 2026, 1), "F2026-0001");
check("nummer: creditreeks", formatFactuurnummer("{reeks}{jaar}-{nummer:4}", "C", 2026, 12), "C2026-0012");
check("nummer: jaarwissel", formatFactuurnummer("{reeks}{jaar}-{nummer:4}", "F", 2027, 1), "F2027-0001");
check(
  "nummer: wijkt af van het 8-cijferige EPD-patroon (26000160)",
  /^\d{8}$/.test(formatFactuurnummer("{reeks}{jaar}-{nummer:4}", "F", 2026, 160)),
  false,
);
check("vervaldatum: 30 dagen", berekenVervaldatum("2026-06-05", 30), "2026-07-05");
check("vervaldatum: over de jaargrens", berekenVervaldatum("2026-12-15", 30), "2027-01-14");
check(
  "te laat: open factuur na vervaldatum",
  isTeLaat({ status: "verzonden", vervaldatum: "2026-07-05" }, "2026-07-06"),
  true,
);
check("te laat: betaald telt niet", isTeLaat({ status: "betaald", vervaldatum: "2026-07-05" }, "2026-08-01"), false);
check("art. 34g: binnen de termijn", uitreikingstermijnOverschreden("2026-05-31", "2026-06-14"), false);
check("art. 34g: termijn verstreken", uitreikingstermijnOverschreden("2026-05-31", "2026-06-16"), true);

// Art. 35a-validator: per ontbrekend veld precies die sleutel terug.
const demoAfzender = afzenderUitTemplate(vindTemplate(DEMO_FACTURATIE_INSTELLINGEN, "tgc-groep"));
const compleetConcept = {
  factuurdatum: "2026-06-05",
  prestatieVan: "2026-05-01",
  prestatieTot: "2026-05-31",
  afnemer: DEMO_FACTUREN[0].afnemer,
  regels: DEMO_FACTUREN[0].regels,
  vrijstellingTekst: undefined,
};
check(
  "validator: complete factuur is uitreikbaar",
  // Belaste (21%) regels: de afzender draagt dan een btw-id (de demo-afzender
  // is bewust volledig vrijgesteld en heeft er geen).
  valideerFactuurVoorUitreiking(compleetConcept, { ...demoAfzender, btwId: "NL123456789B01" }).ok,
  true,
);
check(
  "validator: ontbrekende factuurdatum",
  valideerFactuurVoorUitreiking({ ...compleetConcept, factuurdatum: null }, demoAfzender).ontbrekend.includes(
    "factuurdatum",
  ),
  true,
);
check(
  "validator: ontbrekende prestatieperiode",
  valideerFactuurVoorUitreiking(
    { ...compleetConcept, prestatieVan: null, prestatieTot: null },
    demoAfzender,
  ).ontbrekend.includes("prestatieperiode"),
  true,
);
check(
  "validator: vrijgestelde regel zonder vrijstellingstekst",
  valideerFactuurVoorUitreiking(
    { ...compleetConcept, regels: DEMO_FACTUREN[1].regels, vrijstellingTekst: undefined },
    demoAfzender,
  ).ontbrekend.includes("vrijstellingTekst"),
  true,
);
check(
  "validator: belaste regels eisen een btw-id van de afzender",
  valideerFactuurVoorUitreiking(compleetConcept, { ...demoAfzender, btwId: undefined }).ontbrekend.includes(
    "afzender.btwId",
  ),
  true,
);
check(
  "validator: btw verlegd eist het btw-id van de afnemer",
  valideerFactuurVoorUitreiking(
    {
      ...compleetConcept,
      regels: [regel({ btwCategorie: "AE", btwTarief: "21" })],
      afnemer: { naam: "Test", adresRegel1: "Straat 1", postcode: "1234 AB", plaats: "Stad", land: "NL" },
    },
    { ...demoAfzender, btwId: "NL123456789B01" },
  ).ontbrekend.includes("afnemer.btwId"),
  true,
);
check(
  "validator: lege afzender blokkeert uitreiken",
  valideerFactuurVoorUitreiking(
    compleetConcept,
    afzenderUitTemplate(vindTemplate(EMPTY_FACTURATIE_INSTELLINGEN, "careongroup")),
  ).ok,
  false,
);
// Alle overige OntbrekendVeld-takken, elk met precies zijn eigen sleutel —
// zonder deze checks kon een verwijderde validatortak de gate groen laten.
const afnemerBasis = { naam: "Test B.V.", adresRegel1: "Straat 1", postcode: "1234 AB", plaats: "Stad", land: "NL" };
check(
  "validator: lege bedrijfsnaam afzender",
  valideerFactuurVoorUitreiking(compleetConcept, { ...demoAfzender, statutaireNaam: "" }).ontbrekend.includes(
    "afzender.naam",
  ),
  true,
);
check(
  "validator: onvolledig afzenderadres",
  valideerFactuurVoorUitreiking(compleetConcept, { ...demoAfzender, adresRegel1: "" }).ontbrekend.includes(
    "afzender.adres",
  ),
  true,
);
check(
  "validator: ontbrekend KvK-nummer",
  valideerFactuurVoorUitreiking(compleetConcept, { ...demoAfzender, kvkNummer: "" }).ontbrekend.includes(
    "afzender.kvkNummer",
  ),
  true,
);
check(
  "validator: ontbrekende IBAN",
  valideerFactuurVoorUitreiking(compleetConcept, { ...demoAfzender, iban: "" }).ontbrekend.includes("afzender.iban"),
  true,
);
check(
  "validator: lege afnemernaam",
  valideerFactuurVoorUitreiking(
    { ...compleetConcept, afnemer: { ...afnemerBasis, naam: "" } },
    demoAfzender,
  ).ontbrekend.includes("afnemer.naam"),
  true,
);
check(
  "validator: onvolledig afnemeradres",
  valideerFactuurVoorUitreiking(
    { ...compleetConcept, afnemer: { ...afnemerBasis, postcode: "" } },
    demoAfzender,
  ).ontbrekend.includes("afnemer.adres"),
  true,
);
check(
  "validator: factuur zonder regels",
  valideerFactuurVoorUitreiking({ ...compleetConcept, regels: [] }, demoAfzender).ontbrekend.includes("regels"),
  true,
);
check(
  "validator: regel zonder omschrijving (sub f)",
  valideerFactuurVoorUitreiking(
    { ...compleetConcept, regels: [regel({ omschrijving: "  " })] },
    demoAfzender,
  ).ontbrekend.includes("regels"),
  true,
);

// Seeds: demo valideert tegen de guards en rekent kloppend; EMPTY draagt
// geen klantgegevens (een tweede organisatie erft nooit de eerste).
check("seeds: demo-facturen valideren tegen isFactuur", DEMO_FACTUREN.every(isFactuur), true);
check("seeds: demo-contacten valideren", DEMO_CONTACTEN.every(isFacturatieContact), true);
check("seeds: demo-instellingen valideren", isFacturatieInstellingen(DEMO_FACTURATIE_INSTELLINGEN), true);
check("seeds: lege instellingen valideren", isFacturatieInstellingen(EMPTY_FACTURATIE_INSTELLINGEN), true);
const legeFacturatieGereedheid = facturatieGereedheid(EMPTY_FACTURATIE_INSTELLINGEN, false);
check("facturatie-gereedheid: leeg startsjabloon is niet PDF-klaar", legeFacturatieGereedheid.pdfKlaar, false);
check(
  "facturatie-gereedheid: leeg startsjabloon noemt de concrete ontbrekende basisgegevens",
  legeFacturatieGereedheid.ontbrekend,
  ["statutaire naam", "adres", "postcode", "plaats", "KvK-nummer", "IBAN", "rekeninghouder"],
);
const demoFacturatieGereedheid = facturatieGereedheid(DEMO_FACTURATIE_INSTELLINGEN, true);
check("facturatie-gereedheid: compleet standaardsjabloon is PDF-klaar", demoFacturatieGereedheid.pdfKlaar, true);
check(
  "facturatie-gereedheid: mailstatus volgt uitsluitend serverconfiguratie",
  demoFacturatieGereedheid.mailKlaar,
  true,
);
const belastZonderBtwId: FacturatieInstellingenType = {
  ...DEMO_FACTURATIE_INSTELLINGEN,
  templates: DEMO_FACTURATIE_INSTELLINGEN.templates.map((template, index) =>
    index === 0
      ? { ...template, afzender: { ...template.afzender, btwId: "" }, btw: { ...template.btw, standaardTarief: "21" } }
      : template,
  ),
};
check(
  "facturatie-gereedheid: belast standaardsjabloon vereist btw-identificatienummer",
  facturatieGereedheid(belastZonderBtwId, false).ontbrekend.includes("btw-identificatienummer"),
  true,
);
for (const factuur of DEMO_FACTUREN) {
  const herberekend = berekenTotalen(factuur.regels);
  check(`seeds: totalen van ${factuur.id} kloppen met berekenTotalen`, herberekend, {
    subtotaalCent: factuur.subtotaalCent,
    btwCent: factuur.btwCent,
    totaalCent: factuur.totaalCent,
    btwTotalen: factuur.btwTotalen,
  });
}
check(
  "seeds: EMPTY draagt één neutraal startsjabloon zonder adres",
  [
    EMPTY_FACTURATIE_INSTELLINGEN.templates.length,
    EMPTY_FACTURATIE_INSTELLINGEN.standaardTemplateId,
    EMPTY_FACTURATIE_INSTELLINGEN.templates[0].afzender.adresRegel1,
    EMPTY_FACTURATIE_INSTELLINGEN.templates[0].afzender.postcode,
    EMPTY_FACTURATIE_INSTELLINGEN.templates[0].afzender.plaats,
  ],
  [1, "careongroup", "", "", ""],
);
// Auditbevinding 13-08: de identiteit moet ÉCHT leeg zijn — de validator
// toetst alleen op aanwezigheid, dus elk vooringevuld veld (ontwerp-
// plaatshouders "Careon Group B.V.", KvK 12345678, IBAN NL00 …) zou een
// verse organisatie onder andermans identiteit laten uitreiken.
check(
  "seeds: EMPTY draagt geen enkele vooringevulde identiteit",
  [
    EMPTY_FACTURATIE_INSTELLINGEN.templates[0].afzender.statutaireNaam,
    EMPTY_FACTURATIE_INSTELLINGEN.templates[0].afzender.kvkNummer,
    EMPTY_FACTURATIE_INSTELLINGEN.templates[0].afzender.btwId ?? "",
    EMPTY_FACTURATIE_INSTELLINGEN.templates[0].bank.iban,
    EMPTY_FACTURATIE_INSTELLINGEN.templates[0].bank.tenaamstelling,
    EMPTY_FACTURATIE_INSTELLINGEN.templates[0].presentatie.toonLogo,
  ],
  ["", "", "", "", "", false],
);
// V12/§3.1: een verse organisatie start vrijgesteld (GGZ) — het 21%-tarief
// van het geïmporteerde ontwerp geldt alleen in de demo.
check(
  "seeds: EMPTY start vrijgesteld met de GGZ-vrijstellingstekst",
  [
    EMPTY_FACTURATIE_INSTELLINGEN.templates[0].btw.standaardTarief,
    EMPTY_FACTURATIE_INSTELLINGEN.templates[0].btw.vrijstellingTekst,
  ],
  ["vrijgesteld", DEFAULT_VRIJSTELLING_TEKST],
);

// Multi-template (klantverzoek 09-08): het ingebouwde ontwerp-sjabloon plus
// migratie-bij-lezen van de oude één-profiel-vorm.
check(
  "templates: careongroup volgt het geïmporteerde ontwerp",
  [
    CAREONGROUP_TEMPLATE.id,
    CAREONGROUP_TEMPLATE.naam,
    CAREONGROUP_TEMPLATE.tagline,
    CAREONGROUP_TEMPLATE.afzender.statutaireNaam,
    CAREONGROUP_TEMPLATE.afzender.btwId,
    CAREONGROUP_TEMPLATE.btw.standaardTarief,
    CAREONGROUP_TEMPLATE.presentatie.logoBron,
    CAREONGROUP_TEMPLATE.presentatie.toonLogo,
  ],
  [
    "careongroup",
    "Careon Group",
    "Technology · Growth · Care",
    "Careon Group B.V.",
    "NL001234567B01",
    "21",
    "careongroup",
    true,
  ],
);
check(
  "templates: demo toont meerdere sjablonen met careongroup als standaard",
  [
    DEMO_FACTURATIE_INSTELLINGEN.templates.map((template) => template.id),
    DEMO_FACTURATIE_INSTELLINGEN.standaardTemplateId,
  ],
  [["careongroup", "tgc-groep"], "careongroup"],
);
check(
  "templates: vindTemplate valt terug op het standaardsjabloon",
  vindTemplate(DEMO_FACTURATIE_INSTELLINGEN, "bestaat-niet").id,
  "careongroup",
);
check(
  "templates: afzender-snapshot draagt sjabloonherkomst",
  afzenderUitTemplate(CAREONGROUP_TEMPLATE).templateId,
  "careongroup",
);
const oudeVorm = {
  afzender: DEMO_FACTURATIE_INSTELLINGEN.templates[1].afzender,
  bank: DEMO_FACTURATIE_INSTELLINGEN.templates[1].bank,
  nummering: DEMO_FACTURATIE_INSTELLINGEN.templates[1].nummering,
  betaling: DEMO_FACTURATIE_INSTELLINGEN.templates[1].betaling,
  btw: DEMO_FACTURATIE_INSTELLINGEN.templates[1].btw,
  presentatie: DEMO_FACTURATIE_INSTELLINGEN.templates[1].presentatie,
  updatedAt: "2026-07-01T09:00:00.000Z",
};
check(
  'templates: oude één-profiel-snapshot migreert naar sjabloon "standaard"',
  (migreerInstellingen(oudeVorm) as FacturatieInstellingenType | null)?.templates.map((template) => template.id),
  ["standaard"],
);
check(
  "templates: nieuwe vorm passeert migratie ongewijzigd",
  migreerInstellingen(DEMO_FACTURATIE_INSTELLINGEN)?.standaardTemplateId,
  "careongroup",
);

// Fase B — mailinhoud (handoff 15 §7): uitsluitend nummer, bedrag en
// vervaldatum; nooit regelteksten of andere cliënt-/behandelinhoud. De
// opbouw is een pure functie, dus deze regels zijn hier hard afdwingbaar.
const factuurMail = bouwFactuurMail(DEMO_FACTUREN[0]);
check("mail: onderwerp draagt nummer en afzender", factuurMail.onderwerp, "Factuur F2026-0001 van TGC Groep B.V.");
check(
  "mail: tekst draagt nummer, bedrag en vervaldatum",
  factuurMail.tekst.includes("F2026-0001") &&
    factuurMail.tekst.includes(formatEuro(367_840)) &&
    factuurMail.tekst.includes("5 juli 2026"),
  true,
);
check(
  "mail: tekst draagt GEEN regelteksten (inhoudsregel §7)",
  /Detachering|GZ-psycholoog|Consult|SGGZ/i.test(factuurMail.tekst) ||
    /Detachering|GZ-psycholoog/i.test(factuurMail.onderwerp),
  false,
);
check(
  "mail: creditfactuur krijgt een creditonderwerp zonder betaalverzoek",
  (() => {
    const credit = bouwFactuurMail({ ...DEMO_FACTUREN[0], soort: "creditfactuur", nummer: "C2026-0001" });
    return credit.onderwerp.startsWith("Creditfactuur C2026-0001") && !credit.tekst.includes("uiterste betaaldatum");
  })(),
  true,
);
check(
  "mail: e-mailvormcontrole",
  [
    isEmailAdres("administratie@zorggroepdelinde.nl"),
    isEmailAdres("kaal"),
    isEmailAdres("spatie in@adres.nl"),
    isEmailAdres(`${"x".repeat(250)}@lang.nl`),
    isEmailAdres(""),
  ],
  [true, false, false, false, false],
);
const maillogBasis = {
  id: "log-1",
  factuurId: "demo-factuur-1",
  ontvanger: "test@voorbeeld.nl",
  onderwerp: "Factuur F2026-0001",
  status: "verzonden",
  poging: 1,
  createdAt: "2026-08-13T10:00:00.000Z",
};
check(
  "mail: maillog-guard accepteert geldige regel en weigert corrupte",
  [
    isFactuurMaillogRegel(maillogBasis),
    isFactuurMaillogRegel({ ...maillogBasis, status: "wachtend" }),
    isFactuurMaillogRegel({ ...maillogBasis, ontvanger: "geen-adres" }),
    isFactuurMaillogRegel({ ...maillogBasis, poging: 0 }),
  ],
  [true, false, false, false],
);

// ── Scribe (handoff 20) ─────────────────────────────────────────────────────
// Careon Scribe is een client-goedgekeurde toevoeging buiten de tien
// geauditeerde secties. Deze asserties leggen vast wat de module veilig maakt:
// geen diagnose, geen polariteit op risico-uitspraken, een additieve merge die
// een allergie nooit stil laat verdwijnen, en beoordelingssecties die geen
// enkele generator invult.

interface ScribeRolGeval {
  orgId: string | null;
  orgRole: "org_admin" | "member" | null;
  isSuperadmin: boolean;
  email?: string | null;
}
const scribeLid: ScribeRolGeval = { orgId: "org-1", orgRole: "member", isSuperadmin: false, email: "arts@tgc.nl" };
const scribeBeheerder: ScribeRolGeval = { orgId: "org-1", orgRole: "org_admin", isSuperadmin: false, email: "a@b.nl" };
const scribeSuperadminZonderOrg: ScribeRolGeval = { orgId: null, orgRole: null, isSuperadmin: true, email: "s@b.nl" };
const scribeDemoAccount: ScribeRolGeval = {
  orgId: "org-1",
  orgRole: "member",
  isSuperadmin: false,
  email: CAREON_HOSTED_DEMO_EMAIL,
};

check(
  "scribe rol: lid zonder machtiging mag de module niet gebruiken",
  magScribeGebruiken({ ...scribeLid, gemachtigd: false }),
  false,
);
check(
  "scribe rol: gemachtigd lid mag de module gebruiken",
  magScribeGebruiken({ ...scribeLid, gemachtigd: true }),
  true,
);
check("scribe rol: gemachtigd lid mag NIET beheren", magScribeBeheren(scribeLid), false);
check(
  "scribe rol: org_admin mag beheren en gebruiken",
  [magScribeBeheren(scribeBeheerder), magScribeGebruiken({ ...scribeBeheerder, gemachtigd: false })],
  [true, true],
);
check(
  "scribe rol: superadmin zonder organisatie valt buiten de module",
  [magScribeBeheren(scribeSuperadminZonderOrg), magScribeGebruiken({ ...scribeSuperadminZonderOrg, gemachtigd: true })],
  [false, false],
);
check("scribe rol: demo-account mag beheren (B12)", magScribeBeheren(scribeDemoAccount), true);

// Dossierreferentie (S3): nooit een BSN of geboortedatum in de metadata.
check(
  "scribe referentie: allowlist, BSN- en datumweigering",
  [
    isPatientReferentie("D-2026-0417"),
    isPatientReferentie("EPD 12_3.4/5"),
    isPatientReferentie("123456789"),
    isPatientReferentie("D-12345678"),
    isPatientReferentie("01-02-1990"),
    isPatientReferentie('D"1'),
    isPatientReferentie("D;1"),
    isPatientReferentie("AB"),
    isPatientReferentie("A".repeat(41)),
    isPatientReferentie("Jan Jansen"),
  ],
  [true, true, false, false, false, false, false, false, false, true],
);
check(
  "scribe bestandsnaam: normaliseert, vouwt samen en valt terug op de sessie-id",
  [
    veiligeBestandsnaam("consult D-2026/0417"),
    veiligeBestandsnaam("a??b   c"),
    veiligeBestandsnaam("§§§", "demo-consult-1"),
    veiligeBestandsnaam("x".repeat(60)).length,
  ],
  ["consult-D-2026-0417", "a-b-c", "demo-consult-1", 40],
);

// Formaten (§4.2): acht disciplines, ★-secties expliciet, nergens "diagnose".
check("scribe formaten: acht consulttypen", Object.keys(VERSLAG_FORMATEN).length, 8);
check(
  "scribe formaten: geen enkele sectietitel noemt een diagnose (S10)",
  CONSULT_TYPES.some((type) =>
    VERSLAG_FORMATEN[type].secties.some((sectie) => /diagnose/i.test(`${sectie.titel} ${sectie.id}`)),
  ),
  false,
);
check(
  "scribe formaten: ★-secties per type",
  CONSULT_TYPES.map((type) => beoordelingsSectieIds(type)),
  [
    ["analyse"],
    ["beoordeling"],
    ["evaluatie"],
    ["risicotaxatie", "overwegingen"],
    // N4 — verpleegkundig en ontslag hadden geen enkele ★-sectie: "Alles
    // goedkeuren" maakte een volledig machinaal verslag in twee klikken vast.
    ["reactie-evaluatie"],
    ["werkhypothese"],
    ["beoordeling"],
    ["conclusie-beoordeling"],
  ],
);
check(
  "scribe formaten: elk formaat heeft minstens één ★-sectie (N4)",
  CONSULT_TYPES.every((type) => beoordelingsSectieIds(type).length >= 1),
  true,
);
check(
  "scribe formaten: aantal ★-secties per type",
  CONSULT_TYPES.map((type) => beoordelingsSectieIds(type).length),
  [1, 1, 1, 2, 1, 1, 1, 1],
);
check(
  "scribe formaten: alleen de risicotaxatie draagt soort `risico` (C48)",
  CONSULT_TYPES.flatMap((type) =>
    VERSLAG_FORMATEN[type].secties.filter((sectie) => isRisicoSectie(type, sectie.id)).map((sectie) => sectie.id),
  ),
  ["risicotaxatie"],
);
check(
  "scribe formaten: de risicotaxatie krijgt een structuurplaceholder (N3)",
  [
    structuurPlaceholderVoor("psychiatrie", "risicotaxatie"),
    structuurPlaceholderVoor("psychiatrie", "overwegingen"),
    RISICO_STRUCTUUR_PLACEHOLDER.split("\n").length,
  ],
  [RISICO_STRUCTUUR_PLACEHOLDER, null, 3],
);
check(
  "scribe formaten: vrije en ★-secties zijn complementair",
  CONSULT_TYPES.every(
    (type) =>
      vrijeSectieIds(type).length + beoordelingsSectieIds(type).length === VERSLAG_FORMATEN[type].secties.length,
  ),
  true,
);
check(
  "scribe formaten: unieke sectie-id's en een doelgroep per formaat",
  CONSULT_TYPES.every((type) => {
    const ids = VERSLAG_FORMATEN[type].secties.map((sectie) => sectie.id);
    return new Set(ids).size === ids.length && VERSLAG_FORMATEN[type].doelgroep.length > 0;
  }),
  true,
);
check(
  "scribe formaten: elke ★-sectie draagt de beoordelingshint",
  CONSULT_TYPES.every((type) =>
    VERSLAG_FORMATEN[type].secties
      .filter((sectie) => sectie.vereistBehandelaar === true)
      .every((sectie) => sectie.hint.startsWith("Beoordeling door behandelaar")),
  ),
  true,
);

// Guards (§4.3/§4.6): exacte sleutelset en een actief verbod op `diagnose`.
const scribeLegeStaat = legeKlinischeStaat();
check("scribe guard: lege staat is geldig", isKlinischeStaat(scribeLegeStaat), true);
check(
  "scribe guard: een staat met `diagnose` wordt geweigerd (S10)",
  isKlinischeStaat({ ...scribeLegeStaat, diagnose: "depressieve episode" }),
  false,
);
check(
  "scribe guard: ontbrekende of extra sleutel wordt geweigerd",
  [
    isKlinischeStaat({ ...scribeLegeStaat, waarschuwingen: undefined }),
    isKlinischeStaat({ ...scribeLegeStaat, extra: 1 }),
    isKlinischeStaat(null),
  ],
  [false, false, false],
);
check(
  "scribe guard: labels dekken elke staatsleutel",
  Object.keys(STAAT_LABELS).length === Object.keys(scribeLegeStaat).length,
  true,
);

const scribeDemo = buildDemoConsult2();
check("scribe guard: alle demo-sessies passeren isScribeSessie", DEMO_SCRIBE_SESSIES.every(isScribeSessie), true);
check(
  "scribe guard: sessie met BSN-referentie wordt geweigerd",
  isScribeSessie({ ...DEMO_SCRIBE_SESSIES[0], patientReferentie: "123456789" }),
  false,
);
check("scribe guard: demo-segmenten passeren isScribeSegment", scribeDemo.segmenten.every(isScribeSegment), true);
check(
  "scribe guard: segment met volgnummer 0 of te lange tekst wordt geweigerd",
  [
    isScribeSegment({ ...scribeDemo.segmenten[0], volgnummer: 0 }),
    isScribeSegment({ ...scribeDemo.segmenten[0], tekst: "x".repeat(4001) }),
  ],
  [false, false],
);
check("scribe guard: demo-notitie passeert isScribeNotitie", isScribeNotitie(scribeDemo.notitie), true);
check("scribe guard: goedgekeurde demo-notitie passeert isScribeNotitie", isScribeNotitie(demoConsult3Notitie()), true);
check("scribe guard: demo-taken passeren isScribeTaak", scribeDemo.taken.every(isScribeTaak), true);
check(
  "scribe guard: verslagsectie-guard",
  [
    isVerslagSectie(scribeDemo.notitie.secties[0]),
    isVerslagSectie({ ...scribeDemo.notitie.secties[0], status: "definitief" }),
    isVerslagSectie({ ...scribeDemo.notitie.secties[0], bron: ["§3"] }),
  ],
  [true, false, false],
);
check(
  "scribe guard: instellingen",
  [
    isScribeInstellingen(EMPTY_SCRIBE_INSTELLINGEN),
    isScribeInstellingen(DEMO_SCRIBE_INSTELLINGEN),
    isScribeInstellingen({ ...EMPTY_SCRIBE_INSTELLINGEN, transcriptRetentieDagen: 0 }),
    isScribeInstellingen({ ...EMPTY_SCRIBE_INSTELLINGEN, notitieRetentieDagen: 0 }),
    isScribeInstellingen({ ...EMPTY_SCRIBE_INSTELLINGEN, standaardFormaat: "heap" }),
    isScribeInstellingen({ ...EMPTY_SCRIBE_INSTELLINGEN, consenttekst: "" }),
  ],
  [true, true, false, true, false, false],
);
check(
  "scribe instellingen: onvolledige snapshot wordt aangevuld, geldige blijft ongewijzigd",
  [
    normaliseerScribeInstellingen({ ingeschakeld: true }, EMPTY_SCRIBE_INSTELLINGEN).standaardFormaat,
    normaliseerScribeInstellingen({ ingeschakeld: true }, EMPTY_SCRIBE_INSTELLINGEN).ingeschakeld,
    migreerScribeInstellingen(null).ingeschakeld,
    migreerScribeInstellingen(DEMO_SCRIBE_INSTELLINGEN).standaardFormaat,
  ],
  ["soap", true, false, "psychiatrie"],
);

// Strict JSON-schema's: recursief additionalProperties:false en élke property
// in `required` — dezelfde eis als verify:assistant aan de tool-schema's stelt.
function scribeSchemaStrikt(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return true;
  const node = schema as Record<string, unknown>;
  if (node.type === "object") {
    if (node.additionalProperties !== false) return false;
    const properties = (node.properties ?? {}) as Record<string, unknown>;
    const verplicht = Array.isArray(node.required) ? (node.required as string[]) : [];
    const sleutels = Object.keys(properties);
    if (verplicht.length !== sleutels.length) return false;
    if (!sleutels.every((sleutel) => verplicht.includes(sleutel))) return false;
    return Object.values(properties).every(scribeSchemaStrikt);
  }
  if (node.type === "array") return scribeSchemaStrikt(node.items);
  return true;
}
check("scribe schema: consultstaat is recursief strict", scribeSchemaStrikt(KLINISCHE_STAAT_JSON_SCHEMA), true);
check("scribe schema: verslagschema is recursief strict", scribeSchemaStrikt(VERSLAG_JSON_SCHEMA), true);
check(
  "scribe schema: staat kent geen sleutel `diagnose`",
  Object.keys((KLINISCHE_STAAT_JSON_SCHEMA.properties ?? {}) as Record<string, unknown>).includes("diagnose"),
  false,
);
check(
  "scribe schema: modelwaarschuwingen kunnen alleen `model` als herkomst dragen",
  (
    (
      (
        (KLINISCHE_STAAT_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>).waarschuwingen
          .items as Record<string, Record<string, Record<string, unknown>>>
      ).properties as Record<string, Record<string, unknown>>
    ).herkomst as Record<string, unknown>
  ).enum as string[],
  ["model"],
);
check(
  "scribe schema: het verslagschema per formaat kent alleen de niet-★-sectie-id's",
  (
    (
      (
        (bouwVerslagSchema("psychiatrie").properties as Record<string, Record<string, unknown>>).secties
          .items as Record<string, Record<string, Record<string, unknown>>>
      ).properties as Record<string, Record<string, unknown>>
    ).id as Record<string, unknown>
  ).enum as string[],
  vrijeSectieIds("psychiatrie"),
);
check(
  "scribe schema: geen enkel formaat laat een ★-sectie in het verslagschema toe",
  CONSULT_TYPES.some((type) => {
    const enumWaarden = (
      (
        (
          (bouwVerslagSchema(type).properties as Record<string, Record<string, unknown>>).secties.items as Record<
            string,
            Record<string, Record<string, unknown>>
          >
        ).properties as Record<string, Record<string, unknown>>
      ).id as Record<string, unknown>
    ).enum as string[];
    return beoordelingsSectieIds(type).some((id) => enumWaarden.includes(id));
  }),
  false,
);
const scribeGenormaliseerd = strictSchema({
  type: "object",
  properties: { a: { type: "string" }, b: { type: "integer" } },
  required: ["a"],
});
check(
  "scribe schema: optionele property wordt nullable én verplicht",
  [
    scribeGenormaliseerd.required,
    scribeGenormaliseerd.additionalProperties,
    (scribeGenormaliseerd.properties as Record<string, Record<string, unknown>>).b.type as string[],
  ],
  [["a", "b"], false, ["integer", "null"]],
);

// Merge (S7): veiligheidskritische feiten verdwijnen nooit door een weglating.
function scribeMedicatie(
  naam: string,
  gebruik: Medicatie["gebruik"],
  dosering: string | null,
  bron: number[],
  doseringen: MedicatieDosering[] = dosering ? [{ waarde: dosering, bron }] : [],
): Medicatie {
  return { tekst: naam, bron, ingetrokken: false, naam, dosering, gebruik, doseringen };
}
function scribeAllergie(tekst: string, aard: Allergiefeit["aard"] = "allergie", bron: number[] = [2]): Allergiefeit {
  return { tekst, bron, ingetrokken: false, aard };
}
/** Synthetisch transcriptsegment voor de extractie-asserties. */
function scribeSegment(
  volgnummer: number,
  spreker: ScribeSegment["spreker"],
  tekst: string,
  bron: ScribeSegment["bron"] = "demo",
): ScribeSegment {
  return {
    id: `verify-seg-${volgnummer}`,
    volgnummer,
    spreker,
    tekst,
    tekstGecorrigeerd: null,
    correctieBron: null,
    beginMs: (volgnummer - 1) * 1000,
    eindMs: volgnummer * 1000,
    bron,
    createdAt: "2026-09-07T10:00:00.000Z",
  };
}
const scribeStaatMetAllergie: ScribeKlinischeStaat = {
  ...legeKlinischeStaat(),
  allergieen: [scribeAllergie("amoxicilline")],
  medicatie: [scribeMedicatie("flucloxacilline", "voorgesteld", "500 mg", [7])],
  symptomen: [{ tekst: "somberheid", bron: [2], ingetrokken: false }],
};
const scribeStaatZonderAllergie: ScribeKlinischeStaat = {
  ...legeKlinischeStaat(),
  medicatie: [scribeMedicatie("flucloxacilline", "voorgesteld", "500 mg", [9])],
  symptomen: [{ tekst: "somberheid", bron: [11], ingetrokken: false }],
};
const scribeSamengevoegd = mergeKlinischeStaat(scribeStaatMetAllergie, scribeStaatZonderAllergie);
check(
  "scribe merge: een pass zonder allergie wist de allergie niet (additief)",
  scribeSamengevoegd.allergieen.map((rij) => [rij.tekst, rij.ingetrokken]),
  [["amoxicilline", false]],
);
check(
  "scribe merge: de regelwaarschuwing blijft na de merge vuren",
  controleerMedicatie(scribeSamengevoegd.medicatie, scribeSamengevoegd.allergieen).map((rij) => [
    rij.type,
    rij.herkomst,
  ]),
  [["allergie", "regel"]],
);
check(
  "scribe merge: herkomst blijft behouden bij een niet-additieve categorie",
  scribeSamengevoegd.symptomen[0].bron,
  [2, 11],
);
check(
  "scribe merge: intrekking telt alleen mét bron",
  [
    mergeKlinischeStaat(scribeStaatMetAllergie, {
      ...legeKlinischeStaat(),
      allergieen: [{ ...scribeAllergie("amoxicilline"), ingetrokken: true, bron: [14] }],
    }).allergieen[0].ingetrokken,
    mergeKlinischeStaat(scribeStaatMetAllergie, {
      ...legeKlinischeStaat(),
      allergieen: [{ ...scribeAllergie("amoxicilline"), ingetrokken: true, bron: [] }],
    }).allergieen[0].ingetrokken,
  ],
  [true, false],
);
check(
  "scribe merge: een modelwaarschuwing wordt nooit een regelwaarschuwing",
  mergeKlinischeStaat(
    {
      ...legeKlinischeStaat(),
      waarschuwingen: [{ type: "interactie", herkomst: "model", tekst: "signaal", bron: [3] }],
    },
    {
      ...legeKlinischeStaat(),
      waarschuwingen: [{ type: "interactie", herkomst: "regel", tekst: "signaal", bron: [3] }],
    },
  ).waarschuwingen.map((rij) => rij.herkomst),
  ["model", "regel"],
);
check(
  "scribe merge: een checklist-item verdwijnt nooit en gaat alleen naar besproken",
  mergeKlinischeStaat(
    { ...legeKlinischeStaat(), ontbrekend: [{ tekst: "Suïcidaliteit uitvragen", status: "besproken", bron: [13] }] },
    { ...legeKlinischeStaat(), ontbrekend: [{ tekst: "Suïcidaliteit uitvragen", status: "open", bron: [] }] },
  ).ontbrekend,
  [{ tekst: "Suïcidaliteit uitvragen", status: "besproken", bron: [13] }],
);

// Medicatieveiligheid (§4.4): gecureerde regels, altijd `herkomst: "regel"`.
check(
  "scribe medicatie: allergie penicilline treft amoxicilline",
  controleerMedicatie([scribeMedicatie("amoxicilline", "voorgesteld", null, [4])], [scribeAllergie("penicilline")])
    .length,
  1,
);
check(
  "scribe medicatie: allergie amoxicilline treft flucloxacilline via de groep",
  controleerMedicatie(
    [scribeMedicatie("flucloxacilline", "voorgesteld", null, [4])],
    [scribeAllergie("amoxicilline")],
  ).map((rij) => rij.type),
  ["allergie"],
);
check(
  "scribe medicatie: NSAID-allergie kruist naar carbasalaatcalcium",
  controleerMedicatie([scribeMedicatie("carbasalaatcalcium", "huidig", null, [4])], [scribeAllergie("ibuprofen")])
    .length,
  1,
);
check(
  "scribe medicatie: penicilline-allergie waarschuwt niet bij azitromycine",
  controleerMedicatie([scribeMedicatie("azitromycine", "voorgesteld", null, [4])], [scribeAllergie("penicilline")]),
  [],
);
check(
  "scribe medicatie: allergie amoxicilline lost op naar de penicillinegroep",
  groepenVoorAllergie("allergisch voor amoxicilline"),
  ["penicillinen"],
);
check(
  "scribe medicatie: een intolerantie levert nooit een allergieconflict",
  controleerMedicatie(
    [scribeMedicatie("amoxicilline", "huidig", null, [4])],
    [scribeAllergie("amoxicilline", "intolerantie")],
  ).map((rij) => rij.tekst.includes("Gemelde intolerantie — geen allergie.")),
  [true],
);
check(
  "scribe medicatie: `onbekend` en `gestopt` gaan niet de veiligheidscheck in",
  [
    controleerMedicatie([scribeMedicatie("amoxicilline", "onbekend", null, [4])], [scribeAllergie("penicilline")])
      .length,
    controleerMedicatie([scribeMedicatie("amoxicilline", "gestopt", null, [4])], [scribeAllergie("penicilline")])
      .length,
  ],
  [0, 0],
);
check(
  "scribe medicatie: sertraline × tramadol is een serotonerge interactie",
  controleerMedicatie(
    [scribeMedicatie("sertraline", "huidig", "50 mg", [16]), scribeMedicatie("tramadol", "huidig", null, [17])],
    [],
  ).map((rij) => rij.type),
  ["interactie"],
);
check(
  "scribe medicatie: twee SSRI's leveren dubbelmedicatie",
  controleerMedicatie(
    [scribeMedicatie("sertraline", "huidig", null, [3]), scribeMedicatie("citalopram", "huidig", null, [4])],
    [],
  ).map((rij) => rij.type),
  ["dubbel"],
);
check(
  "scribe medicatie: lithium × ibuprofen waarschuwt op de spiegel",
  controleerMedicatie(
    [scribeMedicatie("lithium", "huidig", null, [3]), scribeMedicatie("ibuprofen", "voorgesteld", null, [4])],
    [],
  ).map((rij) => rij.type),
  ["interactie"],
);
check(
  "scribe medicatie: benzodiazepine × opioïd en QT-middelen onderling",
  [
    controleerMedicatie(
      [scribeMedicatie("oxazepam", "huidig", null, [3]), scribeMedicatie("oxycodon", "huidig", null, [4])],
      [],
    ).length,
    controleerMedicatie(
      [scribeMedicatie("haloperidol", "huidig", null, [3]), scribeMedicatie("methadon", "huidig", null, [4])],
      [],
    ).length,
  ],
  [1, 1],
);
check(
  "scribe medicatie: doseringsinconsistentie binnen dezelfde gebruiksstatus",
  controleerMedicatie(
    [scribeMedicatie("sertraline", "huidig", "50 mg", [3]), scribeMedicatie("sertraline", "huidig", "100 mg", [12])],
    [],
  ).map((rij) => rij.tekst),
  ["Dosering inconsistent genoemd (§3: 50 mg; §12: 100 mg) — controleer."],
);
check(
  "scribe medicatie: een ophoging (ander gebruik) is géén inconsistentie",
  controleerMedicatie(
    [
      scribeMedicatie("sertraline", "huidig", "50 mg", [3]),
      scribeMedicatie("sertraline", "voorgesteld", "100 mg", [12]),
    ],
    [],
  ).filter((rij) => rij.type === "dosering"),
  [],
);
check(
  "scribe medicatie: elke gecontroleerde regel draagt herkomst `regel`",
  controleerMedicatie(
    [
      scribeMedicatie("sertraline", "huidig", null, [3]),
      scribeMedicatie("tramadol", "huidig", null, [4]),
      scribeMedicatie("citalopram", "huidig", null, [5]),
    ],
    [scribeAllergie("penicilline")],
  ).every((rij) => rij.herkomst === "regel"),
  true,
);

// Deterministische extractie op het gescripte demo-consult (§7.7).
check(
  "scribe demo: het script levert evenveel segmenten als regels",
  [scribeDemo.segmenten.length, DEMO_CONSULT_SCRIPT.length],
  [30, 30],
);
check(
  "scribe extractie: hoofdklacht, duur en beloop",
  [scribeDemo.staat.hoofdklacht, scribeDemo.staat.duur, scribeDemo.staat.beloop],
  ["somberheid", "drie maanden", "geleidelijk erger"],
);
check(
  "scribe extractie: samenvatting uit hoofdklacht en duur",
  scribeDemo.staat.samenvatting,
  "Somberheid sinds drie maanden.",
);
check(
  "scribe extractie: sertraline vijftig milligram als huidige medicatie",
  scribeDemo.staat.medicatie
    .filter((rij) => rij.naam === "sertraline" && rij.gebruik === "huidig")
    .map((rij) => rij.dosering),
  ["50 mg"],
);
check(
  "scribe extractie: ophoging naar honderd milligram is `voorgesteld`",
  scribeDemo.staat.medicatie
    .filter((rij) => rij.naam === "sertraline" && rij.gebruik === "voorgesteld")
    .map((rij) => rij.dosering),
  ["100 mg"],
);
check(
  "scribe extractie: tramadol is herkend",
  scribeDemo.staat.medicatie.some((rij) => rij.naam === "tramadol" && rij.gebruik === "huidig"),
  true,
);
check(
  "scribe extractie: allergie amoxicilline, niet als medicatie",
  [
    scribeDemo.staat.allergieen.map((rij) => [rij.tekst, rij.aard]),
    scribeDemo.staat.medicatie.some((rij) => rij.naam === "amoxicilline"),
  ],
  [[["amoxicilline", "allergie"]], false],
);
check(
  "scribe extractie: suïcidaliteit is `besproken` en draagt geen polariteit (S10)",
  scribeDemo.staat.psychisch.filter((rij) => rij.categorie === "suicidaliteit").map((rij) => rij.tekst),
  ["Suïcidaliteit besproken — beoordeling behandelaar"],
);
check(
  "scribe extractie: geen enkel risicofeit bevat een ontkenning of bevestiging",
  scribeDemo.staat.psychisch
    .filter((rij) => ["suicidaliteit", "psychose", "veiligheid", "huiselijk-geweld"].includes(rij.categorie))
    .some((rij) => /\b(geen|geen|niet|nooit|wel|aanwezig|afwezig)\b/i.test(rij.tekst)),
  false,
);
check(
  'scribe extractie: "urine" is geen medicijn (GEEN_MEDICIJN)',
  extraheerDeterministisch(
    [
      {
        id: "s1",
        volgnummer: 1,
        spreker: "patient",
        tekst: "Mijn urine ruikt sterk en ik heb een vaste routine met vitamine.",
        tekstGecorrigeerd: null,
        correctieBron: null,
        beginMs: 0,
        eindMs: 1000,
        bron: "handmatig",
        createdAt: "2026-09-07T10:00:00.000Z",
      } satisfies ScribeSegment,
    ],
    "soap",
  ).medicatie,
  [],
);
check(
  "scribe extractie: twee uitgesproken overwegingen, elk met bron",
  scribeDemo.staat.overwegingen.map((rij) => rij.bron),
  [[23], [24]],
);
check(
  "scribe extractie: alcohol als leefstijlfeit met hoeveelheid, roken ontkend",
  [
    scribeDemo.staat.leefstijl.find((rij) => rij.categorie === "alcohol")?.tekst,
    scribeDemo.staat.leefstijl.find((rij) => rij.categorie === "roken")?.tekst,
  ],
  ["Alcohol: vier glazen", "Roken: ontkend"],
);
check(
  // C49 — `metingen` voedt Objectief/Onderzoek/Bevindingen: per definitie
  // waarnemingen van de behandelaar. "vier kilo" (gewichtsVERLIES) las daar als
  // een gemeten gewicht van 4 kg.
  "scribe extractie: door de cliënt genoemd gewichtsverlies is géén meting",
  [
    scribeDemo.staat.metingen.map((rij) => rij.tekst),
    scribeDemo.staat.begeleidendeSymptomen.some((rij) => rij.tekst.includes("vier kilo afgevallen")),
    checklistOntbrekend(scribeDemo.staat, "seh")
      .filter((rij) => rij.tekst.startsWith("Metingen"))
      .map((rij) => rij.status),
  ],
  [[], true, ["open"]],
);
check(
  "scribe extractie: een meting van de behandelaar landt wél in metingen, met deelzincontext",
  extraheerDeterministisch(
    [
      scribeSegment(
        1,
        "arts",
        "Bij onderzoek meet ik een bloeddruk van 150 / 95 en een pols van tachtig slagen per minuut.",
      ),
    ],
    "soap",
  ).metingen.map((rij) => rij.tekst.includes("bloeddruk") && rij.tekst.includes("slagen per minuut")),
  [true],
);
check(
  "scribe extractie: een pijnschaal van de cliënt is geen bloeddruk",
  extraheerDeterministisch([scribeSegment(1, "patient", "Op een schaal van 10 zit ik op 80/100.")], "soap").metingen,
  [],
);
check(
  "scribe extractie: voorgeschiedenis en familieanamnese",
  [
    scribeDemo.staat.voorgeschiedenis.some((rij) => rij.tekst.includes("burn-out") && rij.tekst.includes("2022")),
    scribeDemo.staat.familieanamnese.some((rij) => rij.tekst.includes("moeder")),
  ],
  [true, true],
);
check(
  "scribe extractie: precies één gecontroleerde waarschuwing (sertraline × tramadol)",
  scribeDemo.staat.waarschuwingen.map((rij) => [rij.type, rij.herkomst]),
  [["interactie", "regel"]],
);
check(
  "scribe taken: lab, communicatie en vervolgafspraak zijn geëxtraheerd",
  extraheerTaken(scribeDemo.staat).map((rij) => rij.soort),
  ["medicatie", "lab", "communicatie", "overig", "vervolgafspraak"],
);
const scribeChecklist = checklistOntbrekend(scribeDemo.staat, "psychiatrie");
check(
  "scribe checklist: suïcidaliteit staat op besproken met bron",
  scribeChecklist.filter((rij) => rij.tekst.startsWith("Suïcidaliteit")).map((rij) => [rij.status, rij.bron]),
  [["besproken", [13]]],
);
check(
  // N8 — de wettelijke en klinische GGZ-onderwerpen staan nu in de lijst en
  // blijven in het demoscript terecht op `open`.
  "scribe checklist: de niet-besproken GGZ-onderwerpen blijven open",
  scribeChecklist.filter((rij) => rij.status === "open").map((rij) => rij.tekst),
  [
    "Eerdere suïcidepogingen",
    "Crisisplan en crisisafspraken",
    "Psychotische verschijnselen uitvragen",
    "Veiligheid van anderen en huiselijk geweld",
    "Kindcheck: kinderen in het gezin en hun veiligheid",
    "Zwangerschap, kinderwens en anticonceptie",
    "Bijwerkingen van de medicatie uitvragen",
    "Therapietrouw uitvragen",
    "Somatische/metabole controle bij antipsychotica",
    "Wonen, financiën en schulden",
    "Vangnetadvies: wanneer contact opnemen",
  ],
);
check(
  "scribe checklist: kindcheck en zwangerschap schuiven naar besproken zodra ze genoemd zijn (N8)",
  (() => {
    const staat = extraheerDeterministisch(
      [
        scribeSegment(1, "arts", "Wonen er kinderen in het gezin en hoe gaat het met hen?"),
        scribeSegment(2, "arts", "Is er een kinderwens of gebruikt u anticonceptie?"),
        scribeSegment(3, "patient", "Ik heb geen last van bijwerkingen en ik vergeet de medicatie nooit in te nemen."),
      ],
      "psychiatrie",
    );
    return checklistOntbrekend(staat, "psychiatrie")
      .filter((rij) =>
        ["Kindcheck", "Zwangerschap", "Bijwerkingen", "Therapietrouw"].some((kop) => rij.tekst.startsWith(kop)),
      )
      .map((rij) => rij.status);
  })(),
  ["besproken", "besproken", "besproken", "besproken"],
);
check(
  "scribe checklist: elk consulttype dekt zijn wettelijke GGZ-onderwerpen (N8)",
  [
    checklistOntbrekend(legeKlinischeStaat(), "psychiatrie").length,
    checklistOntbrekend(legeKlinischeStaat(), "vervolg").some((rij) => rij.tekst.startsWith("Bijwerkingen")),
    checklistOntbrekend(legeKlinischeStaat(), "verpleegkundig").some((rij) => rij.tekst.startsWith("Suïcidaliteit")),
    checklistOntbrekend(legeKlinischeStaat(), "soep").some((rij) => rij.tekst.startsWith("Vangnetadvies")),
  ],
  [21, true, true, true],
);
check(
  "scribe checklist: elk consulttype heeft een eigen lijst",
  CONSULT_TYPES.every((type) => checklistOntbrekend(legeKlinischeStaat(), type).length > 0),
  true,
);

// Verslagopbouw: ★-secties blijven leeg, gaten worden zichtbaar gemaakt.
check(
  "scribe verslag: secties volgen het formaat van het consulttype",
  scribeDemo.notitie.secties.map((sectie) => sectie.id),
  VERSLAG_FORMATEN.psychiatrie.secties.map((sectie) => sectie.id),
);
check(
  // C48 — de ★-bron is sectie-specifiek: Risicotaxatie citeert de risicofeiten
  // uit `psychisch` (§13), Overwegingen de uitgesproken overwegingen (§23/§24).
  "scribe verslag: ★-secties zijn leeg en citeren hun eigen onderwerp",
  scribeDemo.notitie.secties
    .filter((sectie) => sectie.vereistBehandelaar)
    .map((sectie) => [sectie.id, sectie.tekst, sectie.status, sectie.bron, sectie.conceptTekst]),
  [
    ["risicotaxatie", "", "leeg", [13], "Suïcidaliteit besproken — beoordeling behandelaar (§13)"],
    [
      "overwegingen",
      "",
      "leeg",
      [23, 24],
      "Uitgesproken overwegingen (§23): Dit zou kunnen passen bij een depressieve episode, maar ik wil een schildklierafwijking uitsluiten.\nUitgesproken overwegingen (§24): De rugpijn en de tramadol beïnvloeden mogelijk ook het slapen.",
    ],
  ],
);
check(
  "scribe verslag: een ★-risicosectie draagt nooit een overwegingscitaat (C48)",
  scribeDemo.notitie.secties
    .filter((sectie) => isRisicoSectie("psychiatrie", sectie.id))
    .every(
      (sectie) =>
        !sectie.conceptTekst.includes("Uitgesproken overwegingen") &&
        sectie.bron.every((nummer) =>
          scribeDemo.staat.psychisch.some((rij) => rij.bron.includes(nummer) && rij.tekst.includes("besproken")),
        ),
    ),
  true,
);
check(
  "scribe verslag: een lege niet-★-sectie meldt dat er niets besproken is",
  bouwVerslagDeterministisch(legeKlinischeStaat(), [], "soap")
    .filter((sectie) => !sectie.vereistBehandelaar)
    .every((sectie) => sectie.tekst === NIET_BESPROKEN_TEKST && sectie.bron.length === 0),
  true,
);
check(
  "scribe verslag: ontbrekende fragmenten komen in een kopnoot terecht",
  bouwVerslagDeterministisch(
    legeKlinischeStaat(),
    [
      {
        id: "gat-1",
        volgnummer: 1,
        spreker: "onbekend",
        tekst: "[Transcriptie onderbroken — circa 8 seconden ontbreken]",
        tekstGecorrigeerd: null,
        correctieBron: null,
        beginMs: 0,
        eindMs: 8000,
        bron: "systeem",
        createdAt: "2026-09-07T10:00:00.000Z",
      } satisfies ScribeSegment,
    ],
    "soap",
  )[0].tekst.startsWith("Let op: 1 fragmenten ontbreken in het transcript."),
  true,
);
check(
  "scribe verslag: ★-secties blijven buiten de machinale invulling van elk formaat",
  CONSULT_TYPES.every((type) =>
    bouwVerslagDeterministisch(scribeDemo.staat, scribeDemo.segmenten, type)
      .filter((sectie) => sectie.vereistBehandelaar)
      .every((sectie) => sectie.tekst === "" && sectie.status === "leeg"),
  ),
  true,
);

// ── Getallenlexicon (C38): een fout getal is gevaarlijker dan een gemist getal ──
check(
  "scribe getallen: samengestelde telwoorden leveren de juiste dosering",
  [
    "vijfentwintig",
    "vijfenzeventig",
    "honderdvijftig",
    "tweehonderdvijfentwintig",
    "vijfhonderd",
    "achthonderd",
    "duizend",
    "eenentwintig",
    "tweeëntwintig",
    "twaalf komma vijf",
    "vijftig",
    "honderd",
  ].map((woord) => parseNlGetal(woord)),
  [25, 75, 150, 225, 500, 800, 1000, 21, 22, 12.5, 50, 100],
);
check(
  "scribe getallen: extractie leest samengestelde doseringen als één getal",
  [
    "Ik gebruik sertraline vijfentwintig milligram.",
    "Ik gebruik sertraline vijfenzeventig milligram.",
    "Ik gebruik quetiapine honderdvijftig milligram.",
    "Ik gebruik valproaat vijfhonderd milligram.",
    "Ik gebruik lithium twaalf komma vijf milligram.",
    "Ik gebruik sertraline vijftig milligram.",
  ].map(
    (tekst) => extraheerDeterministisch([scribeSegment(1, "patient", tekst)], "soap").medicatie[0]?.dosering ?? null,
  ),
  ["25 mg", "75 mg", "150 mg", "500 mg", "12.5 mg", "50 mg"],
);
check(
  "scribe getallen: duur, meting en leefstijl blijven verankerd",
  [
    extraheerDeterministisch([scribeSegment(1, "patient", "Ik ben al vijfentwintig weken somber.")], "soap").duur,
    extraheerDeterministisch([scribeSegment(1, "arts", "Ik meet vijfentachtig kilo.")], "soap").metingen.length,
    extraheerDeterministisch(
      [scribeSegment(1, "patient", "Ik drink vijfentwintig glazen per week.")],
      "soap",
    ).leefstijl.find((rij) => rij.categorie === "alcohol")?.tekst,
  ],
  ["vijfentwintig weken", 1, "Alcohol: vijfentwintig glazen"],
);
check(
  "scribe getallen: cijfers met en zonder spatie blijven werken",
  [getalNaarCijfer("50"), getalNaarCijfer("12,5"), normaliseerDosering("50mg"), normaliseerDosering("50 MILLIGRAM")],
  ["50", "12.5", "50 mg", "50 mg"],
);

// ── Klinische extractie: ontkenning, uitvraag en context ────────────────────
check(
  // C39 — "Nee, ik ben niet allergisch voor penicilline" is de standaarduitkomst
  // van de allergie-uitvraag; die mocht nooit een gemelde allergie worden.
  "scribe extractie: een ontkende allergie levert nooit aard `allergie` en geen regelwaarschuwing",
  (() => {
    const staat = extraheerDeterministisch(
      [
        scribeSegment(1, "patient", "Nee, ik ben niet allergisch voor penicilline."),
        scribeSegment(2, "arts", "Ik schrijf amoxicilline 500 mg voor."),
      ],
      "soap",
    );
    return [
      staat.allergieen.map((rij) => [rij.tekst, rij.aard]),
      staat.waarschuwingen.filter((rij) => rij.type === "allergie").length,
      checklistOntbrekend(staat, "soap")
        .filter((rij) => rij.tekst.startsWith("Allergieën"))
        .map((rij) => rij.status),
    ];
  })(),
  [[["penicilline — allergie ontkend", "onbekend"]], 0, ["besproken"]],
);
check(
  "scribe extractie: een echte allergie en een intolerantie blijven overeind (C39)",
  [
    extraheerDeterministisch(
      [
        scribeSegment(1, "patient", "Ik ben allergisch voor penicilline."),
        scribeSegment(2, "arts", "Ik schrijf amoxicilline 500 mg voor."),
      ],
      "soap",
    ).waarschuwingen.map((rij) => rij.type),
    extraheerDeterministisch(
      [scribeSegment(1, "patient", "Ik ben allergisch voor penicilline, verder geen klachten.")],
      "soap",
    ).allergieen.map((rij) => rij.aard),
    extraheerDeterministisch([scribeSegment(1, "patient", "Ik verdraag geen ibuprofen.")], "soap").allergieen.map(
      (rij) => rij.aard,
    ),
  ],
  [["allergie"], ["allergie"], ["intolerantie"]],
);
check(
  // C41 — zonder komma slokte de allergievangst de restzin op: het middel
  // verdween uit de staat én leverde een vals conflict met zichzelf.
  "scribe extractie: de allergievangst stopt vóór de bijzin en de rest wordt op medicatie gescand",
  (() => {
    const eerste = extraheerDeterministisch(
      [scribeSegment(1, "patient", "Ik ben allergisch voor penicilline en ik slik ibuprofen.")],
      "soap",
    );
    const tweede = extraheerDeterministisch(
      [scribeSegment(1, "patient", "Ik ben allergisch voor amoxicilline en gebruik sertraline vijftig milligram.")],
      "soap",
    );
    const derde = extraheerDeterministisch(
      [scribeSegment(1, "patient", "Ik ben allergisch voor penicilline en codeïne.")],
      "soap",
    );
    return [
      eerste.allergieen.map((rij) => rij.tekst),
      eerste.medicatie.map((rij) => [rij.naam, rij.gebruik]),
      eerste.waarschuwingen.filter((rij) => rij.type === "allergie").length,
      tweede.allergieen.map((rij) => rij.tekst),
      tweede.medicatie.map((rij) => [rij.naam, rij.gebruik, rij.dosering]),
      derde.allergieen.map((rij) => rij.tekst),
    ];
  })(),
  [
    ["penicilline"],
    [["ibuprofen", "huidig"]],
    0,
    ["amoxicilline"],
    [["sertraline", "huidig", "50 mg"]],
    ["penicilline en codeïne"],
  ],
);
check(
  // C40 — één screeningsvraag leverde twee NSAID's plus een dubbelmedicatie-
  // alarm in juist de groep die als geverifieerd wordt gepresenteerd.
  "scribe extractie: ontkende en uitgevraagde medicatie gaat niet de veiligheidscheck in",
  (() => {
    const ontkend = extraheerDeterministisch([scribeSegment(1, "patient", "Nee, ik gebruik geen ibuprofen.")], "soap");
    const uitvraag = extraheerDeterministisch([scribeSegment(1, "arts", "Gebruikt u ibuprofen of naproxen?")], "soap");
    const gestopt = extraheerDeterministisch([scribeSegment(1, "patient", "Ik gebruik geen tramadol meer.")], "soap");
    const huidig = extraheerDeterministisch(
      [scribeSegment(1, "patient", "Ik heb geen klachten meer sinds ik sertraline gebruik.")],
      "soap",
    );
    return [
      ontkend.medicatie.map((rij) => [rij.naam, rij.gebruik]),
      ontkend.waarschuwingen.length,
      uitvraag.medicatie.map((rij) => [rij.naam, rij.gebruik]),
      uitvraag.waarschuwingen.length,
      gestopt.medicatie.map((rij) => [rij.naam, rij.gebruik]),
      huidig.medicatie.map((rij) => [rij.naam, rij.gebruik]),
    ];
  })(),
  [
    [["ibuprofen", "onbekend"]],
    0,
    [
      ["ibuprofen", "onbekend"],
      ["naproxen", "onbekend"],
    ],
    0,
    [["tramadol", "gestopt"]],
    [["sertraline", "huidig"]],
  ],
);
check(
  "scribe extractie: een voorgestelde ophoging blijft `voorgesteld` (regressiecontrole C40)",
  extraheerDeterministisch(
    [scribeSegment(1, "arts", "Ik wil de sertraline ophogen naar honderd milligram.")],
    "soap",
  ).medicatie.map((rij) => [rij.naam, rij.gebruik, rij.dosering]),
  [["sertraline", "voorgesteld", "100 mg"]],
);
check(
  "scribe extractie: een depot of injectie telt als huidig gebruik (N5)",
  extraheerDeterministisch(
    [scribeSegment(1, "arts", "Cliënt krijgt paliperidon depot elke vier weken.", "handmatig")],
    "psychiatrie",
  ).medicatie.map((rij) => [rij.naam, rij.gebruik]),
  [["paliperidon", "huidig"]],
);
check(
  // C43 — extractie én merge dedupliceerden op precies de sleutel waarop de
  // regel groepeert, dus de tegenstrijdige dosering verdween stil.
  "scribe extractie: twee doseringen van hetzelfde middel vuren de doseringsregel",
  (() => {
    const staat = extraheerDeterministisch(
      [
        scribeSegment(1, "patient", "Ik gebruik sertraline vijftig milligram per dag."),
        scribeSegment(2, "arts", "In het dossier staat dat u sertraline honderd milligram gebruikt."),
      ],
      "soap",
    );
    const gelijk = extraheerDeterministisch(
      [
        scribeSegment(1, "patient", "Ik slik sertraline 50 mg."),
        scribeSegment(2, "patient", "Die sertraline 50mg helpt wel wat."),
      ],
      "soap",
    );
    return [
      staat.medicatie.map((rij) => [rij.naam, rij.gebruik, (rij.doseringen ?? []).map((rows) => rows.waarde)]),
      staat.waarschuwingen.filter((rij) => rij.type === "dosering").map((rij) => rij.tekst),
      gelijk.waarschuwingen.filter((rij) => rij.type === "dosering").length,
      scribeDemo.staat.waarschuwingen.filter((rij) => rij.type === "dosering").length,
    ];
  })(),
  [
    [["sertraline", "huidig", ["50 mg", "100 mg"]]],
    ["Dosering inconsistent genoemd (§1: 50 mg; §2: 100 mg) — controleer."],
    0,
    0,
  ],
);
check(
  "scribe extractie: de psychose-uitvraag in normale woordvolgorde is `besproken` (C51)",
  (() => {
    const vraag = extraheerDeterministisch(
      [scribeSegment(1, "arts", "Hoort u weleens stemmen die anderen niet horen?")],
      "psychiatrie",
    );
    const melding = extraheerDeterministisch(
      [scribeSegment(1, "patient", "Ik hoor stemmen in mijn hoofd.")],
      "psychiatrie",
    );
    const geenTreffer = extraheerDeterministisch(
      [scribeSegment(1, "arts", "We stemmen dat af met de huisarts.")],
      "psychiatrie",
    );
    return [
      vraag.psychisch.map((rij) => [rij.categorie, rij.tekst]),
      checklistOntbrekend(vraag, "psychiatrie")
        .filter((rij) => rij.tekst.startsWith("Psychotische"))
        .map((rij) => rij.status),
      melding.psychisch.map((rij) => rij.categorie),
      geenTreffer.psychisch.map((rij) => rij.categorie),
    ];
  })(),
  [[["psychose", "Psychose besproken — beoordeling behandelaar"]], ["besproken"], ["psychose"], []],
);
check(
  // N9 — handmatige invoer is het enige invoerpad zonder provider; wie na
  // afloop dicteert hield een lege consultstaat over.
  "scribe extractie: declaratieve behandelaarsrapportage levert wél feiten, een vraag niet",
  (() => {
    const rapportage = scribeSegment(
      1,
      "arts",
      "Cliënt is somber sinds drie maanden en is bekend met COPD.",
      "handmatig",
    );
    const vraag = scribeSegment(1, "arts", "Bent u somber?", "handmatig");
    const live = scribeSegment(1, "arts", "Cliënt is somber sinds drie maanden.", "live");
    return [
      isBehandelaarsrapportage(rapportage),
      isBehandelaarsrapportage(vraag),
      isBehandelaarsrapportage(live),
      extraheerDeterministisch([rapportage], "soap").hoofdklacht,
      extraheerDeterministisch([vraag], "soap").symptomen.length,
    ];
  })(),
  [true, false, false, "somberheid", 0],
);

// ── Medicatieveiligheid: GGZ-kern (N5) ─────────────────────────────────────
check(
  "scribe medicatie: de GGZ-groepen bestaan met hun leden (N5)",
  [
    MIDDEL_GROEPEN.tca.leden.includes("nortriptyline"),
    MIDDEL_GROEPEN.stemmingsstabilisatoren.leden.includes("lamotrigine"),
    MIDDEL_GROEPEN.stimulantia.leden.includes("methylfenidaat"),
    MIDDEL_GROEPEN.mao_remmers.leden.includes("tranylcypromine"),
    MIDDEL_GROEPEN.antipsychotica.leden.includes("paliperidon"),
    MIDDEL_GROEPEN.qt_verlengend.leden.includes("amitriptyline"),
  ],
  [true, true, true, true, true, true],
);
check(
  "scribe medicatie: de nieuwe GGZ-interacties vuren elk precies één keer (N5)",
  (
    [
      ["lamotrigine", "valproaat"],
      ["lithium", "carbamazepine"],
      ["clozapine", "oxazepam"],
      ["sertraline", "ibuprofen"],
      ["sertraline", "acenocoumarol"],
      ["methylfenidaat", "tranylcypromine"],
      ["amitriptyline", "sertraline"],
    ] as const
  ).map(
    ([links, rechts]) =>
      controleerMedicatie(
        [scribeMedicatie(links, "huidig", null, [3]), scribeMedicatie(rechts, "voorgesteld", null, [4])],
        [],
      ).filter((rij) => rij.type === "interactie").length,
  ),
  [1, 1, 1, 1, 1, 1, 1],
);
check(
  "scribe medicatie: elke gecontroleerde regel eindigt op de vaste slotzin (N5)",
  controleerMedicatie(
    [
      scribeMedicatie("amitriptyline", "huidig", null, [3]),
      scribeMedicatie("nortriptyline", "huidig", null, [4]),
      scribeMedicatie("sertraline", "huidig", null, [5]),
    ],
    [],
  ).every((rij) => rij.tekst.endsWith("Controleer vóór voorschrijven.") && rij.herkomst === "regel"),
  true,
);
check(
  "scribe medicatie: twee TCA's leveren dubbelmedicatie (N5)",
  controleerMedicatie(
    [scribeMedicatie("amitriptyline", "huidig", null, [3]), scribeMedicatie("nortriptyline", "huidig", null, [4])],
    [],
  )
    .filter((rij) => rij.type === "dubbel")
    .map((rij) => rij.tekst.includes("tricyclische antidepressiva")),
  [true],
);
check(
  // C45 — het schema staat `onbekend` toe (een gemelde overgevoeligheid waarvan
  // de aard onduidelijk is); die groep verdween volledig uit de controle.
  "scribe medicatie: overgevoeligheid met onbekende aard levert een neutrale regel, geen allergieoordeel",
  controleerMedicatie(
    [scribeMedicatie("amoxicilline", "voorgesteld", null, [4])],
    [scribeAllergie("penicilline", "onbekend")],
  ).map((rij) => [
    rij.type,
    rij.herkomst,
    rij.tekst.includes("Gemelde allergie"),
    rij.tekst.includes("aard onbekend"),
    rij.tekst.endsWith("Controleer vóór voorschrijven."),
  ]),
  [["allergie", "regel", false, true, true]],
);
check(
  "scribe medicatie: de intolerantiemelding noemt het middel één keer en behoudt de groep (C52)",
  [
    controleerMedicatie(
      [scribeMedicatie("ibuprofen", "huidig", null, [4])],
      [scribeAllergie("ibuprofen", "intolerantie")],
    ).map((rij) => rij.tekst),
    controleerMedicatie(
      [scribeMedicatie("carbasalaatcalcium", "huidig", null, [4])],
      [scribeAllergie("ibuprofen", "intolerantie")],
    ).map((rij) => rij.tekst.includes("behoort tot de groep salicylaten van de gemelde ibuprofen")),
  ],
  [["ibuprofen: Gemelde intolerantie — geen allergie. Controleer vóór voorschrijven."], [true]],
);

// ── Merge: `aard` is monotoon (C44) ────────────────────────────────────────
check(
  "scribe merge: een latere pass degradeert een allergie niet",
  (["intolerantie", "onbekend"] as const).map(
    (aard) =>
      mergeKlinischeStaat(scribeStaatMetAllergie, {
        ...legeKlinischeStaat(),
        allergieen: [scribeAllergie("amoxicilline", aard, [9])],
      }).allergieen[0].aard,
  ),
  ["allergie", "allergie"],
);
check(
  "scribe merge: het allergieconflict blijft vuren na een intolerantie-/onbekend-pass",
  (["intolerantie", "onbekend"] as const).map((aard) => {
    const samen = mergeKlinischeStaat(scribeStaatMetAllergie, {
      ...legeKlinischeStaat(),
      allergieen: [scribeAllergie("amoxicilline", aard, [9])],
    });
    return controleerMedicatie(samen.medicatie, samen.allergieen).some((rij) =>
      rij.tekst.startsWith("Gemelde allergie voor amoxicilline"),
    );
  }),
  [true, true],
);
check(
  "scribe merge: een opwaardering van intolerantie naar allergie mag wél",
  mergeKlinischeStaat(
    { ...legeKlinischeStaat(), allergieen: [scribeAllergie("amoxicilline", "intolerantie", [2])] },
    { ...legeKlinischeStaat(), allergieen: [scribeAllergie("amoxicilline", "allergie", [9])] },
  ).allergieen.map((rij) => [rij.aard, rij.bron]),
  [["allergie", [2, 9]]],
);
check(
  "scribe merge: doseringvermeldingen van beide passes blijven bestaan (C43)",
  (() => {
    const samen = mergeKlinischeStaat(
      { ...legeKlinischeStaat(), medicatie: [scribeMedicatie("sertraline", "huidig", "50 mg", [3])] },
      { ...legeKlinischeStaat(), medicatie: [scribeMedicatie("sertraline", "huidig", "100 mg", [12])] },
    );
    return [
      samen.medicatie.length,
      (samen.medicatie[0].doseringen ?? []).map((rij) => rij.waarde),
      controleerMedicatie(samen.medicatie, []).filter((rij) => rij.type === "dosering").length,
    ];
  })(),
  [1, ["50 mg", "100 mg"], 1],
);

// ── S10 als code: risicopolariteit (C42) ───────────────────────────────────
check(
  "scribe risico: een modelantwoord met polariteit wordt ontpolariseerd",
  normaliseerRisicopolariteit({
    ...legeKlinischeStaat(),
    psychisch: [
      { categorie: "suicidaliteit", tekst: "Geen suïcidale gedachten; geen plannen", bron: [14], ingetrokken: false },
    ],
  }).psychisch,
  [
    {
      categorie: "suicidaliteit",
      tekst: "Suïcidaliteit besproken — beoordeling behandelaar",
      bron: [14],
      ingetrokken: false,
    },
  ],
);
check(
  "scribe risico: alleen de risicozin wordt herschreven, de rest blijft staan",
  normaliseerRisicozin("Patiënt ontkent suïcidale gedachten. Slaapt slecht."),
  "Suïcidaliteit besproken — beoordeling behandelaar. Slaapt slecht.",
);
check(
  "scribe risico: `rondStaatAf` is idempotent op deterministische uitvoer",
  JSON.stringify(rondStaatAf(scribeDemo.staat)) === JSON.stringify(scribeDemo.staat),
  true,
);
check(
  "scribe risico: een polaire uitspraak in een vrij tekstveld verdwijnt eveneens",
  rondStaatAf({
    ...legeKlinischeStaat(),
    onderzoek: [{ tekst: "Er zijn geen suïcidale gedachten.", bron: [8], ingetrokken: false }],
  }).onderzoek.map((rij) => rij.tekst),
  ["Suïcidaliteit besproken — beoordeling behandelaar."],
);

// ── Eén deterministische ronde voor server én demo (C21) ───────────────────
check(
  "scribe ronde: dezelfde motor levert sprekers, correcties en staat",
  (() => {
    const segmenten = [
      scribeSegment(1, "onbekend", "Waarvoor komt u vandaag bij mij?"),
      scribeSegment(2, "onbekend", "Ik gebruik sertaline en tramadal."),
    ];
    const ronde = deterministischeRonde(segmenten, segmenten, "soap", legeKlinischeStaat());
    // De ASR-correctie landt op het segment; de extractie van DEZE ronde draait
    // nog op de brontekst, de volgende ronde ziet de gecorrigeerde regel.
    const gecorrigeerd = [segmenten[0], { ...segmenten[1], tekstGecorrigeerd: ronde.correcties[0].tekstGecorrigeerd }];
    const tweede = deterministischeRonde(gecorrigeerd, gecorrigeerd, "soap", ronde.staat);
    return [
      ronde.sprekers,
      ronde.correcties,
      tweede.staat.waarschuwingen.map((rij) => [rij.type, rij.herkomst]),
      JSON.stringify(tweede.staat) ===
        JSON.stringify(rondStaatAf(mergeKlinischeStaat(ronde.staat, extraheerDeterministisch(gecorrigeerd, "soap")))),
    ];
  })(),
  [
    [
      { volgnummer: 1, spreker: "arts" },
      { volgnummer: 2, spreker: "patient" },
    ],
    [{ volgnummer: 2, tekstGecorrigeerd: "Ik gebruik sertraline en tramadol." }],
    [["interactie", "regel"]],
    true,
  ],
);

// ── Verslagopbouw: bereik, ontdubbeling en zinsassemblage (N2/N7/C50) ──────
check(
  // N2 — medicatie en allergieën vielen bij soap, soep, verpleegkundig en
  // vervolg uit ELKE sectie: het paneel waarschuwde, het verslag zweeg.
  "scribe verslag: elke medicatie- en allergieregel komt in élk formaat in minstens één sectie voor",
  CONSULT_TYPES.every((type) => {
    const secties = bouwVerslagDeterministisch(scribeDemo.staat, scribeDemo.segmenten, type).filter(
      (sectie) => !sectie.vereistBehandelaar,
    );
    const tekst = secties.map((sectie) => sectie.conceptTekst).join("\n");
    const medicatie = scribeDemo.staat.medicatie.filter((rij) => !rij.ingetrokken);
    const allergieen = scribeDemo.staat.allergieen.filter((rij) => !rij.ingetrokken);
    return medicatie.every((rij) => tekst.includes(rij.naam)) && allergieen.every((rij) => tekst.includes(rij.tekst));
  }),
  true,
);
check(
  "scribe verslag: elke sectie noemt een feit hoogstens één keer (C50)",
  CONSULT_TYPES.every((type) =>
    bouwVerslagDeterministisch(scribeDemo.staat, scribeDemo.segmenten, type)
      .filter((sectie) => !sectie.vereistBehandelaar)
      .every((sectie) => {
        const zinnen = sectie.conceptTekst
          .replace(/\s*\(§[^)]*\)\s*$/, "")
          .split(/(?<=\.)\s+/)
          .map((zin) => zin.trim().toLowerCase())
          .filter((zin) => zin.length > 0);
        return new Set(zinnen).size === zinnen.length;
      }),
  ),
  true,
);
check(
  // N7 — zonder AI is dit het enige actieve verslagpad; een trefwoordenlijst
  // met §-markeringen kost de behandelaar meer tijd dan zij bespaart.
  "scribe verslag: de beleidssectie is verslagtekst zonder eerste persoon",
  scribeDemo.notitie.secties.find((sectie) => sectie.id === "beleid")?.conceptTekst,
  "Sertraline ophogen naar 100 mg. Aanvragen via de huisarts een TSH-bepaling om de schildklier te laten controleren. Overleg met de huisarts over de tramadol. Psycho-educatie en cliënt krijgt adviezen over slaaphygiëne. Vervolgafspraak over twee weken. (§25, §26, §27, §28, §29)",
);
check(
  "scribe verslag: de anamnestische secties zijn Nederlandse zinnen met gebundelde bronnen (N7)",
  [
    scribeDemo.notitie.secties.find((sectie) => sectie.id === "reden-van-komst")?.conceptTekst,
    scribeDemo.notitie.secties.find((sectie) => sectie.id === "somatiek-medicatie")?.conceptTekst,
  ],
  [
    "Cliënt meldt somberheid sinds drie maanden, beloop geleidelijk erger.",
    "Medicatie: sertraline 50 mg (huidig), tramadol (huidig) en sertraline 100 mg (voorgesteld). Allergieën: amoxicilline (allergie). Voorgeschiedenis: In 2022 heb ik een burn-out gehad, toen ben ik drie maanden thuis geweest. (§16, §17, §19, §21, §24, §25, §27)",
  ],
);
check(
  "scribe verslag: geen enkele niet-★-sectie bevat nog een eerste-persoonsbeleidszin (N7)",
  CONSULT_TYPES.every((type) =>
    bouwVerslagDeterministisch(scribeDemo.staat, scribeDemo.segmenten, type)
      .filter((sectie) => !sectie.vereistBehandelaar)
      .every((sectie) => !/(^|\s)Ik (wil|vraag|overleg|geef)\b/.test(sectie.conceptTekst)),
  ),
  true,
);
check(
  "scribe verslag: beleidszin normaliseert de dosering en de aanhef",
  [
    beleidszin("Ik wil de sertraline ophogen naar honderd milligram."),
    beleidszin("We maken een vervolgafspraak over twee weken."),
    beleidszin("Ik overleg met de huisarts over de tramadol."),
  ],
  ["Sertraline ophogen naar 100 mg.", "Vervolgafspraak over twee weken.", "Overleg met de huisarts over de tramadol."],
);

// Transcriptcorrectie (S9) en fragmentontdubbeling (§5.3/§7.6).
check(
  "scribe correctie: bekende ASR-fouten in medische termen",
  corrigeerTranscriptDeterministisch("de patiënt gebruikt sertaline en tramadal"),
  "de patiënt gebruikt sertraline en tramadol",
);
check(
  "scribe correctie: niets te corrigeren levert null",
  corrigeerTranscriptDeterministisch("niets bijzonders"),
  null,
);
check(
  "scribe overlap: herhaalde kop verdwijnt",
  verwijderOverlap("de patiënt gebruikt sertraline vijftig", "sertraline vijftig milligram sinds zes weken"),
  "milligram sinds zes weken",
);
check(
  "scribe overlap: een op de grens afgekapte medicijnnaam blijft volledig staan",
  verwijderOverlap("de patiënt gebruikt sertra", "sertraline vijftig milligram"),
  "sertraline vijftig milligram",
);
check(
  "scribe overlap: zonder overlap blijft de tekst ongewijzigd, volledige herhaling wordt leeg",
  [
    verwijderOverlap("helemaal iets anders", "sertraline vijftig milligram"),
    verwijderOverlap("sertraline vijftig milligram", "sertraline vijftig milligram"),
    verwijderOverlap("", "sertraline vijftig milligram"),
  ],
  ["sertraline vijftig milligram", "", "sertraline vijftig milligram"],
);

// Retentie (§4.7): het transcript volgt altijd de kortste termijn.
const scribeNu = new Date("2026-09-07T00:00:00.000Z");
check(
  "scribe retentie: actief consult volgt de transcripttermijn",
  berekenRetentie("actief", EMPTY_SCRIBE_INSTELLINGEN, scribeNu),
  { transcriptVerwijderNa: "2026-10-07T00:00:00.000Z", sessieVerwijderNa: "2026-10-07T00:00:00.000Z" },
);
check(
  "scribe retentie: bij overname wordt het transcript direct gewist",
  berekenRetentie("overgenomen", EMPTY_SCRIBE_INSTELLINGEN, scribeNu),
  { transcriptVerwijderNa: "2026-09-07T00:00:00.000Z", sessieVerwijderNa: "2026-10-07T00:00:00.000Z" },
);
check(
  "scribe retentie: zonder direct wissen geldt de kortste van beide termijnen",
  berekenRetentie(
    "overgenomen",
    { ...EMPTY_SCRIBE_INSTELLINGEN, transcriptWissenBijOvername: false, notitieRetentieDagen: 7 },
    scribeNu,
  ),
  { transcriptVerwijderNa: "2026-09-14T00:00:00.000Z", sessieVerwijderNa: "2026-09-14T00:00:00.000Z" },
);
check(
  "scribe retentie: verslagtermijn 0 laat niets achter",
  berekenRetentie("overgenomen", { ...EMPTY_SCRIBE_INSTELLINGEN, notitieRetentieDagen: 0 }, scribeNu),
  { transcriptVerwijderNa: "2026-09-07T00:00:00.000Z", sessieVerwijderNa: "2026-09-07T00:00:00.000Z" },
);
check(
  "scribe retentie: annuleren wist het transcript direct, metadata na één dag",
  berekenRetentie("geannuleerd", EMPTY_SCRIBE_INSTELLINGEN, scribeNu),
  { transcriptVerwijderNa: "2026-09-07T00:00:00.000Z", sessieVerwijderNa: "2026-09-08T00:00:00.000Z" },
);

// Seeds (§7.7) — demonstratiedata, geen echte cliëntgegevens.
check(
  "scribe seeds: module staat in productie uit",
  [EMPTY_SCRIBE_INSTELLINGEN.ingeschakeld, EMPTY_SCRIBE_INSTELLINGEN.standaardFormaat],
  [false, "soap"],
);
check(
  "scribe seeds: demo staat aan met het GGZ-formaat",
  [DEMO_SCRIBE_INSTELLINGEN.ingeschakeld, DEMO_SCRIBE_INSTELLINGEN.standaardFormaat],
  [true, "psychiatrie"],
);
check(
  "scribe seeds: retentiestandaarden 30/30 met direct wissen bij overname",
  [
    EMPTY_SCRIBE_INSTELLINGEN.transcriptRetentieDagen,
    EMPTY_SCRIBE_INSTELLINGEN.notitieRetentieDagen,
    EMPTY_SCRIBE_INSTELLINGEN.transcriptWissenBijOvername,
    EMPTY_SCRIBE_INSTELLINGEN.klinischeAanwijzingenAan,
    EMPTY_SCRIBE_INSTELLINGEN.medicatiecheckAan,
  ],
  [30, 30, true, true, true],
);
check(
  "scribe seeds: toestemmingstekst noemt transcriptie, verwijdering, verwerker en vaststelling",
  [
    STANDAARD_CONSENTTEKST.length <= 1000,
    STANDAARD_CONSENTTEKST.includes("getranscribeerd"),
    STANDAARD_CONSENTTEKST.includes("verwerkersovereenkomst"),
    STANDAARD_CONSENTTEKST.includes("niet wordt bewaard"),
    STANDAARD_CONSENTTEKST.endsWith("heeft hiermee ingestemd."),
  ],
  [true, true, true, true, true],
);
check(
  "scribe seeds: consenttekst van de instellingen is de standaardtekst",
  EMPTY_SCRIBE_INSTELLINGEN.consenttekst,
  STANDAARD_CONSENTTEKST,
);
check("scribe seeds: demo-tempo", DEMO_SEGMENT_INTERVAL_MS, 1500);
check(
  "scribe seeds: drie demo-consulten met de audited referentie voor het actieve consult",
  DEMO_SCRIBE_SESSIES.map((sessie) => [sessie.id, sessie.status, sessie.patientReferentie]),
  [
    ["demo-consult-1", "actief", "D-2026-0417"],
    ["demo-consult-2", "afgerond", "D-2026-0392"],
    ["demo-consult-3", "overgenomen", "D-2026-0355"],
  ],
);
check(
  "scribe seeds: elk demo-consult draagt een bevroren toestemming",
  DEMO_SCRIBE_SESSIES.every(
    (sessie) =>
      sessie.consentTekst === STANDAARD_CONSENTTEKST &&
      sessie.consentRevisie >= 1 &&
      !Number.isNaN(Date.parse(sessie.consentBevestigdOp)),
  ),
  true,
);
check(
  "scribe seeds: het overgenomen consult heeft geen transcript meer",
  [
    DEMO_SCRIBE_SESSIES[2].segmentTeller,
    DEMO_SCRIBE_SESSIES[2].transcriptVerwijderNa === DEMO_SCRIBE_SESSIES[2].overgenomenOp,
  ],
  [0, true],
);
check(
  "scribe seeds: sessieteller van het afgeronde consult volgt het script",
  [DEMO_SCRIBE_SESSIES[1].segmentTeller, scribeDemo.segmenten.length],
  [DEMO_CONSULT_SCRIPT.length, DEMO_CONSULT_SCRIPT.length],
);
check(
  "scribe seeds: staat en verslag komen uit dezelfde deterministische motor",
  JSON.stringify(extraheerDeterministisch(scribeDemo.segmenten, "psychiatrie")) === JSON.stringify(scribeDemo.staat),
  true,
);
check(
  "scribe seeds: het script schrijft getallen als woord (alleen het jaartal is een cijfer)",
  DEMO_CONSULT_SCRIPT.flatMap((regel) => regel.tekst.match(/\d+/g) ?? []),
  ["2022"],
);
check(
  "scribe seeds: geen naam, geboortedatum of BSN in de dossierreferenties",
  DEMO_SCRIBE_SESSIES.every((sessie) => isPatientReferentie(sessie.patientReferentie)),
  true,
);

// Export (§5.3, S2/S3): één pure opbouw voor route én demo-pad.
const scribeExportSessie = DEMO_SCRIBE_SESSIES[2];
const scribeExportNotitie = demoConsult3Notitie();
const scribeExportTekst = bouwExportTekst({
  sessie: scribeExportSessie,
  notitie: scribeExportNotitie,
  taken: [
    { omschrijving: "TSH laten bepalen via de huisarts", soort: "lab", status: "goedgekeurd" },
    { omschrijving: "Niet-goedgekeurde actie", soort: "overig", status: "voorgesteld" },
  ],
});
check(
  "scribe export: kop draagt de dossierreferentie en de toestemmingsversie",
  scribeExportTekst.includes(`Dossierreferentie: ${scribeExportSessie.patientReferentie}`) &&
    scribeExportTekst.includes(`(tekstversie ${scribeExportSessie.consentRevisie})`),
  true,
);
check(
  "scribe export: geen e-mailadres, geen behandelaarsnaam en de EPD-regel aanwezig",
  !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(scribeExportTekst) &&
    scribeExportTekst.includes("Het EPD blijft het juridische dossier"),
  true,
);
check(
  "scribe export: elke sectietitel staat in het bestand; alleen goedgekeurde taken gaan mee",
  scribeExportNotitie.secties.every((sectie) => scribeExportTekst.includes(sectie.titel.toUpperCase())) &&
    scribeExportTekst.includes("- TSH laten bepalen via de huisarts (") &&
    !scribeExportTekst.includes("Niet-goedgekeurde actie"),
  true,
);
check(
  "scribe export: markdown-variant gebruikt koppen en dezelfde inhoud",
  bouwExportTekst({ sessie: scribeExportSessie, notitie: scribeExportNotitie, taken: [], formaat: "md" }).startsWith(
    "# Consultverslag",
  ),
  true,
);
check(
  "scribe export: bestandsnaam bevat nooit de dossierreferentie",
  veiligeBestandsnaam(`consult-${scribeExportSessie.id.slice(0, 8)}-2026-09-07`, scribeExportSessie.id).includes(
    scribeExportSessie.patientReferentie,
  ),
  false,
);

// Pdf-pijplijn: dezelfde renderer als de definitief-route. Tekststromen in de
// pdf zijn gecomprimeerd/subset-gecodeerd, dus inhoud wordt op het niveau van
// de documentmetadata (/Title draagt het factuurnummer) en de structuur
// geverifieerd — de veldwaarden zelf zijn hierboven al data-gedreven getoetst.
void (async () => {
  try {
    const verzonden = await renderFactuurPdf(DEMO_FACTUREN[0]);
    check("pdf: bytes beginnen met %PDF-", verzonden.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    check("pdf: document heeft substantie", verzonden.buffer.byteLength > 2_000, true);
    check("pdf: factuurnummer in de documenttitel", verzonden.buffer.includes("F2026-0001"), true);
    check("pdf: sha256 aanwezig", verzonden.sha256.length, 64);
    const vrijgesteldPdf = await renderFactuurPdf(DEMO_FACTUREN[1]);
    check("pdf: vrijgestelde factuur rendert", vrijgesteldPdf.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  } catch (error) {
    failures += 1;
    console.error("FAIL pdf: renderFactuurPdf faalde", error);
  }

  console.log(`\nverify-careon: ${passes} passed, ${failures} failed`);
  if (failures > 0) {
    process.exit(1);
  }
})();

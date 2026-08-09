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
  DEMO_CONTACTEN,
  DEMO_FACTURATIE_INSTELLINGEN,
  DEMO_FACTUREN,
  EMPTY_FACTURATIE_INSTELLINGEN,
} from "../data/careon/careon-facturatie";
import { CAREON_LOCATION_SCALE, CAREON_LOCATIONS } from "../data/careon/careon-filters";
import { FINANCIEEL_METRICS } from "../data/careon/careon-financieel";
import { BIG_REGISTRATIES, HR_METRICS, HR_SEED_STATE } from "../data/careon/careon-hr";
import { careonDetailHref, KPI_DETAIL_BY_ID, KPI_DETAILS } from "../data/careon/careon-kpi-details";
import { COCKPIT_KPIS } from "../data/careon/careon-kpis";
import { complianceTone, KWALITEIT_COUNTERS } from "../data/careon/careon-kwaliteit";
import { DEMO_MIDDELEN_STATE, FUNCTIE_OPTIES, TAAL_OPTIES, TEAM_SEED } from "../data/careon/careon-middelen";
import { CAREON_MODULES } from "../data/careon/careon-modules";
import { CAREON_ROUTES } from "../data/careon/careon-pages";
import { PATIENTEN_METRICS } from "../data/careon/careon-patienten";
import { PLANNING_METRICS } from "../data/careon/careon-planning";
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
import {
  berekenVervaldatum,
  formatFactuurnummer,
  isTeLaat,
  uitreikingstermijnOverschreden,
} from "../lib/careon-facturatie/nummer";
import { renderFactuurPdf } from "../lib/careon-facturatie/pdf/render.server";
import { berekenTotalen, isVolledigVrijgesteld } from "../lib/careon-facturatie/totalen";
import {
  type FactuurRegel,
  isFacturatieContact,
  isFacturatieInstellingen,
  isFactuur,
} from "../lib/careon-facturatie/types";
import { afzenderUitInstellingen, valideerFactuurVoorUitreiking } from "../lib/careon-facturatie/validatie";
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
check("register: facturatietegel is live op /dashboard/facturatie", facturatieTegel?.href, "/dashboard/facturatie");
check("register: facturatietegel is beheerder-only", facturatieTegel?.zichtbaarVoor, "org_admin");

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
const demoAfzender = afzenderUitInstellingen(DEMO_FACTURATIE_INSTELLINGEN);
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
  valideerFactuurVoorUitreiking(compleetConcept, afzenderUitInstellingen(EMPTY_FACTURATIE_INSTELLINGEN)).ok,
  false,
);

// Seeds: demo valideert tegen de guards en rekent kloppend; EMPTY draagt
// geen klantgegevens (een tweede organisatie erft nooit de eerste).
check("seeds: demo-facturen valideren tegen isFactuur", DEMO_FACTUREN.every(isFactuur), true);
check("seeds: demo-contacten valideren", DEMO_CONTACTEN.every(isFacturatieContact), true);
check("seeds: demo-instellingen valideren", isFacturatieInstellingen(DEMO_FACTURATIE_INSTELLINGEN), true);
check("seeds: lege instellingen valideren", isFacturatieInstellingen(EMPTY_FACTURATIE_INSTELLINGEN), true);
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
  "seeds: EMPTY-instellingen zonder bedrijfsgegevens",
  [
    EMPTY_FACTURATIE_INSTELLINGEN.afzender.statutaireNaam,
    EMPTY_FACTURATIE_INSTELLINGEN.afzender.kvkNummer,
    EMPTY_FACTURATIE_INSTELLINGEN.bank.iban,
  ],
  ["", "", ""],
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

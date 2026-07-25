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

import { CAREON_ALERTS, CRITICAL_ALERT_COUNT } from "../data/careon/careon-alerts";
import { BEHANDELAREN, caseloadTone, ncTone, noshowTone } from "../data/careon/careon-behandelaren";
import { parseKpiCsv, SAMPLE_CSV_CONTENT } from "../data/careon/careon-databron";
import { buildDetailRowsFresh, DETAIL_LOCS, demoDetailRows } from "../data/careon/careon-detail-records";
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
import { CAREON_LOCATION_SCALE, CAREON_LOCATIONS } from "../data/careon/careon-filters";
import { FINANCIEEL_METRICS } from "../data/careon/careon-financieel";
import { BIG_REGISTRATIES, HR_METRICS, HR_SEED_STATE } from "../data/careon/careon-hr";
import { careonDetailHref, KPI_DETAIL_BY_ID, KPI_DETAILS } from "../data/careon/careon-kpi-details";
import { COCKPIT_KPIS } from "../data/careon/careon-kpis";
import { complianceTone, KWALITEIT_COUNTERS } from "../data/careon/careon-kwaliteit";
import { DEMO_MIDDELEN_STATE, FUNCTIE_OPTIES, TAAL_OPTIES, TEAM_SEED } from "../data/careon/careon-middelen";
import { CAREON_ROUTES } from "../data/careon/careon-pages";
import { PATIENTEN_METRICS } from "../data/careon/careon-patienten";
import { PLANNING_METRICS } from "../data/careon/careon-planning";
import { CAREON_MONTHLY } from "../data/careon/careon-shared-charts";
import { sliceTimeframe, timeframeKeys } from "../data/careon/careon-timeframe";
import type { CareonMetric } from "../data/careon/careon-types";
import { formatCareonDelta, formatCareonValue } from "../lib/careon-format";
import { bigDagenTot, HR_KPI_IDS, type HrKpiId, isHrState } from "../lib/careon-hr/types";
import { executeMiddelenTool, isMiddelenTool } from "../lib/careon-middelen/assistant-executor";
import { DESTRUCTIEVE_TOOLS, MIDDELEN_TOOL_NAMES, MIDDELEN_TOOLS } from "../lib/careon-middelen/assistant-tools";
import { createConceptMiddelenApi, replayConceptActies } from "../lib/careon-middelen/concept";
import { isMiddelenState } from "../lib/careon-middelen/types";
import { CAREON_PROVENANCE } from "../lib/careon-production/provenance";

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

console.log(`\nverify-careon: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}

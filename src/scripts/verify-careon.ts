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
import { caseloadTone, ncTone, noshowTone } from "../data/careon/careon-behandelaren";
import { parseKpiCsv, SAMPLE_CSV_CONTENT } from "../data/careon/careon-databron";
import { CAREON_LOCATION_SCALE } from "../data/careon/careon-filters";
import { FINANCIEEL_METRICS } from "../data/careon/careon-financieel";
import { HR_METRICS } from "../data/careon/careon-hr";
import { COCKPIT_KPIS } from "../data/careon/careon-kpis";
import { complianceTone, KWALITEIT_COUNTERS } from "../data/careon/careon-kwaliteit";
import { CAREON_ROUTES } from "../data/careon/careon-pages";
import { PATIENTEN_METRICS } from "../data/careon/careon-patienten";
import { PLANNING_METRICS } from "../data/careon/careon-planning";
import type { CareonMetric } from "../data/careon/careon-types";
import { formatCareonDelta, formatCareonValue } from "../lib/careon-format";

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
  omzetverz: ["+6,0%", "good"],
  omzetinfo: ["+15,3%", "good"],
  outreach: ["+5", "good"],
  tevredenheid: ["+0,2", "good"],
};
for (const kpi of COCKPIT_KPIS) {
  const d = formatCareonDelta(kpi);
  check(`cockpit delta ${kpi.id}`, [d.text, d.tone], cockpitDelta[kpi.id]);
}

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
const expectedKpiRoutes: Record<string, string> = {
  actief: "/dashboard/patienten",
  aanmeldingen: "/dashboard/patienten",
  gesloten: "/dashboard/patienten",
  noshow: "/dashboard/planning",
  zondervervolg: "/dashboard/patienten",
  dossiersnc: "/dashboard/dossiercontrole",
  omzetverz: "/dashboard/financieel",
  omzetinfo: "/dashboard/financieel",
  outreach: "/dashboard/patienten",
  tevredenheid: "/dashboard/kwaliteit",
};
for (const kpi of COCKPIT_KPIS) {
  check(`kpi route ${kpi.id}`, CAREON_ROUTES[kpi.page], expectedKpiRoutes[kpi.id]);
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

console.log(`\nverify-careon: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}

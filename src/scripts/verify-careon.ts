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
import { HR_METRICS } from "../data/careon/careon-hr";
import { careonDetailHref, KPI_DETAIL_BY_ID, KPI_DETAILS } from "../data/careon/careon-kpi-details";
import { COCKPIT_KPIS } from "../data/careon/careon-kpis";
import { complianceTone, KWALITEIT_COUNTERS } from "../data/careon/careon-kwaliteit";
import { DEMO_MIDDELEN_STATE, FUNCTIE_OPTIES, TAAL_OPTIES, TEAM_SEED } from "../data/careon/careon-middelen";
import { CAREON_ROUTES } from "../data/careon/careon-pages";
import { PATIENTEN_METRICS } from "../data/careon/careon-patienten";
import { PLANNING_METRICS } from "../data/careon/careon-planning";
import type { CareonMetric } from "../data/careon/careon-types";
import { formatCareonDelta, formatCareonValue } from "../lib/careon-format";
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

console.log(`\nverify-careon: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}

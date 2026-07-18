/**
 * Script: verify-production.ts
 *
 * Mechanical verification of the production-mode data core: the ZSG
 * cliëntendata-export parser and the snapshot aggregations. Runs against the
 * committed synthetic fixture (deterministic, reference date 14-07-2026) and —
 * when the real export is present locally (gitignored) — a sanity pass with
 * independently computed expected values.
 *
 * Usage: npm run verify:production
 */

import { CAREON_ALERTS } from "../data/careon/careon-alerts";
import { CASELOAD_NORM } from "../data/careon/careon-behandelaren";
import { parseKpiCsv } from "../data/careon/careon-databron";
import { DOSSIERS_PRODUCTIE_METRICS, REGIE_NORM } from "../data/careon/careon-dossiers-productie";
import { FINANCIEEL_METRICS } from "../data/careon/careon-financieel";
import { HR_METRICS } from "../data/careon/careon-hr";
import { KPI_DETAIL_BY_ID } from "../data/careon/careon-kpi-details";
import { COCKPIT_KPIS } from "../data/careon/careon-kpis";
import { KWALITEIT_COUNTERS } from "../data/careon/careon-kwaliteit";
import { PATIENTEN_METRICS } from "../data/careon/careon-patienten";
import { PLANNING_METRICS } from "../data/careon/careon-planning";
import { buildProductionAssistantFacts } from "../lib/careon-production/assistant-facts";
import { computeProductionSnapshot } from "../lib/careon-production/compute-snapshot";
import {
  PRODUCTION_DETAIL_ROWS,
  productionDetailMetric,
  productionDetailTrend,
} from "../lib/careon-production/detail-rows";
import { diagnoseGroepVanCode, parseClientExport, parseDutchDate } from "../lib/careon-production/parse-export";
import { CAREON_PROVENANCE, pageLiveCounts, widgetSource } from "../lib/careon-production/provenance";
import { isProductionState } from "../lib/careon-production/types";
import * as fs from "node:fs";
import * as path from "node:path";

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

// Date.UTC: compute-snapshot gebruikt UTC-getters, zodat dezelfde import in
// elke tijdzone dezelfde referentiedag (en maandvensters) oplevert.
const REFERENCE = new Date(Date.UTC(2026, 6, 14));

// ---- Parser unit checks ----
check("date dd-mm-jjjj", parseDutchDate("08-01-2006"), "2006-01-08");
check("date invalid month", parseDutchDate("31-13-2026"), null);
check("date niet-bestaande kalenderdag", parseDutchDate("31-02-2026"), null);
check("date 30 april bestaat wel", parseDutchDate("30-04-2026"), "2026-04-30");
check("date null", parseDutchDate(null), null);
check("diagnosegroep depressief", diagnoseGroepVanCode("D5_4.02.02.02"), "Depressieve stoornissen");
check("diagnosegroep adhd", diagnoseGroepVanCode("D5_1.04.03"), "ADHD");
check("diagnosegroep autisme", diagnoseGroepVanCode("D5_1.03.01"), "Autismespectrum");
check("diagnosegroep ptss", diagnoseGroepVanCode("D5_7.01.01"), "PTSS / trauma");
check("diagnosegroep ocs", diagnoseGroepVanCode("D5_6.01"), "Dwangstoornissen (OCS)");
check("diagnosegroep onbekend hoofdstuk", diagnoseGroepVanCode("D5_15.01"), "Overige diagnoses");
check("diagnosegroep null", diagnoseGroepVanCode(null), null);

// ---- Parser edge-cases (inline CSV's, geen fixture nodig) ----
const EDGE_HEADER =
  "Cliënt ID;Client geslacht;Client leeftijd;Vestigingsnaam;Episode startdatum;Episode einddatum;Verwijsdatum;Wachtlijst Status;Naam huisarts/verwijzer;Ga naar dossier";

// Meerregelige quoted cel: de verwijzer-cel bevat een regeleinde; de rij moet
// als één record doorkomen met intacte kolommen erna.
const multiline = parseClientExport(
  "edge.csv",
  `${EDGE_HEADER}\n1;Man;30;TGC Tilburg;15-01-2026;;01-01-2026;Nee;"Huisarts\nmet regeleinde";https://epd.example/1\n2;Vrouw;40;TGC Breda;10-02-2026;;;Nee;;https://epd.example/2`,
);
check("multiline quoted cel: beide rijen gelezen", multiline.records.length, 2);
check("multiline quoted cel: kolommen erna intact", multiline.records[0]?.dossierUrl, "https://epd.example/1");
check("multiline quoted cel: celinhoud samengevoegd", multiline.records[0]?.verwijzer, "Huisarts\nmet regeleinde");

// Los aanhalingsteken (typfout): mag NIET de rest van het bestand in één cel
// opslokken — de terugval parseert de regels weer los, met waarschuwing.
const stray = parseClientExport(
  "stray.csv",
  `${EDGE_HEADER}\n1;Man;30;TGC Tilburg;15-01-2026;;01-01-2026;Nee;;https://epd.example/1\n2;Vrouw;40;TGC "Breda;10-02-2026;;;Nee;;https://epd.example/2\n3;Man;50;TGC Roermond;01-03-2026;;;Nee;;https://epd.example/3\n4;Vrouw;60;TGC Tilburg;05-04-2026;;;Nee;;https://epd.example/4\n5;Man;20;TGC Breda;06-05-2026;;;Nee;;https://epd.example/5`,
);
check(
  "stray quote: alle rijen blijven behouden",
  stray.records.map((record) => record.id),
  ["1", "2", "3", "4", "5"],
);
check(
  "stray quote: waarschuwing aanwezig",
  stray.warnings.some((warning) => warning.message.includes("Onafgesloten aanhalingsteken")),
  true,
);
check("stray quote: latere rijen onbeschadigd", stray.records[2]?.vestiging, "Roermond");

// Rij-nummers in waarschuwingen wijzen naar de FYSIEKE regel in het bestand,
// ook nadat een meerregelige quoted cel eerdere regels heeft samengevoegd.
const rowNum = parseClientExport(
  "rownum.csv",
  `${EDGE_HEADER}\n1;Man;30;TGC Tilburg;15-01-2026;;01-01-2026;Nee;"Huisarts\nmet regeleinde";https://epd.example/1\n2;Vrouw;40;TGC Breda;10-02-2026;;;Nee;;https://epd.example/2\n;Man;50;TGC Tilburg;;;;Nee;;`,
);
check(
  "rijnummer klopt na meerregelige cel",
  rowNum.warnings.find((warning) => warning.message.includes("zonder Cliënt ID"))?.row,
  5,
);

// Verwijzer-canonicalisatie: HAP / Huisartspraktijk / Huisartsenpraktijk met
// dezelfde praktijknaam zijn één verwijzer in de toplijst.
const verwijzerParse = parseClientExport(
  "verwijzers.csv",
  `${EDGE_HEADER}\n1;Man;30;TGC Tilburg;15-01-2026;;01-01-2026;Nee;A. Arts (HAP Fixture);\n2;Vrouw;40;TGC Breda;10-02-2026;;05-02-2026;Nee;B. Arts (Huisartspraktijk Fixture);\n3;Man;50;TGC Tilburg;12-03-2026;;01-03-2026;Nee;C. Arts (Huisartsenpraktijk Fixture);`,
);
const verwijzerSnap = computeProductionSnapshot(
  { fileName: "verwijzers.csv", importedAt: "2026-07-14T09:00:00.000Z", records: verwijzerParse.records },
  { locatie: "Alle locaties" },
  REFERENCE,
);
check("verwijzer-varianten samengevoegd", verwijzerSnap.dossiersProductie.verwijzers, [
  { label: "Huisartsenpraktijk Fixture", aantal: 3 },
]);

// Dubbele kolomkop: eerste kolom wint, met waarschuwing.
const dupHeader = parseClientExport(
  "dup.csv",
  `${EDGE_HEADER};Client geslacht\n1;Man;30;TGC Tilburg;15-01-2026;;01-01-2026;Nee;;https://epd.example/1;Vrouw`,
);
check("dubbele kolomkop: eerste kolom wint", dupHeader.records[0]?.geslacht, "Man");
check(
  "dubbele kolomkop: waarschuwing aanwezig",
  dupHeader.warnings.some((warning) => warning.message.includes("Dubbele kolomkop")),
  true,
);

// Dossier-deeplinks: alleen https wordt bewaard (CSV-waarde wordt href).
const badUrl = parseClientExport(
  "url.csv",
  `${EDGE_HEADER}\n1;Man;30;TGC Tilburg;15-01-2026;;;Nee;;javascript:alert(1)\n2;Vrouw;40;TGC Breda;10-02-2026;;;Nee;;http://epd.example/2`,
);
check("dossierUrl javascript: geweigerd", badUrl.records[0]?.dossierUrl, null);
check("dossierUrl http (niet-https) geweigerd", badUrl.records[1]?.dossierUrl, null);

// Verkeerde kaart: een cliëntendata-export in de demo-KPI-kaart verwijst naar
// de productie-kaart i.p.v. het generieke voorbeeldbestand-advies.
check(
  "KPI-kaart verwijst cliëntendata-export door",
  parseKpiCsv("clienten.csv", `${EDGE_HEADER}\n1;Man;30;TGC Tilburg;15-01-2026;;;Nee;;`).message.includes(
    "Productie-modus",
  ),
  true,
);

// Persistentie-guard: een kapotte importedAt zou alle maandvensters tot
// NaN-sleutels corrumperen en moet de hele state ongeldig maken.
check(
  "isProductionState weigert ongeldige importedAt",
  isProductionState({ fileName: "x.csv", importedAt: "geen datum", records: multiline.records }),
  false,
);
check(
  "isProductionState accepteert geldige state",
  isProductionState({ fileName: "x.csv", importedAt: "2026-07-14T09:00:00.000Z", records: multiline.records }),
  true,
);

// Legacy-compat: records uit een oudere opgeslagen state (localStorage/Supabase
// van vóór de schema-uitbreiding) missen de vijf later toegevoegde optionele
// velden — de guard moet ze accepteren en de aggregaties moeten er kalm mee
// omgaan (comorbiditeit 0, geen crash).
const legacyRecord: Record<string, unknown> = { ...multiline.records[0] };
delete legacyRecord.diagnoseOmschrijving;
delete legacyRecord.heeftSecundaireDiagnose;
delete legacyRecord.zorgvraagtypeOmschrijving;
delete legacyRecord.voorgesteldZorgvraagtype;
delete legacyRecord.verwijzerAgb;
const legacyState = { fileName: "legacy.csv", importedAt: "2026-07-14T09:00:00.000Z", records: [legacyRecord] };
check("isProductionState accepteert legacy-record zonder nieuwe velden", isProductionState(legacyState), true);
const legacySnap = computeProductionSnapshot(
  legacyState as unknown as Parameters<typeof computeProductionSnapshot>[0],
  { locatie: "Alle locaties" },
  REFERENCE,
);
check("legacy-record: comorbiditeit 0", legacySnap.dossiersProductie.comorbiditeit, { aantal: 0, pct: 0 });
check("legacy-record: afwijkende typering telt niet", legacySnap.dossiercontrole.checks[4].n, 0);

// Hangend scheidingsrestje in het zorgvraagtype ("ZT05 -") wordt gestript.
const hangend = parseClientExport(
  "zt.csv",
  `${EDGE_HEADER};Geselecteerde ZorgVraagType\n1;Man;30;TGC Tilburg;15-01-2026;;;Nee;;;ZT05 -`,
);
check("zorgvraagtype zonder omschrijving: code gestript", hangend.records[0]?.zorgvraagtype, "ZT05");
check("zorgvraagtype zonder omschrijving: omschrijving null", hangend.records[0]?.zorgvraagtypeOmschrijving, null);

// ---- Fixture parse ----
const fixturePath = path.join(__dirname, "fixtures/zsg-clienten-fixture.csv");
const fixture = parseClientExport("zsg-clienten-fixture.csv", fs.readFileSync(fixturePath, "utf8"));

check("fixture ok", fixture.ok, true);
check("fixture records", fixture.records.length, 12);
check("fixture totalRows", fixture.totalRows, 14);
check("fixture skipped (dubbele id + zonder id)", fixture.skippedRows, 2);
check("fixture warnings", fixture.warnings.length, 3);

const record2 = fixture.records.find((r) => r.id === "2");
check("plaats genormaliseerd (TILBURG → Tilburg)", record2?.plaats, "Tilburg");
check("vestiging genormaliseerd (TGC Tilburg → Tilburg)", record2?.vestiging, "Tilburg");
const record8 = fixture.records.find((r) => r.id === "8");
check("huidige RB wint van multi-value regiebehandelaar", record8?.regiebehandelaar, "Rita Boss");
check("zorgvraagtype ingekort", record8?.zorgvraagtype, "ZT03");
const record6 = fixture.records.find((r) => r.id === "6");
check("wachtlijstlabels gesplitst", record6?.wachtlijstLabels, ["Intake (na screening)"]);
check("lege behandelaar → null", record6?.behandelaar, null);
const record14 = fixture.records.find((r) => r.id === "14");
check("onleesbare datum → null", record14?.episodeStart, null);

// ---- Fixture snapshot (Alle locaties) ----
const state = { fileName: "fixture.csv", importedAt: "2026-07-14T09:00:00.000Z", records: fixture.records };
const snap = computeProductionSnapshot(state, { locatie: "Alle locaties" }, REFERENCE);

check("actief nu", snap.cockpitKpis.actief.value, 8);
check("actief vorige maand", snap.cockpitKpis.actief.prev, 8);
check("aanmeldingen juni", snap.cockpitKpis.aanmeldingen.value, 5);
check("aanmeldingen mei", snap.cockpitKpis.aanmeldingen.prev, 1);
check("gesloten juni", snap.cockpitKpis.gesloten.value, 1);
check("gesloten mei", snap.cockpitKpis.gesloten.prev, 1);
check("outreach (S04)", snap.cockpitKpis.outreach.value, 2);
check("dossiers niet compleet", snap.cockpitKpis.dossiersnc.value, 1);
check("dossiersnc geen historie", snap.cockpitKpis.dossiersnc.prev, null);
check("caseload spark laatste punt", snap.cockpitKpis.actief.spark[11], 8);
check("monthly lengte", snap.monthly.length, 12);
check("monthly laatste maand", snap.monthly[11].key, "2026-06");
check("monthly labels", snap.monthly[11].m, "jun");

check("patiënten wachtlijst intake", snap.patientenMetrics["Wachtlijst intake"].value, 2);
check("patiënten wachtlijst behandeling", snap.patientenMetrics["Wachtlijst behandeling"].value, 1);
check("patiënten zonder behandelaar", snap.patientenMetrics["Zonder behandelaar"].value, 1);
check("patiënten actief", snap.patientenMetrics["Actieve patiënten"].value, 8);

check("gem. wachttijd huidig kwartaal", snap.gemWachttijdWkn.value, 3.1);
check("gem. wachttijd vorig kwartaal", snap.gemWachttijdWkn.prev, 2.7);
check("gem. wachttijd draagt kwartaal-label", snap.gemWachttijdWkn.prevLabel, "vorig kwartaal");
check("gem. wachttijd heeft data", snap.gemWachttijdWkn.noData, false);

// Maand-KPI's dragen het venster in de subtekst ("juni · vorige maand …").
check("aanmeldingen windowLabel", snap.cockpitKpis.aanmeldingen.windowLabel, "juni");
check("gesloten windowLabel", snap.cockpitKpis.gesloten.windowLabel, "juni");
check("actief zonder windowLabel (peildatum)", snap.cockpitKpis.actief.windowLabel, undefined);
check("patiënten nieuwe windowLabel", snap.patientenMetrics["Nieuwe patiënten"].windowLabel, "juni");

check(
  "treek intake per locatie",
  snap.treekLocaties.map((row) => [row.loc, row.intake]),
  [
    ["Tilburg", 3.3],
    ["Breda", 2],
    ["Roermond", 4],
  ],
);
check(
  "treek behandeling (alleen Roermond heeft wachtenden)",
  snap.treekLocaties.map((row) => row.behandeling),
  [null, null, 19.3],
);
check(
  "treek venster: Tilburg kwartaal, Breda/Roermond 12-mnds terugval",
  snap.treekLocaties.map((row) => row.intakeVenster),
  ["kwartaal", "12mnd", "12mnd"],
);

check(
  "behandelaren caseloads",
  snap.behandelaren.map((row) => [row.naam, row.caseload]),
  [
    ["Anna Jansen", 5],
    ["Bea Smit", 1],
    ["Carla Prak", 1],
  ],
);
// Directe tijd Anna: 600+300+2000+400+250 = 3550 min ≈ 59 u (actieve cliënten 1,2,8,10,13).
check("behandelaar directe tijd (uren)", snap.behandelaren[0].directeTijdUren, 59);
check(
  "regiebehandelaren",
  snap.regiebehandelaren.map((row) => [row.naam, row.clienten]),
  [
    ["Rita Boss", 6],
    ["Rob Regie", 2],
  ],
);
check(
  "afsluitingen juni per medewerker",
  snap.dossiersProductie.medewerkers.map((row) => [row.naam, row.afsluitingen]),
  [
    ["Anna Jansen", 0],
    ["Bea Smit", 1],
    ["Carla Prak", 0],
  ],
);

check("diagnose top", snap.dossiersProductie.diagnoseGroepen[0], { label: "Depressieve stoornissen", aantal: 2 });
check(
  "geen-diagnose-bucket als laatste",
  snap.dossiersProductie.diagnoseGroepen[snap.dossiersProductie.diagnoseGroepen.length - 1],
  { label: "Geen diagnose geregistreerd", aantal: 1 },
);
check(
  "geslacht",
  snap.dossiersProductie.geslacht.map((item) => [item.name, item.value]),
  [
    ["Vrouw", 3],
    ["Man", 5],
  ],
);
check(
  "leeftijdsgroepen",
  snap.dossiersProductie.leeftijdGroepen.map((groep) => groep.aantal),
  [0, 2, 4, 2, 0],
);
check("verwijzer label uit haakjes", snap.dossiersProductie.verwijzers[0].label, "Huisartsenpraktijk Fixture");
check("verwijzer aantal (12 mnd)", snap.dossiersProductie.verwijzers[0].aantal, 11);

check("wachtlijst totaal", snap.dossiersProductie.wachtlijst.totaal, 3);
check("wachtlijst urgent (>60 dgn)", snap.dossiersProductie.wachtlijst.urgent, 1);
check(
  "wachtduur-buckets",
  snap.dossiersProductie.wachtlijst.buckets.map((bucket) => bucket.aantal),
  [1, 1, 0, 1],
);
// Cliënt 7 (pre-wachtlijst) heeft geen vestiging: de "Onbekend"-bucket laat de
// locatiebalken weer optellen tot "Totaal wachtend" (3).
check("wachtlijst per locatie", snap.dossiersProductie.wachtlijst.perLocatie, [
  { label: "Tilburg", aantal: 1 },
  { label: "Breda", aantal: 0 },
  { label: "Roermond", aantal: 1 },
  { label: "Onbekend", aantal: 1 },
]);
check(
  "wachtlijst per locatie telt op tot totaal",
  snap.dossiersProductie.wachtlijst.perLocatie.reduce((sum, groep) => sum + groep.aantal, 0),
  snap.dossiersProductie.wachtlijst.totaal,
);

// ---- Nieuwe extracties (zorgvraagtypering, behandelduur, comorbiditeit, e.d.) ----
check("zorgvraagtypes verdeling (code · omschrijvingsstaart)", snap.dossiersProductie.zorgvraagtypes, [
  { label: "ZT03 · matige problematiek", aantal: 2 },
  { label: "ZT07 · aanhoudend en/of zeer beperkend", aantal: 2 },
  { label: "ZT04 · ernstige problematiek", aantal: 1 },
  { label: "ZT05 · zeer ernstige problematiek", aantal: 1 },
  { label: "ZT02 · lichte problematiek met grotere zorgvraag", aantal: 1 },
  { label: "Geen typering geregistreerd", aantal: 1 },
]);
check("behandelduur afgesloten", snap.dossiersProductie.behandelduur.afgesloten, 2);
check("behandelduur gemiddeld (23+99)/2", snap.dossiersProductie.behandelduur.gemDagen, 61);
check("behandelduur mediaan", snap.dossiersProductie.behandelduur.mediaanDagen, 61);
check(
  "behandelduur buckets",
  snap.dossiersProductie.behandelduur.buckets.map((bucket) => bucket.aantal),
  [1, 0, 0, 1, 0],
);
check("comorbiditeit aantal (cliënt 5)", snap.dossiersProductie.comorbiditeit, { aantal: 1, pct: 13 });

// ---- Groep 1: trends ----
check(
  "verwijzingen per maand (vraagkant)",
  snap.monthly.map((punt) => punt.verwijzingen),
  [0, 0, 0, 0, 0, 0, 2, 1, 1, 0, 5, 3],
);
check(
  "wachttijd-trend per startmaand [n, mediaan]",
  snap.wachttijdTrend.map((maand) => [maand.n, maand.mediaanDagen]),
  [
    [0, null],
    [0, null],
    [0, null],
    [0, null],
    [0, null],
    [0, null],
    [1, 14],
    [1, 14],
    [1, 28],
    [1, 28],
    [1, 14],
    [5, 28],
  ],
);
check("behandelduur per kwartaal (4 volledige kwartalen)", snap.dossiersProductie.behandelduur.perKwartaal, [
  { label: "Q3 '25", n: 0, mediaanDagen: null },
  { label: "Q4 '25", n: 0, mediaanDagen: null },
  { label: "Q1 '26", n: 0, mediaanDagen: null },
  { label: "Q2 '26", n: 2, mediaanDagen: 61 },
]);
check(
  "behandelduur uitvalsignalen",
  [snap.dossiersProductie.behandelduur.zonderRegistratie, snap.dossiersProductie.behandelduur.churn14],
  [0, 0],
);
check(
  "cockpitSummary bevat netto groei",
  snap.cockpitSummary.find((item) => item.label.startsWith("Netto groei"))?.value,
  "+4",
);
check(
  "capaciteits-insight (netto + doorstroom)",
  snap.cockpitInsights[3].includes("Netto groei in juni: +4") && snap.cockpitInsights[3].includes("12,5%"),
  true,
);

// ---- Groep 2: demo→live vervangingen ----
check(
  "zorgvorm = setting-verdeling",
  snap.zorgvorm.map((item) => [item.name, item.value]),
  [
    ["Ambulant (S03)", 6],
    ["Outreachend (S04)", 2],
  ],
);
check("geen-registratie-proxy >30 (gesleuteld op demo-label)", snap.patientenMetrics[">30 dgn geen contact"], {
  label: ">30 dgn geen registratie",
  value: 0,
  prev: null,
  f: "int",
  betterLow: true,
});
check("hoog-risico vervangt Crisiscliënten", snap.patientenMetrics.Crisiscliënten, {
  label: "Hoog-risico (ZT05/ZT08)",
  value: 1,
  prev: null,
  f: "int",
  betterLow: true,
});
check("productie-uren cumulatief", snap.dossiersProductie.metrics["Productie-uren"].value, 101);
check("productie-uren venster-label", snap.dossiersProductie.metrics["Productie-uren"].windowLabel, "cumulatief");
check("kwaliteit dossierscore = compliance/10", snap.kwaliteitDossierscore.value, 8.8);
// Elke productie-weergavenaam heeft een expliciete provenance-entry (badge mag
// nooit stil op de demo-fallback terugvallen).
check(
  "productie-labels patiënten zijn geregistreerd",
  Object.values(snap.patientenMetrics)
    .map((metric) => metric.label)
    .filter((label) => !(label in CAREON_PROVENANCE.patienten.widgets)),
  [],
);

// ---- Groep 3: extra controles + datakwaliteit ----
check(
  "controles 6-8 (COV, AGB, afgesloten zonder diagnose)",
  snap.dossiercontrole.checks.slice(5).map((row) => [row.check, row.n]),
  [
    ["COV-check ontbreekt of polis verlopen", 8],
    ["Verwijzer zonder AGB-code", 7],
    ["Afgesloten zonder primaire diagnose", 1],
  ],
);
check(
  "datakwaliteit vulgraad (vestiging, diagnose)",
  snap.datakwaliteit
    .filter((rij) => rij.veld === "Vestiging" || rij.veld === "Primaire diagnose")
    .map((rij) => [rij.veld, rij.gevuld, rij.totaal]),
  [
    ["Vestiging", 11, 12],
    ["Primaire diagnose", 8, 12],
  ],
);
check("wachtlijst fases (meest gevorderde fase per wachtende)", snap.dossiersProductie.wachtlijst.fases, [
  { label: "Behandeling", aantal: 1 },
  { label: "Intake", aantal: 1 },
  { label: "Screening", aantal: 1 },
]);
check("wachtlijst talen (fixture heeft geen taaltags)", snap.dossiersProductie.wachtlijst.talen, []);
check(
  "dossiercontrole nieuwe checks (admin onvolledig 0, afwijkende typering 1)",
  snap.dossiercontrole.checks.slice(3, 5).map((row) => [row.check, row.n]),
  [
    ["Administratief onvolledig (geen vestiging, RB én behandelaar)", 0],
    ["Typering wijkt af van HoNOS-advies", 1],
  ],
);
check(
  "insight noemt meest gestelde specifieke diagnose",
  snap.dossiersProductie.insights[0].includes('meest gesteld: "Depressieve stoornis: eenmalige episode - matig"'),
  true,
);
check("compliance ongewijzigd door nieuwe checks", snap.dossiercontrole.compliancePct, 87.5);

// AGB-groepering: zelfde AGB-code met verschillende praktijknaam-spellingen is
// één verwijzer; de meest voorkomende naam wint als label.
const agbParse = parseClientExport(
  "agb.csv",
  `${EDGE_HEADER};AGB code verwijzer\n1;Man;30;TGC Tilburg;15-01-2026;;01-06-2026;Nee;A. Arts (Praktijk Alfa);;01000001\n2;Vrouw;40;TGC Breda;10-02-2026;;05-06-2026;Nee;A. Arts (Praktijk Alpha);;01000001\n3;Man;50;TGC Tilburg;12-03-2026;;01-06-2026;Nee;A. Arts (Praktijk Alfa);;01000001\n4;Vrouw;60;TGC Tilburg;12-03-2026;;01-06-2026;Nee;B. Arts (Praktijk Beta);;01000002`,
);
const agbSnap = computeProductionSnapshot(
  { fileName: "agb.csv", importedAt: "2026-07-14T09:00:00.000Z", records: agbParse.records },
  { locatie: "Alle locaties" },
  REFERENCE,
);
check("AGB-groepering: naamvarianten samengevoegd, modale naam wint", agbSnap.dossiersProductie.verwijzers, [
  { label: "Praktijk Alfa", aantal: 3 },
  { label: "Praktijk Beta", aantal: 1 },
]);

check("signaleringen aantal", snap.signaleringen.length, 4);
check(
  "signalering titels",
  snap.signaleringen.map((alert) => alert.titel),
  ["Wachtenden >60 dagen", "Geen primaire diagnose", "Zonder behandelaar", "Geen zorgvraagtypering"],
);
check("kritieke signaleringen", snap.signaleringen.filter((alert) => alert.sev === "kritiek").length, 0);

check("dossiercontrole gecontroleerd", snap.dossiercontrole.gecontroleerd, 8);
check("dossiercontrole niet compleet", snap.dossiercontrole.nietCompleet, 1);
check("dossiercontrole compliance", snap.dossiercontrole.compliancePct, 87.5);

// ---- AI-assistent feitenblad (productie-grounding) ----
const factsRaw = buildProductionAssistantFacts(snap, { periode: "12m", locatie: "Alle locaties", team: "Alle teams" });
const facts = JSON.parse(factsRaw) as Record<string, unknown> & {
  kernKpis: { patienten: { label: string; waarde: number }[] };
  wachttijdTrend: unknown[];
  databron: string;
};
check("feitenblad noemt de databron", facts.databron.includes("fixture.csv"), true);
check(
  "feitenblad bevat actieve patiënten",
  facts.kernKpis.patienten.find((m) => m.label === "Actieve patiënten")?.waarde,
  8,
);
check("feitenblad bevat 12 maanden wachttijdtrend", facts.wachttijdTrend.length, 12);
// Privacy: uitsluitend aggregaten naar de AI-dienst — geen cliëntniveau-rijen,
// dossierlinks of cliëntlabels uit de risicolijst.
check("feitenblad zonder risicolijst", factsRaw.includes("risicoLijst"), false);
check("feitenblad zonder dossierlinks", factsRaw.includes("dossierUrl"), false);
check("feitenblad zonder cliëntlabels", factsRaw.includes("Cliënt "), false);
check("feitenblad past binnen het context-budget van de route", factsRaw.length < 24000, true);

// ---- Locatiefilter: echt filteren, niet schalen ----
const snapTilburg = computeProductionSnapshot(state, { locatie: "Tilburg" }, REFERENCE);
check("Tilburg actief", snapTilburg.cockpitKpis.actief.value, 6);
check("Tilburg treek alleen Tilburg", snapTilburg.treekLocaties.length, 1);
check("Tilburg wachtlijst per locatie", snapTilburg.dossiersProductie.wachtlijst.perLocatie, [
  { label: "Tilburg", aantal: 1 },
]);
// Fixture: de enige cliënt zonder vestiging (7) is niet actief → 0.
check("meta zonderVestiging (fixture)", snapTilburg.meta.zonderVestiging, 0);

// ---- Degeneraat: locatiefilter zonder records mag geen misleidende cijfers geven ----
const snapLeeg = computeProductionSnapshot(state, { locatie: "Nergens" }, REFERENCE);
check("leeg filter: actief 0", snapLeeg.cockpitKpis.actief.value, 0);
check("leeg filter: compliance 0 (niet 100)", snapLeeg.dossiercontrole.compliancePct, 0);
check(
  "leeg filter: instroom-insight zonder 'steeg van 0 naar 0'",
  snapLeeg.cockpitInsights[0].includes("bleef stabiel"),
  true,
);
check("leeg filter: gem. wachttijd gemarkeerd als geen meting", snapLeeg.gemWachttijdWkn.noData, true);

// ---- Provenance registry ----
check("provenance cockpit actief live", widgetSource("cockpit", "Actieve patiënten"), "live");
check("provenance cockpit noshow demo", widgetSource("cockpit", "No-show"), "demo");
check("provenance outreach proxy", widgetSource("cockpit", "Outreachende cliënten"), "proxy");
check("provenance onbekende widget → demo", widgetSource("cockpit", "Bestaat niet"), "demo");
check("provenance hr alles demo", pageLiveCounts("hr").live, 0);
const cockpitCounts = pageLiveCounts("cockpit");
check("provenance cockpit telling", [cockpitCounts.live, cockpitCounts.total], [10, 17]);

// ---- Drift-bewaking: widget-sleutels zijn vrije strings; deze checks maken
// een hernoemd KPI-label of alert-titel zonder bijgewerkt provenance-register
// (of andersom) een testfout in plaats van een stil verkeerde badge. ----
const metricLabelSets: [string, { label: string }[]][] = [
  ["patienten", PATIENTEN_METRICS],
  ["planning", PLANNING_METRICS],
  ["financieel", FINANCIEEL_METRICS],
  ["hr", HR_METRICS],
  ["kwaliteit", KWALITEIT_COUNTERS],
  ["dossiersProductie", DOSSIERS_PRODUCTIE_METRICS],
];
for (const [pageId, metrics] of metricLabelSets) {
  const registered = new Set(Object.keys(CAREON_PROVENANCE[pageId]?.widgets ?? {}));
  check(
    `provenance dekt alle KPI-labels van ${pageId}`,
    metrics.map((m) => m.label).filter((label) => !registered.has(label)),
    [],
  );
}
const cockpitRegistered = new Set(Object.keys(CAREON_PROVENANCE.cockpit.widgets));
check(
  "provenance dekt alle cockpit-KPI-labels",
  COCKPIT_KPIS.map((kpi) => kpi.label).filter((label) => !cockpitRegistered.has(label)),
  [],
);

check(
  "snapshot cockpit-ids bestaan als cockpit-KPI",
  Object.keys(snap.cockpitKpis).filter((id) => !COCKPIT_KPIS.some((kpi) => kpi.id === id)),
  [],
);
check(
  "snapshot patiënten-labels matchen demo-labels",
  Object.keys(snap.patientenMetrics).filter((label) => !PATIENTEN_METRICS.some((m) => m.label === label)),
  [],
);
check(
  "snapshot dossiers-productie-labels matchen demo-labels",
  Object.keys(snap.dossiersProductie.metrics).filter(
    (label) => !DOSSIERS_PRODUCTIE_METRICS.some((m) => m.label === label),
  ),
  [],
);

// Signaleringen: elke demo-alert-titel én elke titel die compute-snapshot kan
// produceren moet een expliciete provenance-entry hebben; live regels mogen
// nooit als "demo" geregistreerd staan (anders belanden ze dubbel op de
// pagina: als live alert én in de wacht-op-data-sectie).
const signaleringRegistered = CAREON_PROVENANCE.signaleringen.widgets;
check(
  "provenance dekt alle demo-alert-titels",
  CAREON_ALERTS.map((alert) => alert.titel).filter((titel) => !(titel in signaleringRegistered)),
  [],
);
const mogelijkeLiveTitels = [
  "Wachtlijst boven Treeknorm",
  `Caseload boven norm (>${CASELOAD_NORM})`,
  `Regiebehandelaar boven norm (>${REGIE_NORM})`,
  "Wachtenden >60 dagen",
  "Geen primaire diagnose",
  "Zonder behandelaar",
  "Geen zorgvraagtypering",
];
check(
  "live signaleringstitels zijn geregistreerd als live/proxy",
  mogelijkeLiveTitels.filter((titel) => widgetSource("signaleringen", titel) === "demo"),
  [],
);
check(
  "fixture-signaleringen dragen geregistreerde titels",
  snap.signaleringen.map((alert) => alert.titel).filter((titel) => !mogelijkeLiveTitels.includes(titel)),
  [],
);

// ---- KPI-drilldowns (handoff 08): productie-afleidingen over de fixture ----
// De detailpagina's tonen in productie de individuele records achter elk getal;
// hun tellingen moeten exact matchen met de snapshot-aggregaties die de kaart toont.
check(
  "drill: elke productie-afleiding heeft een registry-entry",
  Object.keys(PRODUCTION_DETAIL_ROWS).filter((id) => !KPI_DETAIL_BY_ID.has(id)),
  [],
);
check(
  "drill: elke afleiding heeft een live kopmetric",
  Object.keys(PRODUCTION_DETAIL_ROWS).filter((id) => productionDetailMetric(snap, id) === null),
  [],
);
const drillCounts: [string, number][] = [
  ["actief", 8],
  ["aanmeldingen", 5],
  ["gesloten", 1],
  ["outreach", 2],
  ["dossiersnc", 1],
  ["wachtlijst-intake", 2],
  ["wachtlijst-behandeling", 1],
  ["wachtlijst-totaal", 3],
  ["wachtlijst-urgent", 1],
  ["zonder-behandelaar", 1],
  ["contact30", 0],
  ["contact60", 0],
  ["crisis", 1],
  ["wachttijd", 7],
  ["dossier-compliance", 8],
];
for (const [id, expected] of drillCounts) {
  check(`drill rows ${id}`, PRODUCTION_DETAIL_ROWS[id](snap).length, expected);
}
check("drill actief telt als activeClients", PRODUCTION_DETAIL_ROWS.actief(snap).length, snap.meta.activeClients);
check(
  "drill-rijen pseudoniem + https-deeplink",
  PRODUCTION_DETAIL_ROWS.actief(snap).every(
    (row) => String(row.naam).startsWith("Cliënt ") && String(row.dossierUrl).startsWith("https://"),
  ),
  true,
);
const wachtKeys = PRODUCTION_DETAIL_ROWS["wachtlijst-totaal"](snap).map((row) => row.key);
check("drill-rijen unieke keys", new Set(wachtKeys).size, wachtKeys.length);
check(
  "drill productie-uren per behandelaar (uren desc, afsluitingen juni)",
  PRODUCTION_DETAIL_ROWS["productie-uren"](snap).map((row) => [row.naam, row.uren, row.afsluitingen]),
  [
    ["Anna Jansen", 61, 0],
    ["Carla Prak", 25, 0],
    ["Bea Smit", 16, 1],
  ],
);
check(
  "drill trend actief = caseload-reeks",
  productionDetailTrend(snap, "actief")?.values,
  snap.monthly.map((point) => point.caseload),
);
check("drill trend afwezig zonder historie (wachtlijst)", productionDetailTrend(snap, "wachtlijst-totaal"), null);

// ---- Optionele sanity-pass op de echte export (lokaal, gitignored) ----
const realPath = path.join(__dirname, "../../cli_ntendata_export--6-.csv");
if (fs.existsSync(realPath)) {
  const real = parseClientExport("cli_ntendata_export--6-.csv", fs.readFileSync(realPath, "utf8"));
  check("echt: ok", real.ok, true);
  check("echt: records", real.records.length, 959);
  check("echt: geen rijen overgeslagen", real.skippedRows, 0);

  const realSnap = computeProductionSnapshot(
    { fileName: "echt.csv", importedAt: "2026-07-14T09:00:00.000Z", records: real.records },
    { locatie: "Alle locaties" },
    REFERENCE,
  );
  check("echt: actieve cliënten", realSnap.cockpitKpis.actief.value, 767);
  check("echt: aanmeldingen juni", realSnap.cockpitKpis.aanmeldingen.value, 104);
  check("echt: gesloten juni", realSnap.cockpitKpis.gesloten.value, 39);
  check("echt: outreach S04", realSnap.cockpitKpis.outreach.value, 52);
  check("echt: wachtlijst totaal", realSnap.dossiersProductie.wachtlijst.totaal, 72);
  check("echt: zonder behandelaar", realSnap.patientenMetrics["Zonder behandelaar"].value, 27);
  check("echt: zonder diagnose (actief)", realSnap.dossiercontrole.checks[0].n, 438);
  check(
    "echt: geslacht Vrouw actief",
    realSnap.dossiersProductie.geslacht.find((item) => item.name === "Vrouw")?.value,
    474,
  );

  const realTilburg = computeProductionSnapshot(
    { fileName: "echt.csv", importedAt: "2026-07-14T09:00:00.000Z", records: real.records },
    { locatie: "Tilburg" },
    REFERENCE,
  );
  check("echt: Tilburg actief", realTilburg.cockpitKpis.actief.value, 673);
  // 767 actief − (Tilburg 673 + Roermond 51 + Breda 16) = 27 zonder (bekende) vestiging.
  check("echt: actief zonder vestiging", realTilburg.meta.zonderVestiging, 27);

  // Cliënten die zowel zonder behandelaar als >60 dagen wachtend zijn, staan
  // maar één keer in de risicolijst (geen dubbele React-keys).
  const realRisicoIds = realSnap.risicoLijst.map((rij) => rij.id);
  check("echt: risicolijst zonder dubbele rijen", new Set(realRisicoIds).size, realRisicoIds.length);

  // Nieuwe extracties — verwachtingen onafhankelijk berekend uit de ruwe CSV.
  check(
    "echt: zorgvraagtypes top-3",
    realSnap.dossiersProductie.zorgvraagtypes.slice(0, 3).map((groep) => groep.aantal),
    [112, 111, 111],
  );
  check("echt: behandelduur n", realSnap.dossiersProductie.behandelduur.afgesloten, 184);
  check("echt: behandelduur gemiddeld", realSnap.dossiersProductie.behandelduur.gemDagen, 73);
  check("echt: behandelduur mediaan", realSnap.dossiersProductie.behandelduur.mediaanDagen, 54);
  check("echt: comorbiditeit", realSnap.dossiersProductie.comorbiditeit, { aantal: 253, pct: 33 });
  check(
    "echt: nieuwe dossiercontroles (admin 27, afwijking 48)",
    realSnap.dossiercontrole.checks.slice(3, 5).map((row) => row.n),
    [27, 48],
  );
  check("echt: taal-tags wachtenden", realSnap.dossiersProductie.wachtlijst.talen, [
    { label: "Pools", aantal: 13 },
    { label: "Nederlands", aantal: 7 },
    { label: "Engels", aantal: 5 },
    { label: "Turks", aantal: 2 },
  ]);
  check(
    "echt: wachtlijst fases tellen op tot totaal",
    realSnap.dossiersProductie.wachtlijst.fases.reduce((sum, fase) => sum + fase.aantal, 0),
    72,
  );
  check("echt: AGB-groepering grootste verwijzer", realSnap.dossiersProductie.verwijzers[0].aantal, 37);

  // Groep 1: trends (onafhankelijk berekend uit de ruwe CSV).
  check(
    "echt: verwijzingen per maand",
    realSnap.monthly.map((punt) => punt.verwijzingen),
    [4, 17, 34, 67, 126, 117, 122, 137, 143, 82, 40, 26],
  );
  check(
    "echt: wachttijd-trend laatste 6 maanden (mediaan)",
    realSnap.wachttijdTrend.slice(6).map((maand) => maand.mediaanDagen),
    [15, 24, 38, 55, 60, 42],
  );
  check(
    "echt: wachttijd-trend Treeknorm-overschrijders (12 mnd)",
    realSnap.wachttijdTrend.reduce((sum, maand) => sum + maand.overTreek, 0),
    2,
  );
  check("echt: behandelduur per kwartaal", realSnap.dossiersProductie.behandelduur.perKwartaal, [
    { label: "Q3 '25", n: 2, mediaanDagen: 17 },
    { label: "Q4 '25", n: 24, mediaanDagen: 20 },
    { label: "Q1 '26", n: 75, mediaanDagen: 51 },
    { label: "Q2 '26", n: 81, mediaanDagen: 92 },
  ]);
  check(
    "echt: uitvalsignalen (zonder registratie, churn ≤14 dgn)",
    [realSnap.dossiersProductie.behandelduur.zonderRegistratie, realSnap.dossiersProductie.behandelduur.churn14],
    [63, 27],
  );

  // Groep 2: demo→live vervangingen.
  check(
    "echt: zorgvorm setting-verdeling",
    realSnap.zorgvorm.map((item) => item.value),
    [651, 52, 64],
  );
  check("echt: >30 dgn geen registratie", realSnap.patientenMetrics[">30 dgn geen contact"].value, 65);
  check("echt: >60 dgn geen registratie", realSnap.patientenMetrics[">60 dgn geen contact"].value, 39);
  check("echt: hoog-risico ZT05/ZT08", realSnap.patientenMetrics.Crisiscliënten.value, 43);
  check("echt: productie-uren cumulatief", realSnap.dossiersProductie.metrics["Productie-uren"].value, 11645);
  check("echt: kwaliteit dossierscore", realSnap.kwaliteitDossierscore.value, 4.1);

  // Groep 3: extra controles + datakwaliteit.
  check(
    "echt: controles 6-8",
    realSnap.dossiercontrole.checks.slice(5).map((row) => row.n),
    [30, 75, 142],
  );
  check(
    "echt: datakwaliteit AGB en diagnose",
    realSnap.datakwaliteit
      .filter((rij) => rij.veld === "AGB-code verwijzer" || rij.veld === "Primaire diagnose")
      .map((rij) => rij.gevuld),
    [831, 371],
  );

  // AI-feitenblad over de echte snapshot: compleet, privacy-schoon en binnen budget.
  const realFactsRaw = buildProductionAssistantFacts(realSnap, {
    periode: "12m",
    locatie: "Alle locaties",
    team: "Alle teams",
  });
  const realFacts = JSON.parse(realFactsRaw) as { kernKpis: { cockpit: { id: string; waarde: number }[] } };
  check(
    "echt: feitenblad bevat actief 767",
    realFacts.kernKpis.cockpit.find((kpi) => kpi.id === "actief")?.waarde,
    767,
  );
  check("echt: feitenblad zonder cliëntlabels", realFactsRaw.includes("Cliënt "), false);
  check("echt: feitenblad binnen context-budget", realFactsRaw.length < 24000, true);

  // KPI-drilldowns over de echte export: tellingen matchen de kaartwaarden.
  check("echt: drill actief rows", PRODUCTION_DETAIL_ROWS.actief(realSnap).length, 767);
  check("echt: drill wachtlijst rows", PRODUCTION_DETAIL_ROWS["wachtlijst-totaal"](realSnap).length, 72);
  check("echt: drill aanmeldingen rows", PRODUCTION_DETAIL_ROWS.aanmeldingen(realSnap).length, 104);
  check(
    "echt: drill zonder-behandelaar rows",
    PRODUCTION_DETAIL_ROWS["zonder-behandelaar"](realSnap).length,
    realSnap.patientenMetrics["Zonder behandelaar"].value,
  );
} else {
  console.log("(echte export niet aanwezig — sanity-pass overgeslagen)");
}

console.log(`\nverify-production: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}

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
  hasProductionDetailRows,
  PRODUCTION_DETAIL_ROWS,
  productionAggDetail,
  productionDetailMetric,
  productionDetailTrend,
} from "../lib/careon-production/detail-rows";
import { parseAgendaExport } from "../lib/careon-production/parse-agenda";
import { parseDeclaratiesExport } from "../lib/careon-production/parse-declaraties";
import { diagnoseGroepVanCode, parseClientExport, parseDutchDate } from "../lib/careon-production/parse-export";
import { parseToeslagenExport } from "../lib/careon-production/parse-toeslagen";
import { parseVerwijzersExport } from "../lib/careon-production/parse-verwijzers";
import {
  AGENDA_PROVENANCE,
  CAREON_PROVENANCE,
  DECLARATIES_PROVENANCE,
  pageLiveCounts,
  TOESLAGEN_PROVENANCE,
  VERWIJZERS_PROVENANCE,
  widgetSource,
} from "../lib/careon-production/provenance";
import {
  isAgendaFacts,
  isDeclaratiesFacts,
  isProductionState,
  isToeslagenFacts,
  isVerwijzersFacts,
} from "../lib/careon-production/types";
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
    ["Veghel", null],
    ["Breda", 2],
    ["Roermond", 4],
  ],
);
check(
  "treek behandeling (alleen Roermond heeft wachtenden)",
  snap.treekLocaties.map((row) => row.behandeling),
  [null, null, null, 19.3],
);
check(
  "treek venster: Tilburg kwartaal, rest 12-mnds terugval (incl. Veghel)",
  snap.treekLocaties.map((row) => row.intakeVenster),
  ["kwartaal", "12mnd", "12mnd", "12mnd"],
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
  { label: "Veghel", aantal: 0 },
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
check("provenance cockpit telling", [cockpitCounts.live, cockpitCounts.total], [10, 18]);

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
  "drill: elke afleiding heeft een live kopmetric (waar de gate open staat)",
  Object.keys(PRODUCTION_DETAIL_ROWS).filter(
    (id) => hasProductionDetailRows(id, snap) && productionDetailMetric(snap, id) === null,
  ),
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

// ==== Agenda-export: parser, aggregatie en snapshot-integratie ====

const AGENDA_HEADER =
  "Soort;Behandelaar;Sessie_Naam;Afspraak_lokatie;Datum;Directe_tijd_minute(n);Indirecte_tijd_minute(n);Reistijd_minute(n);Totale_tijd_minute(n);Prijs;Client_ID;Client_naam;No_Show;Tijdig_afgezegd;Tijdig_afgezegd_Redenen;Verzekeringskoepel;Uzovi;Factuurnummer;Factuurdatum;Ondertekend;Sessieverslagen;Memo;BSN";
const agendaCsv = [
  AGENDA_HEADER,
  "Sessie;Anna Jansen;Behandeling - ONLINE;TGC Tilburg;10-06-2026;60,0;0,0;0,0;60,0;100,00;1;GEHEIMNAAM;n;n;;VGZ;7095;F001;12-06-2026;Nee;Ja;supergeheime memotekst;999999990",
  "Sessie;Anna Jansen;Intake - OP LOCATIE;TGC Tilburg;05-06-2026;60,0;0,0;0,0;60,0;200,00;2;GEHEIMNAAM2;y;n;;CZ;9664;;;Nee;Nee;;999999991",
  "Sessie;Bea Smit;Behandelplan - ONLINE;TGC Breda;20-05-2026;30,0;0,0;0,0;30,0;150,00;1;GEHEIMNAAM;n;y;Ziek;VGZ;7095;F002;25-05-2026;Nee;Ja;;999999990",
  "Blok;Anna Jansen;Afwezig;;11-06-2026;0,0;0,0;0,0;120,0;;;;n;n;;;;;;;;;",
  "Sessie;Bea Smit;Behandeling - OP LOCATIE;TGC Roermond;15-01-2026;45,0;15,0;10,0;70,0;300,00;3;GEHEIMNAAM3;n;n;;DSW;7029;;;Nee;Ja;;999999992",
  "Sessie;Bea Smit;Behandeling - ONLINE;TGC Breda;31-13-2026;30,0;0,0;0,0;30,0;;4;X;n;n;;;;;;Nee;Nee;;1",
  // RMO/RMA-sessie (koepel DSW, Uzovi 3355) — behandeld in juni maar pas op
  // 02-07 gefactureerd: bewijst behandelmaand-bucketing én de RMO/RMA-splitsing.
  "Sessie;Anna Jansen;Behandeling - OP LOCATIE;TGC Tilburg;08-06-2026;60,0;0,0;0,0;60,0;400,00;1;GEHEIMNAAM;n;n;;DSW;3355;F003;02-07-2026;Ja;Ja;;999999990",
  // Servicebureau-sessie (CZ), ook juni-behandeld en in juli gefactureerd.
  "Sessie;Bea Smit;Behandeling - ONLINE;TGC Breda;09-06-2026;60,0;0,0;0,0;60,0;250,00;3;GEHEIMNAAM3;n;n;;CZ;9664;F004;02-07-2026;Ja;Ja;;999999992",
  // Blok begin juli: schuift het bronbereik voorbij juni zodat juni de laatste
  // vólledige agenda-maand is (net als de echte export, die t/m 21-07 loopt).
  "Blok;Bea Smit;Afwezig;;05-07-2026;0,0;0,0;0,0;60,0;;;;n;n;;;;;;;;;",
  // Toekomstvenster (peildatum = 2026-07-14): geplande sessie voor cliënt 1
  // (geprijsd maar ongefactureerd — mag onderhanden werk NIET vervuilen),
  // een cliëntloos MDO-blok en een toekomstige agenda-blokkade.
  "Sessie;Anna Jansen;Behandeling - ONLINE;TGC Tilburg;20-07-2026;60,0;0,0;0,0;60,0;120,00;1;GEHEIMNAAM;n;n;;VGZ;7095;;;Nee;Nee;;999999990",
  "Sessie;Bea Smit;MDO met patient;TGC Breda;05-08-2026;60,0;0,0;0,0;60,0;;;;n;n;;;;;;Nee;Nee;;",
  "Blok;Anna Jansen;Afwezig;;21-07-2026;0,0;0,0;0,0;60,0;;;;n;n;;;;;;;;;",
].join("\n");
const agendaParse = parseAgendaExport("agenda-fixture.csv", agendaCsv, "2026-07-14T09:00:00.000Z");
check("agenda: ok", agendaParse.ok, true);
const agendaFacts = agendaParse.facts;
if (!agendaFacts) {
  throw new Error("agenda-fixture parse faalde");
}
check(
  "agenda: sessies/blok/overgeslagen",
  [agendaFacts.sessieRows, agendaFacts.blokRows, agendaFacts.skippedRows],
  [6, 2, 1],
);
check("agenda: bronbereik", [agendaFacts.bronVan, agendaFacts.bronTot], ["2026-01-15", "2026-08-05"]);
check("agenda: peildatum uit importmoment", agendaFacts.peildatum, "2026-07-14");
check(
  "agenda: toekomstvenster (2 geplande sessies, 1 cliënt)",
  [agendaFacts.toekomst?.sessies, agendaFacts.toekomst?.clienten, agendaFacts.toekomst?.tot],
  [2, 1, "2026-08-05"],
);
check(
  "agenda: geplande sessie zet volgende-datum op cliënt 1",
  agendaFacts.clienten.find((fact) => fact.id === "1")?.volgende,
  "2026-07-20",
);
check(
  "agenda: geprijsde toekomstsessie blijft buiten historische aggregaten",
  Math.round(agendaFacts.cellen.reduce((sum, cel) => sum + cel.onderhanden, 0)),
  500,
);
check(
  "agenda: BSN-kolom triggert privacy-waarschuwing",
  agendaParse.warnings.some((warning) => warning.message.includes("BSN")),
  true,
);
check(
  "agenda: onleesbare datum overgeslagen met waarschuwing",
  agendaParse.warnings.some((warning) => warning.message.includes("afspraakdatum")),
  true,
);
// Privacy-canaries: naam, memo en BSN mogen nooit in de aggregaten belanden.
const agendaJson = JSON.stringify(agendaFacts);
check("agenda: geen cliëntnamen in aggregaat", agendaJson.includes("GEHEIMNAAM"), false);
check("agenda: geen memotekst in aggregaat", agendaJson.includes("supergeheime"), false);
check("agenda: geen BSN in aggregaat", agendaJson.includes("999999990"), false);
check("agenda: guard accepteert aggregaat", isAgendaFacts(agendaFacts), true);

const juniCel = agendaFacts.cellen.find((cel) => cel.key === "2026-06" && cel.behandelaar === "Anna Jansen");
check(
  "agenda: juni-cel (sessies, noshow, online, opLocatie, verslag)",
  [juniCel?.sessies, juniCel?.noShows, juniCel?.online, juniCel?.opLocatie, juniCel?.verslagen],
  [3, 1, 1, 2, 2],
);
check("agenda: onderhanden in juni-cel (niet-gefactureerde no-show-intake)", juniCel?.onderhanden, 200);
// Facturatie op BEHANDELMAAND: de RMO/RMA- en CZ-sessies van juni zijn pas op
// 02-07 gefactureerd maar horen in de juni-bucket (klantformaat).
const factuurVgz = agendaFacts.facturatie.find((cel) => cel.key === "2026-06" && cel.koepel === "VGZ");
check(
  "agenda: factuur op behandelmaand (VGZ juni)",
  [factuurVgz?.locatie, factuurVgz?.uzovi, factuurVgz?.omzet],
  ["Tilburg", "7095", 100],
);
const factuurRmo = agendaFacts.facturatie.find((cel) => cel.uzovi === "3355");
check(
  "agenda: RMO/RMA-cel (DSW 3355, juli-factuur → juni-bucket)",
  [factuurRmo?.key, factuurRmo?.koepel, factuurRmo?.omzet],
  ["2026-06", "DSW", 400],
);
const factuurCz = agendaFacts.facturatie.find((cel) => cel.key === "2026-06" && cel.koepel === "CZ");
check("agenda: servicebureau-cel (CZ juni, juli-factuur)", [factuurCz?.locatie, factuurCz?.omzet], ["Breda", 250]);
check(
  "agenda: guard eist uzovi-veld (oude aggregaten → her-import)",
  isAgendaFacts({
    ...agendaFacts,
    facturatie: [{ key: "2026-06", locatie: null, koepel: "VGZ", omzet: 1 }],
  }),
  false,
);
const client1 = agendaFacts.clienten.find((fact) => fact.id === "1");
const client2 = agendaFacts.clienten.find((fact) => fact.id === "2");
check("agenda: contact = alleen gehouden sessies", [client1?.laatste, client1?.sessies], ["2026-06-10", 3]);
check("agenda: afgezegde behandelplan-sessie telt niet als gevoerd", client1?.behandelplan, false);
check("agenda: cliënt met alleen no-show heeft geen contactmoment", [client2?.laatste, client2?.noShows], [null, 1]);
check(
  "agenda: verkeerde kaart (cliëntendata) wordt doorverwezen",
  parseAgendaExport("clienten.csv", `${EDGE_HEADER}\n1;Man;30;TGC Tilburg;15-01-2026;;;Nee;;`).error?.includes(
    "Productie-modus",
  ),
  true,
);

// ---- Snapshot-integratie over de cliënten-fixture + agenda-fixture ----
const snapAgenda = computeProductionSnapshot(state, { locatie: "Alle locaties" }, REFERENCE, {
  agenda: agendaFacts,
});
const agendaSnap = snapAgenda.agenda;
if (!agendaSnap) {
  throw new Error("agenda-snapshot ontbreekt");
}
check(
  "agenda-snap: venster = laatste volle agenda-maand",
  [agendaSnap.meta.maandKey, agendaSnap.meta.maandLabel],
  ["2026-06", "juni"],
);
check(
  "agenda-snap: planning juni (afspraken, no-shows, geannuleerd)",
  [
    agendaSnap.planningMetrics["Afspraken deze maand"].value,
    agendaSnap.planningMetrics["No-shows"].value,
    agendaSnap.planningMetrics.Geannuleerd.value,
  ],
  [4, 1, 0],
);
check(
  "agenda-snap: uren juni (behandel, afwezig, geregistreerd)",
  [
    agendaSnap.planningMetrics.Behandeluren.value,
    agendaSnap.planningMetrics["Beschikbare uren"].value,
    agendaSnap.planningMetrics["Productieve uren"].value,
  ],
  [4, 2, 4],
);
check(
  "agenda-snap: agenda-vulling 67% (4u sessie vs 2u afwezig)",
  agendaSnap.planningMetrics["Agenda-bezetting"].value,
  67,
);
check(
  "agenda-snap: no-show juni 25%; mei zonder noemer (1 sessie, 1 afgezegd) → null",
  [snapAgenda.cockpitKpis.noshow.value, snapAgenda.cockpitKpis.noshow.prev],
  [25, null],
);
// Kanaal-splitsing per behandelmaand (klantformaat): Vecozo = VGZ + DSW-7029,
// servicebureau = overige koepels, RMO/RMA = Uzovi 3355 — juli-facturen over
// juni-werk landen in juni.
check(
  "agenda-snap: cockpit Vecozo juni/mei (VGZ, excl. RMO/RMA)",
  [
    snapAgenda.cockpitKpis.omzetverz.value,
    snapAgenda.cockpitKpis.omzetverz.prev,
    snapAgenda.cockpitKpis.omzetverz.label,
  ],
  [100, 150, "Omzet Vecozo (VGZ + DSW)"],
);
check(
  "agenda-snap: cockpit servicebureau juni (CZ, juli-factuur → juni-bucket)",
  [
    snapAgenda.cockpitKpis.omzetinfo.value,
    snapAgenda.monthly[11].omzetServicebureau,
    snapAgenda.cockpitKpis.omzetinfo.label,
  ],
  [250, 250, "Omzet servicebureau"],
);
check(
  "agenda-snap: cockpit RMO/RMA juni (DSW-3355, niet bij Vecozo)",
  [snapAgenda.cockpitKpis.omzetrmo.value, snapAgenda.monthly[11].omzetRmoRma, snapAgenda.cockpitKpis.omzetrmo.label],
  [400, 400, "Omzet RMO/RMA"],
);
check(
  "agenda-snap: maandreeks draagt no-show en totaalomzet (100+250+400)",
  [snapAgenda.monthly[11].noshowPct, snapAgenda.monthly[11].omzet],
  [25, 750],
);
check("agenda-snap: maand buiten agenda-bereik → omzet null", snapAgenda.monthly[0].omzet, null);
check(
  "agenda-snap: financieel (onderhanden 500, >90 dgn 300)",
  [agendaSnap.financieel.metrics["Onderhanden werk"].value, agendaSnap.financieel.metrics["Declaraties >90 dgn"].value],
  [500, 300],
);
check(
  "agenda-snap: financieel-kaarten Totale omzet + driedeling (juni/mei)",
  [
    agendaSnap.financieel.metrics["Totale omzet"].value,
    agendaSnap.financieel.metrics["Totale omzet"].prev,
    agendaSnap.financieel.metrics["Omzet verzekeraars"].value,
    agendaSnap.financieel.metrics["Omzet verzekeraars"].label,
    agendaSnap.financieel.metrics["Omzet Infomedics"].value,
    agendaSnap.financieel.metrics["Omzet RMO/RMA"].value,
  ],
  [750, 150, 100, "Omzet Vecozo (VGZ + DSW)", 250, 400],
);
// Verwachte uitbetaling (65%-regel klant; RMO/RMA 100%) als tweede kaartwaarde.
check(
  "agenda-snap: verwacht uitbetaald (65% Vecozo/SB, 100% RMO, totaal 0,65×350+400)",
  [
    agendaSnap.financieel.metrics["Omzet verzekeraars"].secondary?.value,
    agendaSnap.financieel.metrics["Omzet Infomedics"].secondary?.value,
    agendaSnap.financieel.metrics["Omzet RMO/RMA"].secondary?.value,
    agendaSnap.financieel.metrics["Totale omzet"].secondary?.value,
    agendaSnap.financieel.metrics["Totale omzet"].secondary?.label,
    snapAgenda.cockpitKpis.omzetverz.secondary?.value,
  ],
  [65, 163, 400, 628, "Verwacht uitbetaald (65% · RMO/RMA 100%)", 65],
);
check(
  "agenda-snap: omzet per verzekeraar (12 mnd, RMO/RMA als eigen groep)",
  agendaSnap.financieel.omzetPerVerzekeraar,
  [
    { label: "RMO/RMA", aantal: 400 },
    { label: "VGZ", aantal: 250 },
    { label: "CZ", aantal: 250 },
  ],
);
check("agenda-snap: omzet per locatie", agendaSnap.financieel.omzetPerLocatie, [
  { label: "Tilburg", aantal: 500 },
  { label: "Breda", aantal: 400 },
]);
// Tijdvenster-bron: behandelmaand × groep / behandelmaand × vestiging — de
// financieel-kaarten hersommeren dit voor de gekozen venster-toggle.
check("agenda-snap: omzet maand × koepel (tijdvenster-bron)", agendaSnap.financieel.omzetKoepelMaand, [
  { key: "2026-05", koepel: "VGZ", omzet: 150 },
  { key: "2026-06", koepel: "VGZ", omzet: 100 },
  { key: "2026-06", koepel: "RMO/RMA", omzet: 400 },
  { key: "2026-06", koepel: "CZ", omzet: 250 },
]);
check("agenda-snap: omzet maand × vestiging (tijdvenster-bron)", agendaSnap.financieel.omzetLocatieMaand, [
  { key: "2026-05", loc: "Breda", omzet: 150 },
  { key: "2026-06", loc: "Tilburg", omzet: 500 },
  { key: "2026-06", loc: "Breda", omzet: 250 },
]);
check(
  "agenda-snap: ouderdom onderhanden (binnen 30 = 200, >90 = 300)",
  agendaSnap.financieel.onderhandenOuderdom.map((bucket) => bucket.bedrag),
  [200, 0, 0, 300],
);
// Contact: het toekomstvenster tilt bronTot voorbij de referentiedatum, dus
// contact wordt op de referentiedatum zelf (14-07) gemeten — alle zes de
// actieve niet-wachtende fixture-cliënten zitten dan boven de 30 dagen;
// alleen cliënt 8 (start 15-04) boven de 60.
check("agenda-snap: echte contact-tellingen", agendaSnap.contact, { z30: 6, z60: 1 });
check("agenda-snap: patiënten-metric >30 dgn wordt echt contact", snapAgenda.patientenMetrics[">30 dgn geen contact"], {
  label: ">30 dgn geen contact",
  value: 6,
  prev: null,
  f: "int",
  betterLow: true,
});
check(
  "agenda-snap: dossiercontrole agenda-checks toegevoegd",
  snapAgenda.dossiercontrole.checks.slice(-2).map((row) => [row.check, row.n]),
  [
    ["Sessie zonder sessieverslag (agenda)", 1],
    ["Sessie niet ondertekend (agenda)", 4],
  ],
);
check(
  "agenda-snap: signalering zonder behandelplan (alle zes >30 dgn open)",
  snapAgenda.signaleringen.find((alert) => alert.titel === "Dossiers zonder behandelplan")?.n,
  6,
);
check(
  "agenda-snap: signalering niet-gefactureerd >90 dgn",
  snapAgenda.signaleringen.find((alert) => alert.titel === "Sessies >90 dgn niet gefactureerd")?.n,
  1,
);
check(
  "agenda-snap: geen no-show-alert onder de 20-sessies-drempel",
  snapAgenda.signaleringen.some((alert) => alert.titel === "No-show >5% per behandelaar"),
  false,
);

// ---- Vooruitblik (toekomstvenster) ----
const vooruitblik = agendaSnap.vooruitblik;
if (!vooruitblik) {
  throw new Error("vooruitblik ontbreekt ondanks toekomstvenster");
}
check("vooruitblik: peildatum + bereik", [vooruitblik.peildatum, vooruitblik.tot], ["2026-07-14", "2026-08-05"]);
check("vooruitblik: geplande sessies (alle locaties)", vooruitblik.sessies, 2);
check(
  "vooruitblik: maanden (jul 1, aug 1)",
  vooruitblik.maanden.map((maand) => [maand.key, maand.sessies, maand.uren]),
  [
    ["2026-07", 1, 1],
    ["2026-08", 1, 1],
  ],
);
// Cliënt 1 heeft een geplande afspraak; de overige vijf actieve niet-wachtende
// fixture-cliënten niet — en allemaal zitten ze ook al >30 dagen zonder contact.
check("vooruitblik: zonder vervolgafspraak", [vooruitblik.zonderVervolg, vooruitblik.zonderVervolgEnContact], [5, 5]);
check("vooruitblik: cockpit-KPI zondervervolg", snapAgenda.cockpitKpis.zondervervolg.value, 5);
check("vooruitblik: patiënten-metric", snapAgenda.patientenMetrics["Zonder vervolgafspraak"].value, 5);
check(
  "vooruitblik: signalering zonder vervolgafspraak",
  snapAgenda.signaleringen.find((alert) => alert.titel === "Zonder vervolgafspraak")?.n,
  5,
);
check(
  "vooruitblik: géén 'Geen evaluatie gepland' (MDO-blokken zijn cliëntloos)",
  snapAgenda.signaleringen.some((alert) => alert.titel === "Geen evaluatie gepland"),
  false,
);
check("vooruitblik: drill zondervervolg volgt de telling", PRODUCTION_DETAIL_ROWS.zondervervolg(snapAgenda).length, 5);
check(
  "vooruitblik: drilldown-gate vereist toekomstvenster",
  [hasProductionDetailRows("zondervervolg", snapAgenda), hasProductionDetailRows("zondervervolg", snap)],
  [true, false],
);
check(
  "vooruitblik: provenance flipt alleen mét toekomstvenster",
  [
    widgetSource("cockpit", "Zonder vervolgafspraak", { agenda: true }),
    widgetSource("cockpit", "Zonder vervolgafspraak", { agenda: true, agendaToekomst: true }),
    widgetSource("signaleringen", "Zonder vervolgafspraak", { agenda: true, agendaToekomst: true }),
    widgetSource("signaleringen", "Geen evaluatie gepland", { agenda: true, agendaToekomst: true }),
  ],
  ["demo", "live", "live", "demo"],
);
check("agenda-snap: behandelaarstats Anna (12 mnd)", agendaSnap.behandelaarStats["Anna Jansen"], {
  sessies: 3,
  noShowPct: null,
  directeUren: 3,
  totaleUren: 3,
  omzet: 700,
});
check(
  "agenda-snap: drill contact30 volgt agenda-telling",
  PRODUCTION_DETAIL_ROWS.contact30(snapAgenda).length,
  agendaSnap.contact.z30,
);
// Locatiefilter over agenda-aggregaten.
const snapAgendaBreda = computeProductionSnapshot(state, { locatie: "Breda" }, REFERENCE, { agenda: agendaFacts });
if (!snapAgendaBreda.agenda) {
  throw new Error("Breda-agenda-snapshot ontbreekt");
}
const bredaPlanning = snapAgendaBreda.agenda.planningMetrics;
check(
  "agenda-snap: Breda-filter (juni-CZ-sessie + mei-afzegging)",
  [bredaPlanning["Afspraken deze maand"].value, bredaPlanning.Geannuleerd.prev],
  [1, 1],
);

// ---- Provenance-overlay: badges volgen de aanwezige exports ----
check(
  "overlay: planning-sleutels bestaan in het basisregister",
  Object.keys(AGENDA_PROVENANCE.planning).filter((key) => !(key in CAREON_PROVENANCE.planning.widgets)),
  [],
);
check(
  "overlay: financieel-sleutels bestaan in het basisregister",
  Object.keys(AGENDA_PROVENANCE.financieel).filter((key) => !(key in CAREON_PROVENANCE.financieel.widgets)),
  [],
);
check(
  "overlay: cockpit-sleutels bestaan in het basisregister",
  Object.keys(AGENDA_PROVENANCE.cockpit).filter((key) => !(key in CAREON_PROVENANCE.cockpit.widgets)),
  [],
);
check(
  "overlay: no-show demo → live met agenda",
  [widgetSource("cockpit", "No-show"), widgetSource("cockpit", "No-show", { agenda: true })],
  ["demo", "live"],
);
check(
  "overlay: planning telling zonder/met agenda",
  [pageLiveCounts("planning").live, pageLiveCounts("planning", { agenda: true }).live],
  [1, 12],
);
check(
  "overlay: financieel telling zonder/met agenda/met declaraties",
  [
    pageLiveCounts("financieel").live,
    pageLiveCounts("financieel", { agenda: true }).live,
    pageLiveCounts("financieel", { agenda: true, declaraties: true }).live,
  ],
  [0, 12, 14],
);
check(
  "overlay: agenda-signaleringstitels niet langer demo",
  [
    "Geen contact >60 dagen",
    "No-show >5% per behandelaar",
    "Dossiers zonder behandelplan",
    "Sessies >90 dgn niet gefactureerd",
  ].filter((titel) => widgetSource("signaleringen", titel, { agenda: true, agendaToekomst: true }) === "demo"),
  [],
);
check(
  "overlay: verwijzers-sleutel geregistreerd",
  widgetSource("dossiersProductie", "Verwijsnetwerk", { verwijzers: true }),
  "live",
);
check(
  "agenda-snap: gefabriceerde signaleringstitels zijn geregistreerd (geen stille demo-badge)",
  snapAgenda.signaleringen
    .map((alert) => alert.titel)
    .filter((titel) => widgetSource("signaleringen", titel, { agenda: true, agendaToekomst: true }) === "demo"),
  [],
);

// ==== Verwijzers-export: parser en netwerk ====
const verwijzersCsv = [
  "Cliënt ID;Cliënt Code;Naam;Rol;Code;AGB Code;Zorgmail;e-mail;Postcode;Plaats",
  "1;X;A. Arts (HAP Fixture);Huisarts;1;01000001;Ja;geheim@lms.example;1234 AB;Tilburg",
  "2;Y;A. Arts (Huisartsenpraktijk Fixture);Huisarts;1;01000001;Nee;;;Tilburg",
  "2;Y;B. Arts (Praktijk B);Psycholoog;2;01000002;Nee;;;Breda",
  ";Z;C. Arts;;;;;;;",
].join("\n");
const verwijzersParse = parseVerwijzersExport("verwijzers-fixture.csv", verwijzersCsv, "2026-07-14T09:00:00.000Z");
check("verwijzers: ok", verwijzersParse.ok, true);
const verwijzersFacts = verwijzersParse.facts;
if (!verwijzersFacts) {
  throw new Error("verwijzers-fixture parse faalde");
}
check("verwijzers: AGB groepeert naamvarianten", verwijzersFacts.contacten.length, 2);
check(
  "verwijzers: grootste contact (2 cliënten, zorgmail via één rij)",
  [verwijzersFacts.contacten[0].clienten, verwijzersFacts.contacten[0].zorgmail, verwijzersFacts.contacten[0].plaats],
  [2, true, "Tilburg"],
);
check(
  "verwijzers: rijen zonder id overgeslagen met waarschuwing",
  verwijzersParse.warnings.some((warning) => warning.message.includes("overgeslagen")),
  true,
);
check("verwijzers: geen e-mailadressen in aggregaat", JSON.stringify(verwijzersFacts).includes("geheim@"), false);
check("verwijzers: guard accepteert aggregaat", isVerwijzersFacts(verwijzersFacts), true);
check(
  "verwijzers: verkeerde kaart (agenda) wordt doorverwezen",
  parseVerwijzersExport("agenda.csv", agendaCsv).error?.includes("agenda-export"),
  true,
);

const snapNetwerk = computeProductionSnapshot(state, { locatie: "Alle locaties" }, REFERENCE, {
  verwijzers: verwijzersFacts,
});
check("netwerk: zorgmail-percentage", snapNetwerk.verwijzerNetwerk?.zorgmailPct, 50);
check("netwerk: plaatsen gewogen op cliënten", snapNetwerk.verwijzerNetwerk?.plaatsen, [
  { label: "Tilburg", aantal: 2 },
  { label: "Breda", aantal: 1 },
]);
check("netwerk: zonder agenda blijft agenda-snapshot leeg", snapNetwerk.agenda, null);
check("netwerk: VERWIJZERS_PROVENANCE alleen dossiersProductie", Object.keys(VERWIJZERS_PROVENANCE), [
  "dossiersProductie",
]);

// ==== Toeslagen-export (declared surcharges): parser en omzet-merge ====

const toeslagenCsv = [
  'Cliënt;Instelling;"Zorgtraject startdatum";Verzekeringskoepel;Uzovi;Afspraakdatum;Starttijd;Eindtijd;Sessietype;"Directe tijd";"Indirecte tijd";Code;Omschrijving;Prijs;Factuurnummer;Factuurdatum',
  '"GEHEIM PERSOON";TGC;01-05-2026;VGZ;7095;10-06-2026;10:00;11:00;Behandeling;60;0;TC0010;"Toeslag reistijd vanaf 25 minuten - ggz";93,85;F001;12-06-2026',
  '"GEHEIM PERSOON";TGC;01-05-2026;VGZ;7095;10-06-2026;10:00;11:00;Behandeling;60;0;TC0008;"Toeslag inzet tolk 120 minuten";274,86;F001;12-06-2026',
  '"ANDER MENS";TGC;01-04-2026;CZ;9664;20-05-2026;09:00;10:00;Intake;60;0;TC0010;"Toeslag reistijd vanaf 25 minuten - ggz";93,85;F002;25-05-2026',
  '"KAPOTTE RIJ";TGC;01-04-2026;CZ;9664;20-05-2026;09:00;10:00;Intake;60;0;TC0010;"Zonder prijs";;F003;25-05-2026',
].join("\n");
const toeslagenParse = parseToeslagenExport("toeslagen-fixture.csv", toeslagenCsv, "2026-07-14T09:00:00.000Z");
check("toeslagen: ok", toeslagenParse.ok, true);
const toeslagenFixture = toeslagenParse.facts;
if (!toeslagenFixture) {
  throw new Error("toeslagen-fixture parse faalde");
}
check("toeslagen: rijen/overgeslagen", [toeslagenFixture.totalRows, toeslagenFixture.skippedRows], [4, 1]);
check(
  "toeslagen: cliënten geteld, namen nooit bewaard",
  [toeslagenFixture.clienten, toeslagenFixture.tolkClienten],
  [2, 1],
);
check("toeslagen: privacy-canary", JSON.stringify(toeslagenFixture).includes("GEHEIM"), false);
check("toeslagen: guard accepteert aggregaat", isToeslagenFacts(toeslagenFixture), true);
check(
  "toeslagen: perCode gesorteerd op omzet (tolk boven reistijd)",
  toeslagenFixture.perCode.map((groep) => [groep.code, Math.round(groep.omzet), groep.aantal, groep.clienten]),
  [
    ["TC0008", 275, 1, 1],
    ["TC0010", 188, 2, 2],
  ],
);
check(
  "toeslagen: cel op factuurmaand",
  toeslagenFixture.cellen.find((cel) => cel.key === "2026-06" && cel.code === "TC0010")?.omzet,
  93.85,
);
check(
  "toeslagen: verkeerde kaart (agenda) doorverwezen",
  parseToeslagenExport("agenda.csv", agendaCsv).error?.includes("agenda-export"),
  true,
);

// ---- Toeslagen blijven BUITEN de omzetreeks (klantformaat: het eigen
// facturatie-overzicht en de boekhoudkundige factuurtotalen zijn excl.
// toeslagen) — de toeslagen-import verandert de omzetkaarten dus niet. ----
const snapToeslag = computeProductionSnapshot(state, { locatie: "Alle locaties" }, REFERENCE, {
  agenda: agendaFacts,
  toeslagen: toeslagenFixture,
});
check(
  "toeslag: omzetkaarten ongewijzigd door toeslagen-import (Vecozo juni/mei)",
  [snapToeslag.cockpitKpis.omzetverz.value, snapToeslag.cockpitKpis.omzetverz.prev],
  [100, 150],
);
check(
  "toeslag: servicebureau-deel ongewijzigd (geen CZ-toeslag erbij)",
  [snapToeslag.cockpitKpis.omzetinfo.value, snapToeslag.cockpitKpis.omzetinfo.prev],
  [250, 0],
);
if (!snapToeslag.agenda) {
  throw new Error("toeslag: agenda-snapshot ontbreekt");
}
check("toeslag: omzet per verzekeraar excl. toeslagen", snapToeslag.agenda.financieel.omzetPerVerzekeraar, [
  { label: "RMO/RMA", aantal: 400 },
  { label: "VGZ", aantal: 250 },
  { label: "CZ", aantal: 250 },
]);
check(
  "toeslag: snapshot-toeslagen totaal (eigen kaart blijft bestaan)",
  [snapToeslag.toeslagen?.totaal, snapToeslag.toeslagen?.aantal],
  [463, 3],
);
check(
  "toeslag-provenance: Toeslagen-widget flipt met cap",
  [widgetSource("financieel", "Toeslagen"), widgetSource("financieel", "Toeslagen", { toeslagen: true })],
  ["demo", "live"],
);
check("toeslag-provenance: register alleen financieel", Object.keys(TOESLAGEN_PROVENANCE), ["financieel"]);

// ---- Gem. omzet / traject uit de agenda (Zorgtraject_ID) ----
const trajectCsv = [
  "Soort;Behandelaar;Datum;Client_ID;No_Show;Totale_tijd_minute(n);Zorgtraject_ID;Prijs;Sessie_Naam;Afspraak_lokatie",
  "Sessie;Anna Jansen;10-06-2026;1;n;60,0;T1;100,00;Behandeling;TGC Tilburg",
  "Sessie;Anna Jansen;11-06-2026;1;n;60,0;T1;100,00;Behandeling;TGC Tilburg",
  "Sessie;Bea Smit;12-06-2026;2;n;60,0;T2;100,00;Behandeling;TGC Breda",
].join("\n");
const trajectParse = parseAgendaExport("traject.csv", trajectCsv, "2026-07-14T09:00:00.000Z");
check("traject: teller uit Zorgtraject_ID", trajectParse.facts?.trajecten, 2);
const snapTraject = computeProductionSnapshot(state, { locatie: "Alle locaties" }, REFERENCE, {
  agenda: trajectParse.facts,
});
if (!snapTraject.agenda) {
  throw new Error("traject: agenda-snapshot ontbreekt");
}
check(
  "traject: gem. omzet per traject (300 / 2)",
  [
    snapTraject.agenda.financieel.metrics["Gem. omzet / traject"].value,
    snapTraject.agenda.financieel.metrics["Gem. omzet / traject"].noData,
  ],
  [150, false],
);
// De hoofd-fixture heeft geen Zorgtraject_ID-kolom: metric aanwezig maar zonder meting.
check(
  "traject: zonder kolom → geen meting (noData)",
  snapAgenda.agenda === null ? null : snapAgenda.agenda.financieel.metrics["Gem. omzet / traject"].noData,
  true,
);

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
  check("echt: aanmeldingen juni (zorgtraject-start)", realSnap.cockpitKpis.aanmeldingen.value, 164);
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
  check("echt: drill aanmeldingen rows (zorgtraject-start)", PRODUCTION_DETAIL_ROWS.aanmeldingen(realSnap).length, 164);
  check(
    "echt: drill zonder-behandelaar rows",
    PRODUCTION_DETAIL_ROWS["zonder-behandelaar"](realSnap).length,
    realSnap.patientenMetrics["Zonder behandelaar"].value,
  );
} else {
  console.log("(echte export niet aanwezig — sanity-pass overgeslagen)");
}

// ---- Optionele sanity-pass op de nieuwe exports (Exports EPD/, gitignored) ----
// Verwachtingen onafhankelijk berekend (Python-profiel van 2026-07-22).
const exportsDir = path.join(__dirname, "../../Exports EPD");
const nieuwClientPath = path.join(exportsDir, "cli_ntendata_export.csv");
const nieuwAgendaPath = path.join(exportsDir, "exporteer_agenda_afspraken_2023_01_01_2028_01_01.csv");
const nieuwVerwijzersPath = path.join(exportsDir, "huisarts_verwijzer export 2026_07_21__16_51_16.csv");
if (fs.existsSync(nieuwClientPath) && fs.existsSync(nieuwAgendaPath) && fs.existsSync(nieuwVerwijzersPath)) {
  const REFERENCE_NIEUW = new Date(Date.UTC(2026, 6, 22));
  const nieuwClient = parseClientExport("cli_ntendata_export.csv", fs.readFileSync(nieuwClientPath, "utf8"));
  check(
    "nieuw: cliënten geparsed (dubbele trajecten samengevoegd)",
    [nieuwClient.records.length, nieuwClient.skippedRows],
    [1267, 38],
  );
  const nieuwAgenda = parseAgendaExport(
    "agenda.csv",
    fs.readFileSync(nieuwAgendaPath, "utf8"),
    "2026-07-22T09:00:00.000Z",
  );
  const nieuwAgendaFacts = nieuwAgenda.facts;
  if (!nieuwAgendaFacts) {
    throw new Error("echte agenda-export parse faalde");
  }
  check(
    "nieuw: agenda-rijen (sessie/blok/overgeslagen — historisch)",
    [nieuwAgendaFacts.sessieRows, nieuwAgendaFacts.blokRows, nieuwAgendaFacts.skippedRows],
    [15873, 6983, 0],
  );
  check("nieuw: agenda-bereik", [nieuwAgendaFacts.bronVan, nieuwAgendaFacts.bronTot], ["2025-04-07", "2028-01-01"]);
  check(
    "nieuw: toekomstvenster (geplande sessies, cliënten, t/m)",
    [nieuwAgendaFacts.toekomst?.sessies, nieuwAgendaFacts.toekomst?.clienten, nieuwAgendaFacts.toekomst?.tot],
    [4099, 559, "2027-07-30"],
  );
  check(
    "nieuw: agenda-totalen (no-shows, afzeggingen — historisch)",
    [
      nieuwAgendaFacts.cellen.reduce((sum, cel) => sum + cel.noShows, 0),
      nieuwAgendaFacts.cellen.reduce((sum, cel) => sum + cel.tijdigAfgezegd, 0),
    ],
    [120, 775],
  );
  check(
    "nieuw: gefactureerd totaal (€)",
    Math.round(nieuwAgendaFacts.facturatie.reduce((sum, cel) => sum + cel.omzet, 0)),
    3607109,
  );
  check(
    "nieuw: onderhanden totaal (€ — geplande sessies tellen niet mee)",
    Math.round(nieuwAgendaFacts.cellen.reduce((sum, cel) => sum + cel.onderhanden, 0)),
    459677,
  );
  check(
    "nieuw: privacy — geen naam/memo-lek in echt aggregaat",
    JSON.stringify(nieuwAgendaFacts).includes("Astan"),
    false,
  );
  const nieuwVerwijzers = parseVerwijzersExport(
    "verwijzers.csv",
    fs.readFileSync(nieuwVerwijzersPath, "utf8"),
    "2026-07-22T09:00:00.000Z",
  );
  if (!nieuwVerwijzers.facts) {
    throw new Error("echte verwijzers-export parse faalde");
  }
  check(
    "nieuw: verwijzers (AGB-gegroepeerd, cliëntkoppelingen)",
    [nieuwVerwijzers.facts.contacten.length, nieuwVerwijzers.facts.clienten],
    [415, 1245],
  );

  const nieuwSnap = computeProductionSnapshot(
    { fileName: "cli_ntendata_export.csv", importedAt: "2026-07-22T09:00:00.000Z", records: nieuwClient.records },
    { locatie: "Alle locaties" },
    REFERENCE_NIEUW,
    { agenda: nieuwAgendaFacts, verwijzers: nieuwVerwijzers.facts },
  );
  if (!nieuwSnap.agenda) {
    throw new Error("agenda-snapshot over de echte export ontbreekt");
  }
  const nieuwAgendaSnap = nieuwSnap.agenda;
  check("nieuw: actieve cliënten (open traject wint bij dubbele id)", nieuwSnap.cockpitKpis.actief.value, 975);
  check(
    "nieuw: aanmeldingen juni/mei op zorgtraject-start (echte instroom)",
    [nieuwSnap.cockpitKpis.aanmeldingen.value, nieuwSnap.cockpitKpis.aanmeldingen.prev],
    [191, 149],
  );
  check("nieuw: uitstroom juni op zorgtraject-eind", nieuwSnap.cockpitKpis.gesloten.value, 54);
  check(
    "nieuw: drill aanmeldingen volgt de nieuwe definitie",
    PRODUCTION_DETAIL_ROWS.aanmeldingen(nieuwSnap).length,
    191,
  );
  check("nieuw: populatieprofiel (gem/mediaan leeftijd, vrouw%, dossierduur)", nieuwSnap.populatieProfiel, {
    n: 975,
    gemLeeftijd: 37.5,
    mediaanLeeftijd: 35,
    vrouwPct: 59,
    gemDuurDagen: 144,
    mediaanDuurDagen: 120,
  });
  check(
    "nieuw: sessievormen — online meeste no-shows, op locatie meeste afzeggingen",
    nieuwAgendaSnap.vormen?.map((vorm) => [vorm.vorm, vorm.sessies, vorm.noShowPct, vorm.afzegPct]),
    [
      ["online", 3455, 1.8, 5.3],
      ["locatie", 4882, 1.1, 10],
      ["overig", 7536, 0.2, 1.4],
    ],
  );
  check(
    "nieuw: beroepsmix — grootste code BP29",
    [nieuwAgendaSnap.beroepen?.[0]?.code, nieuwAgendaSnap.beroepen?.[0]?.sessies],
    ["BP29", 5022],
  );
  check(
    "nieuw: no-show KPI juni (echt, sessie-basis)",
    [nieuwSnap.cockpitKpis.noshow.value, nieuwSnap.cockpitKpis.noshow.prev],
    [0.8, 0.2],
  );
  // Kanaal-verwachtingen onafhankelijk berekend (Python-profiel 2026-07-23):
  // behandelmaand-buckets, excl. toeslagen; RMO/RMA = Uzovi 3355 (juni exact
  // gelijk aan factuur 26000160 uit het facturatie-overzicht van de klant).
  check(
    "nieuw: omzet-KPI juni/mei — Vecozo (VGZ + DSW-7029, behandelmaand)",
    [nieuwSnap.cockpitKpis.omzetverz.value, nieuwSnap.cockpitKpis.omzetverz.prev],
    [249906, 201420],
  );
  check(
    "nieuw: omzet-KPI juni/mei — servicebureau (overige koepels)",
    [nieuwSnap.cockpitKpis.omzetinfo.value, nieuwSnap.cockpitKpis.omzetinfo.prev],
    [312840, 258347],
  );
  check(
    "nieuw: omzet-KPI juni/mei — RMO/RMA (Uzovi 3355; juni = factuur 26000160)",
    [nieuwSnap.cockpitKpis.omzetrmo.value, nieuwSnap.cockpitKpis.omzetrmo.prev],
    [158311, 162506],
  );
  check("nieuw: maandreeks totaal juni (Vecozo + servicebureau + RMO/RMA)", nieuwSnap.monthly[11].omzet, 721057);
  check(
    "nieuw: planning juni (afspraken, no-shows, afgezegd, behandeluren)",
    [
      nieuwAgendaSnap.planningMetrics["Afspraken deze maand"].value,
      nieuwAgendaSnap.planningMetrics["No-shows"].value,
      nieuwAgendaSnap.planningMetrics.Geannuleerd.value,
      nieuwAgendaSnap.planningMetrics.Behandeluren.value,
    ],
    [3279, 26, 185, 3174],
  );
  check("nieuw: echte contactrecentheid", nieuwAgendaSnap.contact, { z30: 343, z60: 205 });
  check(
    "nieuw: vooruitblik (zonder vervolgafspraak, dubbel signaal)",
    [nieuwAgendaSnap.vooruitblik?.zonderVervolg, nieuwAgendaSnap.vooruitblik?.zonderVervolgEnContact],
    [364, 258],
  );
  check(
    "nieuw: signalering zonder vervolgafspraak",
    nieuwSnap.signaleringen.find((alert) => alert.titel === "Zonder vervolgafspraak")?.n,
    364,
  );
  check("nieuw: drill zondervervolg rows", PRODUCTION_DETAIL_ROWS.zondervervolg(nieuwSnap).length, 364);
  check(
    "nieuw: agenda-dossierchecks (verslag ontbreekt, niet ondertekend)",
    [nieuwAgendaSnap.dossierchecks.verslagOntbreekt, nieuwAgendaSnap.dossierchecks.nietOndertekend],
    [1558, 15873],
  );
  check(
    "nieuw: signalering zonder behandelplan",
    nieuwSnap.signaleringen.find((alert) => alert.titel === "Dossiers zonder behandelplan")?.n,
    511,
  );
  check(
    "nieuw: Veghel-vooruitblik (geplande sessies, zonder vervolg)",
    (() => {
      const veghel = computeProductionSnapshot(
        { fileName: "cli_ntendata_export.csv", importedAt: "2026-07-22T09:00:00.000Z", records: nieuwClient.records },
        { locatie: "Veghel" },
        REFERENCE_NIEUW,
        { agenda: nieuwAgendaFacts },
      );
      return [veghel.agenda?.vooruitblik?.sessies, veghel.agenda?.vooruitblik?.zonderVervolg];
    })(),
    [209, 50],
  );
  check(
    "nieuw: signalering niet-gefactureerd >90 dgn",
    nieuwSnap.signaleringen.find((alert) => alert.titel === "Sessies >90 dgn niet gefactureerd")?.n,
    296,
  );
  check("nieuw: verwijzernetwerk zorgmail", nieuwSnap.verwijzerNetwerk?.zorgmailPct, 95);
  check(
    "nieuw: Veghel als echte vestiging filterbaar",
    computeProductionSnapshot(
      { fileName: "cli_ntendata_export.csv", importedAt: "2026-07-22T09:00:00.000Z", records: nieuwClient.records },
      { locatie: "Veghel" },
      REFERENCE_NIEUW,
    ).cockpitKpis.actief.value,
    177,
  );
  check("nieuw: actief zonder vestiging", nieuwSnap.meta.zonderVestiging, 27);
} else {
  console.log("(nieuwe exports niet aanwezig — sanity-pass Exports EPD overgeslagen)");
}

// ==== Declaratie-totaaloverzicht: parser, status en financieel-overrides ====

const DECLARATIE_HEADER =
  'Regelnummer;Administratienummer;Kostenplaats;Dagboek;Dagboektype;Factuurnummer;Factuurdatum;Debiteurennr.;Debiteurennaam;"Omschrijving kop";"Bedrag ex BTW";BTW;"BTW code";"Totaal bedrag";"Toegekend totaalbedrag";"Debet / credit";Grootboeknummer;Periode;Jaar;"Credit voor"';
const declaratiesCsv = [
  DECLARATIE_HEADER,
  "1;;;;;F100;01-04-2026;200001;VGZ;F100;298,94;0,00;;298,94;298,94;D;;04;2026;",
  '2;;;;;F101;01-03-2026;200002;"De heer GEHEIM";F101;150,00;0,00;;150,00;0,00;D;;03;2026;',
  "3;;;;;F102;10-06-2026;200003;CZ;F102;1.000,00;0,00;;1.000,00;600,00;D;;06;2026;",
  "4;;;;;F103;15-06-2026;200003;CZ;F103;-100,00;0,00;;-100,00;0,00;C;;06;2026;F102",
  "5;;;;;F102;10-06-2026;200003;CZ;F102;500,00;0,00;;500,00;400,00;D;;06;2026;",
  "6;;;;;F104;;200004;CZ;F104;10,00;0,00;;10,00;0,00;D;;06;2026;",
].join("\n");
const declaratiesParse = parseDeclaratiesExport("declaraties-fixture.csv", declaratiesCsv, "2026-07-14T09:00:00.000Z");
check("declaraties: ok", declaratiesParse.ok, true);
const declaratiesFixture = declaratiesParse.facts;
if (!declaratiesFixture) {
  throw new Error("declaraties-fixture parse faalde");
}
check(
  "declaraties: rijen/overgeslagen (rij zonder datum)",
  [declaratiesFixture.totalRows, declaratiesFixture.skippedRows],
  [6, 1],
);
check("declaraties: deelfacturen samengevoegd (3 facturen)", declaratiesFixture.facturen.length, 3);
check(
  "declaraties: privacy — persoonsnaam wordt Particulier",
  JSON.stringify(declaratiesFixture).includes("GEHEIM"),
  false,
);
check(
  "declaraties: particulier-label aanwezig",
  declaratiesFixture.facturen.find((factuur) => factuur.nummer === "F101")?.koepel,
  "Particulier",
);
const f102 = declaratiesFixture.facturen.find((factuur) => factuur.nummer === "F102");
check(
  "declaraties: deelfactuur-som + gekoppelde creditnota",
  [f102?.bedrag, f102?.toegekend, f102?.gecrediteerd],
  [1500, 1000, 100],
);
check("declaraties: guard accepteert aggregaat", isDeclaratiesFacts(declaratiesFixture), true);
check(
  "declaraties: verkeerde kaart (toeslagen) doorverwezen",
  parseDeclaratiesExport("toeslagen.csv", toeslagenCsv).error?.includes("toeslagen-export"),
  true,
);

const snapDeclaraties = computeProductionSnapshot(state, { locatie: "Alle locaties" }, REFERENCE, {
  agenda: agendaFacts,
  declaraties: declaratiesFixture,
});
const declSnap = snapDeclaraties.declaraties;
if (!declSnap) {
  throw new Error("declaraties-snapshot ontbreekt");
}
check(
  "declaraties-snap: totalen (gefactureerd, toegekend, gecrediteerd, openstaand)",
  [declSnap.gefactureerd, declSnap.toegekend, declSnap.gecrediteerd, declSnap.openstaand],
  [1949, 1299, 100, 550],
);
check("declaraties-snap: toekenningsgraad", declSnap.toekenningsPct, 67);
check("declaraties-snap: status (volledig/deels/zonder)", declSnap.status, { volledig: 1, deels: 1, zonder: 1 });
check("declaraties-snap: tekort op deels-toegekend", declSnap.tekortDeels, 500);
check("declaraties-snap: openstaand >90 dgn (Particulier-factuur van 01-03)", declSnap.openstaand90, {
  bedrag: 150,
  facturen: 1,
});
check(
  "declaraties-snap: ouderdom (30-60 = 400, >90 = 150)",
  declSnap.ouderdom.map((bucket) => bucket.bedrag),
  [0, 400, 0, 150],
);
check(
  "declaraties-snap: per koepel gesorteerd op gefactureerd",
  declSnap.perKoepel.map((row) => [row.label, row.pct]),
  [
    ["CZ", 67],
    ["VGZ", 100],
    ["Particulier", 0],
  ],
);
if (!snapDeclaraties.agenda) {
  throw new Error("declaraties-snap: agenda-snapshot ontbreekt");
}
check(
  "declaraties-snap: financieel-overrides (openstaand, tekort, >90 dgn)",
  [
    snapDeclaraties.agenda.financieel.metrics["Openstaande declaraties"].value,
    snapDeclaraties.agenda.financieel.metrics["Afgekeurde declaraties"].value,
    snapDeclaraties.agenda.financieel.metrics["Afgekeurde declaraties"].label,
    snapDeclaraties.agenda.financieel.metrics["Declaraties >90 dgn"].value,
  ],
  [550, 500, "Tekort op toekenning", 150],
);
check(
  "declaraties-snap: signalering >90 dagen open",
  snapDeclaraties.signaleringen.find((alert) => alert.titel === "Declaraties >90 dagen open")?.n,
  1,
);
check(
  "declaraties-provenance: flips met cap",
  [
    widgetSource("financieel", "Openstaande declaraties"),
    widgetSource("financieel", "Openstaande declaraties", { declaraties: true }),
    widgetSource("financieel", "Afgekeurde declaraties", { declaraties: true }),
    widgetSource("signaleringen", "Declaraties >90 dagen open", { declaraties: true }),
  ],
  ["demo", "live", "proxy", "live"],
);
check(
  "declaraties-provenance: register alleen financieel + signaleringen",
  Object.keys(DECLARATIES_PROVENANCE).sort(),
  ["financieel", "signaleringen"],
);
check(
  "declaraties-snap: zonder declaraties blijft snapshot leeg",
  computeProductionSnapshot(state, { locatie: "Alle locaties" }, REFERENCE).declaraties,
  null,
);

// ==== Geaggregeerde KPI-drilldowns (kaarten overal klikbaar) ====
// Agenda-/declaratie-gedreven kaarten hebben geen losse records; hun detail-
// pagina toont een live kop + trend + de geaggregeerde maand-/debiteurentabel.
const aggAfspraken = productionAggDetail(snapAgenda, "afspraken");
if (!aggAfspraken) {
  throw new Error("agg-drill: afspraken-aggregaat ontbreekt");
}
check(
  "agg-drill: afspraken → maandtabel (12 maanden, nieuwste eerst)",
  [aggAfspraken.rows.length, aggAfspraken.rows[0].key, aggAfspraken.rows[0].sessies],
  [12, "2026-06", 4],
);
check("agg-drill: kop volgt live planning-metric", productionDetailMetric(snapAgenda, "afspraken")?.value, 4);
const aggTrend = productionDetailTrend(snapAgenda, "afspraken");
if (!aggTrend) {
  throw new Error("agg-drill: afspraken-trend ontbreekt");
}
check("agg-drill: trend volgt maandreeks (laatste = juni)", aggTrend.values.slice(-1), [4]);
check("agg-drill: no-show-kop in procenten", productionDetailMetric(snapAgenda, "noshow")?.f, "pct");
const aggOmzet = productionAggDetail(snapToeslag, "omzetverz");
if (!aggOmzet) {
  throw new Error("agg-drill: omzet-aggregaat ontbreekt");
}
check(
  "agg-drill: omzet → behandelmaandtabel met driedeling (Vecozo/SB/RMO)",
  [
    aggOmzet.rows[0].key,
    aggOmzet.rows[0].omzetVecozo,
    aggOmzet.rows[0].omzetSb,
    aggOmzet.rows[0].omzetRmo,
    aggOmzet.rows[0].totaal,
  ],
  ["2026-06", 100, 250, 400, 750],
);
check("agg-drill: verwacht-uitbetaald-kolom toont de volledige berekening", aggOmzet.rows[0].verwacht, 628);
check(
  "agg-drill: nieuwe drilldowns omzettotaal/omzetrmo delen de maandtabel",
  [
    productionAggDetail(snapToeslag, "omzettotaal")?.rows[0].totaal,
    productionAggDetail(snapToeslag, "omzetrmo")?.rows[0].omzetRmo,
    productionDetailMetric(snapToeslag, "omzettotaal")?.value,
    productionDetailMetric(snapToeslag, "omzetrmo")?.value,
  ],
  [750, 400, 750, 400],
);
const aggOpenstaand = productionAggDetail(snapDeclaraties, "openstaand");
if (!aggOpenstaand) {
  throw new Error("agg-drill: openstaand-aggregaat ontbreekt");
}
check("agg-drill: openstaand → debiteurentabel", aggOpenstaand.rows.length, 3);
check(
  "agg-drill: zonder agenda geen aggregaat (demo-fallback + wachtnoot)",
  [productionAggDetail(snap, "afspraken"), productionAggDetail(snapAgenda, "openstaand")],
  [null, null],
);

// ==== Populatieprofiel, sessievormen, beroepsmix, dekking ====
check("populatie: fixture-profiel (8 actieve cliënten)", snap.populatieProfiel, {
  n: 8,
  gemLeeftijd: 34.3,
  mediaanLeeftijd: 34,
  vrouwPct: 38,
  gemDuurDagen: 74,
  mediaanDuurDagen: 47,
});
check(
  "vormen: no-show excl. afzeggingen per vorm (fixture)",
  snapAgenda.agenda?.vormen?.map((vorm) => [vorm.vorm, vorm.sessies, vorm.noShowPct, vorm.afzegPct]),
  [
    ["online", 3, 0, 33.3],
    ["locatie", 3, 33.3, 0],
  ],
);
check("beroepen: fixture zonder Beroep-kolom → null (paneel verbergt zich)", snapAgenda.agenda?.beroepen, null);
check("dekking: declaraties t.o.v. agenda-facturatie (mechaniek)", snapDeclaraties.declaraties?.dekking, {
  agendaGefactureerd: 900,
  pct: 217,
});

// ---- Optionele sanity-pass op het echte declaratie-totaaloverzicht ----
const echteDeclaratiesPath = path.join(exportsDir, "declaration_total_20260722_1345.csv");
if (fs.existsSync(echteDeclaratiesPath)) {
  const echteDeclaraties = parseDeclaratiesExport(
    "declaration_total_20260722_1345.csv",
    fs.readFileSync(echteDeclaratiesPath, "utf8"),
    "2026-07-22T09:00:00.000Z",
  );
  const echteDeclFacts = echteDeclaraties.facts;
  if (!echteDeclFacts) {
    throw new Error("echt declaratie-overzicht parse faalde");
  }
  check("echt declaraties: rijen/overgeslagen", [echteDeclFacts.totalRows, echteDeclFacts.skippedRows], [277, 0]);
  check("echt declaraties: facturen (ZVW/WMO-reeksen apart gehouden)", echteDeclFacts.facturen.length, 269);
  const echtDeclSnap = computeProductionSnapshot(
    { fileName: "x.csv", importedAt: "2026-07-22T09:00:00.000Z", records: multiline.records },
    { locatie: "Alle locaties" },
    new Date(Date.UTC(2026, 6, 22)),
    { declaraties: echteDeclFacts },
  ).declaraties;
  if (!echtDeclSnap) {
    throw new Error("echt declaraties-snapshot ontbreekt");
  }
  check(
    "echt declaraties: totalen (onafhankelijk berekend)",
    [echtDeclSnap.gefactureerd, echtDeclSnap.toegekend, echtDeclSnap.openstaand],
    [2507381, 2299918, 194543],
  );
  check("echt declaraties: toekenningsgraad 92%", echtDeclSnap.toekenningsPct, 92);
  check("echt declaraties: openstaand >90 dgn", echtDeclSnap.openstaand90, { bedrag: 23922, facturen: 39 });
  check(
    "echt declaraties: status telt op tot alle facturen",
    echtDeclSnap.status.volledig + echtDeclSnap.status.deels + echtDeclSnap.status.zonder,
    269,
  );
  check(
    "echt declaraties: VGZ-toekenningsgraad laag (64%)",
    echtDeclSnap.perKoepel.find((row) => row.label === "VGZ")?.pct,
    64,
  );
  check(
    "echt declaraties: gemeenten aanwezig (Maashorst/Oss = WMO)",
    ["Maashorst", "Oss"].filter((naam) => !echtDeclSnap.perKoepel.some((row) => row.label === naam)),
    [],
  );
  check(
    "echt declaraties: geen persoonsnamen in aggregaat",
    ["Erdogan", "Weijters", "Dobrev"].filter((naam) => JSON.stringify(echteDeclFacts).includes(naam)),
    [],
  );
} else {
  console.log("(declaratie-totaaloverzicht niet aanwezig — sanity-pass overgeslagen)");
}

// ---- Optionele sanity-pass op de echte toeslagen-export ----
const echteToeslagenPath = path.join(exportsDir, "declared_surcharges_20260722_1300.csv");
if (fs.existsSync(echteToeslagenPath)) {
  const echteToeslagen = parseToeslagenExport(
    "declared_surcharges_20260722_1300.csv",
    fs.readFileSync(echteToeslagenPath, "utf8"),
    "2026-07-22T09:00:00.000Z",
  );
  const echteFacts = echteToeslagen.facts;
  if (!echteFacts) {
    throw new Error("echte toeslagen-export parse faalde");
  }
  check("echt toeslagen: rijen/overgeslagen", [echteFacts.totalRows, echteFacts.skippedRows], [882, 0]);
  check(
    "echt toeslagen: totaal (€ 84.219, onafhankelijk berekend)",
    Math.round(echteFacts.cellen.reduce((sum, cel) => sum + cel.omzet, 0)),
    84219,
  );
  check("echt toeslagen: cliënten en tolk", [echteFacts.clienten, echteFacts.tolkClienten], [67, 3]);
  check(
    "echt toeslagen: grootste post = reistijd ≥25 min",
    [echteFacts.perCode[0].code, echteFacts.perCode[0].aantal, Math.round(echteFacts.perCode[0].omzet)],
    ["TC0010", 675, 63964],
  );
  check("echt toeslagen: geen namen in aggregaat", JSON.stringify(echteFacts).includes("Abdirahman"), false);
} else {
  console.log("(toeslagen-export niet aanwezig — sanity-pass overgeslagen)");
}

console.log(`\nverify-production: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}

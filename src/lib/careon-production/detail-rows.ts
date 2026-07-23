// KPI-drilldowns in productie-modus: per KPI-id de individuele ClientRecords
// achter het getal, afgeleid met exact dezelfde predicaten als de
// snapshot-aggregaties (geëxporteerd uit compute-snapshot.ts). Rijen volgen de
// risicoLijst-conventie: pseudoniem "Cliënt <id>", zpm-label als team,
// vestiging als locatie en de EPD-deeplink waar aanwezig.
//
// Relatieve imports (geen @/-alias): dit bestand draait ook onder ts-node in
// verify-scripts, waar de alias niet resolvet voor runtime-imports.

import type { KpiDetailRow } from "../../data/careon/careon-detail-records";
import type { KpiDetailColumn } from "../../data/careon/careon-kpi-details";
import {
  activeAt,
  daysBetween,
  instroomDatum,
  isBehandelingsfase,
  isWachtend,
  lastFullMonths,
  monthKeyOf,
  uitstroomDatum,
  wachtduurDagen,
} from "./compute-snapshot";
import type { ClientRecord, LiveMetric, ProductionSnapshot } from "./types";

function clientRow(record: ClientRecord, extra: Record<string, string | number | null> = {}): KpiDetailRow {
  return {
    key: record.id,
    naam: `Cliënt ${record.id}`,
    team: record.zpmLabel ?? "—",
    loc: record.vestiging ?? "—",
    behandelaar: record.behandelaar ?? "—",
    dossierUrl: record.dossierUrl,
    ...extra,
  };
}

function dagenOpen(record: ClientRecord, referenceIso: string): number {
  return record.episodeStart ? daysBetween(record.episodeStart, referenceIso) : 0;
}

interface WachtRij {
  record: ClientRecord;
  fase: string;
  dagen: number;
}

// Zelfde fase-indeling als de snapshot (intakeWachtenden/behandelingWachtenden).
function wachtRijen(snapshot: ProductionSnapshot): WachtRij[] {
  const referenceIso = snapshot.meta.referenceDate;
  return snapshot.records.filter(isWachtend).map((record) => ({
    record,
    fase: !record.preWachtlijst && isBehandelingsfase(record.wachtlijstLabels) ? "Behandeling" : "Intake",
    dagen: wachtduurDagen(record, referenceIso),
  }));
}

function wachtlijstRows(snapshot: ProductionSnapshot, filter?: (rij: WachtRij) => boolean): KpiDetailRow[] {
  return wachtRijen(snapshot)
    .filter((rij) => (filter ? filter(rij) : true))
    .sort((a, b) => b.dagen - a.dagen)
    .map((rij) =>
      clientRow(rij.record, {
        fase: rij.fase,
        dagen: rij.dagen,
        urgentie: rij.dagen > 60 ? "Urgent" : "",
      }),
    );
}

function contactProxyRows(snapshot: ProductionSnapshot, minDagen: number): KpiDetailRow[] {
  const referenceIso = snapshot.meta.referenceDate;

  // Mét agenda-import: échte contactrecentheid — zelfde ankerlogica als de
  // snapshot-telling (laatste gehouden afspraak, terugval episodestart).
  const agenda = snapshot.agenda;
  if (agenda) {
    const agendaRefIso = agenda.meta.bronTot < referenceIso ? agenda.meta.bronTot : referenceIso;
    return snapshot.records
      .filter((record) => activeAt(record, referenceIso) && !isWachtend(record))
      .map((record) => {
        const laatste = agenda.contactPerClient[record.id] ?? null;
        const anker = laatste ?? record.episodeStart;
        const dagen = anker && anker <= agendaRefIso ? daysBetween(anker, agendaRefIso) : 0;
        return { record, laatste, dagen };
      })
      .filter((item) => item.dagen > minDagen)
      .sort((a, b) => b.dagen - a.dagen)
      .map(({ record, laatste, dagen }) =>
        clientRow(record, {
          laatste: laatste ?? "geen afspraak in de export",
          dagen,
        }),
      );
  }

  return snapshot.records
    .filter(
      (record) =>
        activeAt(record, referenceIso) &&
        !isWachtend(record) &&
        record.totaleTijdMin === 0 &&
        record.episodeStart !== null &&
        daysBetween(record.episodeStart, referenceIso) > minDagen,
    )
    .sort((a, b) => dagenOpen(b, referenceIso) - dagenOpen(a, referenceIso))
    .map((record) =>
      clientRow(record, {
        laatste: "geen registratie",
        dagen: dagenOpen(record, referenceIso),
      }),
    );
}

/**
 * Per KPI-id de productie-afleiding. Alleen ids waarvoor de cliëntendata-export
 * de records echt kan leveren staan hier; de overige detailpagina's houden in
 * productie hun demo-rijen met demo-badge en een wacht-op-export-noot.
 */
export const PRODUCTION_DETAIL_ROWS: Record<string, (snapshot: ProductionSnapshot) => KpiDetailRow[]> = {
  actief: (snapshot) => {
    const referenceIso = snapshot.meta.referenceDate;
    return snapshot.records
      .filter((record) => activeAt(record, referenceIso))
      .map((record) =>
        clientRow(record, {
          diagnose: record.diagnoseGroep ?? "Geen diagnose",
          leeftijd: record.leeftijd,
          sinds: record.episodeStart ?? "—",
        }),
      );
  },

  aanmeldingen: (snapshot) => {
    const months = lastFullMonths(snapshot.meta.referenceDate, 12);
    const lastKey = months[months.length - 1].key;
    return snapshot.records
      .filter((record) => monthKeyOf(instroomDatum(record)) === lastKey)
      .sort((a, b) => (instroomDatum(b) ?? "").localeCompare(instroomDatum(a) ?? ""))
      .map((record) =>
        clientRow(record, {
          datum: instroomDatum(record) ?? "—",
          verwijzer: record.verwijzer ?? "—",
          status: isWachtend(record) ? "Op wachtlijst" : "In zorg",
        }),
      );
  },

  gesloten: (snapshot) => {
    const months = lastFullMonths(snapshot.meta.referenceDate, 12);
    const lastKey = months[months.length - 1].key;
    return snapshot.records
      .filter((record) => monthKeyOf(uitstroomDatum(record)) === lastKey)
      .sort((a, b) => (uitstroomDatum(b) ?? "").localeCompare(uitstroomDatum(a) ?? ""))
      .map((record) =>
        clientRow(record, {
          datum: uitstroomDatum(record) ?? "—",
          // De export bevat geen afsluitreden.
          reden: "—",
        }),
      );
  },

  outreach: (snapshot) => {
    const referenceIso = snapshot.meta.referenceDate;
    return snapshot.records
      .filter((record) => activeAt(record, referenceIso) && record.setting === "S04")
      .map((record) =>
        clientRow(record, {
          frequentie: "—",
          bezoek: "—",
        }),
      );
  },

  dossiersnc: (snapshot) => {
    const referenceIso = snapshot.meta.referenceDate;
    return snapshot.records
      .filter(
        (record) =>
          activeAt(record, referenceIso) &&
          (record.diagnoseCode === null || record.zorgvraagtype === null || record.verwijzer === null),
      )
      .map((record) => {
        const ontbreekt = [
          record.diagnoseCode === null ? "Diagnose" : null,
          record.zorgvraagtype === null ? "Zorgvraagtypering" : null,
          record.verwijzer === null ? "Verwijzing" : null,
        ]
          .filter(Boolean)
          .join(", ");
        return clientRow(record, { ontbreekt, dagen: dagenOpen(record, referenceIso) });
      })
      .sort((a, b) => Number(b.dagen) - Number(a.dagen));
  },

  "wachtlijst-intake": (snapshot) => wachtlijstRows(snapshot, (rij) => rij.fase === "Intake"),
  "wachtlijst-behandeling": (snapshot) => wachtlijstRows(snapshot, (rij) => rij.fase === "Behandeling"),
  "wachtlijst-totaal": (snapshot) => wachtlijstRows(snapshot),
  "wachtlijst-urgent": (snapshot) => wachtlijstRows(snapshot, (rij) => rij.dagen > 60),

  // Vereist een agenda-export mét toekomstvenster (zie hasProductionDetailRows).
  zondervervolg: (snapshot) => {
    const agenda = snapshot.agenda;
    if (!agenda?.vooruitblik) return [];
    const referenceIso = snapshot.meta.referenceDate;
    const agendaRefIso = agenda.meta.bronTot < referenceIso ? agenda.meta.bronTot : referenceIso;
    return snapshot.records
      .filter(
        (record) =>
          activeAt(record, referenceIso) && !isWachtend(record) && agenda.vervolgPerClient[record.id] === undefined,
      )
      .map((record) => {
        const laatste = agenda.contactPerClient[record.id] ?? null;
        const anker = laatste ?? record.episodeStart;
        const dagen = anker && anker <= agendaRefIso ? daysBetween(anker, agendaRefIso) : 0;
        return { record, laatste, dagen };
      })
      .sort((a, b) => b.dagen - a.dagen)
      .map(({ record, laatste, dagen }) =>
        clientRow(record, {
          laatste: laatste ?? "geen gehouden afspraak in de export",
          dagen,
        }),
      );
  },

  "zonder-behandelaar": (snapshot) => {
    const referenceIso = snapshot.meta.referenceDate;
    return snapshot.records
      .filter((record) => activeAt(record, referenceIso) && record.behandelaar === null)
      .map((record) =>
        clientRow(record, {
          oorzaak: "—",
          dagen: dagenOpen(record, referenceIso),
        }),
      );
  },

  contact30: (snapshot) => contactProxyRows(snapshot, 30),
  contact60: (snapshot) => contactProxyRows(snapshot, 60),

  crisis: (snapshot) => {
    const referenceIso = snapshot.meta.referenceDate;
    return snapshot.records
      .filter(
        (record) =>
          activeAt(record, referenceIso) && (record.zorgvraagtype === "ZT05" || record.zorgvraagtype === "ZT08"),
      )
      .map((record) =>
        clientRow(record, {
          status: record.zorgvraagtypeOmschrijving ?? record.zorgvraagtype ?? "—",
          dagen: dagenOpen(record, referenceIso),
        }),
      );
  },

  wachttijd: (snapshot) => {
    // Zelfde kwartaalvenster als gemWachttijdWkn: starts in de laatste drie
    // volledige maanden met een geldige (niet-negatieve) wachttijd.
    const months = lastFullMonths(snapshot.meta.referenceDate, 12);
    const kwartaalStart = months[months.length - 3].key.concat("-01");
    const kwartaalEind = months[months.length - 1].endIso;
    return snapshot.records
      .filter(
        (record) =>
          record.episodeStart !== null &&
          record.verwijsdatum !== null &&
          record.episodeStart >= kwartaalStart &&
          record.episodeStart <= kwartaalEind &&
          daysBetween(record.verwijsdatum, record.episodeStart) >= 0,
      )
      .sort((a, b) => (b.episodeStart ?? "").localeCompare(a.episodeStart ?? ""))
      .map((record) =>
        clientRow(record, {
          start: record.episodeStart ?? "—",
          wkn: Math.round((daysBetween(record.verwijsdatum as string, record.episodeStart as string) / 7) * 10) / 10,
        }),
      );
  },

  "productie-uren": (snapshot) => {
    const referenceIso = snapshot.meta.referenceDate;
    const months = lastFullMonths(referenceIso, 12);
    const lastKey = months[months.length - 1].key;
    const perBehandelaar = new Map<string, { minuten: number; afsluitingen: number; locaties: Map<string, number> }>();
    for (const record of snapshot.records) {
      if (!record.behandelaar) {
        continue;
      }
      const groep = perBehandelaar.get(record.behandelaar) ?? { minuten: 0, afsluitingen: 0, locaties: new Map() };
      if (activeAt(record, referenceIso)) {
        groep.minuten += record.totaleTijdMin;
        if (record.vestiging) {
          groep.locaties.set(record.vestiging, (groep.locaties.get(record.vestiging) ?? 0) + 1);
        }
      }
      if (monthKeyOf(record.episodeEind) === lastKey) {
        groep.afsluitingen += 1;
      }
      perBehandelaar.set(record.behandelaar, groep);
    }
    return [...perBehandelaar.entries()]
      .map(([naam, groep]) => {
        const topLocatie = [...groep.locaties.entries()].sort((a, b) => b[1] - a[1])[0];
        return {
          key: naam,
          naam,
          team: "SGGZ",
          loc: topLocatie ? topLocatie[0] : "—",
          uren: Math.round(groep.minuten / 60),
          afsluitingen: groep.afsluitingen,
        };
      })
      .filter((row) => Number(row.uren) > 0 || Number(row.afsluitingen) > 0)
      .sort((a, b) => Number(b.uren) - Number(a.uren));
  },

  "dossier-compliance": (snapshot) => {
    const sevLabel: Record<string, string> = { kritiek: "Kritiek", hoog: "Hoog", middel: "Middel" };
    return snapshot.dossiercontrole.checks.map((check) => ({
      key: check.check,
      check: check.check,
      n: check.n,
      sev: sevLabel[check.sev] ?? check.sev,
    }));
  },
};

/**
 * De kopmetric die de detailpagina in productie toont — dezelfde live waarde
 * als de aangeklikte kaart (patiëntenmetrics op label, cockpit-KPI's op id).
 */
export function productionDetailMetric(snapshot: ProductionSnapshot, id: string): LiveMetric | null {
  const patient = (label: string) => snapshot.patientenMetrics[label] ?? null;
  const dossiers = (label: string) => snapshot.dossiersProductie.metrics[label] ?? null;
  switch (id) {
    case "actief":
      return patient("Actieve patiënten");
    case "aanmeldingen":
      return patient("Nieuwe patiënten");
    case "gesloten":
      return patient("Uitstroom");
    case "wachtlijst-intake":
      return patient("Wachtlijst intake");
    case "wachtlijst-behandeling":
      return patient("Wachtlijst behandeling");
    case "zonder-behandelaar":
      return patient("Zonder behandelaar");
    case "contact30":
      return patient(">30 dgn geen contact");
    case "contact60":
      return patient(">60 dgn geen contact");
    case "zondervervolg":
      return patient("Zonder vervolgafspraak");
    case "crisis":
      return patient("Crisiscliënten");
    case "outreach": {
      const kpi = snapshot.cockpitKpis.outreach;
      return { label: "Outreachende cliënten", value: kpi.value, prev: kpi.prev, f: "int" };
    }
    case "dossiersnc": {
      const kpi = snapshot.cockpitKpis.dossiersnc;
      return { label: "Dossiers niet compleet", value: kpi.value, prev: kpi.prev, f: "int", betterLow: true };
    }
    case "wachttijd":
      return snapshot.gemWachttijdWkn;
    case "wachtlijst-totaal":
      return dossiers("Wachtlijst totaal");
    case "wachtlijst-urgent":
      return dossiers("Urgent op wachtlijst");
    case "productie-uren":
      return dossiers("Productie-uren");
    case "dossier-compliance":
      return {
        label: "Dossier-compliance",
        value: snapshot.dossiercontrole.compliancePct,
        prev: null,
        f: "pct",
      };
    default:
      return agendaMetric(snapshot, id);
  }
}

// Agenda-/financieel-gedreven kaarten: de kop volgt de live metric van de
// betreffende pagina (zelfde vervangings-patroon, gesleuteld op demo-labels).
function agendaMetric(snapshot: ProductionSnapshot, id: string): LiveMetric | null {
  const agenda = snapshot.agenda;
  if (!agenda) return null;
  const planning = (label: string) => agenda.planningMetrics[label] ?? null;
  const financieel = (label: string) => agenda.financieel.metrics[label] ?? null;
  switch (id) {
    case "afspraken":
      return planning("Afspraken deze maand");
    case "noshow": {
      const kpi = snapshot.cockpitKpis.noshow;
      if (!kpi) return null;
      return {
        label: "No-show",
        value: kpi.value,
        prev: kpi.prev,
        f: "pct",
        betterLow: true,
        windowLabel: kpi.windowLabel,
      };
    }
    case "geannuleerd":
      return planning("Geannuleerd");
    case "bezetting":
      return planning("Agenda-bezetting");
    case "uren-beschikbaar":
      return planning("Beschikbare uren");
    case "uren-productief":
      return planning("Productieve uren");
    case "uren-behandel":
      return planning("Behandeluren");
    case "uren-indirect":
      return planning("Indirecte uren");
    case "omzetverz":
      return financieel("Omzet verzekeraars");
    case "omzetinfo":
      return financieel("Omzet Infomedics");
    case "ohw":
      return financieel("Onderhanden werk");
    case "omzet-client":
      return financieel("Gem. omzet / cliënt");
    case "omzet-traject":
      return financieel("Gem. omzet / traject");
    case "openstaand":
      return financieel("Openstaande declaraties");
    case "afgekeurd":
      return financieel("Afgekeurde declaraties");
    case "declaraties90":
      return financieel("Declaraties >90 dgn");
    default:
      return null;
  }
}

/** Live 12-maands trendreeks in productie, waar de export die echt kent. */
export function productionDetailTrend(
  snapshot: ProductionSnapshot,
  id: string,
): { labels: string[]; values: number[] } | null {
  const labels = snapshot.monthly.map((point) => point.m);
  switch (id) {
    case "actief":
      return { labels, values: snapshot.monthly.map((point) => point.caseload) };
    case "aanmeldingen":
      return { labels, values: snapshot.monthly.map((point) => point.aanmeldingen) };
    case "gesloten":
      return { labels, values: snapshot.monthly.map((point) => point.uitstroom) };
    case "outreach": {
      const spark = snapshot.cockpitKpis.outreach.spark;
      return spark.length === labels.length ? { labels, values: spark } : null;
    }
    default:
      return agendaTrend(snapshot, id);
  }
}

// Agenda-gedreven trends: maandreeks (planning) en omzetsplitsing (financieel).
function agendaTrend(snapshot: ProductionSnapshot, id: string): { labels: string[]; values: number[] } | null {
  const agenda = snapshot.agenda;
  if (!agenda) return null;
  const reeks = agenda.maandreeks;
  const reeksLabels = reeks.map((maand) => maand.label.split(" ")[0]);
  const uitReeks = (veld: (maand: (typeof reeks)[number]) => number) =>
    reeks.length > 0 ? { labels: reeksLabels, values: reeks.map(veld) } : null;
  const monthlyLabels = snapshot.monthly.map((point) => point.m);
  switch (id) {
    case "afspraken":
      return uitReeks((maand) => maand.sessies);
    case "noshow":
      return {
        labels: monthlyLabels,
        values: snapshot.monthly.map((point) => point.noshowPct ?? 0),
      };
    case "geannuleerd":
      return uitReeks((maand) => maand.tijdigAfgezegd);
    case "bezetting":
      return uitReeks((maand) => {
        const totaal = maand.totaleUren + maand.blokUren;
        return totaal === 0 ? 0 : Math.round((maand.totaleUren / totaal) * 100);
      });
    case "uren-beschikbaar":
      return uitReeks((maand) => maand.blokUren);
    case "uren-productief":
      return uitReeks((maand) => maand.totaleUren);
    case "uren-behandel":
      return uitReeks((maand) => maand.directeUren);
    case "uren-indirect":
      return uitReeks((maand) => maand.indirecteUren);
    case "omzetverz":
      return {
        labels: monthlyLabels,
        values: snapshot.monthly.map((point) => Math.round((point.omzet ?? 0) - (point.omzetInfomedics ?? 0))),
      };
    case "omzetinfo":
      return { labels: monthlyLabels, values: snapshot.monthly.map((point) => point.omzetInfomedics ?? 0) };
    case "omzet-client":
    case "omzet-traject":
      return uitReeks((maand) => maand.omzetGerealiseerd);
    default:
      return null;
  }
}

// ---- Geaggregeerde drilldown-tabellen ----
// Voor agenda-/declaratie-gedreven kaarten bestaan er (bewust) geen losse
// records; de detailtabel toont dan de eerlijke aggregaten — per maand of per
// verzekeringskoepel — in plaats van demo-voorbeeldrijen.

export interface AggDetail {
  columns: KpiDetailColumn[];
  rows: KpiDetailRow[];
  /** Eenheid voor de tabel-caption ("maanden", "koepels", …). */
  eenheid: string;
}

const MAAND_COLUMNS: KpiDetailColumn[] = [
  { key: "maand", header: "Maand" },
  { key: "sessies", header: "Afspraken", format: "int", align: "right" },
  { key: "noShows", header: "No-shows", format: "int", align: "right" },
  { key: "tijdigAfgezegd", header: "Afgezegd", format: "int", align: "right", hideOnMobile: true },
  { key: "directeUren", header: "Behandeluren", format: "int", align: "right", hideOnMobile: true },
  { key: "totaleUren", header: "Geregistreerd (u)", format: "int", align: "right", hideOnMobile: true },
  { key: "blokUren", header: "Afwezig (u)", format: "int", align: "right", hideOnMobile: true },
];

const OMZET_COLUMNS: KpiDetailColumn[] = [
  { key: "maand", header: "Factuurmaand" },
  { key: "omzetVerz", header: "VGZ + DSW", format: "eur", align: "right" },
  { key: "omzetInfo", header: "Via Infomedics", format: "eur", align: "right" },
  { key: "totaal", header: "Totaal", format: "eur", align: "right" },
];

const KOEPEL_COLUMNS: KpiDetailColumn[] = [
  { key: "koepel", header: "Debiteur" },
  { key: "gefactureerd", header: "Gedeclareerd", format: "eur", align: "right" },
  { key: "toegekend", header: "Toegekend", format: "eur", align: "right" },
  { key: "openstaand", header: "Openstaand", format: "eur", align: "right" },
  { key: "pct", header: "Toegekend %", format: "pct0", align: "right" },
];

function maandTabel(snapshot: ProductionSnapshot): AggDetail | null {
  const agenda = snapshot.agenda;
  if (!agenda || agenda.maandreeks.length === 0) return null;
  return {
    columns: MAAND_COLUMNS,
    eenheid: "maanden",
    rows: [...agenda.maandreeks].reverse().map((maand) => ({
      key: maand.key,
      maand: maand.label,
      sessies: maand.sessies,
      noShows: maand.noShows,
      tijdigAfgezegd: maand.tijdigAfgezegd,
      directeUren: maand.directeUren,
      totaleUren: maand.totaleUren,
      blokUren: maand.blokUren,
    })),
  };
}

function omzetTabel(snapshot: ProductionSnapshot): AggDetail | null {
  if (!snapshot.agenda) return null;
  const rows = [...snapshot.monthly]
    .filter((point) => point.omzet !== null)
    .reverse()
    .map((point) => ({
      key: point.key,
      maand: point.m,
      omzetVerz: Math.round((point.omzet ?? 0) - (point.omzetInfomedics ?? 0)),
      omzetInfo: point.omzetInfomedics ?? 0,
      totaal: point.omzet ?? 0,
    }));
  return rows.length > 0 ? { columns: OMZET_COLUMNS, eenheid: "factuurmaanden", rows } : null;
}

function koepelTabel(snapshot: ProductionSnapshot): AggDetail | null {
  const declaraties = snapshot.declaraties;
  if (!declaraties) return null;
  return {
    columns: KOEPEL_COLUMNS,
    eenheid: "debiteuren",
    rows: declaraties.perKoepel.map((row) => ({
      key: row.label,
      koepel: row.label,
      gefactureerd: row.gefactureerd,
      toegekend: row.toegekend,
      openstaand: row.openstaand,
      pct: row.pct,
    })),
  };
}

function ouderdomTabel(snapshot: ProductionSnapshot): AggDetail | null {
  const agenda = snapshot.agenda;
  if (!agenda) return null;
  return {
    columns: [
      { key: "bucket", header: "Ouderdom (afspraakmaand)" },
      { key: "bedrag", header: "Nog niet gefactureerd", format: "eur", align: "right" },
      { key: "pct", header: "Aandeel", format: "pct0", align: "right" },
    ],
    eenheid: "categorieën",
    rows: agenda.financieel.onderhandenOuderdom.map((bucket) => ({
      key: bucket.label,
      bucket: bucket.label,
      bedrag: bucket.bedrag,
      pct: bucket.pct,
    })),
  };
}

const AGG_BUILDERS: Record<string, (snapshot: ProductionSnapshot) => AggDetail | null> = {
  afspraken: maandTabel,
  noshow: maandTabel,
  geannuleerd: maandTabel,
  bezetting: maandTabel,
  "uren-beschikbaar": maandTabel,
  "uren-productief": maandTabel,
  "uren-behandel": maandTabel,
  "uren-indirect": maandTabel,
  omzetverz: omzetTabel,
  omzetinfo: omzetTabel,
  "omzet-client": maandTabel,
  "omzet-traject": maandTabel,
  ohw: ouderdomTabel,
  openstaand: koepelTabel,
  afgekeurd: koepelTabel,
  declaraties90: koepelTabel,
};

/** Geaggregeerde detailtabel voor agenda-/declaratie-gedreven kaarten (of null). */
export function productionAggDetail(snapshot: ProductionSnapshot, id: string): AggDetail | null {
  const builder = AGG_BUILDERS[id];
  return builder ? builder(snapshot) : null;
}

export function hasProductionDetailRows(id: string, snapshot?: ProductionSnapshot | null): boolean {
  if (!(id in PRODUCTION_DETAIL_ROWS)) return false;
  // "Zonder vervolgafspraak" is alleen berekenbaar met een agenda-export mét
  // toekomstvenster; anders blijft de drilldown demo-gemarkeerd.
  if (id === "zondervervolg") return snapshot?.agenda?.vooruitblik != null;
  return true;
}

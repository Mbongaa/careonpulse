// KPI-drilldowns in productie-modus: per KPI-id de individuele ClientRecords
// achter het getal, afgeleid met exact dezelfde predicaten als de
// snapshot-aggregaties (geëxporteerd uit compute-snapshot.ts). Rijen volgen de
// risicoLijst-conventie: pseudoniem "Cliënt <id>", zpm-label als team,
// vestiging als locatie en de EPD-deeplink waar aanwezig.
//
// Relatieve imports (geen @/-alias): dit bestand draait ook onder ts-node in
// verify-scripts, waar de alias niet resolvet voor runtime-imports.

import type { KpiDetailRow } from "../../data/careon/careon-detail-records";
import {
  activeAt,
  daysBetween,
  isBehandelingsfase,
  isWachtend,
  lastFullMonths,
  monthKeyOf,
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
      .filter((record) => monthKeyOf(record.episodeStart) === lastKey)
      .sort((a, b) => (b.episodeStart ?? "").localeCompare(a.episodeStart ?? ""))
      .map((record) =>
        clientRow(record, {
          datum: record.episodeStart ?? "—",
          verwijzer: record.verwijzer ?? "—",
          status: isWachtend(record) ? "Op wachtlijst" : "In zorg",
        }),
      );
  },

  gesloten: (snapshot) => {
    const months = lastFullMonths(snapshot.meta.referenceDate, 12);
    const lastKey = months[months.length - 1].key;
    return snapshot.records
      .filter((record) => monthKeyOf(record.episodeEind) === lastKey)
      .sort((a, b) => (b.episodeEind ?? "").localeCompare(a.episodeEind ?? ""))
      .map((record) =>
        clientRow(record, {
          datum: record.episodeEind ?? "—",
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
      return null;
  }
}

export function hasProductionDetailRows(id: string): boolean {
  return id in PRODUCTION_DETAIL_ROWS;
}

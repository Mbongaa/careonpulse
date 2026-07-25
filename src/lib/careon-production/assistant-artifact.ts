import type { AssistantArtifact, AssistantClaim, AssistantVisualization } from "@/data/careon/careon-assistant";
import type { CareonFilters } from "@/data/careon/careon-types";
import { formatCareonValue } from "@/lib/careon-format";

import type { LiveMetric, ProductionSnapshot } from "./types";

interface EvidenceRow {
  label: string;
  value: string;
  detail?: string;
}

const int = new Intl.NumberFormat("nl-NL");
const dec = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function metricRows(metrics: Record<string, LiveMetric>): EvidenceRow[] {
  return Object.values(metrics).map((metric) => ({
    label: metric.label,
    value: metric.noData ? "—" : formatCareonValue(metric.value, metric.f),
    detail: metric.windowLabel,
  }));
}

function table(title: string, sub: string, rows: EvidenceRow[]): AssistantVisualization {
  return {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    kind: "table",
    title,
    sub,
    table: {
      head: ["Meting", "Waarde", "Venster / toelichting"],
      rows: rows.map((row) => ({
        cells: [row.label, row.value, row.detail ?? "—"],
        tone: "none",
      })),
    },
  };
}

function evidenceRows(snapshot: ProductionSnapshot, intent: AssistantArtifact["intent"]): EvidenceRow[] {
  switch (intent) {
    case "directie-overzicht":
      return snapshot.cockpitSummary.map((item) => ({ label: item.label, value: item.value }));
    case "noshow-analyse": {
      const agenda = snapshot.agenda;
      return agenda
        ? metricRows(agenda.planningMetrics).filter((row) => /no.?show|afspraak|sessie/i.test(row.label))
        : [
            {
              label: "Agenda-export",
              value: "Niet beschikbaar",
              detail: "Importeer agenda-data voor live no-showcijfers.",
            },
          ];
    }
    case "capaciteit-planning": {
      const agenda = snapshot.agenda;
      return [
        {
          label: "Gemiddelde wachttijd",
          value: snapshot.gemWachttijdWkn.noData
            ? "—"
            : formatCareonValue(snapshot.gemWachttijdWkn.value, snapshot.gemWachttijdWkn.f),
          detail: snapshot.gemWachttijdWkn.windowLabel,
        },
        ...snapshot.treekLocaties.map((locatie) => ({
          label: `Intake ${locatie.loc}`,
          value: locatie.intake === null ? "—" : `${dec.format(locatie.intake)} weken`,
          detail: locatie.intakeVenster,
        })),
        ...(agenda ? agenda.bezettingPerLocatie : []).map((locatie) => ({
          label: `Bezetting ${locatie.loc}`,
          value: `${dec.format(locatie.pct)}%`,
        })),
      ];
    }
    case "patienten-instroom":
      return metricRows(snapshot.patientenMetrics);
    case "financieel-omzet": {
      const rows = snapshot.agenda ? metricRows(snapshot.agenda.financieel.metrics) : [];
      if (snapshot.declaraties) {
        rows.push(
          { label: "Gefactureerd", value: eur.format(snapshot.declaraties.gefactureerd) },
          { label: "Toegekend", value: eur.format(snapshot.declaraties.toegekend) },
          { label: "Openstaand", value: eur.format(snapshot.declaraties.openstaand) },
        );
      }
      return rows.length
        ? rows
        : [{ label: "Financiële export", value: "Niet beschikbaar", detail: "Importeer agenda/declaratie-data." }];
    }
    case "kwaliteit-dossier":
      return [
        {
          label: "Dossierkwaliteit",
          value: formatCareonValue(snapshot.kwaliteitDossierscore.value, snapshot.kwaliteitDossierscore.f),
        },
        { label: "Compliance", value: `${dec.format(snapshot.dossiercontrole.compliancePct)}%` },
        { label: "Gecontroleerd", value: int.format(snapshot.dossiercontrole.gecontroleerd) },
        { label: "Niet compleet", value: int.format(snapshot.dossiercontrole.nietCompleet) },
      ];
    case "verzuim-hr":
      return [
        {
          label: "HR-verzuimbron",
          value: "Niet beschikbaar",
          detail: "De huidige productie-exports bevatten geen HR-verzuimgegevens; demo-cijfers worden niet getoond.",
        },
      ];
    case "behandelaar-coaching":
      return snapshot.behandelaren.slice(0, 10).map((behandelaar) => ({
        label: behandelaar.naam,
        value: `${int.format(behandelaar.caseload)} cliënten`,
        detail: `${behandelaar.loc} · ${dec.format(behandelaar.directeTijdUren)} directe uren`,
      }));
    case "databron-status": {
      const agenda = snapshot.agenda;
      const verwijzers = snapshot.verwijzerNetwerk;
      const declaraties = snapshot.declaraties;
      return [
        { label: "Hoofdexport", value: snapshot.meta.fileName, detail: snapshot.meta.referenceDate },
        {
          label: "Cliëntrijen",
          value: int.format(snapshot.meta.totalRows),
          detail: `${int.format(snapshot.meta.activeClients)} actief`,
        },
        {
          label: "Agenda",
          value: agenda ? agenda.meta.fileName : "Niet geïmporteerd",
          detail: agenda ? agenda.meta.maandLabel : undefined,
        },
        {
          label: "Verwijzers",
          value: verwijzers ? verwijzers.fileName : "Niet geïmporteerd",
        },
        {
          label: "Declaraties",
          value: declaraties ? declaraties.meta.fileName : "Niet geïmporteerd",
        },
      ];
    }
    case "assistent-acties":
      return [];
  }
}

function claims(rows: EvidenceRow[]): AssistantClaim[] {
  if (!rows.length) return [];
  return [
    {
      title: "Live productie-onderbouwing",
      body: "Deze waarden komen uit dezelfde gefilterde productiesnapshot als het AI-antwoord.",
      values: rows.slice(0, 8).map((row) => ({ label: row.label, value: row.value })),
    },
  ];
}

/**
 * Replaces demo visualizations during a live production answer. The page and
 * intent remain deterministic, while every displayed value comes from the
 * active ProductionSnapshot.
 */
export function buildProductionAssistantArtifact(
  fallback: AssistantArtifact,
  snapshot: ProductionSnapshot,
  filters: CareonFilters,
): AssistantArtifact {
  const rows = evidenceRows(snapshot, fallback.intent);
  return {
    ...fallback,
    visualizations: [
      {
        id: "productiebron",
        kind: "status-card",
        title: "Live productiebron",
        sub: `EPD-export ${snapshot.meta.fileName} · referentiedatum ${snapshot.meta.referenceDate}`,
        statusRows: [
          {
            title: `${int.format(snapshot.meta.totalRows)} bronrijen`,
            detail: `Filter: ${filters.locatie}`,
            tone: "accent",
          },
          {
            title: "Geen demo-waarden in dit canvas",
            detail: "Visualisatie en narratief gebruiken dezelfde productiesnapshot.",
            tone: "good",
          },
        ],
      },
      ...(rows.length ? [table("Live kerncijfers", `Actieve locatie: ${filters.locatie}`, rows)] : []),
    ],
    claims: claims(rows),
    sources: [
      {
        model: "careon.production.snapshot",
        label: `EPD-export ${snapshot.meta.fileName} (${snapshot.meta.referenceDate})`,
        rowCount: snapshot.meta.totalRows,
      },
    ],
  };
}

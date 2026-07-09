import { formatCareonDelta, formatCareonValue } from "@/lib/careon-format";

import { CAREON_ALERTS, CRITICAL_ALERT_COUNT } from "./careon-alerts";
import { BEHANDELAREN, CASELOAD_NORM, caseloadTone, ncTone, noshowTone } from "./careon-behandelaren";
import { EPD_PROVIDERS, SAMPLE_CSV_FILENAME } from "./careon-databron";
import { DOSSIER_CHECKS, DOSSIER_SUMMARY } from "./careon-dossiercontrole";
import { CAREON_ORG } from "./careon-filters";
import { DECLARATIE_OUDERDOM, FINANCIEEL_METRICS, FINANCIEEL_NOTE, OMZET_PER_VERZEKERAAR } from "./careon-financieel";
import { BIG_REGISTRATIES, HR_BIG_NOTE, HR_METRICS } from "./careon-hr";
import { complianceTone, KWALITEIT_COMPLIANCE, KWALITEIT_COUNTERS } from "./careon-kwaliteit";
import { CAREON_PAGE_META, CAREON_ROUTES } from "./careon-pages";
import {
  PATIENTEN_METRICS,
  PATIENTEN_RISICO,
  TREEK_LOCATIES,
  TREEKNORM_WEKEN,
  ZORGVORM_VERDELING,
} from "./careon-patienten";
import {
  BEZETTING_PER_LOCATIE,
  BEZETTING_TOTAAL,
  NOSHOW_PER_WEEKDAG,
  PLANNING_INSIGHT,
  PLANNING_METRICS,
  URENVERDELING,
} from "./careon-planning";
import { CAREON_MONTHLY, GGZ_VERZUIM_BENCHMARK } from "./careon-shared-charts";
import type { CareonFilters, CareonKpi, CareonMetric, CareonPageId, CareonSource } from "./careon-types";

// ---------------------------------------------------------------------------
// Types — mirrors the audited AI-dashboard contract: an intent resolves to a
// plan of read-only visualizations plus claims (numeric proof) and source
// evidence. Everything is deterministic demo data; there is no LLM call.
// ---------------------------------------------------------------------------

export type AssistantIntentId =
  | "directie-overzicht"
  | "noshow-analyse"
  | "capaciteit-planning"
  | "patienten-instroom"
  | "financieel-omzet"
  | "kwaliteit-dossier"
  | "verzuim-hr"
  | "behandelaar-coaching"
  | "databron-status";

export type AssistantTone = "good" | "warn" | "bad" | "accent" | "none";

export interface AssistantSeriesRow {
  label: string;
  sub?: string;
  value: number;
  display: string;
  pct: number;
  tone: AssistantTone;
}

export interface AssistantKpiTile {
  label: string;
  value: string;
  delta: string;
  deltaTone: "good" | "bad" | "neutral";
}

export interface AssistantMonthSeries {
  key: string;
  label: string;
  color: string;
}

export interface AssistantVisualization {
  id: string;
  kind: "kpi-grid" | "rank-list" | "bar-chart" | "donut" | "status-card" | "table";
  title: string;
  sub: string;
  tiles?: AssistantKpiTile[];
  rows?: AssistantSeriesRow[];
  monthSeries?: AssistantMonthSeries[];
  donut?: { name: string; value: number; color: string }[];
  table?: { head: string[]; rows: { cells: string[]; tone: AssistantTone }[] };
  statusRows?: { title: string; detail: string; tone: AssistantTone }[];
}

export interface AssistantClaim {
  title: string;
  body: string;
  values: { label: string; value: string }[];
}

export interface AssistantSourceRef {
  model: string;
  label: string;
  rowCount: number;
}

export interface AssistantArtifact {
  intent: AssistantIntentId;
  query: string;
  page: CareonPageId;
  pageHref: string;
  pageLabel: string;
  visualizations: AssistantVisualization[];
  claims: AssistantClaim[];
  sources: AssistantSourceRef[];
}

export interface AssistantResponse {
  artifact: AssistantArtifact;
  brief: string;
  deep: string;
}

export interface AssistantContext {
  kpis: CareonKpi[];
  filters: CareonFilters;
  source: CareonSource;
}

export const ASSISTANT_INTENT_META: Record<AssistantIntentId, { label: string }> = {
  "directie-overzicht": { label: "Directie-overzicht" },
  "noshow-analyse": { label: "No-show-analyse" },
  "capaciteit-planning": { label: "Capaciteit & planning" },
  "patienten-instroom": { label: "Patiëntenstromen" },
  "financieel-omzet": { label: "Financieel & omzet" },
  "kwaliteit-dossier": { label: "Kwaliteit & dossiers" },
  "verzuim-hr": { label: "Verzuim & HR" },
  "behandelaar-coaching": { label: "Behandelaar-coaching" },
  "databron-status": { label: "Databron-status" },
};

export const ASSISTANT_QUICK_PROMPTS: { id: AssistantIntentId; text: string }[] = [
  { id: "directie-overzicht", text: "Samenvatting van vandaag" },
  { id: "noshow-analyse", text: "Toon no-show afwijkingen" },
  { id: "capaciteit-planning", text: "Waar knelt de capaciteit?" },
  { id: "financieel-omzet", text: "Hoe ontwikkelt de omzet zich?" },
];

// ---------------------------------------------------------------------------
// Intent inference — keyword matching on the normalized query, mirroring the
// audited planResolver approach. Specific domains win before the default.
// ---------------------------------------------------------------------------

const INTENT_KEYWORDS: [AssistantIntentId, string[]][] = [
  ["databron-status", ["databron", "csv", "api", "koppeling", "epd", "import", "bron", "medicore", "nedap"]],
  ["noshow-analyse", ["no-show", "noshow", "no show", "uitval", "afzeg", "gemiste afspraken", "niet verschenen"]],
  [
    "behandelaar-coaching",
    ["behandelaar", "behandelaren", "caseload", "productiviteit", "coaching", "medewerkerprestatie", "psycholoog"],
  ],
  [
    "verzuim-hr",
    ["verzuim", "ziekte", "hr", "personeel", "vacature", "big", "werkdruk", "opleiding", "verloop", "intervisie"],
  ],
  [
    "kwaliteit-dossier",
    ["kwaliteit", "dossier", "rom", "prom", "audit", "compliance", "incident", "klacht", "zorgplan", "evaluatie"],
  ],
  [
    "financieel-omzet",
    ["omzet", "financ", "declarat", "verzekeraar", "infomedics", "onderhanden", "euro", "kosten", "dso", "geld"],
  ],
  [
    "capaciteit-planning",
    ["planning", "bezetting", "agenda", "wachttijd", "treeknorm", "capaciteit", "uren", "rooster", "knelt"],
  ],
  [
    "patienten-instroom",
    ["patiënt", "patient", "aanmeld", "instroom", "uitstroom", "wachtlijst", "zorgvorm", "crisis", "cliënt", "client"],
  ],
];

export function inferAssistantIntent(query: string): AssistantIntentId {
  const text = query.toLowerCase().replace(/\s+/g, " ").trim();
  for (const [intent, terms] of INTENT_KEYWORDS) {
    if (terms.some((term) => text.includes(term))) return intent;
  }
  return "directie-overzicht";
}

// ---------------------------------------------------------------------------
// Shared builders
// ---------------------------------------------------------------------------

const nl = new Intl.NumberFormat("nl-NL");
const nlDec1 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function metricTile(m: CareonMetric): AssistantKpiTile {
  const delta = formatCareonDelta(m);
  return { label: m.label, value: formatCareonValue(m.value, m.f), delta: delta.text, deltaTone: delta.tone };
}

function kpiTile(k: CareonKpi): AssistantKpiTile {
  return metricTile(k);
}

function rankRows(
  items: { label: string; sub?: string; value: number; display: string; tone?: AssistantTone }[],
): AssistantSeriesRow[] {
  const max = Math.max(...items.map((i) => i.value), 1);
  return items.map((i) => ({
    label: i.label,
    sub: i.sub,
    value: i.value,
    display: i.display,
    pct: Math.max(4, Math.round((i.value / max) * 100)),
    tone: i.tone ?? "accent",
  }));
}

const SEV_TONE: Record<string, AssistantTone> = { kritiek: "bad", hoog: "warn", middel: "accent" };

// Descending threshold check: first entry whose bound matches wins.
function toneAbove(value: number, bad: number, warn: number, rest: AssistantTone = "accent"): AssistantTone {
  if (value >= bad) return "bad";
  if (value >= warn) return "warn";
  return rest;
}

function toneBelow(value: number, bad: number, warn: number, rest: AssistantTone = "none"): AssistantTone {
  if (value <= bad) return "bad";
  if (value <= warn) return "warn";
  return rest;
}

function bezettingTone(pct: number): AssistantTone {
  if (pct >= 90) return "good";
  if (pct >= 85) return "accent";
  return "warn";
}

function pageRef(page: CareonPageId): Pick<AssistantArtifact, "page" | "pageHref" | "pageLabel"> {
  return { page, pageHref: CAREON_ROUTES[page], pageLabel: CAREON_PAGE_META[page].title };
}

function scopeLine(filters: CareonFilters): string {
  const parts: string[] = [];
  if (filters.locatie !== "Alle locaties") parts.push(filters.locatie);
  if (filters.team !== "Alle teams") parts.push(filters.team);
  return parts.length ? ` (filter: ${parts.join(" · ")})` : "";
}

function kpiById(kpis: CareonKpi[], id: string): CareonKpi {
  const kpi = kpis.find((k) => k.id === id);
  if (!kpi) throw new Error(`Onbekende KPI: ${id}`);
  return kpi;
}

// ---------------------------------------------------------------------------
// Per-intent artifact builders — all values verbatim from the audited
// constants (optionally location-scaled via the passed-in cockpit KPIs).
// ---------------------------------------------------------------------------

function buildDirectieOverzicht(query: string, ctx: AssistantContext): AssistantResponse {
  const ids = ["actief", "aanmeldingen", "noshow", "omzetverz", "omzetinfo", "tevredenheid"];
  const kpis = ids.map((id) => kpiById(ctx.kpis, id));
  const noshow = kpiById(ctx.kpis, "noshow");
  const omzet = kpiById(ctx.kpis, "omzetverz");
  const critical = CAREON_ALERTS.filter((a) => a.sev === "kritiek");

  const artifact: AssistantArtifact = {
    intent: "directie-overzicht",
    query,
    ...pageRef("cockpit"),
    visualizations: [
      {
        id: "kpis",
        kind: "kpi-grid",
        title: "Kerncijfers vandaag",
        sub: "Zes gevolgde KPI's uit de directiecockpit",
        tiles: kpis.map(kpiTile),
      },
      {
        id: "signalen",
        kind: "status-card",
        title: "Kritieke signaleringen",
        sub: `${CRITICAL_ALERT_COUNT} van ${CAREON_ALERTS.length} signaleringen zijn kritiek`,
        statusRows: critical.map((a) => ({ title: a.titel, detail: `${a.unit} · ${a.detail}`, tone: "bad" })),
      },
      {
        id: "instroom",
        kind: "bar-chart",
        title: "Instroom vs. uitstroom",
        sub: "Aantal patiënten per maand, laatste 12 maanden",
        monthSeries: [
          { key: "aanmeldingen", label: "Aanmeldingen", color: "var(--chart-1)" },
          { key: "uitstroom", label: "Uitstroom", color: "var(--chart-2)" },
        ],
      },
    ],
    claims: [
      {
        title: "No-show op laagste punt van het jaar",
        body: "De sms-herinnering-pilot lijkt te werken; overweeg uitrol naar alle locaties.",
        values: [
          { label: "Huidig", value: formatCareonValue(noshow.value, noshow.f) },
          { label: "Vorige maand", value: formatCareonValue(noshow.prev, noshow.f) },
        ],
      },
      {
        title: "Omzet groeit door",
        body: "Omzet verzekeraars steeg 6,0% ten opzichte van vorige maand; Infomedics zelfs 15,3%.",
        values: [
          { label: "Verzekeraars", value: formatCareonValue(omzet.value, omzet.f) },
          { label: "Delta", value: formatCareonDelta(omzet).text },
        ],
      },
      {
        title: "Treeknorm-overschrijding in Roermond",
        body: "Wachtlijst intake Roermond (15,2 wkn) overschrijdt de Treeknorm van 14 weken; Tilburg heeft ruimte (3,1 wkn).",
        values: [
          { label: "Roermond intake", value: "15,2 wkn" },
          { label: "Treeknorm", value: `${TREEKNORM_WEKEN} wkn` },
        ],
      },
    ],
    sources: [
      { model: "careon.kpi", label: "Directiecockpit KPI's", rowCount: ctx.kpis.length },
      { model: "careon.signalering", label: "Signaleringen", rowCount: CAREON_ALERTS.length },
      { model: "careon.maandreeks", label: "Maandreeksen aug–jul", rowCount: CAREON_MONTHLY.length },
    ],
  };

  const brief = `Het gaat per saldo goed${scopeLine(ctx.filters)}: ${formatCareonValue(kpiById(ctx.kpis, "actief").value, "int")} actieve patiënten (+2,7%), no-show gedaald naar ${formatCareonValue(noshow.value, noshow.f)} en de omzet groeide 6,0%. Er staan ${CRITICAL_ALERT_COUNT} kritieke signaleringen open — de wachtlijst in Roermond overschrijdt de Treeknorm.`;
  const deep = `${brief}\n\n**Waar het knelt:**\n- Wachtlijst intake Roermond: 15,2 wkn (Treeknorm ${TREEKNORM_WEKEN} wkn) — herverdeling naar Tilburg (3,1 wkn) scheelt naar schatting 6 weken.\n- ${critical.length} kritieke signaleringen, o.a. "${critical[0]?.titel}".\n\n**Wat goed gaat:**\n- No-show ${formatCareonValue(noshow.prev, noshow.f)} → ${formatCareonValue(noshow.value, noshow.f)} (beste maand dit jaar).\n- Omzet verzekeraars ${formatCareonValue(omzet.value, omzet.f)} (+6,0%), Infomedics +15,3%.\n- Cliënttevredenheid 8,4 (was 8,2).`;

  return { artifact, brief, deep };
}

function buildNoshowAnalyse(query: string, ctx: AssistantContext): AssistantResponse {
  const noshow = kpiById(ctx.kpis, "noshow");
  const worstDay = NOSHOW_PER_WEEKDAG[NOSHOW_PER_WEEKDAG.length - 1];
  const topBehandelaren = [...BEHANDELAREN].sort((a, b) => b.noshow - a.noshow).slice(0, 5);

  const artifact: AssistantArtifact = {
    intent: "noshow-analyse",
    query,
    ...pageRef("planning"),
    visualizations: [
      {
        id: "kpis",
        kind: "kpi-grid",
        title: "No-show in cijfers",
        sub: "Cockpit-KPI plus planningstellers van deze maand",
        tiles: [kpiTile(noshow), ...PLANNING_METRICS.slice(1, 3).map(metricTile), metricTile(PLANNING_METRICS[0])],
      },
      {
        id: "trend",
        kind: "bar-chart",
        title: "No-show per maand",
        sub: "Percentage gemiste afspraken, laatste 12 maanden",
        monthSeries: [{ key: "noshow", label: "No-show %", color: "var(--chart-1)" }],
      },
      {
        id: "weekdag",
        kind: "rank-list",
        title: "No-show per weekdag",
        sub: "Vrijdag is structureel de uitschieter",
        rows: rankRows(
          NOSHOW_PER_WEEKDAG.map((d) => ({
            label: d.dag,
            value: d.pct,
            display: `${nlDec1.format(d.pct)}%`,
            tone: toneAbove(d.pct, 4, 3.5),
          })),
        ),
      },
      {
        id: "behandelaren",
        kind: "rank-list",
        title: "Hoogste no-show per behandelaar",
        sub: "Top 5 van 10 behandelaren",
        rows: rankRows(
          topBehandelaren.map((b) => ({
            label: b.naam,
            sub: `${b.team} · ${b.loc}`,
            value: b.noshow,
            display: `${nlDec1.format(b.noshow)}%`,
            tone: noshowTone(b.noshow) === "none" ? "accent" : (noshowTone(b.noshow) as AssistantTone),
          })),
        ),
      },
    ],
    claims: [
      {
        title: "Beste maand van het jaar",
        body: "No-show daalde van 4,1% naar 3,4%. De sms-herinnering-pilot lijkt te werken.",
        values: [
          { label: "Huidig", value: formatCareonValue(noshow.value, noshow.f) },
          { label: "Delta", value: formatCareonDelta(noshow).text },
        ],
      },
      {
        title: "Vrijdagpiek blijft staan",
        body: PLANNING_INSIGHT,
        values: [
          { label: "Vrijdag", value: `${nlDec1.format(worstDay.pct)}%` },
          { label: "Maandag", value: `${nlDec1.format(NOSHOW_PER_WEEKDAG[0].pct)}%` },
        ],
      },
    ],
    sources: [
      { model: "careon.kpi", label: "Directiecockpit KPI's", rowCount: ctx.kpis.length },
      { model: "careon.maandreeks", label: "Maandreeksen aug–jul", rowCount: CAREON_MONTHLY.length },
      { model: "careon.planning.weekdag", label: "No-show per weekdag", rowCount: NOSHOW_PER_WEEKDAG.length },
      { model: "careon.behandelaar", label: "Behandelaren", rowCount: BEHANDELAREN.length },
    ],
  };

  const brief = `No-show staat op ${formatCareonValue(noshow.value, noshow.f)} — de beste maand dit jaar (vorige maand ${formatCareonValue(noshow.prev, noshow.f)}). De uitschieters: vrijdag (${nlDec1.format(worstDay.pct)}%) en ${topBehandelaren[0].naam} (${nlDec1.format(topBehandelaren[0].noshow)}%).`;
  const deep = `${brief}\n\n**Patroon per weekdag:** oplopend van ma ${nlDec1.format(NOSHOW_PER_WEEKDAG[0].pct)}% naar vr ${nlDec1.format(worstDay.pct)}%.\n\n**Per behandelaar:** ${topBehandelaren
    .slice(0, 3)
    .map((b) => `${b.naam} ${nlDec1.format(b.noshow)}%`)
    .join(", ")}.\n\n**Aanbeveling:** ${PLANNING_INSIGHT}`;

  return { artifact, brief, deep };
}

function buildCapaciteitPlanning(query: string, _ctx: AssistantContext): AssistantResponse {
  const roermond = TREEK_LOCATIES[2];
  const wachttijd = PLANNING_METRICS[8];

  const artifact: AssistantArtifact = {
    intent: "capaciteit-planning",
    query,
    ...pageRef("planning"),
    visualizations: [
      {
        id: "kpis",
        kind: "kpi-grid",
        title: "Planning deze maand",
        sub: "Kerncijfers agenda en uren",
        tiles: [PLANNING_METRICS[0], PLANNING_METRICS[3], PLANNING_METRICS[4], wachttijd].map(metricTile),
      },
      {
        id: "bezetting",
        kind: "rank-list",
        title: "Agenda-bezetting per locatie",
        sub: `Gemiddeld ${BEZETTING_TOTAAL}% over alle locaties`,
        rows: rankRows(
          BEZETTING_PER_LOCATIE.map((b) => ({
            label: b.loc,
            value: b.pct,
            display: `${b.pct}%`,
            tone: bezettingTone(b.pct),
          })),
        ),
      },
      {
        id: "uren",
        kind: "donut",
        title: "Urenverdeling",
        sub: "Beschikbare uren naar besteding",
        donut: URENVERDELING,
      },
      {
        id: "treek",
        kind: "table",
        title: "Wachttijden vs. Treeknorm",
        sub: `Treeknorm: ${TREEKNORM_WEKEN} weken`,
        table: {
          head: ["Locatie", "Intake (wkn)", "Behandeling (wkn)"],
          rows: TREEK_LOCATIES.map((t) => ({
            cells: [t.loc, nlDec1.format(t.intake), nlDec1.format(t.behandeling)],
            tone: t.intake > TREEKNORM_WEKEN ? ("bad" as const) : ("none" as const),
          })),
        },
      },
    ],
    claims: [
      {
        title: "Roermond overschrijdt de Treeknorm",
        body: "Wachtlijst intake Roermond is 15,2 weken; herverdeling naar Tilburg (3,1 wkn) scheelt naar schatting 6 weken.",
        values: [
          { label: "Roermond intake", value: `${nlDec1.format(roermond.intake)} wkn` },
          { label: "Norm", value: `${TREEKNORM_WEKEN} wkn` },
        ],
      },
      {
        title: "Gemiddelde wachttijd daalt",
        body: "Van 6,0 naar 5,2 weken; agenda-bezetting steeg naar 87%.",
        values: [
          { label: "Wachttijd", value: `${nlDec1.format(wachttijd.value)} wkn` },
          { label: "Bezetting", value: `${BEZETTING_TOTAAL}%` },
        ],
      },
    ],
    sources: [
      { model: "careon.planning", label: "Planningstellers", rowCount: PLANNING_METRICS.length },
      { model: "careon.planning.bezetting", label: "Bezetting per locatie", rowCount: BEZETTING_PER_LOCATIE.length },
      { model: "careon.treeknorm", label: "Wachttijden per locatie", rowCount: TREEK_LOCATIES.length },
    ],
  };

  const brief = `De agenda-bezetting staat op ${BEZETTING_TOTAAL}% en de gemiddelde wachttijd daalde naar ${nlDec1.format(wachttijd.value)} weken. Het knelpunt zit in Roermond: intake ${nlDec1.format(roermond.intake)} weken, boven de Treeknorm van ${TREEKNORM_WEKEN}.`;
  const deep = `${brief}\n\n**Bezetting per locatie:** Tilburg 91%, Breda 86%, Roermond 82%.\n\n**Uren:** 2.930 behandeluren van 4.520 beschikbare uren; 680 indirecte uren (+45 t.o.v. vorige maand).\n\n**Actie:** herverdeel intakes van Roermond naar Tilburg — geschatte winst 6 weken wachttijd.`;

  return { artifact, brief, deep };
}

function buildPatientenInstroom(query: string, ctx: AssistantContext): AssistantResponse {
  const actief = kpiById(ctx.kpis, "actief");

  const artifact: AssistantArtifact = {
    intent: "patienten-instroom",
    query,
    ...pageRef("patienten"),
    visualizations: [
      {
        id: "kpis",
        kind: "kpi-grid",
        title: "Patiëntenstromen",
        sub: "Kernindicatoren instroom, uitstroom en risico",
        tiles: [PATIENTEN_METRICS[0], PATIENTEN_METRICS[1], PATIENTEN_METRICS[2], PATIENTEN_METRICS[3]].map(metricTile),
      },
      {
        id: "instroom",
        kind: "bar-chart",
        title: "Instroom vs. uitstroom",
        sub: "Aantal patiënten per maand, laatste 12 maanden",
        monthSeries: [
          { key: "aanmeldingen", label: "Aanmeldingen", color: "var(--chart-1)" },
          { key: "uitstroom", label: "Uitstroom", color: "var(--chart-2)" },
        ],
      },
      {
        id: "zorgvorm",
        kind: "donut",
        title: "Verdeling per zorgvorm",
        sub: "Actieve patiënten naar zorgvorm (%)",
        donut: ZORGVORM_VERDELING,
      },
      {
        id: "risico",
        kind: "table",
        title: "Vraagt aandacht",
        sub: "Cliënten met een openstaand risicosignaal",
        table: {
          head: ["Cliënt", "Team · locatie", "Signaal", "Dagen"],
          rows: PATIENTEN_RISICO.map((p) => ({
            cells: [`${p.naam} (${p.id})`, `${p.team} · ${p.loc}`, p.signaal, String(p.dagen)],
            tone: toneAbove(p.dagen, 60, 40, "none"),
          })),
        },
      },
    ],
    claims: [
      {
        title: "Caseload groeit gestaag",
        body: "Actieve patiënten stegen naar het hoogste punt van het jaar; instroom (86) overtreft uitstroom (74).",
        values: [
          { label: "Actief", value: formatCareonValue(actief.value, actief.f) },
          { label: "Delta", value: formatCareonDelta(actief).text },
        ],
      },
      {
        title: "Wachtlijsten dalen",
        body: "Wachtlijst intake daalde van 51 naar 43; zonder-behandelaar daalde van 14 naar 9.",
        values: [
          { label: "Wachtlijst intake", value: "43" },
          { label: "Zonder behandelaar", value: "9" },
        ],
      },
      {
        title: "Let op crisiscliënten",
        body: "Het aantal crisiscliënten steeg van 5 naar 7; twee cliënten hebben >60 dagen geen contact gehad.",
        values: [
          { label: "Crisiscliënten", value: "7" },
          { label: ">60 dgn geen contact", value: "23" },
        ],
      },
    ],
    sources: [
      { model: "careon.patient", label: "Patiëntentellers", rowCount: PATIENTEN_METRICS.length },
      { model: "careon.maandreeks", label: "Maandreeksen aug–jul", rowCount: CAREON_MONTHLY.length },
      { model: "careon.patient.risico", label: "Risicosignalen", rowCount: PATIENTEN_RISICO.length },
    ],
  };

  const brief = `De caseload groeit: ${formatCareonValue(actief.value, actief.f)} actieve patiënten${scopeLine(ctx.filters)} met 86 nieuwe aanmeldingen tegenover 74 uitstromers. Wachtlijsten dalen, maar 5 cliënten vragen directe aandacht.`;
  const deep = `${brief}\n\n**Zorgvormen:** SGGZ 46%, BGGZ 27%, FACT 15%, Ouderen 12%.\n\n**Risico's:** crisiscliënten 5 → 7; 23 cliënten >60 dagen geen contact (was 28). Grootste uitschieter: D. van Leeuwen (74 dagen, Roermond).\n\n**Advies:** loop de lijst "Vraagt aandacht" na op de patiëntenpagina.`;

  return { artifact, brief, deep };
}

function buildFinancieelOmzet(query: string, ctx: AssistantContext): AssistantResponse {
  const omzetVerz = kpiById(ctx.kpis, "omzetverz");
  const omzetInfo = kpiById(ctx.kpis, "omzetinfo");

  const artifact: AssistantArtifact = {
    intent: "financieel-omzet",
    query,
    ...pageRef("financieel"),
    visualizations: [
      {
        id: "kpis",
        kind: "kpi-grid",
        title: "Financiële kerncijfers",
        sub: "Omzet, onderhanden werk en declaraties",
        tiles: [kpiTile(omzetVerz), kpiTile(omzetInfo), ...FINANCIEEL_METRICS.slice(2, 4).map(metricTile)],
      },
      {
        id: "omzet",
        kind: "bar-chart",
        title: "Omzet per maand",
        sub: "Verzekeraars en Infomedics (× € 1.000)",
        monthSeries: [
          { key: "omzetVerz", label: "Verzekeraars", color: "var(--chart-1)" },
          { key: "omzetInfo", label: "Infomedics", color: "var(--chart-2)" },
        ],
      },
      {
        id: "verzekeraars",
        kind: "donut",
        title: "Omzet per verzekeraar",
        sub: "Deze maand (× € 1.000)",
        donut: OMZET_PER_VERZEKERAAR,
      },
      {
        id: "ouderdom",
        kind: "rank-list",
        title: "Ouderdom openstaande declaraties",
        sub: "Percentage van € 96.400 openstaand",
        rows: rankRows(
          DECLARATIE_OUDERDOM.map((d, i) => ({
            label: d.label,
            value: d.pct,
            display: `${d.pct}%`,
            tone: toneAbove(i, 3, 2),
          })),
        ),
      },
    ],
    claims: [
      {
        title: "Omzet stijgt op beide stromen",
        body: "Verzekeraars +6,0% en Infomedics +15,3% ten opzichte van vorige maand.",
        values: [
          { label: "Verzekeraars", value: formatCareonValue(omzetVerz.value, omzetVerz.f) },
          { label: "Infomedics", value: formatCareonValue(omzetInfo.value, omzetInfo.f) },
        ],
      },
      {
        title: "Oude declaraties concentreren zich",
        body: FINANCIEEL_NOTE,
        values: [
          { label: ">90 dagen", value: "€ 21.300" },
          { label: "Openstaand totaal", value: "€ 96.400" },
        ],
      },
    ],
    sources: [
      { model: "careon.financieel", label: "Financiële tellers", rowCount: FINANCIEEL_METRICS.length },
      { model: "careon.maandreeks", label: "Maandreeksen aug–jul", rowCount: CAREON_MONTHLY.length },
      { model: "careon.verzekeraar", label: "Omzet per verzekeraar", rowCount: OMZET_PER_VERZEKERAAR.length },
    ],
  };

  const brief = `De omzet ontwikkelt zich goed${scopeLine(ctx.filters)}: verzekeraars ${formatCareonValue(omzetVerz.value, omzetVerz.f)} (+6,0%) en Infomedics ${formatCareonValue(omzetInfo.value, omzetInfo.f)} (+15,3%). Aandachtspunt: € 21.300 aan declaraties staat langer dan 90 dagen open.`;
  const deep = `${brief}\n\n**Verzekeraarsmix:** VGZ € 128K, CZ € 104K, Zilveren Kruis € 92K, Menzis € 58K, DSW € 27K, overig € 16K.\n\n**Werkkapitaal:** onderhanden werk € 182K (groeit mee met de omzet — plan declaratiemoment in week 29); openstaand € 96.400, waarvan 5% ouder dan 90 dagen.\n\n**Actie:** ${FINANCIEEL_NOTE}`;

  return { artifact, brief, deep };
}

function buildKwaliteitDossier(query: string, _ctx: AssistantContext): AssistantResponse {
  const worstChecks = [...DOSSIER_CHECKS].sort((a, b) => b.n - a.n).slice(0, 6);
  const kritiek = DOSSIER_CHECKS.filter((c) => c.sev === "kritiek").reduce((sum, c) => sum + c.n, 0);

  const artifact: AssistantArtifact = {
    intent: "kwaliteit-dossier",
    query,
    ...pageRef("kwaliteit"),
    visualizations: [
      {
        id: "compliance",
        kind: "rank-list",
        title: "Compliance vs. doel",
        sub: "Zes kwaliteitsindicatoren met instelbaar doel",
        rows: rankRows(
          KWALITEIT_COMPLIANCE.map((c) => ({
            label: c.label,
            sub: `doel ${c.doel}%`,
            value: c.value,
            display: `${c.value}%`,
            tone: complianceTone(c.value, c.doel) as AssistantTone,
          })),
        ),
      },
      {
        id: "counters",
        kind: "kpi-grid",
        title: "Kwaliteitstellers",
        sub: "Incidenten, klachten en scores",
        tiles: KWALITEIT_COUNTERS.map(metricTile),
      },
      {
        id: "checks",
        kind: "table",
        title: "Grootste open actiepunten (dossiercontrole)",
        sub: "Twaalf automatische controles draaien elke nacht",
        table: {
          head: ["Controle", "Dossiers", "Urgentie"],
          rows: worstChecks.map((c) => ({
            cells: [c.check, String(c.n), c.sev],
            tone: SEV_TONE[c.sev] ?? "none",
          })),
        },
      },
    ],
    claims: [
      {
        title: "Dossier-compliance is hoog",
        body: `Van de ${nl.format(DOSSIER_SUMMARY.gecontroleerd)} gecontroleerde dossiers is ${nlDec1.format(DOSSIER_SUMMARY.compliancePct)}% compleet; auditscore ${nlDec1.format(DOSSIER_SUMMARY.auditScore)} van 10.`,
        values: [
          { label: "Compliance", value: `${nlDec1.format(DOSSIER_SUMMARY.compliancePct)}%` },
          { label: "Niet compleet", value: String(DOSSIER_SUMMARY.nietCompleet) },
        ],
      },
      {
        title: "ROM en PROM blijven achter op doel",
        body: "ROM-compliance 78% (doel 85%), PROM 71% (doel 80%) — de grootste gaten in de set.",
        values: [
          { label: "ROM", value: "78% / 85%" },
          { label: "PROM", value: "71% / 80%" },
        ],
      },
      {
        title: "Kritieke dossieritems",
        body: "Tien dossiers missen een kritiek item (behandelplan, zorgplan, diagnose of toestemmingsformulier).",
        values: [
          { label: "Kritiek", value: String(kritiek) },
          { label: "Laatste controle", value: DOSSIER_SUMMARY.laatsteCheck },
        ],
      },
    ],
    sources: [
      { model: "careon.kwaliteit", label: "Compliance-indicatoren", rowCount: KWALITEIT_COMPLIANCE.length },
      { model: "careon.kwaliteit.teller", label: "Kwaliteitstellers", rowCount: KWALITEIT_COUNTERS.length },
      { model: "careon.dossiercheck", label: "Dossiercontroles", rowCount: DOSSIER_CHECKS.length },
    ],
  };

  const brief = `De dossier-compliance staat op ${nlDec1.format(DOSSIER_SUMMARY.compliancePct)}% (${DOSSIER_SUMMARY.nietCompleet} dossiers niet compleet) en de auditscore op ${nlDec1.format(DOSSIER_SUMMARY.auditScore)}. ROM (78%) en PROM (71%) blijven het verst achter op hun doel.`;
  const deep = `${brief}\n\n**Compliance vs. doel:** medicatiecontroles 96/98, suïcidaliteitsscreening 91/100, zorgplannen 88/95, evaluaties 84/90, ROM 78/85, PROM 71/80.\n\n**Dossiercontrole:** grootste aantallen zitten in "Geen PROM" (17), "Geen ROM" (14) en "Geen toekomstig consult" (12); ${kritiek} dossiers missen een kritiek item.\n\n**Trend:** incidenten 9 → 6, klachten 3 → 2, dossierkwaliteit 7,8 → 8,1.`;

  return { artifact, brief, deep };
}

function buildVerzuimHr(query: string, _ctx: AssistantContext): AssistantResponse {
  const verzuim = HR_METRICS[0];

  const artifact: AssistantArtifact = {
    intent: "verzuim-hr",
    query,
    ...pageRef("hr"),
    visualizations: [
      {
        id: "kpis",
        kind: "kpi-grid",
        title: "HR-kerncijfers",
        sub: "Verzuim, verloop en ontwikkeling",
        tiles: HR_METRICS.slice(0, 4).map(metricTile),
      },
      {
        id: "verzuim",
        kind: "bar-chart",
        title: "Ziekteverzuim per maand",
        sub: `GGZ-benchmark: ${nlDec1.format(GGZ_VERZUIM_BENCHMARK)}%`,
        monthSeries: [{ key: "verzuim", label: "Verzuim %", color: "var(--chart-1)" }],
      },
      {
        id: "big",
        kind: "table",
        title: "BIG-registraties die verlopen",
        sub: HR_BIG_NOTE,
        table: {
          head: ["Medewerker", "Functie", "Verloopt", "Dagen"],
          rows: BIG_REGISTRATIES.map((b) => ({
            cells: [b.naam, b.functie, b.verloopt, String(b.dagen)],
            tone: toneBelow(b.dagen, 45, 60),
          })),
        },
      },
    ],
    claims: [
      {
        title: "Verzuim onder de GGZ-benchmark",
        body: `Ziekteverzuim daalde naar ${nlDec1.format(verzuim.value)}%, onder de benchmark van ${nlDec1.format(GGZ_VERZUIM_BENCHMARK)}%.`,
        values: [
          { label: "Verzuim", value: `${nlDec1.format(verzuim.value)}%` },
          { label: "Benchmark", value: `${nlDec1.format(GGZ_VERZUIM_BENCHMARK)}%` },
        ],
      },
      {
        title: "BIG-registratie L. Vermeer verloopt eerst",
        body: "Verloopt 14 aug 2026 (39 dagen). Careon Pulse mailt automatisch op 90, 60 en 30 dagen vooraf.",
        values: [
          { label: "Eerstvolgende", value: "L. Vermeer" },
          { label: "Dagen", value: "39" },
        ],
      },
    ],
    sources: [
      { model: "careon.hr", label: "HR-tellers", rowCount: HR_METRICS.length },
      { model: "careon.maandreeks", label: "Maandreeksen aug–jul", rowCount: CAREON_MONTHLY.length },
      { model: "careon.big", label: "BIG-registraties", rowCount: BIG_REGISTRATIES.length },
    ],
  };

  const brief = `Het ziekteverzuim daalde naar ${nlDec1.format(verzuim.value)}% en ligt daarmee onder de GGZ-benchmark van ${nlDec1.format(GGZ_VERZUIM_BENCHMARK)}%. Verloop en vacatures dalen; drie BIG-registraties verlopen binnen 90 dagen.`;
  const deep = `${brief}\n\n**Trend:** verzuim was vorige maand 6,4% en piekte in januari op 7,1%.\n\n**Ontwikkeling:** 12 lopende opleidingen (was 9), intervisie-deelname 92%, werkdrukscore verbeterde van 7,3 naar 6,9.\n\n**Actie:** BIG-registratie van L. Vermeer (GZ-psycholoog) verloopt over 39 dagen — herregistratie starten.`;

  return { artifact, brief, deep };
}

function buildBehandelaarCoaching(query: string, _ctx: AssistantContext): AssistantResponse {
  const byCaseload = [...BEHANDELAREN].sort((a, b) => b.caseload - a.caseload);
  const overNorm = BEHANDELAREN.filter((b) => b.caseload > CASELOAD_NORM);
  const withNc = BEHANDELAREN.filter((b) => b.nc > 0).sort((a, b) => b.nc - a.nc);

  const artifact: AssistantArtifact = {
    intent: "behandelaar-coaching",
    query,
    ...pageRef("behandelaren"),
    visualizations: [
      {
        id: "caseload",
        kind: "rank-list",
        title: "Caseload per behandelaar",
        sub: `Norm: ${CASELOAD_NORM} cliënten`,
        rows: rankRows(
          byCaseload.slice(0, 6).map((b) => ({
            label: b.naam,
            sub: `${b.team} · ${b.loc}`,
            value: b.caseload,
            display: String(b.caseload),
            tone: caseloadTone(b.caseload) === "none" ? "accent" : (caseloadTone(b.caseload) as AssistantTone),
          })),
        ),
      },
      {
        id: "dossiers",
        kind: "table",
        title: "Dossiers niet compleet per behandelaar",
        sub: "Alleen behandelaren met openstaande dossiers",
        table: {
          head: ["Behandelaar", "Team · locatie", "Dossiers NC", "ROM"],
          rows: withNc.map((b) => ({
            cells: [b.naam, `${b.team} · ${b.loc}`, String(b.nc), nlDec1.format(b.rom)],
            tone: ncTone(b.nc) === "none" ? "none" : (ncTone(b.nc) as AssistantTone),
          })),
        },
      },
    ],
    claims: [
      {
        title: `${overNorm.length} behandelaren boven de caseloadnorm`,
        body: `De norm is ${CASELOAD_NORM} cliënten; ${byCaseload[0].naam} zit het hoogst met ${byCaseload[0].caseload}.`,
        values: [
          { label: "Boven norm", value: String(overNorm.length) },
          { label: "Hoogste", value: `${byCaseload[0].caseload}` },
        ],
      },
      {
        title: "Dossierwerk concentreert zich",
        body: `${withNc[0]?.naam} heeft de meeste niet-complete dossiers (${withNc[0]?.nc}); koppel dossiercoaching aan de caseloadgesprekken.`,
        values: [
          { label: "Meeste NC", value: withNc[0]?.naam ?? "—" },
          { label: "Aantal", value: String(withNc[0]?.nc ?? 0) },
        ],
      },
    ],
    sources: [{ model: "careon.behandelaar", label: "Behandelaren", rowCount: BEHANDELAREN.length }],
  };

  const brief = `${overNorm.length} van de ${BEHANDELAREN.length} behandelaren zitten boven de caseloadnorm van ${CASELOAD_NORM}; ${byCaseload[0].naam} het hoogst met ${byCaseload[0].caseload} cliënten. Combineer de caseloadgesprekken met dossiercoaching: ${withNc[0]?.naam} heeft ${withNc[0]?.nc} niet-complete dossiers.`;
  const deep = `${brief}\n\n**Caseload top 3:** ${byCaseload
    .slice(0, 3)
    .map((b) => `${b.naam} (${b.caseload})`)
    .join(
      ", ",
    )}.\n\n**No-show:** hoogste is ${[...BEHANDELAREN].sort((a, b) => b.noshow - a.noshow)[0].naam} — bekijk of de vrijdagafspraken daar clusteren.\n\n**Kwaliteit:** ROM-scores lopen uiteen; leg de link met de ROM-compliance (78%) uit het kwaliteitsoverzicht.`;

  return { artifact, brief, deep };
}

const SOURCE_MODE_TONE: Record<CareonSource["mode"], AssistantTone> = { demo: "warn", csv: "accent", api: "good" };

const SOURCE_MODE_BODY: Record<CareonSource["mode"], string> = {
  demo: "Alle cijfers komen uit de vaste demo-dataset. Upload een CSV of activeer een EPD-koppeling op de databronpagina.",
  csv: "Cockpit-KPI's zijn overschreven door de laatste CSV-import; herstel demo-data zet ze terug.",
  api: "De API-koppeling is actief (sandbox). Herstel demo-data verbreekt de verbinding.",
};

function buildDatabronStatus(query: string, ctx: AssistantContext): AssistantResponse {
  const modeTone = SOURCE_MODE_TONE[ctx.source.mode];

  const artifact: AssistantArtifact = {
    intent: "databron-status",
    query,
    ...pageRef("databron"),
    visualizations: [
      {
        id: "bron",
        kind: "status-card",
        title: "Actieve databron",
        sub: `${CAREON_ORG.name} · ${CAREON_ORG.customerChip}`,
        statusRows: [
          { title: ctx.source.label, detail: ctx.source.detail, tone: modeTone },
          {
            title: "CSV-import",
            detail: `Formaat: kpi;huidig;vorige_maand — voorbeeldbestand: ${SAMPLE_CSV_FILENAME}`,
            tone: "none",
          },
          { title: "Herstel demo-data", detail: "Zet alle KPI's terug naar de demo-waarden", tone: "none" },
        ],
      },
      {
        id: "providers",
        kind: "table",
        title: "Beschikbare EPD-koppelingen",
        sub: "Sandbox-koppelingen voor de API-modus",
        table: {
          head: ["Provider", "Status"],
          rows: EPD_PROVIDERS.map((p: { name: string }) => ({
            cells: [
              p.name,
              ctx.source.mode === "api" && ctx.source.detail.startsWith(p.name) ? "Verbonden" : "Beschikbaar",
            ],
            tone:
              ctx.source.mode === "api" && ctx.source.detail.startsWith(p.name) ? ("good" as const) : ("none" as const),
          })),
        },
      },
    ],
    claims: [
      {
        title: `Bron: ${ctx.source.label}`,
        body: SOURCE_MODE_BODY[ctx.source.mode],
        values: [
          { label: "Modus", value: ctx.source.mode.toUpperCase() },
          { label: "Detail", value: ctx.source.detail },
        ],
      },
    ],
    sources: [{ model: "careon.databron", label: "Bronconfiguratie", rowCount: EPD_PROVIDERS.length + 1 }],
  };

  const brief = `De actieve databron is "${ctx.source.label}" (${ctx.source.detail}). Via de databronpagina kun je een CSV importeren (formaat kpi;huidig;vorige_maand) of een EPD-sandbox koppelen.`;
  const deep = `${brief}\n\n**Modi:** demo-data → CSV-import → API live. "Herstel demo-data" zet de cockpit terug naar de vaste demo-waarden.\n\n**EPD-providers:** ${EPD_PROVIDERS.map((p: { name: string }) => p.name).join(", ")}.`;

  return { artifact, brief, deep };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const INTENT_BUILDERS: Record<AssistantIntentId, (query: string, ctx: AssistantContext) => AssistantResponse> = {
  "directie-overzicht": buildDirectieOverzicht,
  "noshow-analyse": buildNoshowAnalyse,
  "capaciteit-planning": buildCapaciteitPlanning,
  "patienten-instroom": buildPatientenInstroom,
  "financieel-omzet": buildFinancieelOmzet,
  "kwaliteit-dossier": buildKwaliteitDossier,
  "verzuim-hr": buildVerzuimHr,
  "behandelaar-coaching": buildBehandelaarCoaching,
  "databron-status": buildDatabronStatus,
};

export function resolveAssistantResponse(
  query: string,
  ctx: AssistantContext,
  intentHint?: AssistantIntentId,
): AssistantResponse {
  const intent = intentHint ?? inferAssistantIntent(query);
  return INTENT_BUILDERS[intent](query, ctx);
}

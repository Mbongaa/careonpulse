import { COCKPIT_KPIS } from "./careon-kpis";

export const EPD_PROVIDERS = [
  { id: "medicore", name: "Medicore EPD", sub: "REST · FHIR R4", mark: "M", color: "var(--chart-1)" },
  { id: "nedap", name: "Nedap ONS", sub: "REST · OAuth2", mark: "N", color: "var(--chart-2)" },
  { id: "myneva", name: "myneva", sub: "REST · webhook", mark: "my", color: "var(--chart-3)" },
  { id: "custom", name: "Eigen REST-API", sub: "API-key of OAuth2", mark: "</>", color: "var(--chart-4)" },
];

export const SAMPLE_CSV_FILENAME = "careon-kpi-export.csv";

export const SAMPLE_CSV_CONTENT = [
  "kpi;huidig;vorige_maand",
  ...COCKPIT_KPIS.map((k) => `${k.id};${k.value};${k.prev}`),
].join("\n");

export const API_SUCCESS_COPY =
  "Sandbox-koppeling actief — het dashboard toont nu de live badge. In productie draait dit op de Careon-cloud, ingericht naar de uitgangspunten van ISO 27001 en NEN 7510.";

export interface CsvParseResult {
  matched: number;
  overrides: Record<string, { value: number; prev: number }>;
  message: string;
  ok: boolean;
}

// Parser behavior mirrors the audited bundle: ";" or "," separators, decimal
// commas, and only KPI ids from the Directiecockpit set are recognized.
export function parseKpiCsv(fileName: string, text: string): CsvParseResult {
  const knownIds = new Set(COCKPIT_KPIS.map((k) => k.id));
  const overrides: Record<string, { value: number; prev: number }> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = line.split(line.includes(";") ? ";" : ",").map((c) => c.trim());
    if (cells.length < 3) continue;
    const [id, huidig, vorige] = cells;
    if (!knownIds.has(id)) continue;
    const value = Number.parseFloat(huidig.replace(",", "."));
    const prev = Number.parseFloat(vorige.replace(",", "."));
    if (Number.isNaN(value) || Number.isNaN(prev)) continue;
    overrides[id] = { value, prev };
  }

  const matched = Object.keys(overrides).length;
  if (matched === 0) {
    return {
      matched,
      overrides,
      ok: false,
      message: `Geen herkenbare KPI's in ${fileName} — gebruik het voorbeeldbestand als basis.`,
    };
  }

  return {
    matched,
    overrides,
    ok: true,
    message: `${fileName} verwerkt — ${matched} KPI's bijgewerkt in de cockpit.`,
  };
}

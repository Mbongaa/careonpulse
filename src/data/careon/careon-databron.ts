import { COCKPIT_KPIS } from "./careon-kpis";

export const EPD_PROVIDERS = [
  { id: "medicore", name: "Medicore EPD", sub: "REST · FHIR R4", mark: "M", color: "var(--chart-1)" },
  { id: "nedap", name: "Nedap ONS", sub: "REST · OAuth2", mark: "N", color: "var(--chart-2)" },
  { id: "myneva", name: "myneva", sub: "REST · webhook", mark: "my", color: "var(--chart-3)" },
  { id: "custom", name: "Eigen REST-API", sub: "API-key of OAuth2", mark: "</>", color: "var(--chart-4)" },
];

export const SAMPLE_CSV_FILENAME = "careon-kpi-export.csv";

// "omzettotaal" is een afgeleide kopkaart (som van de splitkaarten), geen
// zelfstandig importeerbare KPI — hij staat niet in het voorbeeldbestand en
// wordt bij import berekend uit de deelbedragen (zie parseKpiCsv).
const DERIVED_KPI_IDS = new Set(["omzettotaal"]);

export const SAMPLE_CSV_CONTENT = [
  "kpi;huidig;vorige_maand",
  ...COCKPIT_KPIS.filter((k) => !DERIVED_KPI_IDS.has(k.id)).map((k) => `${k.id};${k.value};${k.prev}`),
].join("\n");

export const API_SUCCESS_COPY =
  "Koppelingspreview actief — er is geen externe EPD-verbinding gemaakt en er is geen sleutel opgeslagen.";

export interface CsvParseResult {
  matched: number;
  overrides: Record<string, { value: number; prev: number }>;
  message: string;
  ok: boolean;
}

// Parser behavior mirrors the audited bundle: ";" or "," separators, decimal
// commas, and only KPI ids from the Directiecockpit set are recognized.
export function parseKpiCsv(
  fileName: string,
  text: string,
  // Reeds geïmporteerde overrides. Zonder deze context zou een tweede,
  // gedeeltelijke import de afgeleide kopkaart terugrekenen op de
  // demo-constanten en een totaal tonen dat niet klopt met de splitkaarten.
  bestaand: Readonly<Record<string, { value: number; prev: number }>> = {},
): CsvParseResult {
  // Herkenbare cliëntendata-export in de verkeerde kaart: verwijs naar de
  // productie-kaart i.p.v. het generieke "geen herkenbare KPI's"-advies.
  // (Aanvulling op het geauditeerde gedrag: het origineel kende dit bestandstype niet.)
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  if (firstLine.toLowerCase().includes("cliënt id")) {
    return {
      matched: 0,
      overrides: {},
      ok: false,
      message: `${fileName} is een cliëntendata-export — gebruik hiervoor de kaart "Productie-modus: volledige EPD-export".`,
    };
  }

  const knownIds = new Set(COCKPIT_KPIS.filter((k) => !DERIVED_KPI_IDS.has(k.id)).map((k) => k.id));
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

  // Afgeleide kopkaart: Totale omzet = som van de deelbedragen. Volgorde van
  // herkomst: dit bestand → een eerdere import → de demo-constante, zodat het
  // kopcijfer nooit uit de pas loopt met de splitkaarten die de cockpit toont.
  if ("omzetverz" in overrides || "omzetinfo" in overrides) {
    const deel = (id: string): { value: number; prev: number } => {
      if (id in overrides) return overrides[id];
      if (id in bestaand) return bestaand[id];
      const kpi = COCKPIT_KPIS.find((k) => k.id === id);
      return { value: kpi?.value ?? 0, prev: kpi?.prev ?? 0 };
    };
    const verz = deel("omzetverz");
    const info = deel("omzetinfo");
    overrides.omzettotaal = { value: verz.value + info.value, prev: verz.prev + info.prev };
  }

  return {
    matched,
    overrides,
    ok: true,
    message: `${fileName} verwerkt — ${matched} KPI's bijgewerkt in de cockpit.`,
  };
}

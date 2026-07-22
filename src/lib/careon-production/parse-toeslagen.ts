import { cleanCell, mergeQuotedLines, parseDutchDate, splitLine } from "./parse-export";
import type { ImportWarning, ParseToeslagenResult, ToeslagCel, ToeslagenFacts } from "./types";

// Parser voor de toeslagen-export ("declared surcharges"): ZPM-toeslag-
// prestaties (TC-codes — reistijd, tolk, psychodiagnostiek) die als extra
// regels op dezelfde facturen staan als de sessies uit de agenda-export.
//
// Privacy aan de grens: de export bevat cliëntNAMEN (geen ID's). Namen worden
// uitsluitend gebruikt om unieke cliënten te tellen en verlaten deze functie
// nooit. Identieke regels komen legitiem meermaals voor (bijv. 2× "tolk 120
// minuten" op één sessie van 240 minuten) en tellen als aparte factuurregels.

const REQUIRED_COLUMNS = ["Cliënt", "Code", "Omschrijving", "Prijs", "Factuurdatum"];
const OPTIONAL_COLUMNS = ["Verzekeringskoepel", "Afspraakdatum", "Factuurnummer"];

function parsePrijs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseToeslagenExport(
  fileName: string,
  text: string,
  importedAt: string = new Date().toISOString(),
): ParseToeslagenResult {
  const { rows, warnings: mergeWarnings } = mergeQuotedLines(text.replace(/^﻿/, "").split(/\r?\n/));
  const headerRowIdx = rows.findIndex((row) => row.text.trim() !== "");
  if (headerRowIdx < 0) {
    return { ok: false, error: "Leeg bestand.", facts: null, warnings: [] };
  }
  const headerLine = rows[headerRowIdx].text;

  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const delim = semicolons >= commas ? ";" : ",";

  const headerCells = splitLine(headerLine, delim).map((cell) => cell.replace(/^﻿/, "").replace(/\s+/g, " ").trim());
  const headerIndex = new Map<string, number>();
  headerCells.forEach((cell, i) => {
    const key = cell.toLowerCase();
    if (key !== "" && !headerIndex.has(key)) {
      headerIndex.set(key, i);
    }
  });
  const col = (name: string): number => headerIndex.get(name.toLowerCase()) ?? -1;

  // Verkeerde kaart: andere ZSG-exports doorverwijzen.
  if (col("Soort") >= 0 && col("Datum") >= 0) {
    return {
      ok: false,
      error: `${fileName} lijkt de agenda-export — gebruik daarvoor het agenda-importveld.`,
      facts: null,
      warnings: [],
    };
  }
  const missing = REQUIRED_COLUMNS.filter((name) => col(name) < 0);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `${fileName} lijkt geen toeslagen-export: kolommen ontbreken (${missing.join(", ")}).`,
      facts: null,
      warnings: [],
    };
  }

  const warnings: ImportWarning[] = [];
  const absentOptional = OPTIONAL_COLUMNS.filter((name) => col(name) < 0);
  if (absentOptional.length > 0) {
    warnings.push({ row: 0, message: `Optionele kolommen niet gevonden: ${absentOptional.join(", ")}.` });
  }
  warnings.push(...mergeWarnings);

  const celMap = new Map<string, ToeslagCel>();
  interface CodeAccu {
    code: string;
    omschrijving: string;
    aantal: number;
    omzet: number;
    namen: Set<string>;
  }
  const codeMap = new Map<string, CodeAccu>();
  const alleNamen = new Set<string>();
  const tolkNamen = new Set<string>();
  let totalRows = 0;
  let skippedRows = 0;
  let bronVan: string | null = null;
  let bronTot: string | null = null;

  for (let rowIdx = headerRowIdx + 1; rowIdx < rows.length; rowIdx += 1) {
    const line = rows[rowIdx].text;
    if (line.trim() === "") continue;
    totalRows += 1;
    const cells = splitLine(line, delim);
    const cell = (name: string): string | null => {
      const i = col(name);
      return i >= 0 ? cleanCell(cells[i]) : null;
    };

    const code = cell("Code");
    const prijs = parsePrijs(cell("Prijs"));
    const factuurDatum = parseDutchDate(cell("Factuurdatum"));
    if (!code || prijs === null || !factuurDatum) {
      skippedRows += 1;
      continue;
    }
    const afspraakDatum = parseDutchDate(cell("Afspraakdatum"));
    if (afspraakDatum) {
      if (bronVan === null || afspraakDatum < bronVan) bronVan = afspraakDatum;
      if (bronTot === null || afspraakDatum > bronTot) bronTot = afspraakDatum;
    }

    const maand = factuurDatum.slice(0, 7);
    const koepel = cell("Verzekeringskoepel");
    const celKey = `${maand}|${koepel ?? ""}|${code}`;
    const cel = celMap.get(celKey) ?? { key: maand, koepel, code, aantal: 0, omzet: 0 };
    cel.aantal += 1;
    cel.omzet += prijs;
    celMap.set(celKey, cel);

    const omschrijving = cell("Omschrijving") ?? code;
    const accu = codeMap.get(code) ?? { code, omschrijving, aantal: 0, omzet: 0, namen: new Set<string>() };
    accu.aantal += 1;
    accu.omzet += prijs;
    const naam = cell("Cliënt");
    if (naam) {
      accu.namen.add(naam);
      alleNamen.add(naam);
      if (omschrijving.toLowerCase().includes("tolk")) {
        tolkNamen.add(naam);
      }
    }
    codeMap.set(code, accu);
  }

  if (celMap.size === 0) {
    return { ok: false, error: `Geen toeslagregels gevonden in ${fileName}.`, facts: null, warnings };
  }

  const facts: ToeslagenFacts = {
    fileName,
    importedAt,
    totalRows,
    skippedRows,
    bronVan: bronVan ?? "1970-01-01",
    bronTot: bronTot ?? "1970-01-01",
    cellen: [...celMap.values()],
    perCode: [...codeMap.values()]
      .map((accu) => ({
        code: accu.code,
        omschrijving: accu.omschrijving,
        aantal: accu.aantal,
        omzet: accu.omzet,
        // Alleen de telling blijft over; de namen zelf verlaten deze functie niet.
        clienten: accu.namen.size,
      }))
      .sort((a, b) => b.omzet - a.omzet),
    clienten: alleNamen.size,
    tolkClienten: tolkNamen.size,
  };

  return { ok: true, facts, warnings };
}

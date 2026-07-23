import { cleanCell, mergeQuotedLines, parseDutchDate, splitLine } from "./parse-export";
import type { DeclaratieFactuur, DeclaratiesFacts, ImportWarning, ParseDeclaratiesResult } from "./types";

// Parser voor het declaratie-totaaloverzicht ("declaration total"): per
// factuur het gedeclareerde bedrag, het door de verzekeraar toegekende
// totaalbedrag en creditnota's (met "Credit voor"-referentie).
//
// Privacy aan de grens: debiteuren zijn doorgaans verzekeraars of gemeenten;
// particuliere facturen dragen een persóónsnaam als debiteur — die worden
// samengevoegd tot het label "Particulier" en nooit bewaard. Het
// debiteurennummer wordt niet gelezen. Eén factuurnummer kan meerdere regels
// beslaan (deelfacturen): bedragen en toekenningen worden per factuur gesommeerd.

const REQUIRED_COLUMNS = ["Factuurnummer", "Factuurdatum", "Debiteurennaam", "Totaal bedrag", "Debet / credit"];
const OPTIONAL_COLUMNS = ["Toegekend totaalbedrag", "Credit voor"];

/** Nederlands bedrag: "1.039,48" → 1039.48. */
function parseBedrag(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Particuliere debiteuren (persoonsnamen) worden samengevoegd — nooit bewaard. */
function normalizeDebiteur(naam: string): string {
  if (/^(de heer|mevrouw|dhr\.?|mevr\.?|mw\.?)\s/i.test(naam.trim())) {
    return "Particulier";
  }
  return naam.trim();
}

export function parseDeclaratiesExport(
  fileName: string,
  text: string,
  importedAt: string = new Date().toISOString(),
): ParseDeclaratiesResult {
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

  // Verkeerde kaart: andere exports doorverwijzen.
  if (col("Soort") >= 0 && col("Datum") >= 0) {
    return {
      ok: false,
      error: `${fileName} lijkt de agenda-export — gebruik daarvoor het agenda-importveld.`,
      facts: null,
      warnings: [],
    };
  }
  if (col("Code") >= 0 && col("Omschrijving") >= 0 && col("Cliënt") >= 0) {
    return {
      ok: false,
      error: `${fileName} lijkt de toeslagen-export — gebruik daarvoor het toeslagen-importveld.`,
      facts: null,
      warnings: [],
    };
  }
  const missing = REQUIRED_COLUMNS.filter((name) => col(name) < 0);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `${fileName} lijkt geen declaratie-totaaloverzicht: kolommen ontbreken (${missing.join(", ")}).`,
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

  const factuurMap = new Map<string, DeclaratieFactuur>();
  interface CreditRij {
    doel: string | null;
    bedrag: number;
  }
  const credits: CreditRij[] = [];
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

    const nummer = cell("Factuurnummer");
    const datum = parseDutchDate(cell("Factuurdatum"));
    const bedrag = parseBedrag(cell("Totaal bedrag"));
    const debetCredit = (cell("Debet / credit") ?? "").toUpperCase();
    if (!nummer || !datum || bedrag === null || (debetCredit !== "D" && debetCredit !== "C")) {
      skippedRows += 1;
      continue;
    }
    if (bronVan === null || datum < bronVan) bronVan = datum;
    if (bronTot === null || datum > bronTot) bronTot = datum;

    const koepel = normalizeDebiteur(cell("Debiteurennaam") ?? "Onbekend");
    // Factuurnummers zijn NIET uniek over administraties heen (de ZVW- en
    // WMO-reeksen overlappen): de sleutel is daarom nummer + debiteur.
    const sleutel = `${nummer}|${koepel}`;

    if (debetCredit === "C") {
      // Creditnota: negatief bedrag; als positieve correctie op de doelfactuur
      // bij dezelfde debiteur.
      const doel = cell("Credit voor");
      credits.push({ doel: doel ? `${doel}|${koepel}` : null, bedrag: Math.abs(bedrag) });
      continue;
    }

    const toegekend = parseBedrag(cell("Toegekend totaalbedrag")) ?? 0;
    const bestaand = factuurMap.get(sleutel);
    if (bestaand) {
      // Deelfacturen onder hetzelfde nummer én dezelfde debiteur: sommeren.
      bestaand.bedrag += bedrag;
      bestaand.toegekend += toegekend;
      if (datum < bestaand.datum) bestaand.datum = datum;
    } else {
      factuurMap.set(sleutel, { nummer, datum, koepel, bedrag, toegekend, gecrediteerd: 0 });
    }
  }

  // Creditnota's toewijzen aan hun doelfactuur; zonder (bekende) doelfactuur
  // blijven ze als losse correctie geteld.
  let losseCreditAantal = 0;
  let losseCreditBedrag = 0;
  for (const credit of credits) {
    const doel = credit.doel ? factuurMap.get(credit.doel) : undefined;
    if (doel) {
      doel.gecrediteerd += credit.bedrag;
    } else {
      losseCreditAantal += 1;
      losseCreditBedrag += credit.bedrag;
    }
  }

  if (factuurMap.size === 0 || bronVan === null || bronTot === null) {
    return { ok: false, error: `Geen declaratieregels gevonden in ${fileName}.`, facts: null, warnings };
  }

  const facts: DeclaratiesFacts = {
    fileName,
    importedAt,
    totalRows,
    skippedRows,
    bronVan,
    bronTot,
    facturen: [...factuurMap.values()],
    losseCredits: { aantal: losseCreditAantal, bedrag: losseCreditBedrag },
  };

  return { ok: true, facts, warnings };
}

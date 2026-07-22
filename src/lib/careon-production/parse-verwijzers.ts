import { cleanCell, mergeQuotedLines, splitLine } from "./parse-export";
import type { ImportWarning, ParseVerwijzersResult, VerwijzerContact, VerwijzersFacts } from "./types";

// Parser voor de ZSG huisarts/verwijzer-export: één rij per (cliënt,
// verwijzer). Geaggregeerd tot een verwijzernetwerk: per verwijzer (AGB-code
// als sleutel) het aantal unieke cliënten, praktijkplaats, rol en
// Zorgmail-aansluiting. E-mailadressen worden bewust niet bewaard; van
// cliënten wordt alleen het ID geteld.

const REQUIRED_COLUMNS = ["Cliënt ID", "Naam", "Rol"];
const OPTIONAL_COLUMNS = ["AGB Code", "Zorgmail", "Plaats"];

export function parseVerwijzersExport(
  fileName: string,
  text: string,
  importedAt: string = new Date().toISOString(),
): ParseVerwijzersResult {
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

  // Andere ZSG-exports hier gedropt → doorverwijzen naar de juiste kaart.
  if (col("Soort") >= 0 && col("Datum") >= 0) {
    return {
      ok: false,
      error: `${fileName} lijkt de agenda-export — gebruik daarvoor het agenda-importveld.`,
      facts: null,
      warnings: [],
    };
  }
  if (col("Vestigingsnaam") >= 0 && col("Episode startdatum") >= 0) {
    return {
      ok: false,
      error: `${fileName} lijkt de cliëntendata-export — gebruik daarvoor de kaart "Productie-modus: volledige EPD-export".`,
      facts: null,
      warnings: [],
    };
  }

  const missing = REQUIRED_COLUMNS.filter((name) => col(name) < 0);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `${fileName} lijkt geen huisarts/verwijzer-export: kolommen ontbreken (${missing.join(", ")}).`,
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

  interface Accumulator {
    agb: string | null;
    namen: Map<string, number>;
    rollen: Map<string, number>;
    plaats: string | null;
    zorgmail: boolean;
    clientIds: Set<string>;
  }
  const contactMap = new Map<string, Accumulator>();
  const alleClienten = new Set<string>();
  let totalRows = 0;
  let skipped = 0;

  for (let rowIdx = headerRowIdx + 1; rowIdx < rows.length; rowIdx += 1) {
    const line = rows[rowIdx].text;
    if (line.trim() === "") continue;
    totalRows += 1;
    const cells = splitLine(line, delim);
    const cell = (name: string): string | null => {
      const i = col(name);
      return i >= 0 ? cleanCell(cells[i]) : null;
    };

    const clientId = cell("Cliënt ID");
    const naam = cell("Naam");
    if (!clientId || !naam) {
      skipped += 1;
      continue;
    }
    alleClienten.add(clientId);

    const agb = cell("AGB Code");
    const key = agb ?? `naam:${naam.toLowerCase()}`;
    const acc =
      contactMap.get(key) ??
      ({
        agb,
        namen: new Map<string, number>(),
        rollen: new Map<string, number>(),
        plaats: null,
        zorgmail: false,
        clientIds: new Set<string>(),
      } satisfies Accumulator);
    acc.namen.set(naam, (acc.namen.get(naam) ?? 0) + 1);
    const rol = cell("Rol") ?? "Onbekend";
    acc.rollen.set(rol, (acc.rollen.get(rol) ?? 0) + 1);
    if (!acc.plaats) acc.plaats = cell("Plaats");
    if ((cell("Zorgmail") ?? "").toLowerCase() === "ja") acc.zorgmail = true;
    acc.clientIds.add(clientId);
    contactMap.set(key, acc);
  }

  if (skipped > 0) {
    warnings.push({ row: 0, message: `${skipped} rij(en) zonder Cliënt ID of Naam overgeslagen.` });
  }
  if (contactMap.size === 0) {
    return { ok: false, error: `Geen verwijzerrijen gevonden in ${fileName}.`, facts: null, warnings };
  }

  const modal = (counts: Map<string, number>): string => [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const contacten: VerwijzerContact[] = [...contactMap.values()]
    .map((acc) => ({
      agb: acc.agb,
      naam: modal(acc.namen),
      rol: modal(acc.rollen),
      plaats: acc.plaats,
      zorgmail: acc.zorgmail,
      clienten: acc.clientIds.size,
    }))
    .sort((a, b) => b.clienten - a.clienten);

  const facts: VerwijzersFacts = {
    fileName,
    importedAt,
    totalRows,
    clienten: alleClienten.size,
    contacten,
  };

  return { ok: true, facts, warnings };
}

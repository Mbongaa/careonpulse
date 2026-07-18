import type { ClientRecord, ImportWarning, ParseExportResult } from "./types";

// Parser voor de ZSG "Cliëntendata"-export (EPD). Formaat-eigenschappen uit de
// echte export: ";"-separator, dd-mm-jjjj-datums, "-" als lege waarde,
// meerdere waarden gescheiden door komma's (regiebehandelaren, wachtlijst-
// labels), inconsistente hoofdletters bij plaatsnamen en een mogelijke BOM.
// Privacy: naam, geboortedatum, postcode en verzekeringsnummer worden hier
// bewust NIET gelezen — pseudonimisering gebeurt aan de grens.

const REQUIRED_COLUMNS = [
  "Cliënt ID",
  "Client geslacht",
  "Client leeftijd",
  "Vestigingsnaam",
  "Episode startdatum",
  "Episode einddatum",
  "Verwijsdatum",
  "Wachtlijst Status",
];

const OPTIONAL_COLUMNS = [
  "Plaats",
  "ZPM label",
  "Setting",
  "Huidige RB",
  "Regiebehandelaar",
  "Behandelaar",
  "Naam huisarts/verwijzer",
  "Verzekeringskoepel",
  "Directe tijd",
  "Indirecte tijd",
  "Totale tijd",
  "Primaire diagnose code",
  "Geselecteerde ZorgVraagType",
  "Wachtlijst Label",
  "Pre Wachtlijst Status",
  "Ga naar dossier",
];

const DATE_RE = /^(\d{2})-(\d{2})-(\d{4})$/;

function splitLine(line: string, delim: string): string[] {
  if (!line.includes('"')) {
    return line.split(delim);
  }
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function cleanCell(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "" || trimmed === "-") {
    return null;
  }
  return trimmed;
}

export function parseDutchDate(value: string | null): string | null {
  if (!value) return null;
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  // Rondreis via Date.UTC vangt niet-bestaande kalenderdagen (31-02, 31-04, …)
  // die een bereikcontrole zou doorlaten.
  const roundTrip = new Date(Date.UTC(Number(yyyy), month - 1, day));
  if (roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function normalizePlaats(value: string | null): string | null {
  if (!value) return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed
    .toLowerCase()
    .split(" ")
    .map((word) => {
      // Provincie-suffixen zoals "NB" blijven hoofdletters ("Oosterhout NB").
      if (word.length <= 2 && collapsed.includes(word.toUpperCase())) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function normalizeVestiging(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/^TGC\s+/i, "").trim();
}

function normalizeGeslacht(value: string | null): "Vrouw" | "Man" | "Anders" {
  if (value === "Vrouw" || value === "Man") return value;
  return "Anders";
}

function parseMinutes(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

// DSM-5-hoofdstuk uit de diagnosecode (D5_<hoofdstuk>.<...>) → diagnosegroep.
const HOOFDSTUK_GROEPEN: Record<string, string> = {
  "3": "Bipolaire stoornis",
  "4": "Depressieve stoornissen",
  "5": "Angststoornissen",
  "6": "Dwangstoornissen (OCS)",
  "7": "PTSS / trauma",
  "18": "Persoonlijkheidsproblematiek",
};

export function diagnoseGroepVanCode(code: string | null): string | null {
  if (!code) return null;
  const match = /^D5_(\d+)(?:\.(\d+))?/.exec(code);
  if (!match) return "Overige diagnoses";
  const hoofdstuk = match[1];
  // Numeriek vergelijken: "03" en "3" zijn hetzelfde subhoofdstuk.
  const sub = match[2] === undefined ? null : Number(match[2]);
  if (hoofdstuk === "1") {
    if (sub === 3) return "Autismespectrum";
    if (sub === 4) return "ADHD";
    return "Overige diagnoses";
  }
  return HOOFDSTUK_GROEPEN[hoofdstuk] ?? "Overige diagnoses";
}

function buildHeaderIndex(headerCells: string[]): { index: Map<string, number>; duplicates: string[] } {
  const index = new Map<string, number>();
  const duplicates: string[] = [];
  headerCells.forEach((cell, i) => {
    const key = cell.replace(/^﻿/, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (key === "") return;
    if (index.has(key)) {
      duplicates.push(cell.trim());
    } else {
      index.set(key, i);
    }
  });
  return { index, duplicates };
}

// Een cel met een regeleinde binnen aanhalingstekens wordt door de regel-split
// in stukken geknipt; regels met een oneven aantal quotes horen bij de
// volgende regel en worden hier weer samengevoegd. Twee beschermingen tegen
// een LOS aanhalingsteken (typfout in een vrij-tekstveld): een plafond op het
// aantal samengevoegde regels en een terugval die de gebufferde regels weer
// lós parseert mét waarschuwing — anders zou één stray quote de rest van het
// bestand geruisloos in één cel opslokken.
interface RawRow {
  text: string;
  /** 1-based fysiek regelnummer van de eerste regel van deze (evt. samengevoegde) rij. */
  lineNumber: number;
}

const MAX_QUOTED_ROW_LINES = 10;

function mergeQuotedLines(rawLines: string[]): { rows: RawRow[]; warnings: ImportWarning[] } {
  const rows: RawRow[] = [];
  const warnings: ImportWarning[] = [];
  let buffer: string[] = [];
  let bufferStart = 0;

  const flushUnmerged = () => {
    warnings.push({
      row: bufferStart,
      message: `Onafgesloten aanhalingsteken bij regel ${bufferStart} — regels zijn niet samengevoegd; controleer dit veld in het bestand.`,
    });
    buffer.forEach((text, offset) => {
      rows.push({ text, lineNumber: bufferStart + offset });
    });
    buffer = [];
  };

  rawLines.forEach((line, index) => {
    if (buffer.length === 0) {
      const quoteCount = (line.match(/"/g) ?? []).length;
      if (quoteCount % 2 === 0) {
        rows.push({ text: line, lineNumber: index + 1 });
      } else {
        buffer = [line];
        bufferStart = index + 1;
      }
      return;
    }
    buffer.push(line);
    const combinedQuotes = (buffer.join("\n").match(/"/g) ?? []).length;
    if (combinedQuotes % 2 === 0) {
      rows.push({ text: buffer.join("\n"), lineNumber: bufferStart });
      buffer = [];
    } else if (buffer.length >= MAX_QUOTED_ROW_LINES) {
      flushUnmerged();
    }
  });
  if (buffer.length > 0) {
    flushUnmerged();
  }
  return { rows, warnings };
}

export function parseClientExport(fileName: string, text: string): ParseExportResult {
  const { rows, warnings: mergeWarnings } = mergeQuotedLines(text.replace(/^﻿/, "").split(/\r?\n/));
  const headerRowIdx = rows.findIndex((row) => row.text.trim() !== "");
  if (headerRowIdx < 0) {
    return { ok: false, error: "Leeg bestand.", records: [], totalRows: 0, skippedRows: 0, warnings: [] };
  }
  const headerLine = rows[headerRowIdx].text;

  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const delim = semicolons >= commas ? ";" : ",";

  const headerCells = splitLine(headerLine, delim);
  const { index: headerIndex, duplicates: duplicateHeaders } = buildHeaderIndex(headerCells);
  const col = (name: string): number => headerIndex.get(name.toLowerCase()) ?? -1;

  const missing = REQUIRED_COLUMNS.filter((name) => col(name) < 0);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `${fileName} lijkt geen ZSG-cliëntendata-export: kolommen ontbreken (${missing.join(", ")}).`,
      records: [],
      totalRows: 0,
      skippedRows: 0,
      warnings: [],
    };
  }

  const absentOptional = OPTIONAL_COLUMNS.filter((name) => col(name) < 0);
  const warnings: ImportWarning[] = [];
  if (absentOptional.length > 0) {
    warnings.push({ row: 0, message: `Optionele kolommen niet gevonden: ${absentOptional.join(", ")}.` });
  }
  if (duplicateHeaders.length > 0) {
    warnings.push({
      row: 0,
      message: `Dubbele kolomkop(pen) ${duplicateHeaders.map((name) => `"${name}"`).join(", ")} — de eerste kolom wordt gebruikt.`,
    });
  }
  warnings.push(...mergeWarnings);

  const records: ClientRecord[] = [];
  const seenIds = new Set<string>();
  let totalRows = 0;
  let skippedRows = 0;

  for (let rowIdx = headerRowIdx + 1; rowIdx < rows.length; rowIdx += 1) {
    const line = rows[rowIdx].text;
    if (line.trim() === "") continue;
    totalRows += 1;
    // Fysiek regelnummer uit het bestand: blijft kloppen ná samengevoegde
    // meerregelige cellen, zodat "Rij N" in het importrapport vindbaar is.
    const rowNumber = rows[rowIdx].lineNumber;
    const cells = splitLine(line, delim);
    const cell = (name: string): string | null => {
      const i = col(name);
      return i >= 0 ? cleanCell(cells[i]) : null;
    };

    const id = cell("Cliënt ID");
    if (!id) {
      skippedRows += 1;
      warnings.push({ row: rowNumber, message: "Rij zonder Cliënt ID overgeslagen." });
      continue;
    }
    if (seenIds.has(id)) {
      warnings.push({ row: rowNumber, message: `Dubbele Cliënt ID ${id} — rij overgeslagen.` });
      skippedRows += 1;
      continue;
    }
    seenIds.add(id);

    const rawEpisodeStart = cell("Episode startdatum");
    const episodeStart = parseDutchDate(rawEpisodeStart);
    if (rawEpisodeStart && !episodeStart) {
      warnings.push({ row: rowNumber, message: `Onleesbare episode-startdatum "${rawEpisodeStart}".` });
    }
    const rawEpisodeEind = cell("Episode einddatum");
    const episodeEind = parseDutchDate(rawEpisodeEind);
    if (rawEpisodeEind && !episodeEind) {
      warnings.push({ row: rowNumber, message: `Onleesbare episode-einddatum "${rawEpisodeEind}".` });
    }

    const leeftijdRaw = cell("Client leeftijd");
    const leeftijd = leeftijdRaw && /^\d+$/.test(leeftijdRaw) ? Number(leeftijdRaw) : null;
    if (leeftijd !== null && (leeftijd < 0 || leeftijd > 110)) {
      warnings.push({ row: rowNumber, message: `Onwaarschijnlijke leeftijd (${leeftijd}) bij cliënt ${id}.` });
    }

    const diagnoseCode = cell("Primaire diagnose code");
    const zorgvraagtypeRaw = cell("Geselecteerde ZorgVraagType");
    // Alleen https-links worden als klikbare deeplink bewaard: de waarde komt
    // uit het CSV-bestand en wordt als href gerenderd (geen javascript:-schema's).
    const rawDossierUrl = cell("Ga naar dossier");
    const dossierUrl = rawDossierUrl?.startsWith("https://") ? rawDossierUrl : null;
    const wachtlijstLabels = (cell("Wachtlijst Label") ?? "")
      .split(",")
      .map((label) => label.trim())
      .filter((label) => label !== "" && label !== "-");

    records.push({
      id,
      geslacht: normalizeGeslacht(cell("Client geslacht")),
      leeftijd,
      plaats: normalizePlaats(cell("Plaats")),
      vestiging: normalizeVestiging(cell("Vestigingsnaam")),
      zpmLabel: cell("ZPM label"),
      setting: cell("Setting"),
      regiebehandelaar: (cell("Huidige RB") ?? cell("Regiebehandelaar"))?.split(",")[0]?.trim() ?? null,
      behandelaar: cell("Behandelaar"),
      verwijzer: cell("Naam huisarts/verwijzer"),
      verzekeraar: cell("Verzekeringskoepel"),
      episodeStart,
      episodeEind,
      verwijsdatum: parseDutchDate(cell("Verwijsdatum")),
      directeTijdMin: parseMinutes(cell("Directe tijd")),
      indirecteTijdMin: parseMinutes(cell("Indirecte tijd")),
      totaleTijdMin: parseMinutes(cell("Totale tijd")),
      diagnoseCode,
      diagnoseGroep: diagnoseGroepVanCode(diagnoseCode),
      zorgvraagtype: zorgvraagtypeRaw ? (zorgvraagtypeRaw.split(" - ")[0]?.trim() ?? null) : null,
      wachtlijst: cell("Wachtlijst Status") === "Ja",
      wachtlijstLabels,
      preWachtlijst: cell("Pre Wachtlijst Status") === "Ja",
      dossierUrl,
    });
  }

  if (records.length === 0) {
    return {
      ok: false,
      error: `Geen cliëntrijen gevonden in ${fileName}.`,
      records: [],
      totalRows,
      skippedRows,
      warnings,
    };
  }

  return { ok: true, records, totalRows, skippedRows, warnings };
}

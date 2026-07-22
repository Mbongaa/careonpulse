import { cleanCell, mergeQuotedLines, normalizeVestiging, parseDutchDate, splitLine } from "./parse-export";
import type {
  AgendaBlokCel,
  AgendaCel,
  AgendaClientFact,
  AgendaFacts,
  AgendaFactuurCel,
  AgendaToekomstCel,
  AgendaWeekdagCel,
  ImportWarning,
  ParseAgendaResult,
} from "./types";

// Parser voor de ZSG agenda-/afsprakenexport (EPD). De export bevat 20k+
// afspraakregels; die worden hier direct geaggregeerd tot AgendaFacts — er
// verlaat nooit een losse afspraakregel deze functie.
//
// Privacy aan de grens: Client_naam, Memo (vrije klinische tekst), BSN en
// Sessieverslag-inhoud worden bewust NIET gelezen. Van cliënten blijft alleen
// het EPD-cliënt-ID over (contactrecentheid), net als in de cliëntendata-parser.

const REQUIRED_COLUMNS = ["Soort", "Behandelaar", "Datum", "Client_ID", "No_Show", "Totale_tijd_minute(n)"];

const OPTIONAL_COLUMNS = [
  "Sessie_Naam",
  "Afspraak_lokatie",
  "Lokatie_zorgtraject",
  "Directe_tijd_minute(n)",
  "Indirecte_tijd_minute(n)",
  "Reistijd_minute(n)",
  "Tijdig_afgezegd",
  "Tijdig_afgezegd_Redenen",
  "Verzekeringskoepel",
  "Prijs",
  "Factuurnummer",
  "Factuurdatum",
  "Ondertekend",
  "Sessieverslagen",
];

function parseDecimal(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Prijs-cel: numeriek of tekst ("Dit sessietype heeft geen financiele waarde"). */
function parsePrijs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function isJa(value: string | null): boolean {
  const lower = (value ?? "").trim().toLowerCase();
  return lower === "ja" || lower === "j" || lower === "y" || lower === "yes";
}

function modality(sessieNaam: string | null): "online" | "locatie" | "overig" {
  const upper = (sessieNaam ?? "").toUpperCase();
  if (upper.includes("ONLINE")) return "online";
  if (upper.includes("LOCATIE")) return "locatie";
  return "overig";
}

function weekdagVanIso(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

const MAX_ROW_WARNINGS = 12;

export function parseAgendaExport(
  fileName: string,
  text: string,
  // Injecteerbaar voor deterministische verificatie (geen klok in de parser).
  importedAt: string = new Date().toISOString(),
): ParseAgendaResult {
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

  // Verkeerde kaart: een cliëntendata-export hier gedropt → doorverwijzen.
  if (col("Cliënt ID") >= 0 && col("Soort") < 0) {
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
      error: `${fileName} lijkt geen ZSG-agenda-export: kolommen ontbreken (${missing.join(", ")}).`,
      facts: null,
      warnings: [],
    };
  }

  const warnings: ImportWarning[] = [];
  const absentOptional = OPTIONAL_COLUMNS.filter((name) => col(name) < 0);
  if (absentOptional.length > 0) {
    warnings.push({ row: 0, message: `Optionele kolommen niet gevonden: ${absentOptional.join(", ")}.` });
  }
  if (col("BSN") >= 0) {
    warnings.push({
      row: 0,
      message:
        "Deze export bevat een BSN-kolom; die wordt genegeerd en nooit opgeslagen. Gebruik bij voorkeur de exportvariant zonder BSN.",
    });
  }
  warnings.push(...mergeWarnings);

  // ---- Aggregatie-accumulatoren ----
  const celMap = new Map<string, AgendaCel>();
  const blokMap = new Map<string, AgendaBlokCel>();
  const factuurMap = new Map<string, AgendaFactuurCel>();
  const weekdagMap = new Map<string, AgendaWeekdagCel>();
  const clientMap = new Map<string, AgendaClientFact>();
  const afzegRedenen = new Map<string, number>();
  const sessieTypen = new Map<string, number>();

  // Peildatum: rijen ná deze dag zijn GEPLANDE afspraken. Ze blijven buiten
  // alle historische aggregaten (een geplande sessie draagt al een geprijsde
  // waarde maar geen factuur — meetellen zou onderhanden werk en no-show-
  // percentages vervuilen) en voeden alleen de vooruitblik.
  const peildatum = importedAt.slice(0, 10);
  const toekomstPerMaand = new Map<string, AgendaToekomstCel>();
  const toekomstClientIds = new Set<string>();
  const trajectIds = new Set<string>();
  let toekomstSessies = 0;
  let toekomstTot: string | null = null;

  let totalRows = 0;
  let sessieRows = 0;
  let blokRows = 0;
  let skippedRows = 0;
  let rowWarnings = 0;
  let bronVan: string | null = null;
  let bronTot: string | null = null;

  const rowWarning = (row: number, message: string) => {
    if (rowWarnings < MAX_ROW_WARNINGS) {
      warnings.push({ row, message });
    }
    rowWarnings += 1;
  };

  for (let rowIdx = headerRowIdx + 1; rowIdx < rows.length; rowIdx += 1) {
    const line = rows[rowIdx].text;
    if (line.trim() === "") continue;
    totalRows += 1;
    const rowNumber = rows[rowIdx].lineNumber;
    const cells = splitLine(line, delim);
    const cell = (name: string): string | null => {
      const i = col(name);
      return i >= 0 ? cleanCell(cells[i]) : null;
    };

    const soort = cell("Soort");
    const datum = parseDutchDate(cell("Datum"));
    if (!datum) {
      skippedRows += 1;
      rowWarning(rowNumber, `Rij zonder leesbare afspraakdatum overgeslagen ("${cell("Datum") ?? ""}").`);
      continue;
    }
    if (bronVan === null || datum < bronVan) bronVan = datum;
    if (bronTot === null || datum > bronTot) bronTot = datum;

    const maand = datum.slice(0, 7);
    const behandelaar = cell("Behandelaar");
    const totaleMin = parseDecimal(cell("Totale_tijd_minute(n)"));

    // ---- Geplande afspraken (ná de peildatum): alleen de vooruitblik ----
    if (datum > peildatum) {
      if (soort !== "Sessie") continue; // toekomstige agenda-blokkades: niet nodig
      toekomstSessies += 1;
      if (toekomstTot === null || datum > toekomstTot) toekomstTot = datum;
      const toekomstLocatie = normalizeVestiging(cell("Afspraak_lokatie") ?? cell("Lokatie_zorgtraject"));
      const toekomstKey = `${maand}|${toekomstLocatie ?? ""}`;
      const toekomstCel = toekomstPerMaand.get(toekomstKey) ?? {
        key: maand,
        locatie: toekomstLocatie,
        sessies: 0,
        totaleMin: 0,
      };
      toekomstCel.sessies += 1;
      toekomstCel.totaleMin += totaleMin;
      toekomstPerMaand.set(toekomstKey, toekomstCel);

      const toekomstClientId = cell("Client_ID");
      if (toekomstClientId) {
        toekomstClientIds.add(toekomstClientId);
        const fact =
          clientMap.get(toekomstClientId) ??
          ({
            id: toekomstClientId,
            eerste: null,
            laatste: null,
            sessies: 0,
            noShows: 0,
            behandelplan: false,
            volgende: null,
            mdoGepland: false,
          } satisfies AgendaClientFact);
        if (fact.volgende === null || fact.volgende === undefined || datum < fact.volgende) {
          fact.volgende = datum;
        }
        if ((cell("Sessie_Naam") ?? "").toUpperCase().startsWith("MDO")) {
          fact.mdoGepland = true;
        }
        clientMap.set(toekomstClientId, fact);
      }
      continue;
    }

    if (soort !== "Sessie") {
      // Blok-rijen (agenda-blokkades, vrijwel altijd "Afwezig"): capaciteits-
      // signaal per behandelaar; ze dragen geen cliënt of locatie.
      blokRows += 1;
      const blokKey = `${maand}|${behandelaar ?? ""}`;
      const blok = blokMap.get(blokKey) ?? { key: maand, behandelaar, blokMin: 0 };
      blok.blokMin += totaleMin;
      blokMap.set(blokKey, blok);
      continue;
    }

    sessieRows += 1;
    const trajectId = cell("Zorgtraject_ID");
    if (trajectId) trajectIds.add(trajectId);
    const locatie = normalizeVestiging(cell("Afspraak_lokatie") ?? cell("Lokatie_zorgtraject"));
    const sessieNaam = cell("Sessie_Naam");
    const noShow = isJa(cell("No_Show"));
    const tijdigAfgezegd = isJa(cell("Tijdig_afgezegd"));
    const directeMin = parseDecimal(cell("Directe_tijd_minute(n)"));
    const indirecteMin = parseDecimal(cell("Indirecte_tijd_minute(n)"));
    const reisMin = parseDecimal(cell("Reistijd_minute(n)"));
    const prijs = parsePrijs(cell("Prijs"));
    const factuurNummer = cell("Factuurnummer");
    const vorm = modality(sessieNaam);

    const celKey = `${maand}|${locatie ?? ""}|${behandelaar ?? ""}`;
    const cel =
      celMap.get(celKey) ??
      ({
        key: maand,
        locatie,
        behandelaar,
        sessies: 0,
        noShows: 0,
        tijdigAfgezegd: 0,
        directeMin: 0,
        indirecteMin: 0,
        reisMin: 0,
        totaleMin: 0,
        online: 0,
        opLocatie: 0,
        verslagen: 0,
        ondertekend: 0,
        omzetGerealiseerd: 0,
        onderhanden: 0,
        onderhandenSessies: 0,
      } satisfies AgendaCel);
    cel.sessies += 1;
    if (noShow) cel.noShows += 1;
    if (tijdigAfgezegd) cel.tijdigAfgezegd += 1;
    cel.directeMin += directeMin;
    cel.indirecteMin += indirecteMin;
    cel.reisMin += reisMin;
    cel.totaleMin += totaleMin;
    if (vorm === "online") cel.online += 1;
    if (vorm === "locatie") cel.opLocatie += 1;
    if (isJa(cell("Sessieverslagen"))) cel.verslagen += 1;
    if (isJa(cell("Ondertekend"))) cel.ondertekend += 1;
    if (prijs !== null) {
      cel.omzetGerealiseerd += prijs;
      if (!factuurNummer) {
        cel.onderhanden += prijs;
        cel.onderhandenSessies += 1;
      }
    }
    celMap.set(celKey, cel);

    // Gefactureerde omzet op factuurmaand (facturatie loopt in batches achter
    // op de behandelmaand); zonder leesbare factuurdatum valt de omzet terug
    // op de afspraakmaand.
    if (prijs !== null && factuurNummer) {
      const factuurMaand = (parseDutchDate(cell("Factuurdatum")) ?? datum).slice(0, 7);
      const koepel = cell("Verzekeringskoepel");
      const factuurKey = `${factuurMaand}|${locatie ?? ""}|${koepel ?? ""}`;
      const factuur = factuurMap.get(factuurKey) ?? { key: factuurMaand, locatie, koepel, omzet: 0 };
      factuur.omzet += prijs;
      factuurMap.set(factuurKey, factuur);
    }

    const dag = weekdagVanIso(datum);
    const weekdagKey = `${dag}|${locatie ?? ""}`;
    const weekdag = weekdagMap.get(weekdagKey) ?? { dag, locatie, sessies: 0, noShows: 0 };
    weekdag.sessies += 1;
    if (noShow) weekdag.noShows += 1;
    weekdagMap.set(weekdagKey, weekdag);

    if (sessieNaam) {
      sessieTypen.set(sessieNaam, (sessieTypen.get(sessieNaam) ?? 0) + 1);
    }
    const afzegReden = cell("Tijdig_afgezegd_Redenen");
    if (afzegReden) {
      afzegRedenen.set(afzegReden, (afzegRedenen.get(afzegReden) ?? 0) + 1);
    }

    const clientId = cell("Client_ID");
    if (clientId) {
      const fact =
        clientMap.get(clientId) ??
        ({
          id: clientId,
          eerste: null,
          laatste: null,
          sessies: 0,
          noShows: 0,
          behandelplan: false,
          volgende: null,
          mdoGepland: false,
        } satisfies AgendaClientFact);
      fact.sessies += 1;
      if (noShow) fact.noShows += 1;
      // Contactrecentheid: alleen gehouden sessies tellen als contactmoment
      // (een no-show of afzegging is juist géén contact geweest).
      if (!noShow && !tijdigAfgezegd) {
        if (fact.eerste === null || datum < fact.eerste) fact.eerste = datum;
        if (fact.laatste === null || datum > fact.laatste) fact.laatste = datum;
        // Alleen een gehouden behandelplan-sessie telt als "behandelplan gevoerd".
        if ((sessieNaam ?? "").toLowerCase().startsWith("behandelplan")) {
          fact.behandelplan = true;
        }
      }
      clientMap.set(clientId, fact);
    }
  }

  if (rowWarnings > MAX_ROW_WARNINGS) {
    warnings.push({ row: 0, message: `… en ${rowWarnings - MAX_ROW_WARNINGS} vergelijkbare rij-waarschuwingen.` });
  }

  if (sessieRows === 0 || bronVan === null || bronTot === null) {
    return {
      ok: false,
      error: `Geen afspraakrijen (Soort = Sessie) gevonden in ${fileName}.`,
      facts: null,
      warnings,
    };
  }

  const topGroepen = (map: Map<string, number>, top: number) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([label, aantal]) => ({ label, aantal }));

  const facts: AgendaFacts = {
    fileName,
    importedAt,
    bronVan,
    bronTot,
    totalRows,
    sessieRows,
    blokRows,
    skippedRows,
    cellen: [...celMap.values()],
    blokken: [...blokMap.values()],
    facturatie: [...factuurMap.values()],
    weekdagen: [...weekdagMap.values()],
    clienten: [...clientMap.values()],
    afzegRedenen: topGroepen(afzegRedenen, 8),
    sessieTypen: topGroepen(sessieTypen, 15),
    peildatum,
    // Alleen aanwezig wanneer de export echt een toekomstvenster heeft — een
    // export die op de peildatum is afgekapt kan "geen vervolgafspraak" niet
    // onderscheiden van "niet geëxporteerd".
    toekomst:
      toekomstSessies > 0
        ? {
            sessies: toekomstSessies,
            clienten: toekomstClientIds.size,
            tot: toekomstTot,
            perMaand: [...toekomstPerMaand.values()],
          }
        : null,
    trajecten: trajectIds.size,
  };

  return { ok: true, facts, warnings };
}

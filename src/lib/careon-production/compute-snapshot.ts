// Relatieve imports (geen @/-alias): dit bestand draait ook onder ts-node in
// verify-scripts, waar de alias niet resolvet voor runtime-imports.
import { CASELOAD_NORM } from "../../data/careon/careon-behandelaren";
import { REGIE_NORM } from "../../data/careon/careon-dossiers-productie";
import { TREEKNORM_WEKEN } from "../../data/careon/careon-patienten";
import type {
  AantalGroep,
  AgendaFacts,
  ClientRecord,
  DeclaratiesFacts,
  LiveMetric,
  ProductionAgendaSnapshot,
  ProductionAlert,
  ProductionDeclaraties,
  ProductionMonthPoint,
  ProductionSnapshot,
  ProductionState,
  ProductionToeslagen,
  ProductionVerwijzerNetwerk,
  RisicoRij,
  ToeslagenFacts,
  VerwijzersFacts,
} from "./types";
import { agendaHistorischEinde } from "./types";

// Alle productie-aggregaties zijn pure functies over de gepseudonimiseerde
// records: filterbaar per vestiging en deterministisch bij een gegeven
// referentiedatum (testbaar zonder klok).

const MAAND_LABELS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MAAND_NAMEN = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

const nl = new Intl.NumberFormat("nl-NL");

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isoFromParts(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

// UTC-getters: de referentiedatum is het importmoment (UTC-instant). Lokale
// getters zouden dezelfde gedeelde import in verschillende tijdzones op een
// andere kalenderdag — en rond middernacht zelfs een andere "laatste volle
// maand" — laten uitkomen.
function isoFromDate(date: Date): string {
  return isoFromParts(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

// Kernpredicaten zijn geëxporteerd zodat de KPI-drilldowns (detail-rows.ts)
// exact dezelfde definities gebruiken als de snapshot-aggregaties.
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const to = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((to - from) / 86_400_000);
}

/** Aanmelddatum: zorgtraject-start (echte aanmelding); fallback episode-start
 * — episodes kunnen her-registraties binnen een lopend traject zijn. */
export function instroomDatum(record: ClientRecord): string | null {
  return record.trajectStart ?? record.episodeStart;
}

/** Uitstroomdatum: zorgtraject-eind; fallback episode-eind. */
export function uitstroomDatum(record: ClientRecord): string | null {
  return record.trajectEind ?? record.episodeEind;
}

export function activeAt(record: ClientRecord, iso: string): boolean {
  return (
    record.episodeStart !== null &&
    record.episodeStart <= iso &&
    (record.episodeEind === null || record.episodeEind > iso)
  );
}

export interface MonthRef {
  year: number;
  month0: number;
  key: string;
  label: string;
  endIso: string;
}

/** De 12 laatste vólledige maanden, oplopend (oudste eerst). */
export function lastFullMonths(referenceIso: string, count: number): MonthRef[] {
  const year = Number(referenceIso.slice(0, 4));
  const month0 = Number(referenceIso.slice(5, 7)) - 1;
  const months: MonthRef[] = [];
  for (let back = count; back >= 1; back -= 1) {
    const shifted = new Date(year, month0 - back, 1);
    const y = shifted.getFullYear();
    const m0 = shifted.getMonth();
    months.push({
      year: y,
      month0: m0,
      key: `${y}-${pad2(m0 + 1)}`,
      label: MAAND_LABELS[m0],
      endIso: isoFromParts(y, m0, lastDayOfMonth(y, m0)),
    });
  }
  return months;
}

export function monthKeyOf(iso: string | null): string | null {
  return iso ? iso.slice(0, 7) : null;
}

export function isBehandelingsfase(labels: string[]): boolean {
  return labels.some((label) => {
    const lower = label.toLowerCase();
    return (
      lower.includes("behandeling") || lower.includes("schema therapie") || lower.includes("emdr") || lower === "cgt"
    );
  });
}

// Wachtlijstfase uit de labels: de meest gevorderde fase wint (een cliënt kan
// meerdere labels dragen). Therapievorm-labels (EMDR/CGT/schematherapie)
// betekenen: wachtend op behandeling.
const FASE_VOLGORDE = ["Behandeling", "Behandelplan", "Indicatiestelling", "Intake", "Diagnostiek", "Screening"];

function wachtlijstFase(labels: string[]): string {
  const aanwezig = new Set<string>();
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (isBehandelingsfase([label])) aanwezig.add("Behandeling");
    else if (lower.startsWith("behandelplan")) aanwezig.add("Behandelplan");
    else if (lower.startsWith("indicatiestelling")) aanwezig.add("Indicatiestelling");
    else if (lower.startsWith("intake")) aanwezig.add("Intake");
    else if (lower.startsWith("diagnostiek")) aanwezig.add("Diagnostiek");
    else if (lower.startsWith("screening")) aanwezig.add("Screening");
  }
  return FASE_VOLGORDE.find((fase) => aanwezig.has(fase)) ?? "Onbekend";
}

// Taal-tags tussen de wachtlijstlabels (whitelist — de labels mengen fases,
// locaties en talen in één veld).
const TAAL_TAGS = new Set(["nederlands", "engels", "pools", "turks", "arabisch", "duits", "frans"]);

function mediaan(sortedValues: number[]): number | null {
  const n = sortedValues.length;
  if (n === 0) return null;
  if (n % 2 === 1) return sortedValues[(n - 1) / 2];
  return Math.round((sortedValues[n / 2 - 1] + sortedValues[n / 2]) / 2);
}

export function isWachtend(record: ClientRecord): boolean {
  return record.wachtlijst || record.preWachtlijst;
}

/** Wachtduur tot nu: sinds episodestart (interne wachtlijst) of sinds verwijzing. */
export function wachtduurDagen(record: ClientRecord, referenceIso: string): number {
  if (record.episodeStart && record.episodeStart <= referenceIso) {
    return daysBetween(record.episodeStart, referenceIso);
  }
  if (record.verwijsdatum && record.verwijsdatum <= referenceIso) {
    return daysBetween(record.verwijsdatum, referenceIso);
  }
  return 0;
}

function modalValue(values: (string | null)[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = "—";
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function groupCount<T>(items: T[], keyOf: (item: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Eén pass over de records i.p.v. per naam filteren (O(n) i.p.v. O(namen×n)). */
function groupBy<T>(items: T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

function topGroepen(counts: Map<string, number>, top: number, restLabel: string): AantalGroep[] {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, top).map(([label, aantal]) => ({ label, aantal }));
  const rest = sorted.slice(top).reduce((sum, [, aantal]) => sum + aantal, 0);
  if (rest > 0) {
    head.push({ label: restLabel, aantal: rest });
  }
  return head;
}

/**
 * "F.C. Raaijmakers (Huisartsenpraktijk Raaijmakers)" → "Huisartsenpraktijk Raaijmakers".
 * De export schrijft dezelfde praktijk wisselend als "HAP X", "Huisartspraktijk X"
 * en "Huisartsenpraktijk X" (identieke rest-naam) — zonder canonicalisatie
 * splitsen die varianten de verwijzers-toplijst. Aanname: "HAP" is hier de
 * praktijk-afkorting, niet een huisartsenpost (die delen geen praktijknaam).
 */
function verwijzerLabel(raw: string): string {
  const match = /\(([^)]+)\)\s*$/.exec(raw);
  const label = match ? match[1].trim() : raw.trim();
  const effectief = label.length > 0 ? label : raw.trim();
  return effectief.replace(/^(?:hap|huisartspraktijk|huisartsenpraktijk)\s+/i, "Huisartsenpraktijk ");
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// Veghel: sinds de export van 2026-07 bevat de cliëntendata ook de tweede
// instelling (Vurans Veghel) — genormaliseerd tot vestigingsplaats "Veghel".
// Deze lijst is uitsluitend een weergavevolgorde-hint: welke vestigingen
// bestáán komt uit de import (zie vestigingenIn/aanwezigeVestigingen).
export const KNOWN_LOCATIES = ["Tilburg", "Veghel", "Breda", "Roermond"];

/** Weergavevolgorde voor vestigingslabels: bekende vestigingen eerst in hun
    vaste volgorde, daarna nieuwe vestigingen alfabetisch, "Onbekend" sluit af. */
function ordenLocaties(labels: Iterable<string>): string[] {
  const rang = (label: string) => {
    if (label === "Onbekend") return KNOWN_LOCATIES.length + 1;
    const index = KNOWN_LOCATIES.indexOf(label);
    return index === -1 ? KNOWN_LOCATIES.length : index;
  };
  return [...new Set(labels)].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b, "nl"));
}

/** Vestigingen die daadwerkelijk in een export voorkomen — de bron voor het
    locatiefilter. Een nieuwe vestiging in het EPD (bv. De Zorgpoort of TGC
    Eindhoven) is daarmee meteen filterbaar in plaats van stil "Onbekend". */
export function aanwezigeVestigingen(records: readonly ClientRecord[]): string[] {
  const aanwezig = new Set<string>();
  for (const record of records) {
    if (record.vestiging !== null) {
      aanwezig.add(record.vestiging);
    }
  }
  return ordenLocaties(aanwezig);
}

/** Vestigingsassen voor de per-locatie-panelen: de bekende vestigingen blijven
    als vaste kolom staan (ook op 0), aangevuld met alles wat de import verder
    meebrengt. */
export function vestigingenIn(records: readonly ClientRecord[]): string[] {
  return ordenLocaties([...KNOWN_LOCATIES, ...aanwezigeVestigingen(records)]);
}

// Verwachte uitbetaling (opgave klant, spiegelt zijn FACTURATIE.xlsx):
// verzekeraarskanalen (Vecozo + servicebureau) ± 65%, RMO/RMA-regelingen 100%.
// De gemeten toekennings-% per koepel staat in het Declaratiestatus-paneel.
export const UITBETALING_PCT = 0.65;

export interface SnapshotFilters {
  locatie: string;
}

export interface SnapshotExtra {
  agenda?: AgendaFacts | null;
  verwijzers?: VerwijzersFacts | null;
  toeslagen?: ToeslagenFacts | null;
  declaraties?: DeclaratiesFacts | null;
}

export function computeProductionSnapshot(
  state: ProductionState,
  filters: SnapshotFilters,
  referenceDate: Date,
  extra?: SnapshotExtra,
): ProductionSnapshot {
  const referenceIso = isoFromDate(referenceDate);
  const records =
    filters.locatie === "Alle locaties"
      ? state.records
      : state.records.filter((record) => record.vestiging === filters.locatie);

  // Vestigingsas van deze import: de bekende vier plus alles wat het EPD verder
  // aanlevert. Zo valt een nieuwe vestiging niet stil in de "Onbekend"-bucket.
  const locaties = vestigingenIn(state.records);

  const months = lastFullMonths(referenceIso, 12);
  const lastMonth = months[months.length - 1];

  const startsPerMaand = groupCount(records, (record) => monthKeyOf(instroomDatum(record)));
  const eindesPerMaand = groupCount(records, (record) => monthKeyOf(uitstroomDatum(record)));
  const verwijzingenPerMaand = groupCount(records, (record) => monthKeyOf(record.verwijsdatum));

  const monthly: ProductionMonthPoint[] = months.map((month) => ({
    m: month.label,
    key: month.key,
    aanmeldingen: startsPerMaand.get(month.key) ?? 0,
    uitstroom: eindesPerMaand.get(month.key) ?? 0,
    caseload: records.filter((record) => activeAt(record, month.endIso)).length,
    verwijzingen: verwijzingenPerMaand.get(month.key) ?? 0,
    // Agenda-velden worden verderop ingevuld wanneer een agenda-import aanwezig is.
    noshowPct: null,
    omzet: null,
    omzetVecozo: null,
    omzetServicebureau: null,
    omzetRmoRma: null,
  }));

  // Volledige historie (klantverzoek 2026-07-25): dezelfde maandreeks, maar
  // vanaf de vroegste databron-maand i.p.v. de laatste 12. Alléén de
  // tijdvenster-grafieken gebruiken deze reeks (de "Alles"-optie); de
  // 12-maands-KPI's, sparklines, wachttijdtrend en per-behandelaar/dossiers-
  // productie-cijfers blijven bewust op `monthly` (12). Maandlabels dragen het
  // jaar ("apr '25") zodat een meerjarige as niet dubbelzinnig is.
  const monthNr = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7));
  const vroegsteStartMaand = [...startsPerMaand.keys()].sort()[0];
  const volledigAantalMaanden = vroegsteStartMaand
    ? Math.max(12, monthNr(lastMonth.key) - monthNr(vroegsteStartMaand) + 1)
    : 12;
  const monthsFull = lastFullMonths(referenceIso, volledigAantalMaanden);
  const monthlyFull: ProductionMonthPoint[] = monthsFull.map((month) => ({
    m: `${MAAND_LABELS[month.month0]} '${String(month.year).slice(2)}`,
    key: month.key,
    aanmeldingen: startsPerMaand.get(month.key) ?? 0,
    uitstroom: eindesPerMaand.get(month.key) ?? 0,
    caseload: records.filter((record) => activeAt(record, month.endIso)).length,
    verwijzingen: verwijzingenPerMaand.get(month.key) ?? 0,
    noshowPct: null,
    omzet: null,
    omzetVecozo: null,
    omzetServicebureau: null,
    omzetRmoRma: null,
  }));

  const actieveClienten = records.filter((record) => activeAt(record, referenceIso));
  const actiefNu = actieveClienten.length;
  const actiefVorigeMaand = monthly[monthly.length - 1].caseload;

  const aanmeldingenLaatste = monthly[monthly.length - 1].aanmeldingen;
  const aanmeldingenVorige = monthly[monthly.length - 2].aanmeldingen;
  const uitstroomLaatste = monthly[monthly.length - 1].uitstroom;
  const uitstroomVorige = monthly[monthly.length - 2].uitstroom;

  // ---- Dossier-compleetheid (alleen de controles die deze export ondersteunt) ----
  const zonderDiagnose = actieveClienten.filter((record) => record.diagnoseCode === null);
  const zonderZorgtypering = actieveClienten.filter((record) => record.zorgvraagtype === null);
  const zonderVerwijzer = actieveClienten.filter((record) => record.verwijzer === null);
  const zonderBehandelaar = actieveClienten.filter((record) => record.behandelaar === null);
  // Cluster van administratief lege dossiers: geen vestiging, geen behandelaar
  // én geen regiebehandelaar — één registratieprobleem, geen drie losse.
  const adminOnvolledig = actieveClienten.filter(
    (record) => record.vestiging === null && record.behandelaar === null && record.regiebehandelaar === null,
  );
  // Geselecteerde typering wijkt af van het HoNOS-advies (beide gevuld).
  const afwijkendeTypering = actieveClienten.filter(
    (record) =>
      record.zorgvraagtype !== null &&
      (record.voorgesteldZorgvraagtype ?? null) !== null &&
      record.zorgvraagtype !== record.voorgesteldZorgvraagtype,
  );
  const nietCompleet = actieveClienten.filter(
    (record) => record.diagnoseCode === null || record.zorgvraagtype === null || record.verwijzer === null,
  ).length;

  // ---- Outreachend (proxy: ZPM-setting S04) ----
  const outreachNu = actieveClienten.filter((record) => record.setting === "S04").length;
  const outreachSpark = months.map(
    (month) => records.filter((record) => activeAt(record, month.endIso) && record.setting === "S04").length,
  );
  const outreachVorige = outreachSpark[outreachSpark.length - 1];

  // ---- Wachtlijst ----
  const wachtenden = records.filter(isWachtend);
  const wachtendenMetDuur = wachtenden.map((record) => ({
    record,
    dagen: wachtduurDagen(record, referenceIso),
  }));
  const intakeWachtenden = wachtenden.filter(
    (record) => record.preWachtlijst || !isBehandelingsfase(record.wachtlijstLabels),
  );
  const behandelingWachtenden = wachtenden.filter(
    (record) => !record.preWachtlijst && isBehandelingsfase(record.wachtlijstLabels),
  );
  const urgentWachtenden = wachtendenMetDuur.filter((item) => item.dagen > 60);

  const wachtlijstBuckets: AantalGroep[] = [
    { label: "0–14 dagen", aantal: wachtendenMetDuur.filter((item) => item.dagen <= 14).length },
    { label: "15–30 dagen", aantal: wachtendenMetDuur.filter((item) => item.dagen > 14 && item.dagen <= 30).length },
    { label: "31–60 dagen", aantal: wachtendenMetDuur.filter((item) => item.dagen > 30 && item.dagen <= 60).length },
    { label: "60+ dagen", aantal: urgentWachtenden.length },
  ];

  const wachtlijstPerLocatie: AantalGroep[] = locaties
    .map((loc) => ({
      label: loc,
      aantal: wachtenden.filter((record) => record.vestiging === loc).length,
    }))
    .filter((groep) => filters.locatie === "Alle locaties" || groep.label === filters.locatie);
  // Wachtenden zonder (bekende) vestiging horen bij het totaal — zonder deze
  // bucket zouden de locatiebalken niet optellen tot "Totaal wachtend".
  if (filters.locatie === "Alle locaties") {
    const wachtendZonderVestiging = wachtenden.filter(
      (record) => record.vestiging === null || !locaties.includes(record.vestiging),
    ).length;
    if (wachtendZonderVestiging > 0) {
      wachtlijstPerLocatie.push({ label: "Onbekend", aantal: wachtendZonderVestiging });
    }
  }

  // Fase-verdeling: elke wachtende telt in precies één (meest gevorderde) fase.
  const faseCounts = groupCount(wachtenden, (record) => wachtlijstFase(record.wachtlijstLabels));
  const wachtlijstFases: AantalGroep[] = FASE_VOLGORDE.concat("Onbekend")
    .map((fase) => ({ label: fase, aantal: faseCounts.get(fase) ?? 0 }))
    .filter((groep) => groep.aantal > 0);

  // Taal-tags (alleen waar geregistreerd): capaciteitssignaal, bijv. Poolstalige
  // wachtenden. Per cliënt uniek en op kleine letters gesleuteld, zodat een tag
  // die in beide labelkolommen staat (of met andere casing) niet dubbel telt.
  const taalCounts = new Map<string, number>();
  for (const record of wachtenden) {
    const talenVanClient = new Set(
      record.wachtlijstLabels.map((label) => label.toLowerCase()).filter((label) => TAAL_TAGS.has(label)),
    );
    for (const taal of talenVanClient) {
      const label = taal.charAt(0).toUpperCase() + taal.slice(1);
      taalCounts.set(label, (taalCounts.get(label) ?? 0) + 1);
    }
  }
  const wachtlijstTalen: AantalGroep[] = [...taalCounts.entries()]
    .map(([label, aantal]) => ({ label, aantal }))
    .sort((a, b) => b.aantal - a.aantal);

  // ---- Gerealiseerde wachttijd (verwijzing → episodestart) ----
  // Negatieve wachttijden (verwijzing ná episodestart geregistreerd — komt in
  // de echte export voor) zijn registratiefouten en worden uitgesloten in
  // plaats van op 0 geklemd, anders drukken ze het gemiddelde kunstmatig.
  const gerealiseerdeWacht = (fromIso: string, toIso: string, loc?: string): number[] =>
    records
      .filter(
        (record) =>
          record.episodeStart !== null &&
          record.verwijsdatum !== null &&
          record.episodeStart >= fromIso &&
          record.episodeStart <= toIso &&
          (loc === undefined || record.vestiging === loc),
      )
      .map((record) => daysBetween(record.verwijsdatum as string, record.episodeStart as string))
      .filter((dagen) => dagen >= 0);

  // ---- Wachttijd-trend per startmaand ----
  // De maandmediaan laat de ontwikkeling zien die het kwartaalgemiddelde
  // verbergt; overTreek telt starters boven de Treeknorm (in dagen).
  const treeknormDagen = TREEKNORM_WEKEN * 7;
  const wachtPerStartmaand = groupBy(
    records.filter(
      (record) =>
        record.episodeStart !== null &&
        record.verwijsdatum !== null &&
        daysBetween(record.verwijsdatum, record.episodeStart) >= 0,
    ),
    (record) => monthKeyOf(record.episodeStart),
  );
  const wachttijdRij = (month: MonthRef, label: string) => {
    const dagen = (wachtPerStartmaand.get(month.key) ?? [])
      .map((record) => daysBetween(record.verwijsdatum as string, record.episodeStart as string))
      .sort((a, b) => a - b);
    return {
      m: label,
      key: month.key,
      n: dagen.length,
      mediaanDagen: mediaan(dagen),
      overTreek: dagen.filter((d) => d > treeknormDagen).length,
    };
  };
  const wachttijdTrend = months.map((month) => wachttijdRij(month, month.label));
  // Volledige historie voor de wachttijdgrafiek ("Alles"-optie); de facts en
  // het kwartaalgemiddelde blijven op de 12-maands `wachttijdTrend`.
  const wachttijdTrendFull = monthsFull.map((month) =>
    wachttijdRij(month, `${MAAND_LABELS[month.month0]} '${String(month.year).slice(2)}`),
  );

  const kwartaalStart = months[months.length - 3].key.concat("-01");
  const vorigKwartaalStart = months[months.length - 6].key.concat("-01");
  const vorigKwartaalEind = months[months.length - 4].endIso;
  const wachtHuidig = mean(gerealiseerdeWacht(kwartaalStart, lastMonth.endIso));
  const wachtVorig = mean(gerealiseerdeWacht(vorigKwartaalStart, vorigKwartaalEind));

  const treekLocaties = locaties
    .filter((loc) => filters.locatie === "Alle locaties" || loc === filters.locatie)
    .map((loc) => {
      let intakeWaarden = gerealiseerdeWacht(kwartaalStart, lastMonth.endIso, loc);
      let intakeVenster: "kwartaal" | "12mnd" = "kwartaal";
      if (intakeWaarden.length < 3) {
        intakeWaarden = gerealiseerdeWacht(months[0].key.concat("-01"), lastMonth.endIso, loc);
        intakeVenster = "12mnd";
      }
      const intakeGem = mean(intakeWaarden);
      const behandelingDuur = mean(
        behandelingWachtenden
          .filter((record) => record.vestiging === loc)
          .map((record) => wachtduurDagen(record, referenceIso)),
      );
      return {
        loc,
        intake: intakeGem === null ? null : round1(intakeGem / 7),
        behandeling: behandelingDuur === null ? null : round1(behandelingDuur / 7),
        intakeVenster,
      };
    });

  // ---- Behandelaren & regiebehandelaren ----
  const behandelaren = [...groupBy(actieveClienten, (record) => record.behandelaar).entries()]
    .map(([naam, clienten]) => ({
      naam,
      loc: modalValue(clienten.map((record) => record.vestiging)),
      caseload: clienten.length,
      nc: clienten.filter((record) => record.diagnoseCode === null).length,
      directeTijdUren: Math.round(clienten.reduce((sum, record) => sum + record.directeTijdMin, 0) / 60),
      totaleTijdUren: Math.round(clienten.reduce((sum, record) => sum + record.totaleTijdMin, 0) / 60),
    }))
    .sort((a, b) => b.caseload - a.caseload);

  const regiebehandelaren = [...groupBy(actieveClienten, (record) => record.regiebehandelaar).entries()]
    .map(([naam, clienten]) => ({
      naam,
      loc: modalValue(clienten.map((record) => record.vestiging)),
      clienten: clienten.length,
    }))
    .sort((a, b) => b.clienten - a.clienten);

  const afsluitingenPerBehandelaar = groupCount(
    records.filter((record) => monthKeyOf(uitstroomDatum(record)) === lastMonth.key),
    (record) => record.behandelaar,
  );

  // ---- Populatie-verdelingen ----
  const diagnoseCounts = groupCount(actieveClienten, (record) => record.diagnoseGroep);
  const diagnoseGroepen: AantalGroep[] = [...diagnoseCounts.entries()]
    .map(([label, aantal]) => ({ label, aantal }))
    .sort((a, b) => b.aantal - a.aantal);
  if (zonderDiagnose.length > 0) {
    diagnoseGroepen.push({ label: "Geen diagnose geregistreerd", aantal: zonderDiagnose.length });
  }

  const geslachtCounts = groupCount(actieveClienten, (record) => record.geslacht);
  const geslacht = [
    { name: "Vrouw", value: geslachtCounts.get("Vrouw") ?? 0, color: "var(--chart-1)" },
    { name: "Man", value: geslachtCounts.get("Man") ?? 0, color: "var(--chart-2)" },
    { name: "Anders / onbekend", value: geslachtCounts.get("Anders") ?? 0, color: "var(--chart-4)" },
  ].filter((item) => item.value > 0);

  const leeftijdGroepen: AantalGroep[] = [
    { label: "0–17 jaar", aantal: actieveClienten.filter((r) => r.leeftijd !== null && r.leeftijd < 18).length },
    {
      label: "18–25 jaar",
      aantal: actieveClienten.filter((r) => r.leeftijd !== null && r.leeftijd >= 18 && r.leeftijd <= 25).length,
    },
    {
      label: "26–40 jaar",
      aantal: actieveClienten.filter((r) => r.leeftijd !== null && r.leeftijd >= 26 && r.leeftijd <= 40).length,
    },
    {
      label: "41–65 jaar",
      aantal: actieveClienten.filter((r) => r.leeftijd !== null && r.leeftijd >= 41 && r.leeftijd <= 65).length,
    },
    { label: "65+ jaar", aantal: actieveClienten.filter((r) => r.leeftijd !== null && r.leeftijd > 65).length },
    { label: "Onbekend", aantal: actieveClienten.filter((r) => r.leeftijd === null).length },
  ].filter((groep) => groep.label !== "Onbekend" || groep.aantal > 0);

  // Zelfde venster als élke andere 12-maands-aggregatie: de laatste 12 vólle
  // maanden — niet "zelfde maand vorig jaar t/m vandaag" (dat is ~13 maanden
  // incl. de lopende maand en spoort niet met de maandreeksen).
  const verwijzerVan = months[0].key.concat("-01");
  const verwijzerTot = lastMonth.endIso;
  // Groepering primair op AGB-code (authoritatief; vangt naamvarianten die
  // tekstuele canonicalisatie mist), terugval op de genormaliseerde naam.
  // Weergavelabel = meest voorkomende naam binnen de groep; gelijknamige
  // groepen worden voor weergave samengeteld (status quo van naamgroepering).
  const verwijzerGroepen = new Map<string, { aantal: number; labels: Map<string, number> }>();
  for (const record of records) {
    if (
      record.verwijsdatum === null ||
      record.verwijsdatum < verwijzerVan ||
      record.verwijsdatum > verwijzerTot ||
      record.verwijzer === null
    ) {
      continue;
    }
    const label = verwijzerLabel(record.verwijzer);
    const key = record.verwijzerAgb ?? `naam:${label.toLowerCase()}`;
    const groep = verwijzerGroepen.get(key) ?? { aantal: 0, labels: new Map<string, number>() };
    groep.aantal += 1;
    groep.labels.set(label, (groep.labels.get(label) ?? 0) + 1);
    verwijzerGroepen.set(key, groep);
  }
  const verwijzerCounts = new Map<string, number>();
  for (const groep of verwijzerGroepen.values()) {
    const label = [...groep.labels.entries()].sort((a, b) => b[1] - a[1])[0][0];
    verwijzerCounts.set(label, (verwijzerCounts.get(label) ?? 0) + groep.aantal);
  }
  const verwijzers = topGroepen(verwijzerCounts, 5, "Overige verwijzers");

  const plaatsen = topGroepen(
    groupCount(actieveClienten, (record) => record.plaats),
    7,
    "Overige plaatsen",
  );

  const verzekeraars = topGroepen(
    groupCount(actieveClienten, (record) => record.verzekeraar ?? "Onbekend"),
    5,
    "Overig",
  );

  // ---- Zorgvraagtypering (geselecteerd ZT, ZPM) ----
  // Label = code + omschrijvingsstaart uit de data ("ZT03 · matige problematiek").
  const ztOmschrijvingen = new Map<string, string>();
  for (const record of actieveClienten) {
    const staart = (record.zorgvraagtypeOmschrijving ?? "").split(" - ").pop()?.trim();
    if (record.zorgvraagtype && staart && !ztOmschrijvingen.has(record.zorgvraagtype)) {
      ztOmschrijvingen.set(record.zorgvraagtype, staart);
    }
  }
  const ztCounts = groupCount(actieveClienten, (record) => record.zorgvraagtype);
  const zorgvraagtypes: AantalGroep[] = [...ztCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, aantal]) => {
      const staart = ztOmschrijvingen.get(code);
      return { label: staart ? `${code} · ${staart}` : code, aantal };
    });
  if (zonderZorgtypering.length > 0) {
    zorgvraagtypes.push({ label: "Geen typering geregistreerd", aantal: zonderZorgtypering.length });
  }

  // ---- Behandelduur (afgesloten episodes binnen het locatiefilter) ----
  const afgeslotenEpisodes = records.filter(
    (record) =>
      record.episodeStart !== null &&
      record.episodeEind !== null &&
      record.episodeEind <= referenceIso &&
      daysBetween(record.episodeStart, record.episodeEind) >= 0,
  );
  const behandelduren = afgeslotenEpisodes
    .map((record) => daysBetween(record.episodeStart as string, record.episodeEind as string))
    .sort((a, b) => a - b);
  const behandelduurGem = mean(behandelduren);

  // Laatste vier vólledige kwartalen (kwartaal van de einddatum): trendsignaal
  // met eerlijke afbakening — het lopende kwartaal is per definitie onvolledig.
  const kwartaalVan = (isoDatum: string) => {
    const jaar = isoDatum.slice(0, 4);
    const q = Math.ceil(Number(isoDatum.slice(5, 7)) / 3);
    return `Q${q} '${jaar.slice(2)}`;
  };
  const refJaar = Number(referenceIso.slice(0, 4));
  const refKwartaal0 = Math.floor((Number(referenceIso.slice(5, 7)) - 1) / 3);
  const voltooideKwartalen: string[] = [];
  for (let terug = 4; terug >= 1; terug -= 1) {
    const totaal0 = refJaar * 4 + refKwartaal0 - terug;
    voltooideKwartalen.push(`Q${(totaal0 % 4) + 1} '${String(Math.floor(totaal0 / 4)).slice(2)}`);
  }
  const durenPerKwartaal = groupBy(afgeslotenEpisodes, (record) => kwartaalVan(record.episodeEind as string));
  const perKwartaal = voltooideKwartalen.map((label) => {
    const dagen = (durenPerKwartaal.get(label) ?? [])
      .map((record) => daysBetween(record.episodeStart as string, record.episodeEind as string))
      .sort((a, b) => a - b);
    return { label, n: dagen.length, mediaanDagen: mediaan(dagen) };
  });

  const behandelduur = {
    afgesloten: behandelduren.length,
    gemDagen: behandelduurGem === null ? null : Math.round(behandelduurGem),
    mediaanDagen: mediaan(behandelduren),
    buckets: [
      { label: "0–30 dagen", aantal: behandelduren.filter((d) => d <= 30).length },
      { label: "31–60 dagen", aantal: behandelduren.filter((d) => d > 30 && d <= 60).length },
      { label: "61–90 dagen", aantal: behandelduren.filter((d) => d > 60 && d <= 90).length },
      { label: "91–180 dagen", aantal: behandelduren.filter((d) => d > 90 && d <= 180).length },
      { label: ">180 dagen", aantal: behandelduren.filter((d) => d > 180).length },
    ],
    perKwartaal,
    zonderRegistratie: afgeslotenEpisodes.filter((record) => record.totaleTijdMin === 0).length,
    churn14: behandelduren.filter((d) => d <= 14).length,
  };

  // ---- Comorbiditeit (secundaire diagnose geregistreerd) ----
  const comorbideAantal = actieveClienten.filter((record) => record.heeftSecundaireDiagnose === true).length;
  const comorbiditeit = {
    aantal: comorbideAantal,
    pct: actiefNu === 0 ? 0 : Math.round((comorbideAantal / actiefNu) * 100),
  };

  // ---- Zorgvorm als Setting-verdeling ----
  // Het ZPM-label is voor deze instelling 100% SGGZ; de informatieve verdeling
  // is de ZPM-setting: regulier ambulant (S03) vs outreachend (S04).
  const settingCounts = groupCount(actieveClienten, (record) => record.setting ?? "Onbekend");
  const zorgvorm = [
    { name: "Ambulant (S03)", value: settingCounts.get("S03") ?? 0, color: "var(--chart-1)" },
    { name: "Outreachend (S04)", value: settingCounts.get("S04") ?? 0, color: "var(--chart-2)" },
    { name: "Onbekend", value: settingCounts.get("Onbekend") ?? 0, color: "var(--chart-4)" },
  ].filter((item) => item.value > 0);

  // ---- Contact-proxy: dossiers zonder één minuut geregistreerde tijd ----
  // Eerlijke ondergrens voor "geen contact": zonder afsprakenexport kennen we
  // geen contactdata, maar een niet-wachtend dossier dat >30/60 dagen open
  // staat met nul geregistreerde tijd heeft aantoonbaar geen geregistreerde zorg.
  const zonderRegistratieOud = (dagen: number) =>
    actieveClienten.filter(
      (record) =>
        !isWachtend(record) &&
        record.totaleTijdMin === 0 &&
        record.episodeStart !== null &&
        daysBetween(record.episodeStart, referenceIso) > dagen,
    ).length;
  const geenRegistratie30 = zonderRegistratieOud(30);
  const geenRegistratie60 = zonderRegistratieOud(60);

  // ---- Hoog-risico (proxy voor "Crisiscliënten") ----
  // Echte crisisdata zit niet in deze export; ZT05 (zeer ernstig) + ZT08 (zeer
  // risicovol/chaotisch) is het eerlijke klinische risicosignaal dat er wél in zit.
  const hoogRisico = actieveClienten.filter(
    (record) => record.zorgvraagtype === "ZT05" || record.zorgvraagtype === "ZT08",
  ).length;

  // ---- Productie-uren (cumulatief geregistreerde tijd op actieve dossiers) ----
  const productieUren = Math.round(actieveClienten.reduce((sum, record) => sum + record.totaleTijdMin, 0) / 60);

  // ---- Declaratierisico's ----
  const covRisico = actieveClienten.filter(
    (record) =>
      (record.covUzovi ?? null) === null ||
      ((record.polisEinde ?? null) !== null && (record.polisEinde as string) <= referenceIso),
  ).length;
  const agbOntbreekt = actieveClienten.filter(
    (record) => record.verwijzer !== null && (record.verwijzerAgb ?? null) === null,
  ).length;
  const afgeslotenZonderDiagnose = afgeslotenEpisodes.filter((record) => record.diagnoseCode === null).length;

  // ---- Datakwaliteit: vulgraad per veld over de héle export ----
  // Bewust ongefilterd (state.records): dit gaat over registratiediscipline
  // van het bestand zelf, niet over een locatie.
  const vulgraad = (veld: string, isGevuld: (record: ClientRecord) => boolean) => ({
    veld,
    gevuld: state.records.filter(isGevuld).length,
    totaal: state.records.length,
  });
  const datakwaliteit = [
    vulgraad("Vestiging", (r) => r.vestiging !== null),
    vulgraad("Behandelaar", (r) => r.behandelaar !== null),
    vulgraad("Regiebehandelaar", (r) => r.regiebehandelaar !== null),
    vulgraad("Verwijzer", (r) => r.verwijzer !== null),
    vulgraad("AGB-code verwijzer", (r) => (r.verwijzerAgb ?? null) !== null),
    vulgraad("Verwijsdatum", (r) => r.verwijsdatum !== null),
    vulgraad("Primaire diagnose", (r) => r.diagnoseCode !== null),
    vulgraad("Zorgvraagtypering", (r) => r.zorgvraagtype !== null),
    vulgraad("Setting", (r) => r.setting !== null),
    vulgraad("Verzekeringskoepel", (r) => r.verzekeraar !== null),
    vulgraad("COV-check", (r) => (r.covUzovi ?? null) !== null),
    vulgraad("Woonplaats", (r) => r.plaats !== null),
  ];

  const gemWachtlijstDuur = mean(wachtendenMetDuur.map((item) => item.dagen));

  // ---- Cockpit ----
  // Maand-KPI's tonen de laatste vólledige maand; het venster staat in de
  // subtekst zodat "104" medio juli leesbaar is als "juni: 104".
  const lastMonthNaam = MAAND_NAMEN[lastMonth.month0];
  const cockpitKpis: ProductionSnapshot["cockpitKpis"] = {
    actief: { value: actiefNu, prev: actiefVorigeMaand, spark: monthly.map((point) => point.caseload) },
    aanmeldingen: {
      value: aanmeldingenLaatste,
      prev: aanmeldingenVorige,
      spark: monthly.map((point) => point.aanmeldingen),
      windowLabel: lastMonthNaam,
    },
    gesloten: {
      value: uitstroomLaatste,
      prev: uitstroomVorige,
      spark: monthly.map((point) => point.uitstroom),
      windowLabel: lastMonthNaam,
    },
    dossiersnc: { value: nietCompleet, prev: null, spark: [] },
    outreach: { value: outreachNu, prev: outreachVorige, spark: outreachSpark },
  };

  const topDiagnose = diagnoseGroepen.find((groep) => groep.label !== "Geen diagnose geregistreerd");
  const topVerwijzer = verwijzers[0];
  const wachtlijstTotaal = wachtenden.length;

  const nettoLaatste = aanmeldingenLaatste - uitstroomLaatste;
  const cockpitSummary = [
    { label: "Afsluitingen", value: nl.format(uitstroomLaatste) },
    { label: `Netto groei (${lastMonth.label})`, value: `${nettoLaatste >= 0 ? "+" : ""}${nl.format(nettoLaatste)}` },
    { label: "Wachtlijst", value: nl.format(wachtlijstTotaal) },
    { label: "Top diagnose", value: topDiagnose ? topDiagnose.label.split(" ")[0] : "—" },
    { label: "Grootste verwijzer", value: topVerwijzer ? topVerwijzer.label : "—" },
    { label: "Zonder behandelaar", value: nl.format(zonderBehandelaar.length) },
  ];

  const instroomZin =
    aanmeldingenLaatste === aanmeldingenVorige
      ? `Instroom bleef stabiel op ${nl.format(aanmeldingenLaatste)} aanmeldingen per maand`
      : `Instroom ${aanmeldingenLaatste > aanmeldingenVorige ? "steeg" : "daalde"} van ${nl.format(aanmeldingenVorige)} naar ${nl.format(aanmeldingenLaatste)} aanmeldingen per maand`;
  const cockpitInsights = [
    `${instroomZin}; er lopen nu ${nl.format(actiefNu)} actieve dossiers.`,
    `${nl.format(zonderDiagnose.length)} actieve dossiers (${Math.round((zonderDiagnose.length / Math.max(1, actiefNu)) * 100)}%) missen een primaire DSM-5-diagnose — grootste dossiercontrole-actiepunt.`,
    regiebehandelaren[0] && regiebehandelaren[0].clienten > REGIE_NORM
      ? `${regiebehandelaren[0].naam} draagt als regiebehandelaar ${nl.format(regiebehandelaren[0].clienten)} cliënten — ruim boven de regienorm van ${REGIE_NORM}. Overweeg herverdeling.`
      : `Wachtlijst telt ${nl.format(wachtlijstTotaal)} cliënten; ${nl.format(urgentWachtenden.length)} wachten langer dan 60 dagen.`,
    // Capaciteitsinzicht: netto groei + doorstroom (uitstroom t.o.v. caseload).
    `Netto groei in ${MAAND_NAMEN[lastMonth.month0]}: ${nettoLaatste >= 0 ? "+" : ""}${nl.format(nettoLaatste)} cliënten (${nl.format(aanmeldingenLaatste)} in, ${nl.format(uitstroomLaatste)} uit); de uitstroom is ${actiefVorigeMaand > 0 ? `${String(round1((uitstroomLaatste / actiefVorigeMaand) * 100)).replace(".", ",")}%` : "—"} van de caseload per maand.`,
  ];

  // ---- Patiënten ----
  const patientenMetrics: Record<string, LiveMetric> = {
    "Actieve patiënten": { label: "Actieve patiënten", value: actiefNu, prev: actiefVorigeMaand, f: "int" },
    "Nieuwe patiënten": {
      label: "Nieuwe patiënten",
      value: aanmeldingenLaatste,
      prev: aanmeldingenVorige,
      f: "int",
      windowLabel: lastMonthNaam,
    },
    Uitstroom: {
      label: "Uitstroom",
      value: uitstroomLaatste,
      prev: uitstroomVorige,
      f: "int",
      neutralDown: true,
      windowLabel: lastMonthNaam,
    },
    "Wachtlijst intake": {
      label: "Wachtlijst intake",
      value: intakeWachtenden.length,
      prev: null,
      f: "int",
      betterLow: true,
    },
    "Wachtlijst behandeling": {
      label: "Wachtlijst behandeling",
      value: behandelingWachtenden.length,
      prev: null,
      f: "int",
      betterLow: true,
    },
    "Zonder behandelaar": {
      label: "Zonder behandelaar",
      value: zonderBehandelaar.length,
      prev: null,
      f: "int",
      betterLow: true,
    },
    // Gesleuteld op het demo-label (zo vindt de pagina de vervanging), maar met
    // een eerlijker weergavelabel: we meten registratie, niet contactrecentheid.
    ">30 dgn geen contact": {
      label: ">30 dgn geen registratie",
      value: geenRegistratie30,
      prev: null,
      f: "int",
      betterLow: true,
    },
    ">60 dgn geen contact": {
      label: ">60 dgn geen registratie",
      value: geenRegistratie60,
      prev: null,
      f: "int",
      betterLow: true,
    },
    Crisiscliënten: {
      label: "Hoog-risico (ZT05/ZT08)",
      value: hoogRisico,
      prev: null,
      f: "int",
      betterLow: true,
    },
  };

  // Eén rij per cliënt: wie zowel zonder behandelaar als >60 dagen wachtend is
  // (komt vaak samen voor) zou anders dubbel — met dubbele React-key — verschijnen.
  const zonderBehandelaarIds = new Set(zonderBehandelaar.map((record) => record.id));
  const risicoLijst: RisicoRij[] = [
    ...zonderBehandelaar.map((record) => ({
      id: `#${record.id}`,
      naam: `Cliënt ${record.id}`,
      team: record.zpmLabel ?? "—",
      loc: record.vestiging ?? "—",
      signaal: "Zonder behandelaar",
      dagen: record.episodeStart ? daysBetween(record.episodeStart, referenceIso) : 0,
      dossierUrl: record.dossierUrl,
    })),
    ...urgentWachtenden
      .filter((item) => !zonderBehandelaarIds.has(item.record.id))
      .map((item) => ({
        id: `#${item.record.id}`,
        naam: `Cliënt ${item.record.id}`,
        team: item.record.zpmLabel ?? "—",
        loc: item.record.vestiging ?? "—",
        signaal: "Wachtlijst >60 dagen",
        dagen: item.dagen,
        dossierUrl: item.record.dossierUrl,
      })),
  ]
    .sort((a, b) => b.dagen - a.dagen)
    .slice(0, 6);

  // ---- Signaleringen (alleen regels die deze export kan berekenen) ----
  const overbelast = behandelaren.filter((row) => row.caseload > CASELOAD_NORM);
  const regieOverbelast = regiebehandelaren.filter((row) => row.clienten > REGIE_NORM);
  const treekOverschrijding = treekLocaties.filter((row) => row.intake !== null && row.intake > TREEKNORM_WEKEN);

  const signaleringen: ProductionAlert[] = [];
  if (treekOverschrijding.length > 0) {
    signaleringen.push({
      sev: "kritiek",
      titel: "Wachtlijst boven Treeknorm",
      unit: "locatie",
      detail: treekOverschrijding
        .map(
          (row) =>
            `Intake ${row.loc} staat op ${String(row.intake).replace(".", ",")} wkn (norm ${TREEKNORM_WEKEN}${row.intakeVenster === "12mnd" ? "; 12-maandsvenster" : ""}).`,
        )
        .join(" "),
      n: treekOverschrijding.length,
      page: "patienten",
    });
  }
  if (overbelast.length > 0) {
    signaleringen.push({
      sev: "kritiek",
      titel: `Caseload boven norm (>${CASELOAD_NORM})`,
      unit: "behandelaars",
      detail: `${overbelast
        .slice(0, 3)
        .map((row) => `${row.naam} (${row.caseload})`)
        .join(", ")} boven de caseloadnorm van ${CASELOAD_NORM} cliënten.`,
      n: overbelast.length,
      page: "behandelaren",
    });
  }
  if (regieOverbelast.length > 0) {
    signaleringen.push({
      sev: "kritiek",
      titel: `Regiebehandelaar boven norm (>${REGIE_NORM})`,
      unit: "regiebehandelaars",
      detail: `${regieOverbelast
        .slice(0, 3)
        .map((row) => `${row.naam} (${row.clienten})`)
        .join(", ")} boven de regienorm van ${REGIE_NORM} cliënten.`,
      n: regieOverbelast.length,
      page: "dossiersProductie",
    });
  }
  if (urgentWachtenden.length > 0) {
    signaleringen.push({
      sev: "hoog",
      titel: "Wachtenden >60 dagen",
      unit: "cliënten",
      detail: `${nl.format(urgentWachtenden.length)} cliënten staan langer dan 60 dagen op de wachtlijst.`,
      n: urgentWachtenden.length,
      page: "patienten",
    });
  }
  if (zonderDiagnose.length > 0) {
    signaleringen.push({
      sev: "hoog",
      titel: "Geen primaire diagnose",
      unit: "dossiers",
      detail: `${nl.format(zonderDiagnose.length)} actieve dossiers missen een primaire DSM-5-diagnose.`,
      n: zonderDiagnose.length,
      page: "dossiers",
    });
  }
  if (zonderBehandelaar.length > 0) {
    signaleringen.push({
      sev: "hoog",
      titel: "Zonder behandelaar",
      unit: "cliënten",
      detail: `${nl.format(zonderBehandelaar.length)} actieve cliënten hebben geen behandelaar toegewezen${
        adminOnvolledig.length > 0
          ? `, waarvan ${nl.format(adminOnvolledig.length)} administratief leeg (ook geen vestiging en regiebehandelaar)`
          : ""
      }.`,
      n: zonderBehandelaar.length,
      page: "patienten",
    });
  }
  if (zonderZorgtypering.length > 0) {
    signaleringen.push({
      sev: "middel",
      titel: "Geen zorgvraagtypering",
      unit: "dossiers",
      detail: `${nl.format(zonderZorgtypering.length)} actieve dossiers zonder geselecteerd zorgvraagtype.`,
      n: zonderZorgtypering.length,
      page: "dossiers",
    });
  }

  // ---- Dossiers & productie ----
  const medewerkers = behandelaren.map((row) => ({
    naam: row.naam,
    loc: row.loc,
    caseload: row.caseload,
    afsluitingen: afsluitingenPerBehandelaar.get(row.naam) ?? 0,
    nc: row.nc,
  }));

  const dossiersProductieMetrics: Record<string, LiveMetric> = {
    "Actieve cliënten": { label: "Actieve cliënten", value: actiefNu, prev: actiefVorigeMaand, f: "int" },
    // Cumulatief geregistreerde tijd op actieve dossiers — géén maandproductie
    // (daarvoor is de urenregistratie-export nodig); het venster staat in de subtekst.
    "Productie-uren": {
      label: "Productie-uren",
      value: productieUren,
      prev: null,
      f: "int",
      windowLabel: "cumulatief",
    },
    Afsluitingen: {
      label: "Afsluitingen",
      value: uitstroomLaatste,
      prev: uitstroomVorige,
      f: "int",
      neutralDown: true,
      windowLabel: lastMonthNaam,
    },
    "Wachtlijst totaal": {
      label: "Wachtlijst totaal",
      value: wachtlijstTotaal,
      prev: null,
      f: "int",
      betterLow: true,
    },
    "Urgent op wachtlijst": {
      label: "Urgent op wachtlijst",
      value: urgentWachtenden.length,
      prev: null,
      f: "int",
      betterLow: true,
    },
  };

  const grootsteWachtLocatie = [...wachtlijstPerLocatie].sort((a, b) => b.aantal - a.aantal)[0];
  // Meest gestelde specifieke diagnose binnen de grootste groep (kolom
  // "Primaire diagnose omschrijving" — 1-op-1 met de code, leesbaarder).
  const topOmschrijving = topDiagnose
    ? modalValue(
        actieveClienten
          .filter((record) => record.diagnoseGroep === topDiagnose.label)
          .map((record) => record.diagnoseOmschrijving ?? null),
      )
    : "—";
  const dossiersProductieInsights = [
    topDiagnose
      ? `${topDiagnose.label} is met ${nl.format(topDiagnose.aantal)} cliënten (${Math.round((topDiagnose.aantal / Math.max(1, actiefNu)) * 100)}%) de grootste gediagnosticeerde groep${topOmschrijving !== "—" ? `; meest gesteld: "${topOmschrijving}"` : ""}.`
      : `Nog geen diagnoses geregistreerd in de export.`,
    grootsteWachtLocatie && wachtlijstTotaal > 0
      ? `${grootsteWachtLocatie.label} draagt ${nl.format(grootsteWachtLocatie.aantal)} van de ${nl.format(wachtlijstTotaal)} wachtenden.`
      : "De wachtlijst is momenteel leeg.",
    `${nl.format(zonderDiagnose.length)} actieve dossiers zonder primaire diagnose — grootste compliance-actiepunt uit de EPD-data.`,
  ];

  // ---- Dossiercontrole ----
  // Zonder gecontroleerde dossiers is "100% compleet" misleidend groen; 0 met
  // "gecontroleerd: 0" ernaast maakt de lege set zichtbaar.
  const compliancePct = actiefNu === 0 ? 0 : round1(100 - (nietCompleet / actiefNu) * 100);

  // Over de óngefilterde set: actieve cliënten die bij geen enkele bekende
  // vestiging horen en dus buiten elk locatiefilter vallen (banner-melding).
  const zonderVestiging = state.records.filter(
    (record) => activeAt(record, referenceIso) && (record.vestiging === null || !locaties.includes(record.vestiging)),
  ).length;

  // ---- Agenda-export: planning, no-show, uren, omzet en contactrecentheid ----
  const agendaFacts = extra?.agenda ?? null;
  let agendaSnapshot: ProductionAgendaSnapshot | null = null;
  if (agendaFacts) {
    const inFilter = (locatie: string | null) => filters.locatie === "Alle locaties" || locatie === filters.locatie;
    const cellen = agendaFacts.cellen.filter((cel) => inFilter(cel.locatie));

    // De agenda-export kan vestigingen bevatten die (nog) niet in de
    // cliëntendata staan; ook die horen op de per-locatie-assen thuis.
    const agendaLocaties = ordenLocaties([
      ...locaties,
      ...agendaFacts.cellen.map((cel) => cel.locatie).filter((locatie): locatie is string => locatie !== null),
    ]);

    // Blok-rijen (Afwezig) dragen geen locatie: attribueer ze aan de modale
    // sessie-locatie van de behandelaar (gedocumenteerde benadering).
    const locatiePerBehandelaar = new Map<string, Map<string, number>>();
    for (const cel of agendaFacts.cellen) {
      if (cel.behandelaar === null || cel.locatie === null) continue;
      const counts = locatiePerBehandelaar.get(cel.behandelaar) ?? new Map<string, number>();
      counts.set(cel.locatie, (counts.get(cel.locatie) ?? 0) + cel.sessies);
      locatiePerBehandelaar.set(cel.behandelaar, counts);
    }
    const modaleLocatie = (behandelaar: string | null): string | null => {
      if (behandelaar === null) return null;
      const counts = locatiePerBehandelaar.get(behandelaar);
      if (!counts || counts.size === 0) return null;
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    };
    const blokken = agendaFacts.blokken.filter((blok) => inFilter(modaleLocatie(blok.behandelaar)));

    // Vensters op het agenda-bereik zelf: is de agenda ouder dan de cliënten-
    // import, dan blijft de "laatste volle maand" binnen het agenda-bereik.
    // Historisch bereik eindigt op de peildatum van de agenda-import — bronTot
    // kan jaren verder liggen (geplande afspraken in het toekomstvenster) en
    // mag het venster nooit voorbij de werkelijke dekking schuiven.
    const agendaEinde = agendaHistorischEinde(agendaFacts);
    const agendaRefIso = agendaEinde < referenceIso ? agendaEinde : referenceIso;
    const agendaMonths = lastFullMonths(agendaRefIso, 12);
    const lastAgendaMonth = agendaMonths[agendaMonths.length - 1];
    const prevAgendaMonth = agendaMonths[agendaMonths.length - 2];
    const maandLabel = MAAND_NAMEN[lastAgendaMonth.month0];
    const agendaKeys = new Set(agendaMonths.map((month) => month.key));
    // Volledige agenda-historie voor de tijdvenster-grafieken ("Alles"-optie:
    // maandreeks, omzet per koepel/locatie). De 12-maands rollups, kaarten en
    // per-behandelaar/dossiers-productie-cijfers blijven op agendaMonths/agendaKeys.
    const agendaVroegsteMaand = agendaFacts.bronVan.slice(0, 7);
    const agendaVolledigAantal = Math.max(12, monthNr(lastAgendaMonth.key) - monthNr(agendaVroegsteMaand) + 1);
    const agendaMonthsFull = lastFullMonths(agendaRefIso, agendaVolledigAantal);
    const agendaFullKeys = new Set(agendaMonthsFull.map((month) => month.key));

    const NUM_VELDEN = [
      "sessies",
      "noShows",
      "tijdigAfgezegd",
      "directeMin",
      "indirecteMin",
      "reisMin",
      "totaleMin",
      "online",
      "opLocatie",
      "verslagen",
      "ondertekend",
      "omzetGerealiseerd",
      "onderhanden",
      "onderhandenSessies",
    ] as const;
    type Rollup = Record<(typeof NUM_VELDEN)[number], number>;
    const leegRollup = (): Rollup => {
      const rollup = {} as Rollup;
      for (const veld of NUM_VELDEN) rollup[veld] = 0;
      return rollup;
    };
    const telOp = (acc: Rollup, cel: Rollup) => {
      for (const veld of NUM_VELDEN) acc[veld] += cel[veld];
    };

    const perMaand = new Map<string, Rollup>();
    const totaalRollup = leegRollup();
    const twaalfMndRollup = leegRollup();
    for (const cel of cellen) {
      const acc = perMaand.get(cel.key) ?? leegRollup();
      telOp(acc, cel);
      perMaand.set(cel.key, acc);
      telOp(totaalRollup, cel);
      if (agendaKeys.has(cel.key)) telOp(twaalfMndRollup, cel);
    }
    const van = (key: string): Rollup => perMaand.get(key) ?? leegRollup();

    const blokPerMaand = new Map<string, number>();
    for (const blok of blokken) {
      blokPerMaand.set(blok.key, (blokPerMaand.get(blok.key) ?? 0) + blok.blokMin);
    }
    const factuurCellen = agendaFacts.facturatie.filter((cel) => inFilter(cel.locatie));
    // Kanaal-indeling conform het maandoverzicht van de klant (FACTURATIE.xlsx):
    // • RMO/RMA — regelingen voor asielzoekers/ontheemden, uitgevoerd door DSW,
    //   herkenbaar aan Uzovi 3355 (gewone DSW-verzekering is 7029): eigen potje;
    // • Vecozo — VGZ en DSW declareren rechtstreeks (opgave klant);
    // • Servicebureau — alle overige koepels lopen via Infomedics.
    // Alles per BEHANDELMAAND en exclusief toeslagen — zo sluiten de kaarten
    // 1-op-1 aan op het eigen maandoverzicht en de boekhoudkundige factuurtotalen.
    const RMO_RMA_UZOVI = "3355";
    const DIRECTE_KOEPELS = new Set(["VGZ", "DSW"]);
    const omzetVecozoPerMaand = new Map<string, number>();
    const omzetSbPerMaand = new Map<string, number>();
    const omzetRmoPerMaand = new Map<string, number>();
    const isRmoRma = (uzovi: string | null): boolean => uzovi === RMO_RMA_UZOVI;
    const kanaalDoel = (koepel: string | null, uzovi: string | null): Map<string, number> => {
      if (isRmoRma(uzovi)) return omzetRmoPerMaand;
      if (koepel !== null && DIRECTE_KOEPELS.has(koepel)) return omzetVecozoPerMaand;
      return omzetSbPerMaand;
    };
    const telOmzet = (key: string, koepel: string | null, uzovi: string | null, omzet: number) => {
      const doel = kanaalDoel(koepel, uzovi);
      doel.set(key, (doel.get(key) ?? 0) + omzet);
    };
    for (const cel of factuurCellen) {
      telOmzet(cel.key, cel.koepel, cel.uzovi, cel.omzet);
    }
    const omzetPerMaand = new Map<string, number>();
    for (const bron of [omzetVecozoPerMaand, omzetSbPerMaand, omzetRmoPerMaand]) {
      for (const [key, omzet] of bron) {
        omzetPerMaand.set(key, (omzetPerMaand.get(key) ?? 0) + omzet);
      }
    }
    // Groepslabel voor de koepel-uitsplitsingen: RMO/RMA apart van gewone DSW.
    const koepelGroep = (cel: { koepel: string | null; uzovi: string | null }): string =>
      isRmoRma(cel.uzovi) ? "RMO/RMA" : (cel.koepel ?? "Onbekend");

    const laatste = van(lastAgendaMonth.key);
    const vorige = van(prevAgendaMonth.key);
    const blokLaatste = blokPerMaand.get(lastAgendaMonth.key) ?? 0;
    const blokVorige = blokPerMaand.get(prevAgendaMonth.key) ?? 0;
    const uren = (minuten: number) => Math.round(minuten / 60);
    // No-show gemeten over doorgegane + gemiste afspraken: tijdig afgezegde
    // afspraken tellen niet mee in de noemer (die zijn immers niet "gemist").
    const noshowPctVan = (rollup: Rollup): number | null => {
      const noemer = rollup.sessies - rollup.tijdigAfgezegd;
      return noemer <= 0 ? null : round1((rollup.noShows / noemer) * 100);
    };
    const vulling = (rollup: Rollup, blokMin: number): number | null => {
      const totaal = rollup.totaleMin + blokMin;
      return totaal === 0 ? null : Math.round((rollup.totaleMin / totaal) * 100);
    };

    const planningMetrics: Record<string, LiveMetric> = {
      "Afspraken deze maand": {
        label: "Afspraken",
        value: laatste.sessies,
        prev: vorige.sessies,
        f: "int",
        windowLabel: maandLabel,
      },
      "No-shows": {
        label: "No-shows",
        value: laatste.noShows,
        prev: vorige.noShows,
        f: "int",
        betterLow: true,
        windowLabel: maandLabel,
      },
      Geannuleerd: {
        label: "Tijdig afgezegd",
        value: laatste.tijdigAfgezegd,
        prev: vorige.tijdigAfgezegd,
        f: "int",
        betterLow: true,
        windowLabel: maandLabel,
      },
      "Agenda-bezetting": {
        label: "Agenda-vulling",
        value: vulling(laatste, blokLaatste) ?? 0,
        prev: vulling(vorige, blokVorige),
        f: "pct0",
        windowLabel: maandLabel,
        noData: vulling(laatste, blokLaatste) === null,
      },
      "Beschikbare uren": {
        label: "Afwezig geblokkeerd (u)",
        value: uren(blokLaatste),
        prev: uren(blokVorige),
        f: "int",
        windowLabel: maandLabel,
      },
      "Productieve uren": {
        label: "Geregistreerde uren",
        value: uren(laatste.totaleMin),
        prev: uren(vorige.totaleMin),
        f: "int",
        windowLabel: maandLabel,
      },
      Behandeluren: {
        label: "Behandeluren",
        value: uren(laatste.directeMin),
        prev: uren(vorige.directeMin),
        f: "int",
        windowLabel: maandLabel,
      },
      "Indirecte uren": {
        label: "Indirecte uren",
        value: uren(laatste.indirecteMin),
        prev: uren(vorige.indirecteMin),
        f: "int",
        betterLow: true,
        windowLabel: maandLabel,
      },
    };

    // Alle 7 weekdagen in Nederlandse volgorde — de praktijk werkt ook in het weekend.
    const WEEKDAG_LABELS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
    const weekdagCellen = agendaFacts.weekdagen.filter((cel) => inFilter(cel.locatie));
    const noshowWeekdagen = [1, 2, 3, 4, 5, 6, 0].map((dag) => {
      const cellenVanDag = weekdagCellen.filter((cel) => cel.dag === dag);
      const sessies = cellenVanDag.reduce((sum, cel) => sum + cel.sessies, 0);
      const noShows = cellenVanDag.reduce((sum, cel) => sum + cel.noShows, 0);
      const afgezegd = cellenVanDag.reduce((sum, cel) => sum + (cel.tijdigAfgezegd ?? 0), 0);
      const noemer = sessies - afgezegd;
      return {
        dag: WEEKDAG_LABELS[dag],
        pct: noemer <= 0 ? 0 : round1((noShows / noemer) * 100),
        sessies,
      };
    });

    const urenverdeling = [
      { name: "Behandeluren", value: uren(laatste.directeMin), color: "var(--chart-1)" },
      { name: "Indirecte uren", value: uren(laatste.indirecteMin), color: "var(--chart-2)" },
      { name: "Reistijd", value: uren(laatste.reisMin), color: "var(--chart-3)" },
      { name: "Afwezig-blokken", value: uren(blokLaatste), color: "var(--chart-4)" },
    ].filter((item) => item.value > 0);

    const bezettingVoor = (loc: string): { sessieMin: number; blokMin: number } => {
      const sessieMin = agendaFacts.cellen
        .filter((cel) => cel.locatie === loc && agendaKeys.has(cel.key))
        .reduce((sum, cel) => sum + cel.totaleMin, 0);
      const blokMin = agendaFacts.blokken
        .filter((blok) => modaleLocatie(blok.behandelaar) === loc && agendaKeys.has(blok.key))
        .reduce((sum, blok) => sum + blok.blokMin, 0);
      return { sessieMin, blokMin };
    };
    const bezettingPerLocatie = agendaLocaties
      .filter((loc) => inFilter(loc))
      .map((loc) => {
        const { sessieMin, blokMin } = bezettingVoor(loc);
        const totaal = sessieMin + blokMin;
        return { loc, pct: totaal === 0 ? 0 : Math.round((sessieMin / totaal) * 100), totaal };
      })
      .filter((row) => row.totaal > 0)
      .map(({ loc, pct }) => ({ loc, pct }));
    const twaalfMndBlok = blokken
      .filter((blok) => agendaKeys.has(blok.key))
      .reduce((sum, blok) => sum + blok.blokMin, 0);
    const bezettingTotaal = vulling(twaalfMndRollup, twaalfMndBlok);

    const modality = [
      { name: "Online", value: twaalfMndRollup.online, color: "var(--chart-2)" },
      { name: "Op locatie", value: twaalfMndRollup.opLocatie, color: "var(--chart-1)" },
      {
        name: "Overig (MDO, telefonisch, …)",
        value: twaalfMndRollup.sessies - twaalfMndRollup.online - twaalfMndRollup.opLocatie,
        color: "var(--chart-4)",
      },
    ].filter((item) => item.value > 0);

    // ---- Financieel ----
    const vecozoLaatste = omzetVecozoPerMaand.get(lastAgendaMonth.key) ?? 0;
    const vecozoVorige = omzetVecozoPerMaand.get(prevAgendaMonth.key) ?? 0;
    const sbLaatste = omzetSbPerMaand.get(lastAgendaMonth.key) ?? 0;
    const sbVorige = omzetSbPerMaand.get(prevAgendaMonth.key) ?? 0;
    const rmoLaatste = omzetRmoPerMaand.get(lastAgendaMonth.key) ?? 0;
    const rmoVorige = omzetRmoPerMaand.get(prevAgendaMonth.key) ?? 0;
    const omzetTotaalLaatste = vecozoLaatste + sbLaatste + rmoLaatste;
    const omzetTotaalVorige = vecozoVorige + sbVorige + rmoVorige;
    const onderhandenTotaal = totaalRollup.onderhanden;
    // ">90 dagen": alles ouder dan drie volle maanden vóór de agenda-referentie.
    const drempel90 = agendaMonths[agendaMonths.length - 3].key;
    const ouder90 = cellen.filter((cel) => cel.key < drempel90).reduce((sum, cel) => sum + cel.onderhanden, 0);
    const ouder90Sessies = cellen
      .filter((cel) => cel.key < drempel90)
      .reduce((sum, cel) => sum + cel.onderhandenSessies, 0);

    const omzetGerealiseerdTotaal = agendaFacts.cellen.reduce((sum, cel) => sum + cel.omzetGerealiseerd, 0);
    const gemOmzetPerClient =
      agendaFacts.clienten.length === 0 ? null : omzetGerealiseerdTotaal / agendaFacts.clienten.length;
    const trajectenTotaal = agendaFacts.trajecten ?? 0;

    const verwachtUitbetaald = (bedrag: number, pct: number, pctLabel: string): LiveMetric["secondary"] => ({
      label: `Verwacht uitbetaald (${pctLabel})`,
      value: Math.round(bedrag * pct),
      f: "eurK",
    });
    const verwachtTotaal = (vecozo: number, sb: number, rmo: number): number =>
      Math.round((vecozo + sb) * UITBETALING_PCT + rmo);

    // Gesleuteld op de demo-labels (vervangings-patroon); "Totale omzet" en
    // "Omzet RMO/RMA" zijn productie-exclusieve kaarten zonder demo-slot.
    const financieelMetrics: Record<string, LiveMetric> = {
      "Totale omzet": {
        label: "Totale omzet",
        value: Math.round(omzetTotaalLaatste),
        prev: Math.round(omzetTotaalVorige),
        f: "eurK",
        windowLabel: `behandelmaand ${maandLabel} · excl. toeslagen`,
        secondary: {
          label: "Verwacht uitbetaald (65% · RMO/RMA 100%)",
          value: verwachtTotaal(vecozoLaatste, sbLaatste, rmoLaatste),
          f: "eurK",
        },
      },
      "Omzet verzekeraars": {
        label: "Omzet Vecozo (VGZ + DSW)",
        value: Math.round(vecozoLaatste),
        prev: Math.round(vecozoVorige),
        f: "eurK",
        windowLabel: `behandelmaand ${maandLabel}`,
        secondary: verwachtUitbetaald(vecozoLaatste, UITBETALING_PCT, "65%"),
      },
      "Omzet Infomedics": {
        label: "Omzet servicebureau",
        value: Math.round(sbLaatste),
        prev: Math.round(sbVorige),
        f: "eurK",
        windowLabel: `via Infomedics · behandelmaand ${maandLabel}`,
        secondary: verwachtUitbetaald(sbLaatste, UITBETALING_PCT, "65%"),
      },
      "Omzet RMO/RMA": {
        label: "Omzet RMO/RMA",
        value: Math.round(rmoLaatste),
        prev: Math.round(rmoVorige),
        f: "eurK",
        windowLabel: `via DSW · behandelmaand ${maandLabel}`,
        secondary: verwachtUitbetaald(rmoLaatste, 1, "100%"),
      },
      "Onderhanden werk": {
        label: "Onderhanden werk",
        value: Math.round(onderhandenTotaal),
        prev: null,
        f: "eurK",
        neutralDown: true,
        windowLabel: "nog niet gefactureerd",
      },
      "Declaraties >90 dgn": {
        label: "Niet gefactureerd >90 dgn",
        value: Math.round(ouder90),
        prev: null,
        f: "eurK",
        betterLow: true,
      },
      "Gem. omzet / cliënt": {
        label: "Gem. omzet / cliënt",
        value: gemOmzetPerClient === null ? 0 : Math.round(gemOmzetPerClient),
        prev: null,
        f: "eur",
        windowLabel: "hele agenda-export",
        // Cliënt-aantallen zijn niet per vestiging te splitsen in de agenda-
        // aggregaten; toon de waarde alleen ongefilterd.
        noData: filters.locatie !== "Alle locaties" || gemOmzetPerClient === null,
      },
      "Gem. omzet / traject": {
        label: "Gem. omzet / traject",
        value: trajectenTotaal === 0 ? 0 : Math.round(omzetGerealiseerdTotaal / trajectenTotaal),
        prev: null,
        f: "eur",
        windowLabel: "hele agenda-export",
        // Traject-aantallen zijn evenmin per vestiging te splitsen; oudere
        // opgeslagen aggregaten missen de trajectteller (dan geen meting).
        noData: filters.locatie !== "Alle locaties" || trajectenTotaal === 0,
      },
    };

    const omzetKoepels = new Map<string, number>();
    for (const cel of factuurCellen) {
      if (!agendaKeys.has(cel.key)) continue;
      const label = koepelGroep(cel);
      omzetKoepels.set(label, (omzetKoepels.get(label) ?? 0) + cel.omzet);
    }
    const koepelsGesorteerd = [...omzetKoepels.entries()].sort((a, b) => b[1] - a[1]);
    const omzetPerVerzekeraar = koepelsGesorteerd.slice(0, 5).map(([label, omzet]) => ({
      label,
      aantal: Math.round(omzet),
    }));
    const koepelRest = koepelsGesorteerd.slice(5).reduce((sum, [, omzet]) => sum + omzet, 0);
    if (koepelRest > 0) omzetPerVerzekeraar.push({ label: "Overig", aantal: Math.round(koepelRest) });

    const omzetLocaties = new Map<string, number>();
    for (const cel of factuurCellen) {
      if (!agendaKeys.has(cel.key)) continue;
      const label = cel.locatie ?? "Onbekend";
      omzetLocaties.set(label, (omzetLocaties.get(label) ?? 0) + cel.omzet);
    }
    const omzetPerLocatie = ordenLocaties([...agendaLocaties, ...omzetLocaties.keys()])
      .filter((loc) => (omzetLocaties.get(loc) ?? 0) > 0)
      .map((loc) => ({ label: loc, aantal: Math.round(omzetLocaties.get(loc) ?? 0) }));

    // Maand × koepel / maand × vestiging binnen hetzelfde 12-maandsvenster —
    // de kaarten hersommeren dit client-side voor het gekozen tijdvenster.
    // Ongeaffronde bedragen: afronden gebeurt pas ná de som per venster.
    const koepelMaand = new Map<string, number>();
    const locatieMaand = new Map<string, number>();
    // Volledige historie zodat de "Alles"-optie op Financieel klopt; het venster
    // wordt client-side gekozen via timeframeKeys(maandreeks-keys, ...).
    const telVenster = (doel: Map<string, number>, key: string, groep: string, omzet: number) => {
      if (!agendaFullKeys.has(key)) return;
      const sleutel = `${key}|${groep}`;
      doel.set(sleutel, (doel.get(sleutel) ?? 0) + omzet);
    };
    for (const cel of factuurCellen) {
      telVenster(koepelMaand, cel.key, koepelGroep(cel), cel.omzet);
      telVenster(locatieMaand, cel.key, cel.locatie ?? "Onbekend", cel.omzet);
    }
    const naarMaandRijen = (bron: Map<string, number>) =>
      [...bron.entries()]
        .map(([sleutel, omzet]) => {
          const [key, groep] = sleutel.split("|");
          return { key, groep, omzet };
        })
        // Totale orde (0 bij gelijke sleutel): stabiele sortering houdt de
        // invoegvolgorde binnen een maand vast — meerdere groepen per maand.
        .sort((a, b) => a.key.localeCompare(b.key));
    const omzetKoepelMaand = naarMaandRijen(koepelMaand).map(({ key, groep, omzet }) => ({
      key,
      koepel: groep,
      omzet,
    }));
    const omzetLocatieMaand = naarMaandRijen(locatieMaand).map(({ key, groep, omzet }) => ({
      key,
      loc: groep,
      omzet,
    }));

    const maandAfstand = (key: string): number =>
      Number(lastAgendaMonth.key.slice(0, 4)) * 12 +
      Number(lastAgendaMonth.key.slice(5, 7)) -
      (Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)));
    // Zelfde maand-conventie als de ">90 dgn"-kaart (drempel90 = maand op
    // afstand 3): afstand 0 = laatste agendamaand, >2 = ouder dan 90 dagen.
    const ouderdomBuckets = [
      { label: "Binnen 30 dagen", test: (afstand: number) => afstand <= 0 },
      { label: "30–60 dagen", test: (afstand: number) => afstand === 1 },
      { label: "60–90 dagen", test: (afstand: number) => afstand === 2 },
      { label: "Ouder dan 90 dagen", test: (afstand: number) => afstand > 2 },
    ];
    const onderhandenOuderdom = ouderdomBuckets.map(({ label, test }) => {
      const bedrag = cellen.filter((cel) => test(maandAfstand(cel.key))).reduce((sum, cel) => sum + cel.onderhanden, 0);
      return {
        label,
        bedrag: Math.round(bedrag),
        pct: onderhandenTotaal === 0 ? 0 : Math.round((bedrag / onderhandenTotaal) * 100),
      };
    });

    // ---- Per behandelaar (laatste 12 agenda-maanden) ----
    const behandelaarStats: ProductionAgendaSnapshot["behandelaarStats"] = {};
    const statsAccu = new Map<string, Rollup>();
    for (const cel of cellen) {
      if (cel.behandelaar === null || !agendaKeys.has(cel.key)) continue;
      const acc = statsAccu.get(cel.behandelaar) ?? leegRollup();
      telOp(acc, cel);
      statsAccu.set(cel.behandelaar, acc);
    }
    for (const [naam, acc] of statsAccu) {
      const noemer = acc.sessies - acc.tijdigAfgezegd;
      behandelaarStats[naam] = {
        sessies: acc.sessies,
        noShowPct: noemer >= 10 ? round1((acc.noShows / noemer) * 100) : null,
        directeUren: uren(acc.directeMin),
        totaleUren: uren(acc.totaleMin),
        omzet: Math.round(acc.omzetGerealiseerd),
      };
    }

    // ---- Contactrecentheid (echte agenda-data i.p.v. registratie-proxy) ----
    const factPerClient = new Map(agendaFacts.clienten.map((fact) => [fact.id, fact]));
    const contactDagen = (record: ClientRecord): number => {
      const anker = factPerClient.get(record.id)?.laatste ?? record.episodeStart;
      if (!anker || anker > agendaRefIso) return 0;
      return daysBetween(anker, agendaRefIso);
    };
    const zonderContact = (dagen: number) =>
      actieveClienten.filter((record) => !isWachtend(record) && contactDagen(record) > dagen).length;
    const z30 = zonderContact(30);
    const z60 = zonderContact(60);

    patientenMetrics[">30 dgn geen contact"] = {
      label: ">30 dgn geen contact",
      value: z30,
      prev: null,
      f: "int",
      betterLow: true,
    };
    patientenMetrics[">60 dgn geen contact"] = {
      label: ">60 dgn geen contact",
      value: z60,
      prev: null,
      f: "int",
      betterLow: true,
    };

    // ---- Crisiscliënten (agenda-proxy) ----
    // Échte crisis-sessies uit de agenda ("Crisis -beoordeling" / "Crisis -
    // tijdens behandeling") vervangen de Hoog-risico-proxy — alleen op
    // aggregaten mét de crisis-velden; oudere aggregaten houden ZT05/ZT08
    // tot een her-import van de agenda-export.
    const heeftCrisisVelden = agendaFacts.clienten.some((fact) => fact.crisis !== undefined);
    let crisisPerClient: Record<string, string> | null = null;
    if (heeftCrisisVelden) {
      const perClient: Record<string, string> = {};
      for (const fact of agendaFacts.clienten) {
        if (fact.laatsteCrisis) perClient[fact.id] = fact.laatsteCrisis;
      }
      crisisPerClient = perClient;
      const crisisClienten = actieveClienten.filter((record) => {
        const laatsteCrisis = perClient[record.id];
        return (
          laatsteCrisis !== undefined && laatsteCrisis <= agendaRefIso && daysBetween(laatsteCrisis, agendaRefIso) <= 90
        );
      }).length;
      patientenMetrics.Crisiscliënten = {
        label: "Crisiscliënten (90 dgn)",
        value: crisisClienten,
        prev: null,
        f: "int",
        betterLow: true,
      };
    }

    // ---- Vooruitblik (alleen wanneer de export een toekomstvenster heeft) ----
    // Zonder toekomstvenster is "geen vervolgafspraak" niet te onderscheiden
    // van "niet geëxporteerd" — de widgets blijven dan demo-gemarkeerd.
    let vooruitblik: ProductionAgendaSnapshot["vooruitblik"] = null;
    const vervolgPerClient: Record<string, string> = {};
    if (agendaFacts.toekomst && agendaFacts.peildatum) {
      for (const fact of agendaFacts.clienten) {
        if (fact.volgende) vervolgPerClient[fact.id] = fact.volgende;
      }
      const toekomstCellen = agendaFacts.toekomst.perMaand.filter((cel) => inFilter(cel.locatie));
      const perToekomstMaand = new Map<string, { sessies: number; totaleMin: number }>();
      for (const cel of toekomstCellen) {
        const acc = perToekomstMaand.get(cel.key) ?? { sessies: 0, totaleMin: 0 };
        acc.sessies += cel.sessies;
        acc.totaleMin += cel.totaleMin;
        perToekomstMaand.set(cel.key, acc);
      }
      const maanden = [...perToekomstMaand.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .slice(0, 6)
        .map(([key, acc]) => ({
          key,
          label: MAAND_LABELS[Number(key.slice(5, 7)) - 1],
          sessies: acc.sessies,
          uren: uren(acc.totaleMin),
        }));
      const zonderVervolgClienten = actieveClienten.filter(
        (record) => !isWachtend(record) && vervolgPerClient[record.id] === undefined,
      );
      const zonderVervolgEnContact = zonderVervolgClienten.filter((record) => contactDagen(record) > 30).length;
      // Bewust GEEN "Geen evaluatie gepland": toekomstige MDO-sessies staan in
      // de export vrijwel allemaal zonder cliënt-ID (terugkerende MDO-blokken
      // die nog niet aan een cliënt zijn gekoppeld) — per cliënt is dit dus
      // niet eerlijk te meten; de widget blijft demo-gemarkeerd.
      vooruitblik = {
        peildatum: agendaFacts.peildatum,
        sessies: toekomstCellen.reduce((sum, cel) => sum + cel.sessies, 0),
        clienten: agendaFacts.toekomst.clienten,
        tot: agendaFacts.toekomst.tot,
        maanden,
        zonderVervolg: zonderVervolgClienten.length,
        zonderVervolgEnContact,
      };

      cockpitKpis.zondervervolg = { value: vooruitblik.zonderVervolg, prev: null, spark: [] };
      patientenMetrics["Zonder vervolgafspraak"] = {
        label: "Zonder vervolgafspraak",
        value: vooruitblik.zonderVervolg,
        prev: null,
        f: "int",
        betterLow: true,
      };
      if (vooruitblik.zonderVervolg > 0) {
        signaleringen.push({
          sev: "hoog",
          titel: "Zonder vervolgafspraak",
          unit: "cliënten",
          detail: `${nl.format(vooruitblik.zonderVervolg)} actieve cliënten hebben geen geplande vervolgafspraak${
            zonderVervolgEnContact > 0
              ? `, waarvan ${nl.format(zonderVervolgEnContact)} ook al >30 dagen geen gehouden afspraak`
              : ""
          }.`,
          n: vooruitblik.zonderVervolg,
          page: "patienten",
        });
      }
    }

    // ---- Dossiers & productie: echte 12-maands productie uit de agenda ----
    dossiersProductieMetrics["Productie-uren"] = {
      label: "Productie-uren",
      value: uren(twaalfMndRollup.totaleMin),
      prev: null,
      f: "int",
      windowLabel: "laatste 12 mnd",
    };
    dossiersProductieMetrics.Productiviteit = {
      label: "Productiviteit",
      value:
        twaalfMndRollup.totaleMin === 0
          ? 0
          : Math.round((twaalfMndRollup.directeMin / twaalfMndRollup.totaleMin) * 100),
      prev: null,
      f: "pct0",
      noData: twaalfMndRollup.totaleMin === 0,
    };

    // ---- Cockpit-KPI's uit de agenda ----
    cockpitKpis.noshow = {
      value: noshowPctVan(laatste) ?? 0,
      prev: noshowPctVan(vorige),
      spark: agendaMonths.map((month) => noshowPctVan(van(month.key)) ?? 0),
      windowLabel: maandLabel,
    };
    cockpitKpis.omzetverz = {
      label: "Omzet Vecozo (VGZ + DSW)",
      value: Math.round(vecozoLaatste),
      prev: Math.round(vecozoVorige),
      spark: agendaMonths.map((month) => Math.round(omzetVecozoPerMaand.get(month.key) ?? 0)),
      windowLabel: `behandelmaand ${maandLabel}`,
      secondary: verwachtUitbetaald(vecozoLaatste, UITBETALING_PCT, "65%"),
    };
    cockpitKpis.omzetinfo = {
      label: "Omzet servicebureau",
      value: Math.round(sbLaatste),
      prev: Math.round(sbVorige),
      spark: agendaMonths.map((month) => Math.round(omzetSbPerMaand.get(month.key) ?? 0)),
      windowLabel: `behandelmaand ${maandLabel}`,
      secondary: verwachtUitbetaald(sbLaatste, UITBETALING_PCT, "65%"),
    };
    cockpitKpis.omzetrmo = {
      label: "Omzet RMO/RMA",
      value: Math.round(rmoLaatste),
      prev: Math.round(rmoVorige),
      spark: agendaMonths.map((month) => Math.round(omzetRmoPerMaand.get(month.key) ?? 0)),
      windowLabel: `behandelmaand ${maandLabel}`,
      secondary: verwachtUitbetaald(rmoLaatste, 1, "100%"),
    };

    // Afgeleide kopkaart voor de directie (klantverzoek 2026-07-25): totale
    // omzet = som van de drie splitkaarten (Vecozo + servicebureau + RMO/RMA),
    // zodat het kopcijfer live meebeweegt en nooit een "Demo"-badge toont.
    cockpitKpis.omzettotaal = {
      label: "Totale omzet",
      value: Math.round(vecozoLaatste + sbLaatste + rmoLaatste),
      prev: Math.round(vecozoVorige + sbVorige + rmoVorige),
      spark: agendaMonths.map((month) =>
        Math.round(
          (omzetVecozoPerMaand.get(month.key) ?? 0) +
            (omzetSbPerMaand.get(month.key) ?? 0) +
            (omzetRmoPerMaand.get(month.key) ?? 0),
        ),
      ),
      windowLabel: `behandelmaand ${maandLabel}`,
      // Verwacht uitbetaald: zelfde blend als de Financieel-kopkaart
      // (Vecozo + servicebureau × 65%, RMO/RMA 100%).
      secondary: {
        label: "Verwacht uitbetaald (65% · RMO/RMA 100%)",
        value: verwachtTotaal(vecozoLaatste, sbLaatste, rmoLaatste),
        f: "eurK",
      },
    };

    // ---- Maandreeks verrijken (no-show-trend en omzetontwikkeling) ----
    // Dezelfde verrijking op zowel de 12-maandsreeks als de volledige historie
    // (de per-maand-maps dekken álle maanden — alleen de aggregaten zijn gevensterd).
    const bronVanMaand = agendaFacts.bronVan.slice(0, 7);
    // Historische dekking eindigt op de peildatum — maanden dáárna zijn geen
    // €0-maanden maar niet-gedekte maanden (null), ook al loopt bronTot door.
    const bronTotMaand = agendaEinde.slice(0, 7);
    const verrijkMaand = (point: ProductionMonthPoint) => {
      const rollup = perMaand.get(point.key);
      point.noshowPct =
        rollup && rollup.sessies - rollup.tijdigAfgezegd > 0
          ? round1((rollup.noShows / (rollup.sessies - rollup.tijdigAfgezegd)) * 100)
          : null;
      const binnenBereik = point.key >= bronVanMaand && point.key <= bronTotMaand;
      point.omzet = binnenBereik ? Math.round(omzetPerMaand.get(point.key) ?? 0) : null;
      point.omzetVecozo = binnenBereik ? Math.round(omzetVecozoPerMaand.get(point.key) ?? 0) : null;
      point.omzetServicebureau = binnenBereik ? Math.round(omzetSbPerMaand.get(point.key) ?? 0) : null;
      point.omzetRmoRma = binnenBereik ? Math.round(omzetRmoPerMaand.get(point.key) ?? 0) : null;
    };
    for (const point of monthly) verrijkMaand(point);
    for (const point of monthlyFull) verrijkMaand(point);

    // ---- Signaleringen uit de agenda ----
    if (z60 > 0) {
      signaleringen.push({
        sev: "hoog",
        titel: "Geen contact >60 dagen",
        unit: "cliënten",
        detail: `${nl.format(z60)} actieve cliënten hebben al meer dan 60 dagen geen gehouden afspraak (agenda-export).`,
        n: z60,
        page: "patienten",
      });
    }
    const kwartaalKeys = new Set(agendaMonths.slice(-3).map((month) => month.key));
    const kwartaalAccu = new Map<string, { sessies: number; noShows: number; tijdigAfgezegd: number }>();
    for (const cel of cellen) {
      if (cel.behandelaar === null || !kwartaalKeys.has(cel.key)) continue;
      const acc = kwartaalAccu.get(cel.behandelaar) ?? { sessies: 0, noShows: 0, tijdigAfgezegd: 0 };
      acc.sessies += cel.sessies;
      acc.noShows += cel.noShows;
      acc.tijdigAfgezegd += cel.tijdigAfgezegd;
      kwartaalAccu.set(cel.behandelaar, acc);
    }
    // Zelfde noemer als élk getoond no-show-percentage: tijdig afgezegde
    // afspraken tellen niet mee — anders vuurt de signalering niet terwijl de
    // Behandelaren-tabel wél >5% toont. Volume-eis óók op de effectieve noemer
    // (≥10, zelfde onderdrukking als behandelaarStats) zodat een bijna geheel
    // afgezegd kwartaal geen percentage kan produceren dat nergens getoond wordt.
    const noshowBoven5 = [...kwartaalAccu.entries()]
      .map(([naam, acc]) => {
        const noemer = acc.sessies - acc.tijdigAfgezegd;
        return {
          naam,
          sessies: acc.sessies,
          noemer,
          pct: noemer > 0 ? (acc.noShows / noemer) * 100 : 0,
        };
      })
      .filter((row) => row.sessies >= 20 && row.noemer >= 10 && row.pct > 5)
      .sort((a, b) => b.pct - a.pct);
    if (noshowBoven5.length > 0) {
      signaleringen.push({
        sev: "middel",
        titel: "No-show >5% per behandelaar",
        unit: "behandelaars",
        detail: `${noshowBoven5
          .slice(0, 3)
          .map((row) => `${row.naam} (${String(round1(row.pct)).replace(".", ",")}%)`)
          .join(", ")} in de laatste drie volle maanden.`,
        n: noshowBoven5.length,
        page: "behandelaren",
      });
    }
    const zonderPlan = actieveClienten.filter(
      (record) =>
        !isWachtend(record) &&
        record.episodeStart !== null &&
        record.episodeStart <= agendaRefIso &&
        daysBetween(record.episodeStart, agendaRefIso) > 30 &&
        factPerClient.get(record.id)?.behandelplan !== true,
    ).length;
    if (zonderPlan > 0) {
      signaleringen.push({
        sev: "middel",
        titel: "Dossiers zonder behandelplan",
        unit: "dossiers",
        detail: `${nl.format(zonderPlan)} actieve dossiers (>30 dgn open) zonder behandelplan-sessie in de agenda-export.`,
        n: zonderPlan,
        page: "dossiers",
      });
    }

    // ---- Kwaliteit-proxies (Kwaliteit-pagina) ----
    // Alleen berekenbaar op aggregaten mét de MDO-/farmaco-velden; een ouder
    // opgeslagen aggregaat levert null en de widgets blijven demo tot een
    // her-import van de agenda-export.
    const heeftKwaliteitVelden = agendaFacts.clienten.some((fact) => fact.farmaco !== undefined);
    let agendaKwaliteit: ProductionAgendaSnapshot["kwaliteit"] = null;
    if (heeftKwaliteitVelden) {
      const pctVan = (met: number, totaal: number) => (totaal > 0 ? Math.round((met / totaal) * 100) : null);
      // Zorgplannen compleet: complement van "Dossiers zonder behandelplan"
      // (zelfde basis: actieve, niet-wachtende dossiers >30 dgn open).
      const zorgplanBasis = actieveClienten.filter(
        (record) =>
          !isWachtend(record) &&
          record.episodeStart !== null &&
          record.episodeStart <= agendaRefIso &&
          daysBetween(record.episodeStart, agendaRefIso) > 30,
      );
      const zorgplanMet = zorgplanBasis.filter((record) => factPerClient.get(record.id)?.behandelplan === true).length;
      // Evaluaties op tijd: cliënten die lang genoeg in zorg zijn dat een
      // evaluatie verwacht mag worden (>6 mnd), met een gehouden MDO-sessie in
      // de laatste 6 maanden.
      const evaluatieBasis = actieveClienten.filter(
        (record) =>
          !isWachtend(record) && record.episodeStart !== null && daysBetween(record.episodeStart, agendaRefIso) > 182,
      );
      const evaluatieMet = evaluatieBasis.filter((record) => {
        const laatsteMdo = factPerClient.get(record.id)?.laatsteMdo ?? null;
        return laatsteMdo !== null && daysBetween(laatsteMdo, agendaRefIso) <= 182;
      }).length;
      // Medicatiecontroles: medicatie-cliënten (≥1 gehouden farmaco-sessie) met
      // een farmaco-contact in het laatste kwartaal (kwartaalcontrole-ritme).
      const medicatieBasis = actieveClienten.filter(
        (record) => !isWachtend(record) && (factPerClient.get(record.id)?.farmaco ?? 0) > 0,
      );
      const medicatieMet = medicatieBasis.filter((record) => {
        const laatsteFarmaco = factPerClient.get(record.id)?.laatsteFarmaco ?? null;
        return laatsteFarmaco !== null && daysBetween(laatsteFarmaco, agendaRefIso) <= 92;
      }).length;
      agendaKwaliteit = {
        zorgplan: { pct: pctVan(zorgplanMet, zorgplanBasis.length), met: zorgplanMet, totaal: zorgplanBasis.length },
        evaluaties: {
          pct: pctVan(evaluatieMet, evaluatieBasis.length),
          met: evaluatieMet,
          totaal: evaluatieBasis.length,
        },
        medicatie: {
          pct: pctVan(medicatieMet, medicatieBasis.length),
          met: medicatieMet,
          totaal: medicatieBasis.length,
        },
      };
    }
    if (ouder90Sessies > 0) {
      signaleringen.push({
        sev: "middel",
        titel: "Sessies >90 dgn niet gefactureerd",
        unit: "sessies",
        detail: `${nl.format(ouder90Sessies)} sessies (€ ${nl.format(Math.round(ouder90))}) wachten al langer dan 90 dagen op facturatie.`,
        n: ouder90Sessies,
        page: "financieel",
      });
    }

    const maandreeks = agendaMonthsFull.map((month) => {
      const rollup = van(month.key);
      return {
        key: month.key,
        label: `${month.label} '${month.key.slice(2, 4)}`,
        sessies: rollup.sessies,
        noShows: rollup.noShows,
        tijdigAfgezegd: rollup.tijdigAfgezegd,
        directeUren: uren(rollup.directeMin),
        indirecteUren: uren(rollup.indirecteMin),
        reisUren: uren(rollup.reisMin),
        totaleUren: uren(rollup.totaleMin),
        blokUren: uren(blokPerMaand.get(month.key) ?? 0),
        omzetGerealiseerd: Math.round(rollup.omzetGerealiseerd),
        onderhanden: Math.round(rollup.onderhanden),
        online: rollup.online,
        opLocatie: rollup.opLocatie,
      };
    });

    agendaSnapshot = {
      meta: {
        fileName: agendaFacts.fileName,
        importedAt: agendaFacts.importedAt,
        bronVan: agendaFacts.bronVan,
        bronTot: agendaFacts.bronTot,
        peildatum: agendaFacts.peildatum,
        sessieRows: agendaFacts.sessieRows,
        blokRows: agendaFacts.blokRows,
        maandLabel,
        maandKey: lastAgendaMonth.key,
      },
      planningMetrics,
      maandreeks,
      vormen:
        agendaFacts.vormen && agendaFacts.vormen.length > 0
          ? ["online", "locatie", "overig"]
              .map((vorm) => agendaFacts.vormen?.find((cel) => cel.vorm === vorm))
              .filter((cel): cel is NonNullable<typeof cel> => cel !== undefined && cel !== null)
              .map((cel) => ({
                vorm: cel.vorm,
                label:
                  { online: "Online", locatie: "Op locatie", overig: "Overig (MDO, telefonisch, …)" }[cel.vorm] ??
                  cel.vorm,
                sessies: cel.sessies,
                noShowPct:
                  cel.sessies - cel.tijdigAfgezegd > 0
                    ? round1((cel.noShows / (cel.sessies - cel.tijdigAfgezegd)) * 100)
                    : 0,
                afzegPct: cel.sessies > 0 ? round1((cel.tijdigAfgezegd / cel.sessies) * 100) : 0,
              }))
          : null,
      beroepen: (() => {
        if (!agendaFacts.beroepen || agendaFacts.beroepen.length === 0) return null;
        const perCode = new Map<string, { sessies: number; directeMin: number; namen: Map<string, number> }>();
        for (const cel of agendaFacts.beroepen) {
          const acc = perCode.get(cel.code) ?? { sessies: 0, directeMin: 0, namen: new Map<string, number>() };
          acc.sessies += cel.sessies;
          acc.directeMin += cel.directeMin;
          if (cel.behandelaar) acc.namen.set(cel.behandelaar, (acc.namen.get(cel.behandelaar) ?? 0) + cel.sessies);
          perCode.set(cel.code, acc);
        }
        return [...perCode.entries()]
          .map(([code, acc]) => ({
            code,
            sessies: acc.sessies,
            directeUren: uren(acc.directeMin),
            behandelaars: [...acc.namen.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([naam]) => naam),
          }))
          .sort((a, b) => b.sessies - a.sessies);
      })(),
      noshowWeekdagen,
      urenverdeling,
      bezettingPerLocatie,
      bezettingTotaal,
      afzegRedenen: agendaFacts.afzegRedenen,
      sessieTypen: agendaFacts.sessieTypen,
      modality,
      financieel: {
        metrics: financieelMetrics,
        omzetPerVerzekeraar,
        omzetPerLocatie,
        omzetKoepelMaand,
        omzetLocatieMaand,
        onderhandenTotaal: Math.round(onderhandenTotaal),
        onderhandenOuderdom,
      },
      behandelaarStats,
      contact: { z30, z60 },
      contactPerClient: Object.fromEntries(
        agendaFacts.clienten
          .filter((fact): fact is typeof fact & { laatste: string } => fact.laatste !== null)
          .map((fact) => [fact.id, fact.laatste]),
      ),
      vervolgPerClient,
      crisisPerClient,
      vooruitblik,
      dossierchecks: {
        verslagOntbreekt: totaalRollup.sessies - totaalRollup.verslagen,
        nietOndertekend: totaalRollup.sessies - totaalRollup.ondertekend,
      },
      kwaliteit: agendaKwaliteit,
    };
  }

  // ---- Verwijzernetwerk (huisarts/verwijzer-export) ----
  const verwijzersFacts = extra?.verwijzers ?? null;
  let verwijzerNetwerk: ProductionVerwijzerNetwerk | null = null;
  if (verwijzersFacts && verwijzersFacts.contacten.length > 0) {
    const plaatsGewogen = new Map<string, number>();
    for (const contact of verwijzersFacts.contacten) {
      const label = contact.plaats ?? "Onbekend";
      plaatsGewogen.set(label, (plaatsGewogen.get(label) ?? 0) + contact.clienten);
    }
    verwijzerNetwerk = {
      fileName: verwijzersFacts.fileName,
      importedAt: verwijzersFacts.importedAt,
      contacten: verwijzersFacts.contacten,
      clienten: verwijzersFacts.clienten,
      zorgmailPct: Math.round(
        (verwijzersFacts.contacten.filter((contact) => contact.zorgmail).length / verwijzersFacts.contacten.length) *
          100,
      ),
      rollen: topGroepen(
        groupCount(verwijzersFacts.contacten, (contact) => contact.rol),
        5,
        "Overig",
      ),
      plaatsen: topGroepen(plaatsGewogen, 7, "Overige plaatsen"),
    };
  }

  // ---- Toeslagen (declared surcharges) ----
  const toeslagenFacts = extra?.toeslagen ?? null;
  let toeslagen: ProductionToeslagen | null = null;
  if (toeslagenFacts) {
    const perKoepelMap = new Map<string, number>();
    for (const cel of toeslagenFacts.cellen) {
      const label = cel.koepel ?? "Onbekend";
      perKoepelMap.set(label, (perKoepelMap.get(label) ?? 0) + cel.omzet);
    }
    toeslagen = {
      meta: {
        fileName: toeslagenFacts.fileName,
        importedAt: toeslagenFacts.importedAt,
        bronVan: toeslagenFacts.bronVan,
        bronTot: toeslagenFacts.bronTot,
      },
      totaal: Math.round(toeslagenFacts.cellen.reduce((sum, cel) => sum + cel.omzet, 0)),
      aantal: toeslagenFacts.cellen.reduce((sum, cel) => sum + cel.aantal, 0),
      clienten: toeslagenFacts.clienten,
      tolkClienten: toeslagenFacts.tolkClienten,
      perCode: toeslagenFacts.perCode,
      perKoepel: topGroepen(perKoepelMap, 5, "Overig").map((groep) => ({
        label: groep.label,
        aantal: Math.round(groep.aantal),
      })),
    };
  }

  // ---- Declaratie-totaaloverzicht: toekenning, openstaand en ouderdom ----
  // De export draagt geen vestiging — cijfers zijn instellingsbreed en worden
  // niet door het locatiefilter beïnvloed (gedocumenteerd in het paneel).
  const declaratiesFacts = extra?.declaraties ?? null;
  let declaraties: ProductionDeclaraties | null = null;
  if (declaratiesFacts && declaratiesFacts.facturen.length > 0) {
    const openVan = (factuur: (typeof declaratiesFacts.facturen)[number]): number =>
      Math.max(0, factuur.bedrag - factuur.toegekend - factuur.gecrediteerd);
    const gefactureerd = declaratiesFacts.facturen.reduce((sum, factuur) => sum + factuur.bedrag, 0);
    const toegekend = declaratiesFacts.facturen.reduce((sum, factuur) => sum + factuur.toegekend, 0);
    const gecrediteerd =
      declaratiesFacts.facturen.reduce((sum, factuur) => sum + factuur.gecrediteerd, 0) +
      declaratiesFacts.losseCredits.bedrag;
    const openstaand = declaratiesFacts.facturen.reduce((sum, factuur) => sum + openVan(factuur), 0);
    const ouder90 = declaratiesFacts.facturen.filter(
      (factuur) => openVan(factuur) > 0.01 && daysBetween(factuur.datum, referenceIso) > 90,
    );
    const deelsToegekend = declaratiesFacts.facturen.filter(
      (factuur) => factuur.toegekend > 0.01 && factuur.toegekend < factuur.bedrag - 0.01,
    );
    const tekortDeels = deelsToegekend.reduce((sum, factuur) => sum + (factuur.bedrag - factuur.toegekend), 0);

    const koepelAccu = new Map<string, { gefactureerd: number; toegekend: number; openstaand: number }>();
    for (const factuur of declaratiesFacts.facturen) {
      const accu = koepelAccu.get(factuur.koepel) ?? { gefactureerd: 0, toegekend: 0, openstaand: 0 };
      accu.gefactureerd += factuur.bedrag;
      accu.toegekend += factuur.toegekend;
      accu.openstaand += openVan(factuur);
      koepelAccu.set(factuur.koepel, accu);
    }
    const perKoepel = [...koepelAccu.entries()]
      .map(([label, accu]) => ({
        label,
        gefactureerd: Math.round(accu.gefactureerd),
        toegekend: Math.round(accu.toegekend),
        openstaand: Math.round(accu.openstaand),
        pct: accu.gefactureerd === 0 ? 0 : Math.round((accu.toegekend / accu.gefactureerd) * 100),
      }))
      .sort((a, b) => b.gefactureerd - a.gefactureerd);

    const ouderdomBucketsDef = [
      { label: "Binnen 30 dagen", test: (dagen: number) => dagen <= 30 },
      { label: "30-60 dagen", test: (dagen: number) => dagen > 30 && dagen <= 60 },
      { label: "60-90 dagen", test: (dagen: number) => dagen > 60 && dagen <= 90 },
      { label: "Ouder dan 90 dagen", test: (dagen: number) => dagen > 90 },
    ];
    const ouderdom = ouderdomBucketsDef.map(({ label, test }) => {
      const bedrag = declaratiesFacts.facturen
        .filter((factuur) => openVan(factuur) > 0.01 && test(daysBetween(factuur.datum, referenceIso)))
        .reduce((sum, factuur) => sum + openVan(factuur), 0);
      return {
        label,
        bedrag: Math.round(bedrag),
        pct: openstaand === 0 ? 0 : Math.round((bedrag / openstaand) * 100),
      };
    });

    declaraties = {
      meta: {
        fileName: declaratiesFacts.fileName,
        importedAt: declaratiesFacts.importedAt,
        bronVan: declaratiesFacts.bronVan,
        bronTot: declaratiesFacts.bronTot,
      },
      gefactureerd: Math.round(gefactureerd),
      toegekend: Math.round(toegekend),
      gecrediteerd: Math.round(gecrediteerd),
      openstaand: Math.round(openstaand),
      toekenningsPct: gefactureerd === 0 ? 0 : Math.round((toegekend / gefactureerd) * 100),
      openstaand90: {
        bedrag: Math.round(ouder90.reduce((sum, factuur) => sum + openVan(factuur), 0)),
        facturen: ouder90.length,
      },
      status: {
        volledig: declaratiesFacts.facturen.filter((factuur) => factuur.toegekend >= factuur.bedrag - 0.01).length,
        deels: deelsToegekend.length,
        zonder: declaratiesFacts.facturen.filter((factuur) => factuur.toegekend <= 0.01).length,
      },
      tekortDeels: Math.round(tekortDeels),
      perKoepel,
      ouderdom,
      facturen: declaratiesFacts.facturen.length,
      // Dekking t.o.v. de agenda-facturatie (incl. toeslagen), instellingsbreed.
      dekking: agendaFacts
        ? (() => {
            const agendaGefactureerd =
              agendaFacts.facturatie.reduce((sum, cel) => sum + cel.omzet, 0) +
              (extra?.toeslagen?.cellen.reduce((sum, cel) => sum + cel.omzet, 0) ?? 0);
            return {
              agendaGefactureerd: Math.round(agendaGefactureerd),
              pct: agendaGefactureerd === 0 ? 0 : Math.round((gefactureerd / agendaGefactureerd) * 100),
            };
          })()
        : null,
    };

    // Financieel-metrics (vervangings-patroon; vereist agenda voor de metric-map).
    if (agendaSnapshot) {
      agendaSnapshot.financieel.metrics["Openstaande declaraties"] = {
        label: "Openstaande declaraties",
        value: declaraties.openstaand,
        prev: null,
        f: "eurK",
        betterLow: true,
        windowLabel: "nog niet toegekend",
      };
      agendaSnapshot.financieel.metrics["Afgekeurde declaraties"] = {
        label: "Tekort op toekenning",
        value: declaraties.tekortDeels,
        prev: null,
        f: "eurK",
        betterLow: true,
        windowLabel: "deels toegekende facturen",
      };
      agendaSnapshot.financieel.metrics["Declaraties >90 dgn"] = {
        label: "Declaraties >90 dgn",
        value: declaraties.openstaand90.bedrag,
        prev: null,
        f: "eurK",
        betterLow: true,
        windowLabel: "openstaand",
      };
    }

    if (declaraties.openstaand90.facturen > 0) {
      signaleringen.push({
        sev: "middel",
        titel: "Declaraties >90 dagen open",
        unit: "facturen",
        detail: `${nl.format(declaraties.openstaand90.facturen)} facturen (€ ${nl.format(declaraties.openstaand90.bedrag)}) staan langer dan 90 dagen open zonder (volledige) toekenning.`,
        n: declaraties.openstaand90.facturen,
        page: "financieel",
      });
    }
  }

  // ---- Populatieprofiel (actieve cliënten binnen het locatiefilter) ----
  const leeftijden = actieveClienten
    .map((record) => record.leeftijd)
    .filter((leeftijd): leeftijd is number => leeftijd !== null && leeftijd >= 0 && leeftijd <= 110)
    .sort((a, b) => a - b);
  const dossierDuren = actieveClienten
    .filter((record) => record.episodeStart !== null)
    .map((record) => daysBetween(record.episodeStart as string, referenceIso))
    .sort((a, b) => a - b);
  const vrouwen = actieveClienten.filter((record) => record.geslacht === "Vrouw").length;
  const gemiddelde = (waarden: number[]) =>
    waarden.length === 0 ? null : round1(waarden.reduce((sum, w) => sum + w, 0) / waarden.length);
  const populatieProfiel = {
    n: actiefNu,
    gemLeeftijd: gemiddelde(leeftijden),
    mediaanLeeftijd: mediaan(leeftijden),
    vrouwPct: actiefNu === 0 ? null : Math.round((vrouwen / actiefNu) * 100),
    gemDuurDagen:
      dossierDuren.length === 0 ? null : Math.round(dossierDuren.reduce((sum, d) => sum + d, 0) / dossierDuren.length),
    mediaanDuurDagen: mediaan(dossierDuren),
  };

  return {
    meta: {
      fileName: state.fileName,
      importedAt: state.importedAt,
      referenceDate: referenceIso,
      totalRows: state.records.length,
      activeClients: actiefNu,
      zonderVestiging,
    },
    // De (op vestiging gefilterde) records zelf: bron voor de KPI-drilldowns.
    records,
    monthly,
    monthlyFull,
    cockpitKpis,
    cockpitSummary,
    cockpitInsights,
    patientenMetrics,
    zorgvorm,
    wachttijdTrend,
    wachttijdTrendFull,
    treekLocaties,
    risicoLijst,
    gemWachttijdWkn: {
      label: "Gem. wachttijd (wkn)",
      value: wachtHuidig === null ? 0 : round1(wachtHuidig / 7),
      prev: wachtVorig === null ? null : round1(wachtVorig / 7),
      // Kwartaalvensters — zonder label zou de kaart "vorige maand" beweren.
      prevLabel: "vorig kwartaal",
      noData: wachtHuidig === null,
      f: "dec1",
      betterLow: true,
    },
    behandelaren,
    regiebehandelaren,
    dossiersProductie: {
      metrics: dossiersProductieMetrics,
      medewerkers,
      diagnoseGroepen,
      comorbiditeit,
      zorgvraagtypes,
      behandelduur,
      geslacht,
      leeftijdGroepen,
      verwijzers,
      plaatsen,
      verzekeraars,
      wachtlijst: {
        totaal: wachtlijstTotaal,
        urgent: urgentWachtenden.length,
        gemWachttijdWkn: gemWachtlijstDuur === null ? null : round1(gemWachtlijstDuur / 7),
        buckets: wachtlijstBuckets,
        perLocatie: wachtlijstPerLocatie,
        fases: wachtlijstFases,
        talen: wachtlijstTalen,
      },
      insights: dossiersProductieInsights,
    },
    signaleringen,
    // Zelfde compliance als dossiercontrole, geschaald naar de score-op-10 die
    // de kwaliteit-pagina toont — registratie-compleetheid, geen audit.
    kwaliteitDossierscore: {
      label: "Dossierkwaliteit",
      value: round1(compliancePct / 10),
      prev: null,
      f: "dec1",
    },
    datakwaliteit,
    dossiercontrole: {
      compliancePct,
      gecontroleerd: actiefNu,
      nietCompleet,
      // De eerste drie controles bepalen samen compliancePct/nietCompleet
      // (ontbrekende kerngegevens); de overige zijn aanvullende
      // review-controles en tellen daar bewust niet in mee.
      checks: [
        { check: "Geen primaire diagnose", n: zonderDiagnose.length, sev: "hoog" },
        { check: "Geen zorgvraagtypering", n: zonderZorgtypering.length, sev: "middel" },
        { check: "Geen verwijzer geregistreerd", n: zonderVerwijzer.length, sev: "middel" },
        {
          check: "Administratief onvolledig (geen vestiging, RB én behandelaar)",
          n: adminOnvolledig.length,
          sev: "hoog",
        },
        { check: "Typering wijkt af van HoNOS-advies", n: afwijkendeTypering.length, sev: "middel" },
        { check: "COV-check ontbreekt of polis verlopen", n: covRisico, sev: "hoog" },
        { check: "Verwijzer zonder AGB-code", n: agbOntbreekt, sev: "middel" },
        { check: "Afgesloten zonder primaire diagnose", n: afgeslotenZonderDiagnose, sev: "middel" },
        // Agenda-controles: over de sessierijen binnen het locatiefilter.
        ...(agendaSnapshot
          ? ([
              {
                check: "Sessie zonder sessieverslag (agenda)",
                n: agendaSnapshot.dossierchecks.verslagOntbreekt,
                sev: "middel",
              },
              {
                check: "Sessie niet ondertekend (agenda)",
                n: agendaSnapshot.dossierchecks.nietOndertekend,
                sev: "hoog",
              },
            ] as const)
          : []),
      ],
    },
    agenda: agendaSnapshot,
    verwijzerNetwerk,
    toeslagen,
    declaraties,
    populatieProfiel,
  };
}

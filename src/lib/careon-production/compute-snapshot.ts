// Relatieve imports (geen @/-alias): dit bestand draait ook onder ts-node in
// verify-scripts, waar de alias niet resolvet voor runtime-imports.
import { CASELOAD_NORM } from "../../data/careon/careon-behandelaren";
import { REGIE_NORM } from "../../data/careon/careon-dossiers-productie";
import { TREEKNORM_WEKEN } from "../../data/careon/careon-patienten";
import type {
  AantalGroep,
  ClientRecord,
  LiveMetric,
  ProductionAlert,
  ProductionMonthPoint,
  ProductionSnapshot,
  ProductionState,
  RisicoRij,
} from "./types";

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

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const to = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((to - from) / 86_400_000);
}

function activeAt(record: ClientRecord, iso: string): boolean {
  return (
    record.episodeStart !== null &&
    record.episodeStart <= iso &&
    (record.episodeEind === null || record.episodeEind > iso)
  );
}

interface MonthRef {
  year: number;
  month0: number;
  key: string;
  label: string;
  endIso: string;
}

/** De 12 laatste vólledige maanden, oplopend (oudste eerst). */
function lastFullMonths(referenceIso: string, count: number): MonthRef[] {
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

function monthKeyOf(iso: string | null): string | null {
  return iso ? iso.slice(0, 7) : null;
}

function isBehandelingsfase(labels: string[]): boolean {
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

function isWachtend(record: ClientRecord): boolean {
  return record.wachtlijst || record.preWachtlijst;
}

/** Wachtduur tot nu: sinds episodestart (interne wachtlijst) of sinds verwijzing. */
function wachtduurDagen(record: ClientRecord, referenceIso: string): number {
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

const KNOWN_LOCATIES = ["Tilburg", "Breda", "Roermond"];

export interface SnapshotFilters {
  locatie: string;
}

export function computeProductionSnapshot(
  state: ProductionState,
  filters: SnapshotFilters,
  referenceDate: Date,
): ProductionSnapshot {
  const referenceIso = isoFromDate(referenceDate);
  const records =
    filters.locatie === "Alle locaties"
      ? state.records
      : state.records.filter((record) => record.vestiging === filters.locatie);

  const months = lastFullMonths(referenceIso, 12);
  const lastMonth = months[months.length - 1];

  const startsPerMaand = groupCount(records, (record) => monthKeyOf(record.episodeStart));
  const eindesPerMaand = groupCount(records, (record) => monthKeyOf(record.episodeEind));
  const verwijzingenPerMaand = groupCount(records, (record) => monthKeyOf(record.verwijsdatum));

  const monthly: ProductionMonthPoint[] = months.map((month) => ({
    m: month.label,
    key: month.key,
    aanmeldingen: startsPerMaand.get(month.key) ?? 0,
    uitstroom: eindesPerMaand.get(month.key) ?? 0,
    caseload: records.filter((record) => activeAt(record, month.endIso)).length,
    verwijzingen: verwijzingenPerMaand.get(month.key) ?? 0,
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

  const wachtlijstPerLocatie: AantalGroep[] = KNOWN_LOCATIES.map((loc) => ({
    label: loc,
    aantal: wachtenden.filter((record) => record.vestiging === loc).length,
  })).filter((groep) => filters.locatie === "Alle locaties" || groep.label === filters.locatie);
  // Wachtenden zonder (bekende) vestiging horen bij het totaal — zonder deze
  // bucket zouden de locatiebalken niet optellen tot "Totaal wachtend".
  if (filters.locatie === "Alle locaties") {
    const wachtendZonderVestiging = wachtenden.filter(
      (record) => record.vestiging === null || !KNOWN_LOCATIES.includes(record.vestiging),
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
  const wachttijdTrend = months.map((month) => {
    const dagen = (wachtPerStartmaand.get(month.key) ?? [])
      .map((record) => daysBetween(record.verwijsdatum as string, record.episodeStart as string))
      .sort((a, b) => a - b);
    return {
      m: month.label,
      key: month.key,
      n: dagen.length,
      mediaanDagen: mediaan(dagen),
      overTreek: dagen.filter((d) => d > treeknormDagen).length,
    };
  });

  const kwartaalStart = months[months.length - 3].key.concat("-01");
  const vorigKwartaalStart = months[months.length - 6].key.concat("-01");
  const vorigKwartaalEind = months[months.length - 4].endIso;
  const wachtHuidig = mean(gerealiseerdeWacht(kwartaalStart, lastMonth.endIso));
  const wachtVorig = mean(gerealiseerdeWacht(vorigKwartaalStart, vorigKwartaalEind));

  const treekLocaties = KNOWN_LOCATIES.filter(
    (loc) => filters.locatie === "Alle locaties" || loc === filters.locatie,
  ).map((loc) => {
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
    records.filter((record) => monthKeyOf(record.episodeEind) === lastMonth.key),
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

  const twaalfMaandenTerug = isoFromParts(referenceDate.getUTCFullYear() - 1, referenceDate.getUTCMonth(), 1);
  // Groepering primair op AGB-code (authoritatief; vangt naamvarianten die
  // tekstuele canonicalisatie mist), terugval op de genormaliseerde naam.
  // Weergavelabel = meest voorkomende naam binnen de groep; gelijknamige
  // groepen worden voor weergave samengeteld (status quo van naamgroepering).
  const verwijzerGroepen = new Map<string, { aantal: number; labels: Map<string, number> }>();
  for (const record of records) {
    if (record.verwijsdatum === null || record.verwijsdatum < twaalfMaandenTerug || record.verwijzer === null) {
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
    (record) =>
      activeAt(record, referenceIso) && (record.vestiging === null || !KNOWN_LOCATIES.includes(record.vestiging)),
  ).length;

  return {
    meta: {
      fileName: state.fileName,
      importedAt: state.importedAt,
      referenceDate: referenceIso,
      totalRows: state.records.length,
      activeClients: actiefNu,
      zonderVestiging,
    },
    monthly,
    cockpitKpis,
    cockpitSummary,
    cockpitInsights,
    patientenMetrics,
    zorgvorm,
    wachttijdTrend,
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
      ],
    },
  };
}

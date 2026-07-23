// Deterministische demo-records achter elke KPI-drilldown.
//
// Elke KPI-kaart opent een detailpagina met de individuele records achter het
// getal. De geauditeerde bron kent alleen totalen; deze generator maakt daar
// realistische Nederlandse mock-rijen bij die EXACT reconciliëren met de
// geauditeerde waarden (aantallen, sommen, gewogen gemiddelden en de
// locatieschaal 0,44/0,34/0,22). Alles is seeded per KPI-id — geen
// Math.random/Date.now — zodat SSR en client altijd dezelfde rijen zien.
//
// Reconciliatie wordt bewaakt door verify:careon (registry-sectie).

import { BEHANDELAREN } from "./careon-behandelaren";
import { DOSSIER_CHECKS } from "./careon-dossiercontrole";
import {
  DIAGNOSE_GROEPEN,
  GESLACHT_VERDELING,
  LEEFTIJD_GROEPEN,
  MEDEWERKER_PRODUCTIE,
  PLAATS_VERDELING,
  VERWIJZERS,
  WACHTLIJST_BUCKETS,
} from "./careon-dossiers-productie";
// (WACHTLIJST_PER_LOCATIE wordt in verify:careon tegen deze rijen gecheckt.)
import { OMZET_PER_VERZEKERAAR } from "./careon-financieel";
import { PATIENTEN_RISICO } from "./careon-patienten";
import { NOSHOW_PER_WEEKDAG } from "./careon-planning";

export interface KpiDetailRow {
  key: string;
  loc?: string;
  team?: string;
  [field: string]: string | number | null | undefined;
}

// ---- Seeded PRNG (xmur3 + mulberry32) ----

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  let state = a;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRng(seed: string): () => number {
  return mulberry32(xmur3(`careon-detail:${seed}`)());
}

// ---- Verdelingshelpers ----

/**
 * Largest-remainder-verdeling: som van het resultaat is altijd exact `total`.
 * Voor de schaalbare cockpit-KPI's komt dit per locatie overeen met
 * Math.round(value × factor), op één gedocumenteerde uitzondering na
 * (zondervervolg 31: de drie afrondingen sommeren tot 32, dus één locatie
 * wijkt ±1 af — mechanisch bewaakt in verify:careon).
 */
export function allocateLargestRemainder(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = total - out.reduce((acc, v) => acc + v, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k += 1, rest -= 1) {
    out[order[k % order.length].i] += 1;
  }
  return out;
}

export const DETAIL_LOCS = ["Tilburg", "Breda", "Roermond"] as const;
const LOC_WEIGHTS = [0.44, 0.34, 0.22];
const TEAMS = ["SGGZ", "BGGZ", "FACT", "Ouderen"];
const TEAM_WEIGHTS = [0.46, 0.27, 0.15, 0.12];

function pickWeighted<T>(rng: () => number, items: readonly T[], weights: readonly number[]): T {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  let roll = rng() * sum;
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) {
      return items[i];
    }
  }
  return items[items.length - 1];
}

function shuffle<T>(rng: () => number, input: readonly T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Vlakke pool met exacte aantallen per label (bijv. diagnosegroepen). */
function exactPool<T>(rng: () => number, groups: readonly { label: T; aantal: number }[]): T[] {
  const pool: T[] = [];
  for (const group of groups) {
    for (let i = 0; i < group.aantal; i += 1) {
      pool.push(group.label);
    }
  }
  return shuffle(rng, pool);
}

// ---- Namen, cliënt-ids en datums ----

const VOORLETTERS = [
  "A.",
  "B.",
  "C.",
  "D.",
  "E.",
  "F.",
  "G.",
  "H.",
  "I.",
  "J.",
  "K.",
  "L.",
  "M.",
  "N.",
  "P.",
  "R.",
  "S.",
  "T.",
  "V.",
  "W.",
];

const ACHTERNAMEN = [
  "de Vries",
  "Jansen",
  "van den Berg",
  "Bakker",
  "Visser",
  "Smit",
  "Meijer",
  "Mulder",
  "de Boer",
  "Peters",
  "Hendriks",
  "van Leeuwen",
  "Dekker",
  "Vermeulen",
  "van der Heijden",
  "Kuipers",
  "Prins",
  "Huisman",
  "Willems",
  "Smulders",
  "Özdemir",
  "Yılmaz",
  "el Amrani",
  "Kowalski",
  "Nowak",
  "Jacobs",
  "van Dam",
  "Post",
  "Schouten",
  "Maas",
  "Verhoeven",
  "Hermans",
  "Aarts",
  "Claessen",
  "Peeters",
  "Martens",
  "Simons",
  "Goossens",
  "van Gils",
  "Beckers",
];

function mockNaam(rng: () => number): string {
  return `${VOORLETTERS[Math.floor(rng() * VOORLETTERS.length)]} ${ACHTERNAMEN[Math.floor(rng() * ACHTERNAMEN.length)]}`;
}

/** Cliënt-ids in het geauditeerde P-4xxx/P-5xxx-schema, uniek binnen één tabel.
    De trekkingslus vereist poolSize > aantal getrokken ids, anders raakt de
    pool uitgeput en draait de lus oneindig. */
function clientIdFactory(rng: () => number, poolSize = 1400): () => string {
  const used = new Set<string>(PATIENTEN_RISICO.map((r) => r.id));
  return () => {
    for (;;) {
      const id = `P-${4100 + Math.floor(rng() * poolSize)}`;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
}

const MAANDEN = ["aug", "sep", "okt", "nov", "dec", "jan", "feb", "mrt", "apr", "mei", "jun", "jul"];

/** Dag in de lopende demo-maand (juli, t/m "vandaag" in de demo). */
function dagInJuli(rng: () => number): number {
  return 1 + Math.floor(rng() * 18);
}

// juli in het demo-venster: 1 juli valt op woensdag (0 = zondag).
function weekdagJuli(dag: number): number {
  return (dag + 2) % 7;
}

const WEEKDAG_KORT = ["zo", "ma", "di", "wo", "do", "vr", "za"];

function fmtJuliDatum(dag: number): string {
  return `${WEEKDAG_KORT[weekdagJuli(dag)]} ${dag} jul`;
}

// Behandelaren per locatie — rijen krijgen een behandelaar van hun eigen vestiging.
const BEHANDELAREN_PER_LOC = new Map<string, string[]>();
for (const behandelaar of BEHANDELAREN) {
  const lijst = BEHANDELAREN_PER_LOC.get(behandelaar.loc) ?? [];
  lijst.push(behandelaar.naam);
  BEHANDELAREN_PER_LOC.set(behandelaar.loc, lijst);
}

function behandelaarVoorLoc(rng: () => number, loc: string): string {
  const pool = BEHANDELAREN_PER_LOC.get(loc) ?? BEHANDELAREN.map((b) => b.naam);
  return pool[Math.floor(rng() * pool.length)];
}

// ---- Generieke cliëntrij-bouwer ----

interface InjectRow {
  id: string;
  naam: string;
  team: string;
  loc: string;
  dagen?: number;
}

interface ClientRowsOpts {
  total: number;
  /** Per DETAIL_LOCS; default largest remainder over 0,44/0,34/0,22. */
  locCounts?: number[];
  /** Geauditeerde rijen (Patiënten "Vraagt aandacht") die letterlijk terugkomen. */
  inject?: InjectRow[];
  dagen?: { min: number; max: number };
  extra?: (rng: () => number, loc: string, index: number) => Record<string, string | number | null>;
}

function buildClientRows(seed: string, opts: ClientRowsOpts): KpiDetailRow[] {
  const rng = createRng(seed);
  const nextId = clientIdFactory(rng);
  const locCounts = opts.locCounts ?? allocateLargestRemainder(opts.total, LOC_WEIGHTS);
  const rows: KpiDetailRow[] = [];
  const injectRest = [...(opts.inject ?? [])];

  DETAIL_LOCS.forEach((loc, locIndex) => {
    let remaining = locCounts[locIndex];
    // Eerst de geïnjecteerde (geauditeerde) rijen van deze locatie.
    for (let i = injectRest.length - 1; i >= 0; i -= 1) {
      if (injectRest[i].loc === loc && remaining > 0) {
        const inj = injectRest.splice(i, 1)[0];
        rows.push({
          key: inj.id,
          naam: inj.naam,
          team: inj.team,
          loc,
          behandelaar: behandelaarVoorLoc(rng, loc),
          ...(inj.dagen !== undefined ? { dagen: inj.dagen } : {}),
          ...(opts.extra ? opts.extra(rng, loc, rows.length) : {}),
        });
        remaining -= 1;
      }
    }
    for (let i = 0; i < remaining; i += 1) {
      const row: KpiDetailRow = {
        key: nextId(),
        naam: mockNaam(rng),
        team: pickWeighted(rng, TEAMS, TEAM_WEIGHTS),
        loc,
        behandelaar: behandelaarVoorLoc(rng, loc),
      };
      if (opts.dagen) {
        row.dagen = opts.dagen.min + Math.floor(rng() * (opts.dagen.max - opts.dagen.min + 1));
      }
      if (opts.extra) {
        Object.assign(row, opts.extra(rng, loc, rows.length));
      }
      rows.push(row);
    }
  });

  return rows;
}

// ---- Euro-rijen (som per locatie exact) ----

interface EurRowsOpts {
  totals: number[]; // per DETAIL_LOCS, exact
  avg: number;
  spread: number;
  prefix: string; // declaratienummer-prefix
  extra?: (rng: () => number, loc: string, index: number) => Record<string, string | number | null>;
}

function buildEurRows(seed: string, opts: EurRowsOpts): KpiDetailRow[] {
  const rng = createRng(seed);
  const rows: KpiDetailRow[] = [];
  let volgnr = 100 + Math.floor(rng() * 400);

  DETAIL_LOCS.forEach((loc, locIndex) => {
    const target = opts.totals[locIndex];
    const n = Math.max(2, Math.round(target / opts.avg));
    let rest = target;
    for (let i = 0; i < n; i += 1) {
      const laatste = i === n - 1;
      let bedrag: number;
      if (laatste) {
        bedrag = rest;
      } else {
        bedrag = Math.round((opts.avg + (rng() - 0.5) * 2 * opts.spread) / 10) * 10;
        // Houd de sluitpost binnen een plausibele bandbreedte.
        const naRest = rest - bedrag;
        const overige = n - i - 1;
        const minRest = overige * Math.max(50, opts.avg - 2 * opts.spread);
        const maxRest = overige * (opts.avg + 2 * opts.spread);
        if (naRest < minRest) {
          bedrag = Math.max(50, rest - minRest);
        } else if (naRest > maxRest) {
          bedrag = rest - maxRest;
        }
        bedrag = Math.max(50, Math.round(bedrag));
      }
      rest -= bedrag;
      volgnr += 1 + Math.floor(rng() * 6);
      rows.push({
        key: `${opts.prefix}-${volgnr}`,
        naam: mockNaam(rng),
        loc,
        datum: `${dagInJuli(rng)} jul`,
        bedrag,
        ...(opts.extra ? opts.extra(rng, loc, rows.length) : {}),
      });
    }
  });

  return rows;
}

const VERZEKERAAR_LABELS = OMZET_PER_VERZEKERAAR.map((v) => v.name);
const VERZEKERAAR_WEIGHTS = OMZET_PER_VERZEKERAAR.map((v) => v.value);

// ---- Uren-rijen (som exact via largest remainder) ----

function buildUrenRows(total: number, basis: (b: (typeof BEHANDELAREN)[number]) => number): KpiDetailRow[] {
  const verdeling = allocateLargestRemainder(
    total,
    BEHANDELAREN.map((b) => basis(b)),
  );
  return BEHANDELAREN.map((b, i) => ({
    key: b.naam,
    naam: b.naam,
    team: b.team,
    loc: b.loc,
    uren: verdeling[i],
  }));
}

// ---- Wachtlijst: één consistente set van 70 wachtenden ----
// Constraints tegelijk: fase-totalen (intake 43 / behandeling 27), de
// geauditeerde locatieverdeling (21/18/31, Roermond-zwaar per Treeknorm-
// verhaal) en de geauditeerde duur-buckets (22/19/17/12). Urgent = 6 van de
// 12 wachtenden in de 60+-bucket.

const WACHTLIJST_LOC_INTAKE = [13, 11, 19]; // som 43; kolomsom met behandeling = 21/18/31
const WACHTLIJST_LOC_BEHANDELING = [8, 7, 12]; // som 27

const BUCKET_RANGES = [
  { min: 3, max: 14 },
  { min: 15, max: 30 },
  { min: 31, max: 60 },
  { min: 61, max: 120 },
];

function buildWachtlijstRows(): KpiDetailRow[] {
  const rng = createRng("wachtlijst");
  const nextId = clientIdFactory(rng);
  const bucketRest = WACHTLIJST_BUCKETS.map((b) => b.aantal);
  let urgentRest = 6;
  const rows: KpiDetailRow[] = [];

  const fasen: { fase: string; counts: number[] }[] = [
    { fase: "Intake", counts: WACHTLIJST_LOC_INTAKE },
    { fase: "Behandeling", counts: WACHTLIJST_LOC_BEHANDELING },
  ];

  for (const { fase, counts } of fasen) {
    DETAIL_LOCS.forEach((loc, locIndex) => {
      for (let i = 0; i < counts[locIndex]; i += 1) {
        // Grootste resterende bucket eerst — deterministisch en exact.
        let bucket = 0;
        for (let b = 1; b < bucketRest.length; b += 1) {
          if (bucketRest[b] > bucketRest[bucket]) {
            bucket = b;
          }
        }
        bucketRest[bucket] -= 1;
        const range = BUCKET_RANGES[bucket];
        const dagen = range.min + Math.floor(rng() * (range.max - range.min + 1));
        let urgent = "";
        if (bucket === 3 && urgentRest > 0) {
          urgentRest -= 1;
          urgent = "Urgent";
        }
        rows.push({
          key: nextId(),
          naam: mockNaam(rng),
          team: pickWeighted(rng, TEAMS, TEAM_WEIGHTS),
          loc,
          fase,
          dagen,
          urgentie: urgent,
        });
      }
    });
  }

  return rows;
}

// ---- Afspraken deze maand: 1.842 rijen met exact 63 no-shows en 118 annuleringen ----

const AFSPRAAK_TYPES = ["Behandelconsult", "Intake", "Evaluatie", "Telefonisch consult", "Groepssessie"];
const AFSPRAAK_TYPE_WEIGHTS = [0.52, 0.12, 0.1, 0.16, 0.1];

function buildAfspraakRows(): KpiDetailRow[] {
  const rng = createRng("afspraken");
  // 1.842 unieke ids passen niet in de standaardpool van 1.400 — gebruik de
  // volle P-4100..P-5999-ruimte, binnen het geauditeerde P-4xxx/P-5xxx-schema.
  const nextId = clientIdFactory(rng, 1900);
  const locCounts = allocateLargestRemainder(1842, LOC_WEIGHTS);

  // Statuspool met exacte aantallen, deterministisch geschud.
  const statusPool = shuffle(rng, [
    ...Array.from({ length: 63 }, () => "No-show"),
    ...Array.from({ length: 118 }, () => "Geannuleerd"),
    ...Array.from({ length: 1842 - 63 - 118 }, () => "Nagekomen"),
  ]);

  const rows: KpiDetailRow[] = [];
  DETAIL_LOCS.forEach((loc, locIndex) => {
    for (let i = 0; i < locCounts[locIndex]; i += 1) {
      const dag = dagInJuli(rng);
      const uur = 8 + Math.floor(rng() * 9);
      const minuut = [0, 15, 30, 45][Math.floor(rng() * 4)];
      rows.push({
        key: `A-${rows.length + 1}`,
        datum: fmtJuliDatum(dag),
        tijd: `${String(uur).padStart(2, "0")}:${String(minuut).padStart(2, "0")}`,
        naam: mockNaam(rng),
        clientId: nextId(),
        behandelaar: behandelaarVoorLoc(rng, loc),
        loc,
        type: pickWeighted(rng, AFSPRAAK_TYPES, AFSPRAAK_TYPE_WEIGHTS),
        status: statusPool[rows.length],
      });
    }
  });
  return rows;
}

// ---- No-shows: 63 events, vrijdag-zwaar conform NOSHOW_PER_WEEKDAG ----

// Werkdagen in de demo-maand juli, gegroepeerd per weekdag (ma..vr).
const JULI_WERKDAGEN: Record<string, number[]> = {
  ma: [6, 13],
  di: [7, 14],
  wo: [1, 8, 15],
  do: [2, 9, 16],
  vr: [3, 10, 17],
};

function buildNoshowRows(): KpiDetailRow[] {
  const rng = createRng("noshow");
  const nextId = clientIdFactory(rng);
  const perWeekdag = allocateLargestRemainder(
    63,
    NOSHOW_PER_WEEKDAG.map((d) => d.pct),
  );
  const rows: KpiDetailRow[] = [];
  NOSHOW_PER_WEEKDAG.forEach((weekdag, index) => {
    const dagen = JULI_WERKDAGEN[weekdag.dag];
    for (let i = 0; i < perWeekdag[index]; i += 1) {
      const loc = pickWeighted(rng, DETAIL_LOCS, LOC_WEIGHTS);
      const dag = dagen[Math.floor(rng() * dagen.length)];
      rows.push({
        key: `NS-${rows.length + 1}`,
        datum: fmtJuliDatum(dag),
        naam: mockNaam(rng),
        clientId: nextId(),
        team: pickWeighted(rng, TEAMS, TEAM_WEIGHTS),
        loc,
        behandelaar: behandelaarVoorLoc(rng, loc),
      });
    }
  });
  return rows;
}

// ---- Gem. wachttijd: gestarte cliënten dit kwartaal, gemiddelde exact 5,2 wkn ----

function buildWachttijdRows(): KpiDetailRow[] {
  const rng = createRng("wachttijd");
  const nextId = clientIdFactory(rng);
  const n = 26;
  const doelTienden = 52 * n; // 5,2 wkn × 26 rijen, in tienden van weken
  const tienden: number[] = [];
  let som = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const w = Math.max(12, Math.min(110, Math.round(52 + (rng() - 0.5) * 60)));
    tienden.push(w);
    som += w;
  }
  let laatste = doelTienden - som;
  // Sluitpost binnen [1,2 .. 11,0] wkn houden zonder het exacte gemiddelde te verliezen.
  for (let i = 0; laatste > 110; i = (i + 1) % (n - 1)) {
    if (tienden[i] <= 100) {
      tienden[i] += 10;
      laatste -= 10;
    }
  }
  for (let i = 0; laatste < 12; i = (i + 1) % (n - 1)) {
    if (tienden[i] >= 22) {
      tienden[i] -= 10;
      laatste += 10;
    }
  }
  tienden.push(laatste);

  const startMaanden = ["mei", "jun", "jul"];
  return tienden.map((t) => {
    const loc = pickWeighted(rng, DETAIL_LOCS, LOC_WEIGHTS);
    return {
      key: nextId(),
      naam: mockNaam(rng),
      team: pickWeighted(rng, TEAMS, TEAM_WEIGHTS),
      loc,
      start: `${1 + Math.floor(rng() * 28)} ${startMaanden[Math.floor(rng() * startMaanden.length)]}`,
      wkn: t / 10,
    };
  });
}

// ---- Kleine letterlijke sets ----

const INCIDENT_TYPES = [
  "Medicatie-incident",
  "Agressie-incident",
  "Valincident",
  "Suïcidepoging (afgewend)",
  "Datalek (bijna)",
  "Overig",
];

const OPLEIDINGEN = [
  "EMDR-basisopleiding",
  "Schematherapie",
  "CGT-verdieping",
  "Systeemtherapie",
  "BHV-herhaling",
  "Suïcidepreventie (PITSTOP)",
  "Verdiepingsmodule ADHD",
  "Motiverende gespreksvoering",
  "Groepsdynamica",
  "Wet zorg en dwang",
];

// ---- Alle builders per KPI-id ----

const BUILDERS: Record<string, () => KpiDetailRow[]> = {
  actief: () => {
    const rng = createRng("actief");
    const diagnoses = exactPool(rng, DIAGNOSE_GROEPEN);
    const geslachten = exactPool(
      rng,
      GESLACHT_VERDELING.map((g) => ({ label: g.name, aantal: g.value })),
    );
    const leeftijden = exactPool(rng, LEEFTIJD_GROEPEN);
    const plaatsen = exactPool(rng, PLAATS_VERDELING);
    let index = 0;
    return buildClientRows("actief-rows", {
      total: 1248,
      extra: (rowRng) => {
        const leeftijdGroep = leeftijden[index];
        const plaats = plaatsen[index];
        const row = {
          diagnose: diagnoses[index],
          geslacht: geslachten[index],
          leeftijdGroep,
          leeftijd: leeftijdVoorGroep(rowRng, leeftijdGroep),
          woonplaats: plaats === "Overige plaatsen" ? "Overig" : plaats,
          sinds: sindsMaand(rowRng),
        };
        index += 1;
        return row;
      },
    });
  },

  aanmeldingen: () =>
    buildClientRows("aanmeldingen", {
      total: 86,
      extra: (rng) => ({
        datum: `${dagInJuli(rng)} jul`,
        verwijzer: pickWeighted(
          rng,
          VERWIJZERS.map((v) => v.label),
          VERWIJZERS.map((v) => v.aantal),
        ),
        status: rng() < 0.62 ? "Wacht op intake" : "Intake gepland",
      }),
    }),

  gesloten: () =>
    buildClientRows("gesloten", {
      total: 74,
      extra: (rng) => ({
        datum: `${dagInJuli(rng)} jul`,
        reden: pickWeighted(
          rng,
          ["Behandeling afgerond", "Verwezen extern", "Eigen keuze cliënt", "Geen contact meer"],
          [0.64, 0.16, 0.12, 0.08],
        ),
      }),
    }),

  noshow: buildNoshowRows,

  zondervervolg: () =>
    buildClientRows("zondervervolg", {
      total: 31,
      inject: [
        { id: "P-4930", naam: "W. Smulders", team: "BGGZ", loc: "Breda", dagen: 61 },
        { id: "P-5121", naam: "M. Jacobs", team: "Ouderen", loc: "Roermond", dagen: 44 },
      ],
      dagen: { min: 18, max: 58 },
      extra: (rng) => ({ laatste: `${dagInJuli(rng)} jun` }),
    }),

  dossiersnc: () =>
    buildClientRows("dossiersnc", {
      total: 18,
      dagen: { min: 12, max: 92 },
      extra: (rng) => {
        const items = DOSSIER_CHECKS.filter((c) => c.sev !== "middel").map((c) => c.check.replace("Geen ", ""));
        const eerste = items[Math.floor(rng() * items.length)];
        const tweede = rng() < 0.33 ? items[Math.floor(rng() * items.length)] : null;
        return { ontbreekt: tweede && tweede !== eerste ? `${eerste}, ${tweede}` : eerste };
      },
    }),

  omzetverz: () =>
    buildEurRows("omzetverz", {
      totals: [187000, 144500, 93500],
      avg: 4200,
      spread: 1500,
      prefix: "D-2026",
      extra: (rng) => ({ verzekeraar: pickWeighted(rng, VERZEKERAAR_LABELS, VERZEKERAAR_WEIGHTS) }),
    }),

  omzetinfo: () =>
    buildEurRows("omzetinfo", {
      totals: [29920, 23120, 14960],
      avg: 950,
      spread: 350,
      prefix: "F-2026",
      extra: () => ({ verzekeraar: "Infomedics" }),
    }),

  // Productie-exclusieve kaart "Totale omzet": demo-rijen zijn de som van de
  // twee geauditeerde omzetkaarten (verz + info) — reconcilieert op 493.000.
  omzettotaal: () => [...demoDetailRows("omzetverz"), ...demoDetailRows("omzetinfo")],

  outreach: () =>
    buildClientRows("outreach", {
      total: 114,
      extra: (rng) => ({
        bezoek: `${dagInJuli(rng)} jul`,
        frequentie: pickWeighted(rng, ["Wekelijks", "2× per week", "Om de week"], [0.52, 0.31, 0.17]),
      }),
    }),

  tevredenheid: () => [
    { key: "SGGZ Tilburg", team: "SGGZ", loc: "Tilburg", n: 46, score: 8.6 },
    { key: "SGGZ Breda", team: "SGGZ", loc: "Breda", n: 38, score: 8.3 },
    { key: "BGGZ Breda", team: "BGGZ", loc: "Breda", n: 24, score: 8.1 },
    { key: "BGGZ Tilburg", team: "BGGZ", loc: "Tilburg", n: 22, score: 8.5 },
    { key: "FACT Tilburg", team: "FACT", loc: "Tilburg", n: 18, score: 8.2 },
    { key: "Ouderen Roermond", team: "Ouderen", loc: "Roermond", n: 16, score: 8.4 },
  ],

  "wachtlijst-intake": () => buildWachtlijstRows().filter((r) => r.fase === "Intake"),
  "wachtlijst-behandeling": () => buildWachtlijstRows().filter((r) => r.fase === "Behandeling"),
  "wachtlijst-totaal": buildWachtlijstRows,
  "wachtlijst-urgent": () => buildWachtlijstRows().filter((r) => r.urgentie === "Urgent"),

  "zonder-behandelaar": () =>
    buildClientRows("zonder-behandelaar", {
      total: 9,
      inject: [{ id: "P-5104", naam: "A. Kowalski", team: "SGGZ", loc: "Tilburg", dagen: 19 }],
      dagen: { min: 4, max: 26 },
      extra: (rng) => ({
        oorzaak: pickWeighted(
          rng,
          ["Behandelaar uit dienst", "Langdurig verzuim behandelaar", "Interne overdracht"],
          [0.45, 0.33, 0.22],
        ),
      }),
    }),

  contact30: () =>
    buildClientRows("contact30", {
      total: 58,
      dagen: { min: 31, max: 59 },
      extra: (rng) => ({ laatste: `${1 + Math.floor(rng() * 28)} ${rng() < 0.5 ? "mei" : "jun"}` }),
    }),

  contact60: () =>
    buildClientRows("contact60", {
      total: 23,
      inject: [
        { id: "P-4817", naam: "D. van Leeuwen", team: "SGGZ", loc: "Roermond", dagen: 74 },
        { id: "P-4522", naam: "H. Özdemir", team: "FACT", loc: "Tilburg", dagen: 68 },
      ],
      dagen: { min: 61, max: 96 },
      extra: (rng) => ({ laatste: `${1 + Math.floor(rng() * 28)} ${rng() < 0.6 ? "apr" : "mrt"}` }),
    }),

  crisis: () =>
    buildClientRows("crisis", {
      total: 7,
      dagen: { min: 1, max: 12 },
      extra: (rng) => ({
        status: pickWeighted(rng, ["Crisisplan actief", "Opschaling FACT", "Wekelijkse monitoring"], [0.45, 0.3, 0.25]),
      }),
    }),

  afspraken: buildAfspraakRows,

  geannuleerd: () =>
    buildClientRows("geannuleerd", {
      total: 118,
      extra: (rng) => ({
        datum: fmtJuliDatum(dagInJuli(rng)),
        reden: pickWeighted(
          rng,
          ["Cliënt afgezegd", "Behandelaar ziek", "Verzet naar later moment", "Vervoer / logistiek"],
          [0.46, 0.2, 0.25, 0.09],
        ),
      }),
    }),

  bezetting: () => [
    { key: "Tilburg", loc: "Tilburg", uren: 1989, pct: 91 },
    { key: "Breda", loc: "Breda", uren: 1537, pct: 86 },
    { key: "Roermond", loc: "Roermond", uren: 994, pct: 82 },
  ],

  "uren-beschikbaar": () => buildUrenRows(4520, (b) => b.declU + b.indirU),
  "uren-productief": () => buildUrenRows(3610, (b) => b.declU + b.indirU),
  "uren-behandel": () => buildUrenRows(2930, (b) => b.declU),
  "uren-indirect": () => buildUrenRows(680, (b) => b.indirU),

  wachttijd: buildWachttijdRows,

  ohw: () =>
    buildEurRows("ohw", {
      totals: [80080, 61880, 40040],
      avg: 1400,
      spread: 600,
      prefix: "T-2026",
      extra: (rng) => ({ fase: rng() < 0.7 ? "Lopend traject" : "Wacht op declaratiemoment" }),
    }),

  openstaand: () =>
    buildEurRows("openstaand", {
      totals: [42416, 32776, 21208],
      avg: 2400,
      spread: 900,
      prefix: "D-2026",
      extra: (rng) => {
        const bucket = pickWeighted(rng, [0, 1, 2, 3], [68, 21, 6, 5]);
        const ranges = [
          { min: 5, max: 29 },
          { min: 30, max: 60 },
          { min: 61, max: 90 },
          { min: 91, max: 140 },
        ][bucket];
        return {
          verzekeraar: pickWeighted(rng, VERZEKERAAR_LABELS, VERZEKERAAR_WEIGHTS),
          dagenOpen: ranges.min + Math.floor(rng() * (ranges.max - ranges.min + 1)),
        };
      },
    }),

  afgekeurd: () =>
    buildEurRows("afgekeurd", {
      totals: [5412, 4182, 2706],
      avg: 1500,
      spread: 500,
      prefix: "D-2026",
      extra: (rng) => ({
        verzekeraar: pickWeighted(rng, VERZEKERAAR_LABELS, VERZEKERAAR_WEIGHTS),
        reden: pickWeighted(
          rng,
          ["Verwijzing ontbreekt", "AGB-code onjuist", "Verzekering beëindigd", "Zorgtraject al gesloten"],
          [0.36, 0.27, 0.2, 0.17],
        ),
      }),
    }),

  "omzet-client": () => [
    { key: "Tilburg", loc: "Tilburg", n: 90, omzet: 198000, gem: 2200 },
    { key: "Breda", loc: "Breda", n: 70, omzet: 147000, gem: 2100 },
    { key: "Roermond", loc: "Roermond", n: 40, omzet: 83000, gem: 2075 },
  ],

  "omzet-traject": () => [
    { key: "Tilburg", loc: "Tilburg", n: 45, omzet: 171000, gem: 3800 },
    { key: "Breda", loc: "Breda", n: 35, omzet: 124600, gem: 3560 },
    { key: "Roermond", loc: "Roermond", n: 20, omzet: 72400, gem: 3620 },
  ],

  declaraties90: () =>
    buildEurRows("declaraties90", {
      totals: [9372, 7242, 4686],
      avg: 3000,
      spread: 900,
      prefix: "D-2025",
      // Gebundeld bij 3 verzekeraars — conform FINANCIEEL_NOTE.
      extra: (rng) => ({
        verzekeraar: pickWeighted(rng, ["VGZ", "CZ", "Menzis"], [0.45, 0.35, 0.2]),
        dagenOpen: 91 + Math.floor(rng() * 70),
      }),
    }),

  verzuim: () => [
    { key: "SGGZ", team: "SGGZ", fte: 42, pct: 6.2 },
    { key: "BGGZ", team: "BGGZ", fte: 28, pct: 5.6 },
    { key: "FACT", team: "FACT", fte: 18, pct: 6.4 },
    { key: "Ouderen", team: "Ouderen", fte: 12, pct: 5 },
    { key: "Staf & ondersteuning", team: "Staf", fte: 20, pct: 5.4 },
  ],

  verloop: () => [
    { key: "SGGZ", team: "SGGZ", mw: 42, vertrokken: 4, pct: 10 },
    { key: "BGGZ", team: "BGGZ", mw: 28, vertrokken: 3, pct: 11 },
    { key: "FACT", team: "FACT", mw: 18, vertrokken: 3, pct: 17 },
    { key: "Ouderen", team: "Ouderen", mw: 12, vertrokken: 1, pct: 8 },
    { key: "Staf & ondersteuning", team: "Staf", mw: 20, vertrokken: 2, pct: 10 },
  ],

  vacatures: () => [
    { key: "GZ-psycholoog", functie: "GZ-psycholoog", team: "SGGZ", loc: "Tilburg", dagen: 34 },
    { key: "Psychiater", functie: "Psychiater", team: "SGGZ", loc: "Roermond", dagen: 87 },
    { key: "SPV", functie: "Sociaal-psychiatrisch verpleegkundige", team: "FACT", loc: "Breda", dagen: 21 },
    { key: "VS GGZ", functie: "Verpleegkundig specialist GGZ", team: "Ouderen", loc: "Roermond", dagen: 45 },
  ],

  opleidingen: () => {
    const rng = createRng("opleidingen");
    const deelnemers = shuffle(
      rng,
      BEHANDELAREN.map((b) => ({ naam: b.naam, team: b.team, loc: b.loc })),
    );
    return Array.from({ length: 12 }, (_, i) => {
      const wie =
        i < deelnemers.length
          ? deelnemers[i]
          : {
              naam: mockNaam(rng),
              team: pickWeighted(rng, TEAMS, TEAM_WEIGHTS),
              loc: pickWeighted(rng, DETAIL_LOCS, LOC_WEIGHTS),
            };
      return {
        key: `${OPLEIDINGEN[i % OPLEIDINGEN.length]} · ${wie.naam}`,
        opleiding: OPLEIDINGEN[i % OPLEIDINGEN.length],
        naam: wie.naam,
        team: wie.team,
        loc: wie.loc,
        start: `${MAANDEN[[8, 9, 10][Math.floor(rng() * 3)]]} 2026`,
      };
    });
  },

  intervisie: () => [
    { key: "SGGZ", team: "SGGZ", mw: 42, pct: 93 },
    { key: "BGGZ", team: "BGGZ", mw: 28, pct: 94 },
    { key: "FACT", team: "FACT", mw: 18, pct: 88 },
    { key: "Ouderen", team: "Ouderen", mw: 12, pct: 92 },
    { key: "Staf & ondersteuning", team: "Staf", mw: 20, pct: 89 },
  ],

  werkdruk: () => [
    { key: "SGGZ", team: "SGGZ", mw: 42, score: 7.2 },
    { key: "BGGZ", team: "BGGZ", mw: 28, score: 6.5 },
    { key: "FACT", team: "FACT", mw: 18, score: 7.4 },
    { key: "Ouderen", team: "Ouderen", mw: 12, score: 6.3 },
    { key: "Staf & ondersteuning", team: "Staf", mw: 20, score: 6.6 },
  ],

  incidenten: () => {
    const rng = createRng("incidenten");
    return Array.from({ length: 6 }, (_, i) => {
      const loc = pickWeighted(rng, DETAIL_LOCS, LOC_WEIGHTS);
      return {
        key: `MIC-2026-${41 + i}`,
        datum: `${dagInJuli(rng)} jul`,
        type: INCIDENT_TYPES[i % INCIDENT_TYPES.length],
        loc,
        ernst: pickWeighted(rng, ["Laag", "Middel", "Hoog"], [0.5, 0.33, 0.17]),
        status: pickWeighted(rng, ["Afgehandeld", "In onderzoek"], [0.67, 0.33]),
      };
    });
  },

  klachten: () => [
    { key: "K-2026-07", datum: "4 jul", onderwerp: "Wachttijd tot intake", loc: "Roermond", status: "In behandeling" },
    {
      key: "K-2026-08",
      datum: "11 jul",
      onderwerp: "Bejegening tijdens consult",
      loc: "Tilburg",
      status: "Gesprek gepland",
    },
  ],

  dossierkwaliteit: () => [
    { key: "Behandelplannen", categorie: "Behandelplannen", score: 8.4 },
    { key: "Zorgplannen", categorie: "Zorgplannen", score: 8.2 },
    { key: "Diagnostiek", categorie: "Diagnostiek", score: 8.6 },
    { key: "Evaluaties", categorie: "Evaluaties", score: 7.6 },
    { key: "ROM-registratie", categorie: "ROM-registratie", score: 7.4 },
    { key: "Verslaglegging", categorie: "Verslaglegging", score: 8.3 },
    { key: "Toestemmingen", categorie: "Toestemmingen", score: 8.2 },
  ],

  "productie-uren": () =>
    MEDEWERKER_PRODUCTIE.map((m) => ({
      key: m.naam,
      naam: m.naam,
      team: m.team,
      loc: m.loc,
      uren: m.productieUren,
      afsluitingen: m.afsluitingen,
    })),

  productiviteit: () =>
    BEHANDELAREN.map((b) => ({
      key: b.naam,
      naam: b.naam,
      team: b.team,
      loc: b.loc,
      consulten: b.consulten,
      pct: b.productiviteit,
    })),

  "dossier-compliance": () => {
    const sevLabel: Record<string, string> = { kritiek: "Kritiek", hoog: "Hoog", middel: "Middel" };
    return DOSSIER_CHECKS.map((c) => ({
      key: c.check,
      check: c.check,
      n: c.n,
      sev: sevLabel[c.sev],
    }));
  },
};

// ---- Hulpfuncties voor actief ----

function leeftijdVoorGroep(rng: () => number, groep: string): number {
  const ranges: Record<string, [number, number]> = {
    "0–17 jaar": [8, 17],
    "18–25 jaar": [18, 25],
    "26–40 jaar": [26, 40],
    "41–65 jaar": [41, 65],
    "65+ jaar": [66, 88],
    Onbekend: [21, 67],
  };
  const [min, max] = ranges[groep] ?? [18, 67];
  return min + Math.floor(rng() * (max - min + 1));
}

function sindsMaand(rng: () => number): string {
  const jaar = pickWeighted(rng, [2024, 2025, 2026], [0.28, 0.44, 0.28]);
  const maand = MAANDEN[Math.floor(rng() * (jaar === 2026 ? 7 : 12))];
  return `${maand} ${jaar}`;
}

// ---- Publieke, gememoizede toegang ----

const cache = new Map<string, KpiDetailRow[]>();

export function demoDetailRows(id: string): KpiDetailRow[] {
  const hit = cache.get(id);
  if (hit) {
    return hit;
  }
  const rows = BUILDERS[id] ? BUILDERS[id]() : [];
  cache.set(id, rows);
  return rows;
}

export function hasDetailBuilder(id: string): boolean {
  return id in BUILDERS;
}

/** Alleen voor verify: bouwt twee keer vers zodat determinisme aantoonbaar is. */
export function buildDetailRowsFresh(id: string): KpiDetailRow[] {
  return BUILDERS[id] ? BUILDERS[id]() : [];
}

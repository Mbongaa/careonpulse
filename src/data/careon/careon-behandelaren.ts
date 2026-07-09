export interface Behandelaar {
  naam: string;
  team: string;
  loc: string;
  caseload: number;
  consulten: number;
  noshow: number;
  productiviteit: number;
  declU: number;
  indirU: number;
  omzet: number;
  rom: number;
  nc: number;
  tevr: number;
}

export const CASELOAD_NORM = 80;

export const BEHANDELAREN: Behandelaar[] = [
  {
    naam: "Drs. E. van Dijk",
    team: "SGGZ",
    loc: "Tilburg",
    caseload: 74,
    consulten: 132,
    noshow: 2.1,
    productiviteit: 88,
    declU: 118,
    indirU: 22,
    omzet: 48200,
    rom: 7.9,
    nc: 1,
    tevr: 8.7,
  },
  {
    naam: "S. Yılmaz",
    team: "FACT",
    loc: "Tilburg",
    caseload: 83,
    consulten: 121,
    noshow: 3.8,
    productiviteit: 84,
    declU: 109,
    indirU: 27,
    omzet: 44100,
    rom: 7.4,
    nc: 4,
    tevr: 8.2,
  },
  {
    naam: "M. Janssen",
    team: "BGGZ",
    loc: "Breda",
    caseload: 68,
    consulten: 140,
    noshow: 2.9,
    productiviteit: 90,
    declU: 122,
    indirU: 16,
    omzet: 46800,
    rom: 8.1,
    nc: 0,
    tevr: 8.9,
  },
  {
    naam: "A. de Boer",
    team: "SGGZ",
    loc: "Breda",
    caseload: 77,
    consulten: 128,
    noshow: 3.2,
    productiviteit: 86,
    declU: 114,
    indirU: 21,
    omzet: 45300,
    rom: 7.7,
    nc: 2,
    tevr: 8.4,
  },
  {
    naam: "Dr. R. Chen",
    team: "SGGZ",
    loc: "Tilburg",
    caseload: 62,
    consulten: 96,
    noshow: 1.8,
    productiviteit: 82,
    declU: 98,
    indirU: 25,
    omzet: 39700,
    rom: 8.3,
    nc: 1,
    tevr: 8.8,
  },
  {
    naam: "L. Vermeer",
    team: "Ouderen",
    loc: "Roermond",
    caseload: 71,
    consulten: 118,
    noshow: 4.4,
    productiviteit: 81,
    declU: 104,
    indirU: 28,
    omzet: 38900,
    rom: 7.2,
    nc: 3,
    tevr: 8,
  },
  {
    naam: "K. Aydın",
    team: "FACT",
    loc: "Breda",
    caseload: 86,
    consulten: 124,
    noshow: 5.1,
    productiviteit: 79,
    declU: 101,
    indirU: 32,
    omzet: 41200,
    rom: 7,
    nc: 5,
    tevr: 7.8,
  },
  {
    naam: "J. Willems",
    team: "BGGZ",
    loc: "Roermond",
    caseload: 58,
    consulten: 134,
    noshow: 3,
    productiviteit: 89,
    declU: 119,
    indirU: 15,
    omzet: 43600,
    rom: 8,
    nc: 1,
    tevr: 8.6,
  },
  {
    naam: "F. el Amrani",
    team: "SGGZ",
    loc: "Roermond",
    caseload: 66,
    consulten: 112,
    noshow: 2.6,
    productiviteit: 85,
    declU: 108,
    indirU: 20,
    omzet: 40800,
    rom: 7.8,
    nc: 1,
    tevr: 8.5,
  },
  {
    naam: "T. Bakker",
    team: "BGGZ",
    loc: "Tilburg",
    caseload: 64,
    consulten: 126,
    noshow: 3.6,
    productiviteit: 87,
    declU: 112,
    indirU: 18,
    omzet: 42500,
    rom: 7.6,
    nc: 0,
    tevr: 8.3,
  },
];

export type CellTone = "good" | "warn" | "bad" | "none";

export function caseloadTone(caseload: number): CellTone {
  if (caseload > CASELOAD_NORM) return "bad";
  if (caseload > 72) return "warn";
  return "none";
}

export function noshowTone(noshow: number): CellTone {
  if (noshow > 5) return "bad";
  if (noshow > 4) return "warn";
  return "none";
}

export function ncTone(nc: number): CellTone {
  if (nc > 3) return "bad";
  if (nc >= 1) return "warn";
  return "good";
}

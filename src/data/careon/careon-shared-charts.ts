export const CAREON_MONTHS = ["aug", "sep", "okt", "nov", "dec", "jan", "feb", "mrt", "apr", "mei", "jun", "jul"];

const AANMELDINGEN = [61, 64, 59, 66, 58, 72, 69, 75, 78, 79, 83, 86];
const UITSTROOM = [52, 58, 55, 60, 63, 57, 64, 61, 70, 74, 82, 74];
const OMZET_VERZ = [318, 332, 326, 341, 335, 352, 361, 374, 382, 398, 401, 425];
const OMZET_INFO = [41, 44, 43, 47, 45, 49, 52, 54, 57, 58, 59, 68];
const CASELOAD = [1128, 1134, 1138, 1144, 1139, 1154, 1159, 1173, 1181, 1189, 1215, 1248];
const NOSHOW = [5.2, 5, 5.1, 4.8, 4.9, 4.6, 4.4, 4.3, 4.1, 4.2, 4.1, 3.4];
const VERZUIM = [6.8, 6.5, 6.7, 6.2, 6.9, 7.1, 6.6, 6.3, 6.1, 6, 6.4, 5.8];

export interface CareonMonthPoint {
  m: string;
  aanmeldingen: number;
  uitstroom: number;
  omzetVerz: number;
  omzetInfo: number;
  caseload: number;
  noshow: number;
  verzuim: number;
}

export const CAREON_MONTHLY: CareonMonthPoint[] = CAREON_MONTHS.map((m, i) => ({
  m,
  aanmeldingen: AANMELDINGEN[i],
  uitstroom: UITSTROOM[i],
  omzetVerz: OMZET_VERZ[i],
  omzetInfo: OMZET_INFO[i],
  caseload: CASELOAD[i],
  noshow: NOSHOW[i],
  verzuim: VERZUIM[i],
}));

export const GGZ_VERZUIM_BENCHMARK = 6.2;

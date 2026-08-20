export const TGC_BASE_URL = "https://tgc.zsg.nl";

export const TGC_ROUTES = {
  login: "/login",
  tools: "/management-suite-tool",
  client: "/management-suite-tool/care-process-management-export-patients-data",
  agenda: "/management-suite-tool/care-process-management-export-appointments",
  referrers: "/management-suite-tool/care-process-management-export-referrer",
  surcharges: "/financial-zpm-overview/overview/declared-surcharges",
  declarations: "/financial-general-declaration-total",
  zpmFinance: "/financial-zpm-finance",
} as const;

export const TGC_DATE_RANGES = {
  clientStart: "01-01-2023",
  agendaStart: "01-01-2023",
  agendaMonthsAhead: 18,
  surchargesStart: "01-10-2025",
  declarationsStart: "01-04-2025",
} as const;

/**
 * Exact per-run allowlist for the client report. This deliberately leaves out
 * names, BSN, birth date, street address, phone, email, insurance number and
 * authorization number. The production parser never needs those columns.
 */
export const CLIENT_RESULT_FIELDS = [
  "patientId",
  "patientGender",
  "patientCity",
  "careProcessLocationName",
  "careProcessCurrentControlPractitioner",
  "careProcessControlPractitioner",
  "careProcessPractitioner",
  "careProcessPatientAge",
  "episodeStartDate",
  "episodeEndDate",
  "careProcessStartDate",
  "careProcessEndDate",
  "referralLetterDate",
  "careProcessCovUzovi",
  "careProcessCovEndDate",
  "careProcessInsuranceCompanyGroup",
  "careProcessDirectTime",
  "careProcessIndirectTime",
  "careProcessTotalTime",
  "careProcessSetting",
  "careProcessLabel",
  "careProcessPrimaryDiagnosisCode",
  "careProcessPrimaryDiagnosisDescription",
  "careProcessSecondaryDiagnosisDescription",
  "honosCareTypeSuggested",
  "honosCareTypeSelected",
  "gpReferrerName",
  "gpReferrerAgbCode",
  "prewaitingListStatus",
  "prewaitingListLabel",
  "waitingListStatus",
  "waitingListLabel",
  "linkToEpisode",
] as const;

/**
 * Exact per-run allowlist for the agenda report. Client name, BSN, postcode,
 * debtor number and free-text memo are excluded at the source.
 */
export const AGENDA_RESULT_FIELDS = [
  "appointmentType",
  "practitionerName",
  "practitionerOccupation",
  "careProcessId",
  "careProcessLocation",
  "appointmentName",
  "careProcessInsuranceCompanyGroup",
  "appointmentLocation",
  "appointmentDate",
  "appointmentSigned",
  "appointmentDirectTime",
  "appointmentIndirectTime",
  "appointmentTravelTime",
  "appointmentTotalTime",
  "appointmentPrice",
  "patientId",
  "careProcessUzovi",
  "appointmentNoShow",
  "appointmentCancelled",
  "invoiceNumber",
  "appointmentReport",
  "cancelledReason",
] as const;

export const CLIENT_FORBIDDEN_HEADERS = [
  "Client voornaam",
  "Client tussenvoegsel",
  "Client achternaam",
  "BSN",
  "Geb. datum",
  "Straat",
  "Huisnummer",
  "HN Toevoeging",
  "Postcode",
  "Mobiel",
  "Telefoon thuis",
  "Telefoon werk",
  "E-mail thuis",
  "E-mail werk",
  "Verzekeringsnummer",
] as const;

export const AGENDA_FORBIDDEN_HEADERS = ["BSN", "Client_naam", "Postcode", "Debiteurennummer", "Memo"] as const;

export function formatDutchDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

export function addMonths(date: Date, months: number): Date {
  const firstOfTargetMonth = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth() + 1, 0).getDate();
  return new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth(), Math.min(date.getDate(), lastDay));
}

export function timestampForFile(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "_",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
}

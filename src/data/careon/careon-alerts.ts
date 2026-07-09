import type { CareonAlert, CareonSeverity } from "./careon-types";

export const CAREON_ALERTS: CareonAlert[] = [
  {
    sev: "kritiek",
    titel: "Wachtlijst boven Treeknorm",
    unit: "locatie",
    detail:
      "Intake Roermond staat op 15,2 wkn — boven de norm van 14 wkn. Overweeg herverdeling naar Tilburg (3,1 wkn).",
    n: 1,
    page: "patienten",
  },
  {
    sev: "kritiek",
    titel: "Caseload boven norm (>80)",
    unit: "behandelaars",
    detail: "K. Aydın (86) en S. Yılmaz (83) zitten boven de caseloadnorm van 80 cliënten.",
    n: 2,
    page: "behandelaren",
  },
  {
    sev: "kritiek",
    titel: "Geen contact >60 dagen",
    unit: "cliënten",
    detail: "23 cliënten hadden 60+ dagen geen contactmoment. 7 daarvan zijn crisisgevoelig.",
    n: 23,
    page: "patienten",
  },
  {
    sev: "hoog",
    titel: "Zonder vervolgafspraak",
    unit: "patiënten",
    detail: "31 actieve patiënten hebben geen toekomstige afspraak in de agenda.",
    n: 31,
    page: "patienten",
  },
  {
    sev: "hoog",
    titel: "Dossiers zonder behandelplan",
    unit: "dossiers",
    detail: "4 dossiers missen een behandelplan — vereist vóór declaratie.",
    n: 4,
    page: "dossiers",
  },
  {
    sev: "hoog",
    titel: "Declaraties >90 dagen open",
    unit: "facturen",
    detail: "€21.300 aan declaraties staat langer dan 90 dagen open bij 3 verzekeraars.",
    n: 9,
    page: "financieel",
  },
  {
    sev: "hoog",
    titel: "BIG-registratie verloopt <90 dgn",
    unit: "medewerkers",
    detail: "L. Vermeer (39 dgn), T. Bakker (58 dgn) en S. Yılmaz (84 dgn).",
    n: 3,
    page: "hr",
  },
  {
    sev: "middel",
    titel: "No-show >5% per behandelaar",
    unit: "behandelaar",
    detail: "K. Aydın zit op 5,1% — boven de signaleringsgrens van 5%.",
    n: 1,
    page: "behandelaren",
  },
  {
    sev: "middel",
    titel: "Geen ROM-meting",
    unit: "trajecten",
    detail: "14 trajecten hebben nog geen ROM-voormeting.",
    n: 14,
    page: "dossiers",
  },
  {
    sev: "middel",
    titel: "Geen evaluatie gepland",
    unit: "dossiers",
    detail: "9 dossiers zonder evaluatie in de afgelopen behandelperiode.",
    n: 9,
    page: "dossiers",
  },
];

export const CAREON_SEVERITY_META: Record<CareonSeverity, { heading: string; label: string }> = {
  kritiek: { heading: "Kritiek — direct actie", label: "kritiek" },
  hoog: { heading: "Hoog — deze week", label: "hoog" },
  middel: { heading: "Middel — monitoren", label: "middel" },
};

export const CRITICAL_ALERT_COUNT = CAREON_ALERTS.filter((a) => a.sev === "kritiek").length;

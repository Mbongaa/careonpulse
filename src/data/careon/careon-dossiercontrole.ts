import type { CareonSeverity } from "./careon-types";

export const DOSSIER_SUMMARY = {
  compliancePct: 98.6,
  gecontroleerd: 1248,
  nietCompleet: 18,
  auditScore: 8.1,
  laatsteCheck: "vannacht 03:15",
  volgendeCheck: "morgen 03:15",
};

export const DOSSIER_CHECKS: { check: string; n: number; sev: CareonSeverity }[] = [
  { check: "Geen behandelplan", n: 4, sev: "kritiek" },
  { check: "Geen zorgplan", n: 3, sev: "kritiek" },
  { check: "Geen diagnose", n: 1, sev: "kritiek" },
  { check: "Geen toestemmingsformulier", n: 2, sev: "kritiek" },
  { check: "Geen handtekening", n: 3, sev: "hoog" },
  { check: "Geen verwijzing", n: 2, sev: "hoog" },
  { check: "Geen beschikking", n: 2, sev: "hoog" },
  { check: "Geen ROM", n: 14, sev: "middel" },
  { check: "Geen PROM", n: 17, sev: "middel" },
  { check: "Geen evaluatie", n: 9, sev: "hoog" },
  { check: "Geen toekomstig consult", n: 12, sev: "middel" },
  { check: ">365 dgn niet geëvalueerd", n: 6, sev: "hoog" },
];

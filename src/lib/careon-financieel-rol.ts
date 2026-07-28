import { isCareonHostedDemoEmail } from "./careon-demo-account";

// Rolregel financiële gegevens (klantbesluit 28-07-2026): gewone leden zien
// niets financieels — geen omzet, declaraties, toeslagen of onderhanden werk.
// Iedere laag (sessie-API, dataroutes, proxy, UI, assistent) leidt zijn
// beslissing af van deze ene predicaat, nooit van een eigen rolvergelijking.
// Het vaste demoaccount toont als etalage bewust wél alles: het leeft in de
// demo-organisatie en kan dus nooit echte klantcijfers zien.

export interface FinancieelRolInput {
  orgRole: "org_admin" | "member" | null;
  isSuperadmin: boolean;
  email?: string | null;
}

export function magFinancieelZien(input: FinancieelRolInput): boolean {
  return input.orgRole === "org_admin" || input.isSuperadmin || isCareonHostedDemoEmail(input.email);
}

/** Signaleringen met doelpagina "financieel" verdwijnen voor leden — zowel de
    demo-constanten als de EPD-berekende regels dragen die pagina als route. */
export function filterFinancieleAlerts<T extends { page: string }>(alerts: T[], financieelZichtbaar: boolean): T[] {
  return financieelZichtbaar ? alerts : alerts.filter((alert) => alert.page !== "financieel");
}

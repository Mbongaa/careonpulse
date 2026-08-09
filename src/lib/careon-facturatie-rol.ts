import { isCareonHostedDemoEmail } from "./careon-demo-account";

// Facturatie is een beheerdersmodule (handoff 15, klantbesluit bevestigd
// 09-08-2026). Iedere laag (launcher-filter, paginagate, dataroutes, RLS,
// sidebar) leidt zijn beslissing af van dit ene predicaat en vergelijkt nooit
// zelf op rol. Vandaag inhoudelijk gelijk aan magFinancieelZien plús de
// org-eis: een superadmin zónder org-lidmaatschap kan de module niet
// gebruiken (elke dataroute eist een organisatie), dus die krijgt de tegel
// ook niet te zien. Eigen functie zodat de per-account entitlements uit
// blueprint §5/D13 hier kunnen landen zonder de financiële rolregel te raken.

export interface FacturatieRolInput {
  orgRole: "org_admin" | "member" | null;
  isSuperadmin: boolean;
  email?: string | null;
  orgId: string | null;
}

export function magFacturatieZien(input: FacturatieRolInput): boolean {
  if (!input.orgId) return false;
  return input.orgRole === "org_admin" || input.isSuperadmin || isCareonHostedDemoEmail(input.email);
}

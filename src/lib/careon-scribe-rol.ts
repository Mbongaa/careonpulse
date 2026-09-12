import { isCareonHostedDemoEmail } from "./careon-demo-account";

// Careon Scribe is een module met bijzondere-categoriedata (handoff 20 §2.2,
// S12): de kring blijft zo klein mogelijk. Elke laag — launcher-tegel,
// paginagate, dataroutes en RLS — leidt zijn beslissing af van dit predicaatpaar
// en vergelijkt nooit zelf op rol. De SQL-spiegels zijn app.mag_scribe_beheren()
// en app.mag_scribe_gebruiken() in de migratie.
//
// Twee verschillen met magFacturatieZien():
//   * beheren is niet hetzelfde als gebruiken — een org_admin beheert de
//     module, maar consulten voeren mag ook een gemachtigde behandelaar;
//   * een superadmin telt alleen mée wanneer die lid is van de organisatie
//     (de sessie heeft `orgId` uitsluitend bij lidmaatschap). De SQL-predicaten
//     hebben daarom BEWUST geen kale is_superadmin()-tak.

export interface ScribeRolInput {
  orgRole: "org_admin" | "member" | null;
  isSuperadmin: boolean;
  email?: string | null;
  orgId: string | null;
}

/** Instellingen, gemachtigden, verwijderen en vrijgave: organisatiebeheer. */
export function magScribeBeheren(input: ScribeRolInput): boolean {
  if (!input.orgId) return false;
  return input.orgRole === "org_admin" || input.isSuperadmin || isCareonHostedDemoEmail(input.email);
}

/**
 * Consulten voeren: beheerders plus de door hen gemachtigde behandelaren.
 * `gemachtigd` komt uit één query op careon_scribe_gemachtigden
 * (isScribeGemachtigd() in scribe.server.ts) — CareonSession zelf blijft
 * ongewijzigd, zodat er geen extra query per request bijkomt.
 */
export function magScribeGebruiken(input: ScribeRolInput & { gemachtigd: boolean }): boolean {
  if (!input.orgId) return false;
  return magScribeBeheren(input) || input.gemachtigd;
}

import { magFinancieelZien } from "./careon-financieel-rol";

// Serialiseerbare sessie-info voor de client (gezaaid door de dashboard-layout,
// gedeeld via CareonSessionProvider). Bewust géén "use client"-module: de
// server-layout leest deze waarden ook, en niet-componentexports uit een
// client-module zijn server-side niet bruikbaar.

export interface CareonSessionInfo {
  authed: boolean;
  demo: boolean;
  email: string;
  fullName: string;
  /** Eigenaar van alle browsercaches: zonder org-id kan de client niet zien
      dat een lokale kopie van een andere organisatie is. */
  orgId: string | null;
  /** Naam uit `organizations`; null zonder lidmaatschap of in demo-modus. De
      weergave loopt altijd via careonOrgNaam(), dat dan terugvalt op de
      geauditeerde demo-constante. */
  orgName: string | null;
  orgRole: "org_admin" | "member" | null;
  isSuperadmin: boolean;
  /** Afgeleid via magFinancieelZien — de enige bron voor financiële zichtbaarheid. */
  financieelZichtbaar: boolean;
}

/** Demo/fail-open-weergave: toont alles (dataroutes zelf falen gesloten). */
export const DEMO_SESSION_INFO: CareonSessionInfo = {
  authed: false,
  demo: true,
  email: "",
  fullName: "",
  orgId: null,
  orgName: null,
  orgRole: null,
  isSuperadmin: false,
  financieelZichtbaar: true,
};

export function sessionInfoVan(session: {
  email: string;
  fullName: string;
  orgId: string | null;
  orgName?: string | null;
  orgRole: "org_admin" | "member" | null;
  isSuperadmin: boolean;
}): CareonSessionInfo {
  return {
    authed: true,
    demo: false,
    email: session.email,
    fullName: session.fullName,
    orgId: session.orgId,
    orgName: session.orgName ?? null,
    orgRole: session.orgRole,
    isSuperadmin: session.isSuperadmin,
    financieelZichtbaar: magFinancieelZien(session),
  };
}

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
  orgRole: null,
  isSuperadmin: false,
  financieelZichtbaar: true,
};

export function sessionInfoVan(session: {
  email: string;
  fullName: string;
  orgRole: "org_admin" | "member" | null;
  isSuperadmin: boolean;
}): CareonSessionInfo {
  return {
    authed: true,
    demo: false,
    email: session.email,
    fullName: session.fullName,
    orgRole: session.orgRole,
    isSuperadmin: session.isSuperadmin,
    financieelZichtbaar: magFinancieelZien(session),
  };
}

"use client";

import { createContext, type ReactNode, useContext } from "react";

import { careonKlantChip, careonOrgNaam } from "@/lib/careon-org-naam";
import { type CareonSessionInfo, DEMO_SESSION_INFO } from "@/lib/careon-session-info";

// Rol- en identiteitscontext voor alle dashboard-widgets. De waarde wordt
// server-side gezaaid in de dashboard-layout (getCareonSession) zodat de
// eerste render al rolcorrect is: financiële kaarten mogen voor leden nooit
// eerst verschijnen en dan pas verdwijnen. Demo- en misconfiguratiestanden
// tonen bewust alles (fail-open voor weergave — de dataroutes zelf falen
// gesloten), exact zoals de beheer-paginapoort dat doet.

const CareonSessionContext = createContext<CareonSessionInfo>(DEMO_SESSION_INFO);

export function useCareonSessionInfo(): CareonSessionInfo {
  return useContext(CareonSessionContext);
}

/**
 * Klantnaam voor weergave: de organisatie van de ingelogde gebruiker, en in
 * demo-modus de geauditeerde demo-klant. Elk scherm dat de klant noemt hoort
 * hier langs te gaan — anders staat de naam van klant 1 in de omgeving van
 * klant 2.
 */
export function useCareonOrgNaam(): string {
  return careonOrgNaam(useContext(CareonSessionContext).orgName);
}

/** Zijbalkregel: "Klant: <naam>" (demo houdt de geauditeerde chip mét locaties). */
export function useCareonKlantChip(): string {
  return careonKlantChip(useContext(CareonSessionContext).orgName);
}

export function CareonSessionProvider({
  value,
  children,
}: Readonly<{ value: CareonSessionInfo; children: ReactNode }>) {
  return <CareonSessionContext.Provider value={value}>{children}</CareonSessionContext.Provider>;
}

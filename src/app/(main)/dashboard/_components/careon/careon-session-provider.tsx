"use client";

import { createContext, type ReactNode, useContext } from "react";

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

export function CareonSessionProvider({
  value,
  children,
}: Readonly<{ value: CareonSessionInfo; children: ReactNode }>) {
  return <CareonSessionContext.Provider value={value}>{children}</CareonSessionContext.Provider>;
}

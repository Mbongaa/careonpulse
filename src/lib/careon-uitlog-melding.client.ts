"use client";

import { toast } from "sonner";

import { heeftOnbewaardeRegistraties, type OnbewaardeRegistraties } from "@/lib/careon-auth";

/**
 * Waarschuwing ná uitloggen over handmatige registraties die alleen nog lokaal
 * staan. Eén implementatie voor alle uitlogpunten (sidebar, modulekiezer,
 * beheer): uitloggen blijft onvoorwaardelijk — op een gedeelde werkplek weegt
 * de sessie beëindigen zwaarder dan de laatste bewaarpoging — maar de
 * gebruiker moet wél weten dat er iets achterblijft. De Toaster hangt in de
 * root-layout, dus de melding overleeft de navigatie naar het loginscherm.
 */
export function meldOnbewaardeRegistraties(onbewaard: OnbewaardeRegistraties) {
  if (!heeftOnbewaardeRegistraties(onbewaard)) return;
  const namen: string[] = [];
  if (onbewaard.hr) namen.push("HR-registratie");
  if (onbewaard.middelen) namen.push("middelenregistratie");
  toast.warning(`Nog niet centraal opgeslagen: ${namen.join(" en ")}`, {
    description: "Deze wijzigingen blijven in deze browser bewaard tot u opnieuw inlogt.",
    duration: 12000,
  });
}

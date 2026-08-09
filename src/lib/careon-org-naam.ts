import { CAREON_ORG } from "@/data/careon/careon-filters";

// Weergavenaam van de organisatie van de ingelogde gebruiker.
//
// De naam komt uit `organizations` (via de sessie) zodat een tweede klant zijn
// eigen naam ziet in plaats van die van klant 1. Zonder sessie — demo-modus,
// misconfiguratie, of een platformbeheerder zonder lidmaatschap — valt alles
// terug op de geauditeerde demo-constante, zodat de bevroren democopy
// (en de asserties daarop) byte-identiek blijft.

export function careonOrgNaam(orgName: string | null | undefined): string {
  const naam = orgName?.trim() ?? "";
  return naam === "" ? CAREON_ORG.name : naam;
}

/**
 * Klantregel in de zijbalk. De demo-chip noemt ook het aantal locaties (drie,
 * geauditeerd); voor een echte organisatie is dat aantal niet bekend zonder
 * hun import, dus die krijgt alleen de naam.
 */
export function careonKlantChip(orgName: string | null | undefined): string {
  const naam = orgName?.trim() ?? "";
  return naam === "" ? CAREON_ORG.customerChip : `Klant: ${naam}`;
}

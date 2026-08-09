import { heeftVrijgesteldeRegels } from "./totalen";
import type { FacturatieInstellingen, Factuur, FactuurAfzender, FactuurPartij } from "./types";

// Art. 35a lid 1 Wet OB 1968 als pure functie (handoff 15 §6.1): gedeeld door
// de definitief-route (server) én verify:careon (fixtures). Geeft de
// ontbrekende velden als stabiele sleutels terug zodat de UI ze kan aanwijzen.

export type OntbrekendVeld =
  | "factuurdatum" // sub a
  | "prestatieperiode" // sub g
  | "afzender.naam" // sub e
  | "afzender.adres" // sub e (postbus alleen is onvoldoende)
  | "afzender.kvkNummer" // Belastingdienst-eis buiten art. 35a
  | "afzender.btwId" // sub c — verplicht zodra één regel niet vrijgesteld is
  | "afzender.iban"
  | "afnemer.naam" // sub e
  | "afnemer.adres" // sub e
  | "afnemer.btwId" // sub d — bij verlegd (AE)
  | "regels" // sub f
  | "vrijstellingTekst"; // sub l

export interface FactuurValidatie {
  ok: boolean;
  ontbrekend: OntbrekendVeld[];
}

function heeftAdres(partij: FactuurPartij | FactuurAfzender): boolean {
  return (
    typeof partij.adresRegel1 === "string" &&
    partij.adresRegel1.trim().length > 0 &&
    typeof partij.postcode === "string" &&
    partij.postcode.trim().length > 0 &&
    typeof partij.plaats === "string" &&
    partij.plaats.trim().length > 0
  );
}

/**
 * Volledigheidscontrole vóór uitreiking. `afzender` komt uit de instellingen
 * (concept) of uit de bevroren snapshot (hervalidatie); de route roept dit aan
 * ná het bevriezen, met exact de gegevens die op de factuur komen.
 */
export function valideerFactuurVoorUitreiking(
  factuur: Pick<Factuur, "factuurdatum" | "prestatieVan" | "prestatieTot" | "afnemer" | "regels" | "vrijstellingTekst">,
  afzender: FactuurAfzender | null,
): FactuurValidatie {
  const ontbrekend: OntbrekendVeld[] = [];

  if (!factuur.factuurdatum) ontbrekend.push("factuurdatum");
  if (!factuur.prestatieVan && !factuur.prestatieTot) ontbrekend.push("prestatieperiode");

  if (!afzender || afzender.statutaireNaam.trim().length === 0) ontbrekend.push("afzender.naam");
  if (!afzender || !heeftAdres(afzender)) ontbrekend.push("afzender.adres");
  if (!afzender || afzender.kvkNummer.trim().length === 0) ontbrekend.push("afzender.kvkNummer");
  if (!afzender || afzender.iban.trim().length === 0) ontbrekend.push("afzender.iban");

  if (!factuur.afnemer || factuur.afnemer.naam.trim().length === 0) ontbrekend.push("afnemer.naam");
  if (!factuur.afnemer || !heeftAdres(factuur.afnemer)) ontbrekend.push("afnemer.adres");

  if (factuur.regels.length === 0) ontbrekend.push("regels");

  const nietVrijgesteld = factuur.regels.some((regel) => regel.btwTarief !== "vrijgesteld");
  if (nietVrijgesteld && (!afzender?.btwId || afzender.btwId.trim().length === 0)) {
    ontbrekend.push("afzender.btwId");
  }
  const verlegd = factuur.regels.some((regel) => regel.btwCategorie === "AE");
  if (verlegd && (!factuur.afnemer?.btwId || factuur.afnemer.btwId.trim().length === 0)) {
    ontbrekend.push("afnemer.btwId");
  }
  if (heeftVrijgesteldeRegels(factuur.regels) && !factuur.vrijstellingTekst?.trim()) {
    ontbrekend.push("vrijstellingTekst");
  }

  return { ok: ontbrekend.length === 0, ontbrekend };
}

/** Nederlandse veldnamen voor de UI-melding "Vul eerst … in". */
export const ONTBREKEND_LABELS: Record<OntbrekendVeld, string> = {
  factuurdatum: "factuurdatum",
  prestatieperiode: "prestatieperiode",
  "afzender.naam": "bedrijfsnaam (instellingen)",
  "afzender.adres": "bedrijfsadres (instellingen)",
  "afzender.kvkNummer": "KvK-nummer (instellingen)",
  "afzender.btwId": "btw-identificatienummer (instellingen — verplicht bij belaste regels)",
  "afzender.iban": "IBAN (instellingen)",
  "afnemer.naam": "naam van de afnemer",
  "afnemer.adres": "adres van de afnemer",
  "afnemer.btwId": "btw-identificatienummer van de afnemer (btw verlegd)",
  regels: "minimaal één factuurregel",
  vrijstellingTekst: "vrijstellingstekst",
};

/** Platgeslagen afzender-snapshot uit de instellingen (handoff 15 §3.1). */
export function afzenderUitInstellingen(instellingen: FacturatieInstellingen): FactuurAfzender {
  return {
    statutaireNaam: instellingen.afzender.statutaireNaam,
    handelsnaam: instellingen.afzender.handelsnaam,
    adresRegel1: instellingen.afzender.adresRegel1,
    adresRegel2: instellingen.afzender.adresRegel2,
    postcode: instellingen.afzender.postcode,
    plaats: instellingen.afzender.plaats,
    land: instellingen.afzender.land,
    kvkNummer: instellingen.afzender.kvkNummer,
    btwId: instellingen.afzender.btwId,
    agbCode: instellingen.afzender.agbCode,
    email: instellingen.afzender.email,
    telefoon: instellingen.afzender.telefoon,
    iban: instellingen.bank.iban,
    bic: instellingen.bank.bic,
    tenaamstelling: instellingen.bank.tenaamstelling,
    betaalinstructie: instellingen.betaling.betaalinstructie,
    voettekst: instellingen.presentatie.voettekst,
    toonLogo: instellingen.presentatie.toonLogo,
  };
}

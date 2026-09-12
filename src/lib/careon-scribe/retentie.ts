// Careon Scribe — retentieberekening (handoff 20 §4.7, puur).
//
// De module houdt een tijdelijke WERKKOPIE, geen schaduwdossier (S2/S15):
// het EPD blijft het juridische dossier. Het transcript volgt daarom altijd
// de kórtste termijn — nooit langer dan de sessie zelf blijft bestaan.
//
// Dezelfde berekening staat in de RPC `careon_scribe_status_zetten`; de
// database is de bron van waarheid, deze functie voedt de UI-teksten en de
// demo-opslag. Wissingen die de route/RPC synchroon uitvoert heten in de UI
// "direct"; het opruimen van de rest heet "bij de dagelijkse opschoning
// (uiterlijk 24 uur na de termijn)".

import { SCRIBE_VERLOOPT_BINNENKORT_DAGEN } from "./api-contract";
import type { ScribeInstellingen, SessieStatus } from "./types";

export interface RetentieUitkomst {
  /** ISO-tijdstip waarna segmenten + staat verdwijnen. */
  transcriptVerwijderNa: string;
  /** ISO-tijdstip waarna de sessie (met verslag en taken) verdwijnt. */
  sessieVerwijderNa: string;
}

const DAG_MS = 24 * 60 * 60 * 1_000;

function plusDagen(nu: Date, dagen: number): number {
  return nu.getTime() + dagen * DAG_MS;
}

export function berekenRetentie(
  status: SessieStatus,
  instellingen: ScribeInstellingen,
  nu: Date = new Date(),
): RetentieUitkomst {
  const transcriptTermijn = plusDagen(nu, instellingen.transcriptRetentieDagen);
  const notitieTermijn = plusDagen(nu, instellingen.notitieRetentieDagen);
  let transcript: number;
  let sessie: number;

  switch (status) {
    case "overgenomen":
      // Het verslag is in het EPD opgeslagen: de werkkopie mag weg. Staat
      // "transcript direct wissen" uit, dan geldt alsnog de kortste van beide
      // termijnen.
      transcript = instellingen.transcriptWissenBijOvername
        ? nu.getTime()
        : Math.min(transcriptTermijn, notitieTermijn);
      // notitieRetentieDagen = 0 → nu; de RPC wist dan synchroon.
      sessie = notitieTermijn;
      break;
    case "geannuleerd":
      // Transcript en staat worden synchroon gewist; de metadata verdwijnt bij
      // de eerstvolgende opschoning.
      transcript = nu.getTime();
      sessie = plusDagen(nu, 1);
      break;
    default:
      transcript = transcriptTermijn;
      sessie = transcriptTermijn;
      break;
  }

  // Het transcript blijft nooit langer bestaan dan de sessie eromheen.
  const transcriptGeklemd = Math.min(transcript, sessie);
  return {
    transcriptVerwijderNa: new Date(transcriptGeklemd).toISOString(),
    sessieVerwijderNa: new Date(sessie).toISOString(),
  };
}

/** Hele dagen tot een termijn — voor "Verloopt over n dagen" in de lijst. */
export function dagenTot(tijdstip: string, nu: Date = new Date()): number {
  const doel = Date.parse(tijdstip);
  if (Number.isNaN(doel)) return 0;
  return Math.max(0, Math.ceil((doel - nu.getTime()) / DAG_MS));
}

/**
 * Ambermarkering "Verloopt binnenkort" in de consultlijst (C37): minder dan
 * SCRIBE_VERLOOPT_BINNENKORT_DAGEN hele dagen te gaan én nog niet overgenomen.
 * De grens is STRIKT (`<`), zoals het contract hem beschrijft: precies zeven
 * dagen is nog geen waarschuwing.
 *
 * Eén implementatie voor de serverserializer (`sessieVoorLijst`) en het
 * demo-pad (`lijstRij`) — anders staat er in de demo een badge waar productie
 * er geen toont, en dekt een e2e-assertie op die badge niets af.
 */
export function verlooptBinnenkort(
  sessieVerwijderNa: string | null | undefined,
  status: SessieStatus,
  nu: Date = new Date(),
): boolean {
  if (!sessieVerwijderNa || status === "overgenomen") return false;
  if (Number.isNaN(Date.parse(sessieVerwijderNa))) return false;
  return dagenTot(sessieVerwijderNa, nu) < SCRIBE_VERLOOPT_BINNENKORT_DAGEN;
}

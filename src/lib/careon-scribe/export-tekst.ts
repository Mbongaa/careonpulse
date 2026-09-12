import { CONSULT_TYPE_LABELS, TAAK_SOORT_LABELS } from "@/data/careon/careon-scribe";

import type { ScribeExportFormaat } from "./api-contract";
import {
  type ScribeNotitie,
  type ScribeSessie,
  type ScribeTaak,
  type VerslagSectie,
  veiligeBestandsnaam,
} from "./types";

// Verslagtekst voor het EPD (handoff 20 §5.3/S2) — één pure opbouw voor de
// exportroute (centraal) én het demo-pad (lokaal), zodat beide letterlijk
// dezelfde kop en dezelfde regels garanderen; verify:careon toetst deze
// functie. Het EPD blijft het juridische dossier: dit is de overdrachtsvorm.
// Daarom staat de dossierreferentie WEL in de kop (anders is niet vast te
// stellen bij welk dossier het verslag hoort) maar NOOIT in de bestandsnaam,
// en bevat de tekst GEEN naam of e-mailadres van de behandelaar.
//
// Twee opties sturen de vorm (N17):
//   * `bronverwijzingen` — de "(bronnen: §3, §7)"-regels wijzen naar een
//     transcript dat bij de overname juist wordt gewist. In het EPD is dat
//     blijvende ruis, dus voor `txt` staan ze standaard UIT; de markdown-vorm
//     is de werkkopie voor de behandelaar zelf en houdt ze standaard AAN.
//   * `legeSectiesWeglaten` — secties zonder vastgestelde tekst (die anders als
//     "—" verschijnen) blijven weg. Door de behandelaar geschreven of
//     goedgekeurde tekst wordt NOOIT weggelaten, ook niet "Niet besproken
//     tijdens dit consult." — dat is een vaststelling, geen lege sectie.

function nederlandseDatumTijd(waarde: string | null): string {
  if (!waarde) return "onbekend";
  const tijdstip = Date.parse(waarde);
  if (Number.isNaN(tijdstip)) return "onbekend";
  return new Date(tijdstip).toLocaleString("nl-NL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  });
}

/**
 * Datumdeel van de exportbestandsnaam: de CONSULTdatum, niet vandaag (C28).
 * Route, client en demo-pad rekenen met deze ene functie, zodat de naam in de
 * `Content-Disposition` en de naam waaronder het bestand landt gelijk zijn.
 */
export function datumDeel(waarde: string | null): string {
  const tijdstip = waarde ? Date.parse(waarde) : Number.NaN;
  const datum = Number.isNaN(tijdstip) ? new Date() : new Date(tijdstip);
  return datum.toISOString().slice(0, 10);
}

/** Bestandsnaam zonder dossierreferentie (§5.3): `consult-<id8>-<consultdatum>.txt`. */
export function exportBestandsnaam(
  sessieId: string,
  formaat: ScribeExportFormaat = "txt",
  consultTijdstip?: string | null,
): string {
  const datum = datumDeel(consultTijdstip ?? null);
  return `${veiligeBestandsnaam(`consult-${sessieId.slice(0, 8)}-${datum}`, sessieId)}.${formaat}`;
}

export interface ExportTekstOpties {
  formaat?: ScribeExportFormaat;
  /** Default: `false` voor txt (EPD), `true` voor md (werkkopie). */
  bronverwijzingen?: boolean;
  /** Default `true`: secties zonder vastgestelde tekst blijven weg. */
  legeSectiesWeglaten?: boolean;
}

export interface ExportTekstInvoer extends ExportTekstOpties {
  sessie: Pick<
    ScribeSessie,
    "patientReferentie" | "gestartOp" | "createdAt" | "consentBevestigdOp" | "consentRevisie" | "ontbrekendeFragmenten"
  >;
  notitie: Pick<ScribeNotitie, "formaat" | "secties" | "goedgekeurdOp">;
  taken: readonly Pick<ScribeTaak, "omschrijving" | "soort" | "status">[];
}

/** Goedgekeurde vervolgacties (goedgekeurd of al afgerond) — voorgesteld/afgewezen blijven buiten het EPD. */
export function exportTaken<T extends Pick<ScribeTaak, "status">>(taken: readonly T[]): T[] {
  return taken.filter((taak) => taak.status === "goedgekeurd" || taak.status === "afgerond");
}

function bronRegel(bron: readonly number[]): string {
  return bron.length > 0 ? `(bronnen: ${bron.map((nummer) => `§${nummer}`).join(", ")})` : "";
}

function sectieBlok(sectie: Pick<VerslagSectie, "titel" | "tekst" | "bron">, md: boolean, bronnen: boolean): string {
  const titel = md ? `## ${sectie.titel}` : sectie.titel.toUpperCase();
  const tekst = sectie.tekst.trim();
  return [titel, tekst.length > 0 ? tekst : "—", bronnen ? bronRegel(sectie.bron) : ""].filter(Boolean).join("\n");
}

/**
 * Eén sectie als losse kopieertekst (N17). CareCheck-gebruikers plakken per
 * rubriek in het EPD; de dossierreferentie staat als eerste regel zodat een
 * losse kopie nooit bij het verkeerde dossier belandt.
 */
export function bouwSectieTekst(
  sessie: Pick<ScribeSessie, "patientReferentie">,
  sectie: Pick<VerslagSectie, "titel" | "tekst" | "bron">,
  opties: ExportTekstOpties = {},
): string {
  const md = opties.formaat === "md";
  const bronnen = opties.bronverwijzingen ?? md;
  return [`Dossierreferentie: ${sessie.patientReferentie}`, sectieBlok(sectie, md, bronnen)].join("\n");
}

export function bouwExportTekst({
  sessie,
  notitie,
  taken,
  formaat = "txt",
  bronverwijzingen,
  legeSectiesWeglaten = true,
}: ExportTekstInvoer): string {
  const md = formaat === "md";
  const bronnen = bronverwijzingen ?? md;
  const kop = [
    md ? "# Consultverslag" : "CONSULTVERSLAG",
    `Dossierreferentie: ${sessie.patientReferentie}`,
    `Type: ${CONSULT_TYPE_LABELS[notitie.formaat]}`,
    `Datum: ${nederlandseDatumTijd(sessie.gestartOp ?? sessie.createdAt)}`,
    "",
    `Opgesteld met Careon AI; toestemming vastgelegd op ${nederlandseDatumTijd(sessie.consentBevestigdOp)} ` +
      `(tekstversie ${sessie.consentRevisie}); goedgekeurd op ${nederlandseDatumTijd(notitie.goedgekeurdOp)}.`,
    "Het EPD blijft het juridische dossier: neem dit verslag daar over en verwijder het bestand daarna.",
  ];
  if (sessie.ontbrekendeFragmenten > 0) {
    kop.push(
      `Let op: ${sessie.ontbrekendeFragmenten} fragment(en) zijn niet getranscribeerd; het transcript is onvolledig.`,
    );
  }

  // Het gesprek dekt alleen wat is uitgesproken: het middelenoverzicht van dit
  // verslag is geen medicatiebewaking (N6).
  kop.push("Alleen gecontroleerd wat in dit gesprek is genoemd — dit is geen volledige medicatiebewaking.");

  const gevuld = legeSectiesWeglaten
    ? notitie.secties.filter((sectie) => sectie.tekst.trim().length > 0)
    : notitie.secties;
  // Zou het weglaten élke sectie schrappen, dan blijft de volledige lijst staan:
  // een export mag nooit tot een kale kop verschrompelen.
  const zichtbaar = gevuld.length > 0 ? gevuld : notitie.secties;
  const sectieBlokken = zichtbaar.map((sectie) => sectieBlok(sectie, md, bronnen));

  const goedgekeurdeTaken = exportTaken(taken);
  const takenBlok =
    goedgekeurdeTaken.length > 0
      ? [
          md ? "## Vervolgacties" : "VERVOLGACTIES",
          ...goedgekeurdeTaken.map((taak) => `- ${taak.omschrijving} (${TAAK_SOORT_LABELS[taak.soort]})`),
        ].join("\n")
      : "";

  return [kop.join("\n"), ...sectieBlokken, takenBlok].filter((deel) => deel.length > 0).join("\n\n");
}

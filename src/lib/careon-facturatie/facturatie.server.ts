import { EMPTY_FACTURATIE_INSTELLINGEN } from "@/data/careon/careon-facturatie";
import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import type { CareonSession } from "@/lib/supabase/session.server";

import { type FacturatieContact, type FacturatieInstellingen, type Factuur, isFacturatieInstellingen } from "./types";

// Server-side gereedschap voor de facturatieroutes (handoff 15 §2.3/§2.4):
//   * PostgREST-calls lopen standaard onder het caller-JWT (RLS als grens) mét
//     expliciet org-filter — een superadmin ziet via RLS álle organisaties.
//   * Administratieve schrijfacties op uitgereikte facturen (statusvoortgang,
//     pdf-/mailmetadata) en alle Storage-toegang lopen via de service-role, ná
//     requireOrgAdmin() in de route — clients kunnen zelf uitsluitend
//     concepten schrijven (RLS-policy: status='concept' en nummer null).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const FACTUREN_BUCKET = "facturen";

export function serviceRestHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export function storageBeschikbaar(): boolean {
  return SUPABASE_URL.length > 0 && SERVICE_KEY.length > 0;
}

/** DB-rij (snake_case) van careon_facturatie_facturen. */
export interface FactuurRij {
  id: string;
  status: Factuur["status"];
  soort: Factuur["soort"];
  reeks: string;
  jaar: number;
  volgnummer: number | null;
  nummer: string | null;
  gecrediteerde_factuur_id: string | null;
  factuurdatum: string | null;
  prestatie_van: string | null;
  prestatie_tot: string | null;
  vervaldatum: string | null;
  betaaltermijn_dagen: number | null;
  contact_id: string | null;
  afnemer: unknown;
  afzender: unknown;
  uw_kenmerk: string | null;
  order_referentie: string | null;
  regels: unknown;
  btw_totalen: unknown;
  vrijstelling_tekst: string | null;
  subtotaal_cent: number;
  btw_cent: number;
  totaal_cent: number;
  valuta: string;
  opmerking: string | null;
  betaald_op: string | null;
  pdf_pad: string | null;
  mail_status: Factuur["mailStatus"];
  created_at: string;
  updated_at: string;
}

export const FACTUUR_SELECT =
  "id,status,soort,reeks,jaar,volgnummer,nummer,gecrediteerde_factuur_id,factuurdatum,prestatie_van," +
  "prestatie_tot,vervaldatum,betaaltermijn_dagen,contact_id,afnemer,afzender,uw_kenmerk,order_referentie," +
  "regels,btw_totalen,vrijstelling_tekst,subtotaal_cent,btw_cent,totaal_cent,valuta,opmerking,betaald_op," +
  "pdf_pad,mail_status,created_at,updated_at";

export function factuurVanRij(rij: FactuurRij): Factuur {
  return {
    id: rij.id,
    status: rij.status,
    soort: rij.soort,
    reeks: rij.reeks,
    jaar: rij.jaar,
    volgnummer: rij.volgnummer,
    nummer: rij.nummer,
    gecrediteerdeFactuurId: rij.gecrediteerde_factuur_id,
    factuurdatum: rij.factuurdatum,
    prestatieVan: rij.prestatie_van,
    prestatieTot: rij.prestatie_tot,
    vervaldatum: rij.vervaldatum,
    betaaltermijnDagen: rij.betaaltermijn_dagen,
    contactId: rij.contact_id,
    afnemer: (rij.afnemer as Factuur["afnemer"]) ?? null,
    afzender: (rij.afzender as Factuur["afzender"]) ?? null,
    uwKenmerk: rij.uw_kenmerk ?? undefined,
    orderReferentie: rij.order_referentie ?? undefined,
    regels: (rij.regels as Factuur["regels"]) ?? [],
    btwTotalen: (rij.btw_totalen as Factuur["btwTotalen"]) ?? [],
    vrijstellingTekst: rij.vrijstelling_tekst ?? undefined,
    subtotaalCent: rij.subtotaal_cent,
    btwCent: rij.btw_cent,
    totaalCent: rij.totaal_cent,
    valuta: "EUR",
    opmerking: rij.opmerking ?? undefined,
    betaaldOp: rij.betaald_op,
    pdfPad: rij.pdf_pad,
    mailStatus: rij.mail_status,
    createdAt: rij.created_at,
    updatedAt: rij.updated_at,
  };
}

/** Velden die een client op een CONCEPT mag zetten (autosave/definitief-prep). */
export function conceptRijVanFactuur(factuur: Factuur): Record<string, unknown> {
  return {
    factuurdatum: factuur.factuurdatum,
    prestatie_van: factuur.prestatieVan,
    prestatie_tot: factuur.prestatieTot,
    vervaldatum: factuur.vervaldatum,
    betaaltermijn_dagen: factuur.betaaltermijnDagen,
    contact_id: factuur.contactId,
    afnemer: factuur.afnemer,
    uw_kenmerk: factuur.uwKenmerk ?? null,
    order_referentie: factuur.orderReferentie ?? null,
    regels: factuur.regels,
    btw_totalen: factuur.btwTotalen,
    vrijstelling_tekst: factuur.vrijstellingTekst ?? null,
    subtotaal_cent: factuur.subtotaalCent,
    btw_cent: factuur.btwCent,
    totaal_cent: factuur.totaalCent,
    opmerking: factuur.opmerking ?? null,
    updated_at: new Date().toISOString(),
  };
}

/** DB-rij van careon_facturatie_contacten. */
export interface ContactRij {
  id: string;
  soort: FacturatieContact["soort"];
  bron: FacturatieContact["bron"];
  medewerker_naam: string | null;
  medewerker_user_id: string | null;
  naam: string;
  contactpersoon: string | null;
  email: string | null;
  telefoon: string | null;
  adres_regel1: string | null;
  adres_regel2: string | null;
  postcode: string | null;
  plaats: string | null;
  land: string;
  kvk_nummer: string | null;
  btw_id: string | null;
  uzovi: string | null;
  agb_code: string | null;
  betaaltermijn_dagen: number | null;
  referentie: string | null;
  notitie: string | null;
  archief: boolean;
  updated_at: string;
}

export const CONTACT_SELECT =
  "id,soort,bron,medewerker_naam,medewerker_user_id,naam,contactpersoon,email,telefoon,adres_regel1," +
  "adres_regel2,postcode,plaats,land,kvk_nummer,btw_id,uzovi,agb_code,betaaltermijn_dagen,referentie," +
  "notitie,archief,updated_at";

export function contactVanRij(rij: ContactRij): FacturatieContact {
  return {
    id: rij.id,
    soort: rij.soort,
    bron: rij.bron,
    medewerkerNaam: rij.medewerker_naam ?? undefined,
    medewerkerUserId: rij.medewerker_user_id ?? undefined,
    naam: rij.naam,
    contactpersoon: rij.contactpersoon ?? undefined,
    email: rij.email ?? undefined,
    telefoon: rij.telefoon ?? undefined,
    adresRegel1: rij.adres_regel1 ?? undefined,
    adresRegel2: rij.adres_regel2 ?? undefined,
    postcode: rij.postcode ?? undefined,
    plaats: rij.plaats ?? undefined,
    land: rij.land,
    kvkNummer: rij.kvk_nummer ?? undefined,
    btwId: rij.btw_id ?? undefined,
    uzovi: rij.uzovi ?? undefined,
    agbCode: rij.agb_code ?? undefined,
    betaaltermijnDagen: rij.betaaltermijn_dagen ?? undefined,
    referentie: rij.referentie ?? undefined,
    notitie: rij.notitie ?? undefined,
    archief: rij.archief,
    updatedAt: rij.updated_at,
  };
}

export function rijVanContact(contact: FacturatieContact, orgId: string, createdBy?: string): Record<string, unknown> {
  return {
    org_id: orgId,
    soort: contact.soort,
    bron: contact.bron,
    medewerker_naam: contact.medewerkerNaam ?? null,
    medewerker_user_id: contact.medewerkerUserId ?? null,
    naam: contact.naam.trim(),
    contactpersoon: contact.contactpersoon ?? null,
    email: contact.email ?? null,
    telefoon: contact.telefoon ?? null,
    adres_regel1: contact.adresRegel1 ?? null,
    adres_regel2: contact.adresRegel2 ?? null,
    postcode: contact.postcode ?? null,
    plaats: contact.plaats ?? null,
    land: contact.land,
    kvk_nummer: contact.kvkNummer ?? null,
    btw_id: contact.btwId ?? null,
    uzovi: contact.uzovi ?? null,
    agb_code: contact.agbCode ?? null,
    betaaltermijn_dagen: contact.betaaltermijnDagen ?? null,
    referentie: contact.referentie ?? null,
    notitie: contact.notitie ?? null,
    archief: contact.archief,
    updated_at: new Date().toISOString(),
    ...(createdBy ? { created_by: createdBy } : {}),
  };
}

/** Nieuwste instellingen-snapshot van deze organisatie (caller-JWT + org-filter). */
export async function haalInstellingen(
  session: CareonSession,
): Promise<{ instellingen: FacturatieInstellingen; revision: number }> {
  const params = new URLSearchParams({
    select: "state,revision",
    org_id: `eq.${session.orgId}`,
    order: "revision.desc",
    limit: "1",
  });
  const response = await fetch(`${POSTGREST_URL}/careon_facturatie_instellingen?${params}`, {
    headers: userRestHeaders(session),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("storage-unavailable");
  const rows = (await response.json()) as { state: unknown; revision: number }[];
  const rij = rows.at(0);
  if (rij && isFacturatieInstellingen(rij.state)) {
    return { instellingen: rij.state, revision: rij.revision };
  }
  return { instellingen: EMPTY_FACTURATIE_INSTELLINGEN, revision: rij?.revision ?? 0 };
}

/** Eén factuur binnen de eigen organisatie, of null. */
export async function haalFactuurRij(session: CareonSession, factuurId: string): Promise<FactuurRij | null> {
  const params = new URLSearchParams({
    select: FACTUUR_SELECT,
    org_id: `eq.${session.orgId}`,
    id: `eq.${factuurId}`,
    limit: "1",
  });
  const response = await fetch(`${POSTGREST_URL}/careon_facturatie_facturen?${params}`, {
    headers: userRestHeaders(session),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("storage-unavailable");
  const rows = (await response.json()) as FactuurRij[];
  return rows[0] ?? null;
}

/** Administratieve update op een (uitgereikte) factuur — service-role, ná rolcheck. */
export async function serviceFactuurUpdate(
  orgId: string,
  factuurId: string,
  patch: Record<string, unknown>,
): Promise<FactuurRij | null> {
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    id: `eq.${factuurId}`,
    select: FACTUUR_SELECT,
  });
  const response = await fetch(`${POSTGREST_URL}/careon_facturatie_facturen?${params}`, {
    method: "PATCH",
    headers: serviceRestHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error("storage-unavailable");
  const rows = (await response.json()) as FactuurRij[];
  return rows[0] ?? null;
}

/** Pdf-bytes uploaden (service-role). `overschrijven` alleen voor het logo. */
export async function uploadNaarBucket(
  pad: string,
  bytes: Uint8Array,
  contentType: string,
  overschrijven = false,
): Promise<boolean> {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${FACTUREN_BUCKET}/${pad}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": contentType,
      "x-upsert": overschrijven ? "true" : "false",
    },
    body: bytes as unknown as BodyInit,
  });
  return response.ok;
}

export async function bestaatInBucket(pad: string): Promise<boolean> {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/info/${FACTUREN_BUCKET}/${pad}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  return response.ok;
}

export async function downloadUitBucket(pad: string): Promise<ArrayBuffer | null> {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${FACTUREN_BUCKET}/${pad}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return response.arrayBuffer();
}

/** Storage-pad van de definitieve pdf (handoff 15 §3.3). */
export function pdfPadVoor(orgId: string, jaar: number, nummer: string): string {
  return `${orgId}/${jaar}/${encodeURIComponent(nummer)}.pdf`;
}

export function logoPadVoor(orgId: string): string {
  return `${orgId}/branding/logo.png`;
}

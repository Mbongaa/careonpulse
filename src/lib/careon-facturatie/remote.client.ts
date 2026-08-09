"use client";

import { DEMO_MIDDELEN_STATE } from "@/data/careon/careon-middelen";

import { berekenVervaldatum, formatFactuurnummer, isTeLaat } from "./nummer";
import {
  demoFacturatieState,
  type FacturatieLocalState,
  loadFacturatieState,
  saveFacturatieState,
  volgendDemoNummer,
} from "./storage.client";
import { berekenTotalen } from "./totalen";
import type { FacturatieContact, FacturatieInstellingen, Factuur, FactuurStatus } from "./types";
import { afzenderUitInstellingen, valideerFactuurVoorUitreiking } from "./validatie";

// Client-datatoegang met demo-terugval (handoff 15 B12): elke functie
// probeert de API; antwoordt die 501 (expliciete demo-modus), dan draait
// dezelfde handeling op de localStorage-store — inclusief de client-side
// nummerteller, de gedocumenteerde enige uitzondering op B9. Elk resultaat
// draagt zijn bron zodat de UI "lokaal" kan tonen.

export type FacturatieBron = "centraal" | "lokaal";

export interface FacturatieFout {
  fout: string;
  status: number;
  ontbrekend?: string[];
  /** Bij 409-conflicten: de centrale versie. */
  factuur?: Factuur;
}

type Resultaat<T> = ({ ok: true; bron: FacturatieBron } & T) | ({ ok: false } & FacturatieFout);

async function api<T>(pad: string, init?: RequestInit): Promise<{ status: number; data: T | null }> {
  try {
    const response = await fetch(`/api/careon/facturatie/${pad}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as T | null;
    return { status: response.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

function lokaleState(): FacturatieLocalState {
  return loadFacturatieState() ?? demoFacturatieState();
}

function bewaarLokaal(state: FacturatieLocalState): void {
  saveFacturatieState(state);
}

function nu(): string {
  return new Date().toISOString();
}

function vandaag(): string {
  return new Date().toISOString().slice(0, 10);
}

function foutUit(status: number, data: unknown, standaard: string): FacturatieFout {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    fout: typeof record.error === "string" ? record.error : standaard,
    status,
    ontbrekend: Array.isArray(record.ontbrekend) ? (record.ontbrekend as string[]) : undefined,
    factuur: (record.factuur as Factuur | undefined) ?? undefined,
  };
}

const NIET_BEREIKBAAR = "Supabase niet bereikbaar.";

// ── Facturen ────────────────────────────────────────────────────────────────

export interface OverzichtFilters {
  jaar?: number;
  status?: FactuurStatus | "te_laat";
  zoek?: string;
  pagina?: number;
}

export async function haalFacturen(
  filters: OverzichtFilters,
): Promise<Resultaat<{ facturen: Factuur[]; heeftMeer: boolean }>> {
  const zoekparams = new URLSearchParams();
  if (filters.jaar) zoekparams.set("jaar", String(filters.jaar));
  if (filters.status && filters.status !== "te_laat") zoekparams.set("status", filters.status);
  if (filters.zoek) zoekparams.set("zoek", filters.zoek);
  if (filters.pagina) zoekparams.set("pagina", String(filters.pagina));

  const { status, data } = await api<{ facturen: Factuur[]; heeftMeer: boolean }>(`facturen?${zoekparams}`);
  if (status === 200 && data) {
    let facturen = data.facturen;
    if (filters.status === "te_laat") {
      facturen = facturen.filter((factuur) => isTeLaat(factuur, vandaag()));
    }
    return { ok: true, bron: "centraal", facturen, heeftMeer: data.heeftMeer };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  const state = lokaleState();
  bewaarLokaal(state);
  let facturen = [...state.facturen].sort((a, b) => ((b.factuurdatum ?? "9999") > (a.factuurdatum ?? "9999") ? 1 : -1));
  if (filters.jaar) facturen = facturen.filter((factuur) => factuur.jaar === filters.jaar);
  if (filters.status === "te_laat") facturen = facturen.filter((factuur) => isTeLaat(factuur, vandaag()));
  else if (filters.status) facturen = facturen.filter((factuur) => factuur.status === filters.status);
  if (filters.zoek) {
    const term = filters.zoek.toLowerCase();
    facturen = facturen.filter(
      (factuur) => factuur.nummer?.toLowerCase().includes(term) || factuur.afnemer?.naam.toLowerCase().includes(term),
    );
  }
  return { ok: true, bron: "lokaal", facturen, heeftMeer: false };
}

export async function haalFactuur(factuurId: string): Promise<Resultaat<{ factuur: Factuur }>> {
  const { status, data } = await api<{ factuur: Factuur }>(`facturen/${factuurId}`);
  if (status === 200 && data) return { ok: true, bron: "centraal", factuur: data.factuur };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  const state = lokaleState();
  const factuur = state.facturen.find((rij) => rij.id === factuurId);
  if (!factuur) {
    return { ok: false, fout: "Deze factuur bestaat niet (meer) voor deze organisatie.", status: 404 };
  }
  return { ok: true, bron: "lokaal", factuur };
}

export async function maakConcept(dupliceerVan?: string): Promise<Resultaat<{ factuur: Factuur }>> {
  const query = dupliceerVan ? `?dupliceerVan=${encodeURIComponent(dupliceerVan)}` : "";
  const { status, data } = await api<{ factuur: Factuur }>(`facturen${query}`, { method: "POST" });
  if (status === 200 && data) return { ok: true, bron: "centraal", factuur: data.factuur };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  const state = lokaleState();
  const bron = dupliceerVan ? state.facturen.find((rij) => rij.id === dupliceerVan) : undefined;
  const factuur: Factuur = {
    id: `lokaal-${crypto.randomUUID()}`,
    status: "concept",
    soort: "factuur",
    reeks: state.instellingen.nummering.reeksFactuur,
    jaar: new Date().getUTCFullYear(),
    volgnummer: null,
    nummer: null,
    factuurdatum: null,
    prestatieVan: null,
    prestatieTot: null,
    vervaldatum: null,
    betaaltermijnDagen: state.instellingen.betaling.standaardTermijnDagen,
    contactId: bron?.contactId ?? null,
    afnemer: bron?.afnemer ? { ...bron.afnemer } : null,
    afzender: null,
    uwKenmerk: bron?.uwKenmerk,
    orderReferentie: bron?.orderReferentie,
    regels: bron ? bron.regels.map((regel) => ({ ...regel, id: crypto.randomUUID() })) : [],
    btwTotalen: bron ? bron.btwTotalen.map((totaal) => ({ ...totaal })) : [],
    vrijstellingTekst:
      bron?.vrijstellingTekst ??
      (state.instellingen.btw.standaardTarief === "vrijgesteld" ? state.instellingen.btw.vrijstellingTekst : undefined),
    subtotaalCent: bron?.subtotaalCent ?? 0,
    btwCent: bron?.btwCent ?? 0,
    totaalCent: bron?.totaalCent ?? 0,
    valuta: "EUR",
    opmerking: undefined,
    betaaldOp: null,
    pdfPad: null,
    mailStatus: "niet_verzonden",
    createdAt: nu(),
    updatedAt: nu(),
  };
  state.facturen.unshift(factuur);
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", factuur };
}

export async function bewaarConcept(factuur: Factuur, baseUpdatedAt: string): Promise<Resultaat<{ factuur: Factuur }>> {
  const { status, data } = await api<{ factuur: Factuur }>(`facturen/${factuur.id}`, {
    method: "PATCH",
    body: JSON.stringify({ factuur, baseUpdatedAt }),
  });
  if (status === 200 && data) return { ok: true, bron: "centraal", factuur: data.factuur };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  const state = lokaleState();
  const index = state.facturen.findIndex((rij) => rij.id === factuur.id);
  if (index < 0) {
    return { ok: false, fout: "Deze factuur bestaat niet (meer) voor deze organisatie.", status: 404 };
  }
  if (state.facturen[index].status !== "concept") {
    return {
      ok: false,
      fout: "Een uitgereikte factuur kan niet meer worden gewijzigd; maak een creditfactuur.",
      status: 409,
    };
  }
  const totalen = berekenTotalen(factuur.regels);
  const bijgewerkt: Factuur = {
    ...factuur,
    subtotaalCent: totalen.subtotaalCent,
    btwCent: totalen.btwCent,
    totaalCent: totalen.totaalCent,
    btwTotalen: totalen.btwTotalen,
    updatedAt: nu(),
  };
  state.facturen[index] = bijgewerkt;
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", factuur: bijgewerkt };
}

export async function verwijderConcept(factuurId: string): Promise<Resultaat<Record<never, never>>> {
  const { status, data } = await api<Record<string, unknown>>(`facturen/${factuurId}`, { method: "DELETE" });
  if (status === 200) return { ok: true, bron: "centraal" };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  const state = lokaleState();
  const factuur = state.facturen.find((rij) => rij.id === factuurId);
  if (factuur && factuur.status !== "concept") {
    return { ok: false, fout: "Een uitgereikte factuur kan niet worden verwijderd.", status: 409 };
  }
  state.facturen = state.facturen.filter((rij) => rij.id !== factuurId);
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal" };
}

export async function maakDefinitief(
  factuurId: string,
  factuurdatum?: string,
): Promise<Resultaat<{ factuur: Factuur; pdfOntbreekt?: boolean; melding?: string }>> {
  const { status, data } = await api<{ factuur: Factuur; pdfOntbreekt?: boolean; melding?: string }>(
    `facturen/${factuurId}/definitief`,
    { method: "POST", body: JSON.stringify(factuurdatum ? { factuurdatum } : {}) },
  );
  if (status === 200 && data) {
    return {
      ok: true,
      bron: "centraal",
      factuur: data.factuur,
      pdfOntbreekt: data.pdfOntbreekt,
      melding: data.melding,
    };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  // Demo-pad: valideren, bevriezen en nummeren met de client-side teller
  // (gedocumenteerde enige uitzondering op B9 — alleen zonder Supabase-sessie).
  const state = lokaleState();
  const index = state.facturen.findIndex((rij) => rij.id === factuurId);
  if (index < 0) {
    return { ok: false, fout: "Deze factuur bestaat niet (meer) voor deze organisatie.", status: 404 };
  }
  const concept = state.facturen[index];
  if (concept.status !== "concept") {
    return { ok: false, fout: "Deze factuur is al uitgereikt.", status: 409 };
  }
  const afzender = afzenderUitInstellingen(state.instellingen);
  const datum = factuurdatum ?? vandaag();
  const validatie = valideerFactuurVoorUitreiking({ ...concept, factuurdatum: datum }, afzender);
  if (!validatie.ok) {
    return {
      ok: false,
      fout: "Vul eerst alle wettelijk verplichte factuurgegevens in.",
      status: 400,
      ontbrekend: validatie.ontbrekend,
    };
  }
  const reeks =
    concept.soort === "creditfactuur"
      ? state.instellingen.nummering.reeksCredit
      : state.instellingen.nummering.reeksFactuur;
  const jaar = Number.parseInt(datum.slice(0, 4), 10);
  const volgnummer = volgendDemoNummer(state, reeks, jaar);
  const nummer = formatFactuurnummer(state.instellingen.nummering.formaat, reeks, jaar, volgnummer);
  const betaaltermijn = concept.betaaltermijnDagen ?? state.instellingen.betaling.standaardTermijnDagen;
  const totalen = berekenTotalen(concept.regels);
  const definitief: Factuur = {
    ...concept,
    status: "definitief",
    reeks,
    jaar,
    volgnummer,
    nummer,
    factuurdatum: datum,
    vervaldatum: berekenVervaldatum(datum, betaaltermijn),
    betaaltermijnDagen: betaaltermijn,
    afzender,
    subtotaalCent: totalen.subtotaalCent,
    btwCent: totalen.btwCent,
    totaalCent: totalen.totaalCent,
    btwTotalen: totalen.btwTotalen,
    updatedAt: nu(),
  };
  state.facturen[index] = definitief;
  bewaarLokaal(state);
  // Geen archief in demo: downloaden gebeurt rechtstreeks via de client-blob.
  return { ok: true, bron: "lokaal", factuur: definitief };
}

export async function wijzigStatus(
  factuurId: string,
  naarStatus: "verzonden" | "betaald",
  betaaldOp?: string,
): Promise<Resultaat<{ factuur: Factuur }>> {
  const { status, data } = await api<{ factuur: Factuur }>(`facturen/${factuurId}/status`, {
    method: "POST",
    body: JSON.stringify({ status: naarStatus, betaaldOp }),
  });
  if (status === 200 && data) return { ok: true, bron: "centraal", factuur: data.factuur };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  const state = lokaleState();
  const index = state.facturen.findIndex((rij) => rij.id === factuurId);
  if (index < 0) {
    return { ok: false, fout: "Deze factuur bestaat niet (meer) voor deze organisatie.", status: 404 };
  }
  const huidig = state.facturen[index];
  const toegestaan = naarStatus === "verzonden" ? ["definitief"] : ["definitief", "verzonden"];
  if (!toegestaan.includes(huidig.status)) {
    return {
      ok: false,
      fout: `Deze factuur kan vanuit status "${huidig.status}" niet naar "${naarStatus}".`,
      status: 409,
    };
  }
  const bijgewerkt: Factuur = {
    ...huidig,
    status: naarStatus,
    betaaldOp: naarStatus === "betaald" ? (betaaldOp ?? vandaag()) : huidig.betaaldOp,
    updatedAt: nu(),
  };
  state.facturen[index] = bijgewerkt;
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", factuur: bijgewerkt };
}

export async function crediteer(factuurId: string): Promise<Resultaat<{ factuur: Factuur }>> {
  const { status, data } = await api<{ factuur: Factuur }>(`facturen/${factuurId}/credit`, { method: "POST" });
  if (status === 200 && data) return { ok: true, bron: "centraal", factuur: data.factuur };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  const state = lokaleState();
  const index = state.facturen.findIndex((rij) => rij.id === factuurId);
  const origineel = index >= 0 ? state.facturen[index] : null;
  if (!origineel) {
    return { ok: false, fout: "Deze factuur bestaat niet (meer) voor deze organisatie.", status: 404 };
  }
  if (origineel.soort !== "factuur" || !["definitief", "verzonden", "betaald"].includes(origineel.status)) {
    return { ok: false, fout: "Alleen een uitgereikte factuur kan worden gecrediteerd.", status: 409 };
  }
  const afzender = afzenderUitInstellingen(state.instellingen);
  const datum = vandaag();
  const jaar = Number.parseInt(datum.slice(0, 4), 10);
  const reeks = state.instellingen.nummering.reeksCredit;
  const volgnummer = volgendDemoNummer(state, reeks, jaar);
  const creditRegels = origineel.regels.map((regel) => ({ ...regel, id: crypto.randomUUID(), aantal: -regel.aantal }));
  const totalen = berekenTotalen(creditRegels);
  const betaaltermijn = origineel.betaaltermijnDagen ?? state.instellingen.betaling.standaardTermijnDagen;
  const credit: Factuur = {
    ...origineel,
    id: `lokaal-${crypto.randomUUID()}`,
    soort: "creditfactuur",
    status: "definitief",
    reeks,
    jaar,
    volgnummer,
    nummer: formatFactuurnummer(state.instellingen.nummering.formaat, reeks, jaar, volgnummer),
    gecrediteerdeFactuurId: origineel.id,
    factuurdatum: datum,
    vervaldatum: berekenVervaldatum(datum, betaaltermijn),
    afzender,
    regels: creditRegels,
    btwTotalen: totalen.btwTotalen,
    subtotaalCent: totalen.subtotaalCent,
    btwCent: totalen.btwCent,
    totaalCent: totalen.totaalCent,
    opmerking: `Creditering van factuur ${origineel.nummer ?? ""}`.trim(),
    betaaldOp: null,
    pdfPad: null,
    createdAt: nu(),
    updatedAt: nu(),
  };
  state.facturen[index] = { ...origineel, status: "gecrediteerd", updatedAt: nu() };
  state.facturen.unshift(credit);
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", factuur: credit };
}

export async function herstelPdf(factuurId: string): Promise<Resultaat<{ factuur: Factuur | null }>> {
  const { status, data } = await api<{ factuur: Factuur | null }>(`facturen/${factuurId}/pdf`, { method: "POST" });
  if (status === 200 && data) return { ok: true, bron: "centraal", factuur: data.factuur };
  if (status === 501) {
    return {
      ok: false,
      fout: "In demo-modus is er geen centraal pdf-archief; download via het voorbeeld.",
      status: 501,
    };
  }
  return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };
}

// ── Contacten ───────────────────────────────────────────────────────────────

export async function haalContacten(): Promise<Resultaat<{ contacten: FacturatieContact[] }>> {
  const { status, data } = await api<{ contacten: FacturatieContact[] }>("contacten");
  if (status === 200 && data) return { ok: true, bron: "centraal", contacten: data.contacten };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };
  const state = lokaleState();
  bewaarLokaal(state);
  return {
    ok: true,
    bron: "lokaal",
    contacten: [...state.contacten].sort((a, b) => a.naam.localeCompare(b.naam, "nl")),
  };
}

export async function bewaarContact(
  contact: FacturatieContact,
  nieuw: boolean,
): Promise<Resultaat<{ contact: FacturatieContact }>> {
  const pad = nieuw ? "contacten" : `contacten/${contact.id}`;
  const { status, data } = await api<{ contact: FacturatieContact }>(pad, {
    method: nieuw ? "POST" : "PATCH",
    body: JSON.stringify({ contact }),
  });
  if (status === 200 && data) return { ok: true, bron: "centraal", contact: data.contact };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  const state = lokaleState();
  const bijgewerkt = { ...contact, updatedAt: nu() };
  if (nieuw) {
    bijgewerkt.id = `lokaal-${crypto.randomUUID()}`;
    state.contacten.push(bijgewerkt);
  } else {
    const index = state.contacten.findIndex((rij) => rij.id === contact.id);
    if (index < 0) {
      return { ok: false, fout: "Dit contact bestaat niet (meer) voor deze organisatie.", status: 404 };
    }
    state.contacten[index] = bijgewerkt;
  }
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", contact: bijgewerkt };
}

export async function verwijderContact(contactId: string): Promise<Resultaat<{ archiveerbaar?: boolean }>> {
  const { status, data } = await api<{ archiveerbaar?: boolean }>(`contacten/${contactId}`, { method: "DELETE" });
  if (status === 200) return { ok: true, bron: "centraal" };
  if (status === 409) {
    return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  const state = lokaleState();
  const verwezen = state.facturen.some((factuur) => factuur.contactId === contactId);
  if (verwezen) {
    return { ok: false, fout: "Dit contact staat op een factuur en kan alleen worden gearchiveerd.", status: 409 };
  }
  state.contacten = state.contacten.filter((rij) => rij.id !== contactId);
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal" };
}

// ── Medewerkers-unie ────────────────────────────────────────────────────────

export interface MedewerkerUnieRij {
  naam: string;
  functie?: string;
  email?: string;
  teams?: string[];
  userId?: string;
  alContact: boolean;
}

export async function haalMedewerkers(): Promise<Resultaat<{ medewerkers: MedewerkerUnieRij[] }>> {
  const { status, data } = await api<{ medewerkers: MedewerkerUnieRij[] }>("medewerkers");
  if (status === 200 && data) return { ok: true, bron: "centraal", medewerkers: data.medewerkers };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  const state = lokaleState();
  const contactSleutels = new Set(
    state.contacten
      .filter((contact) => contact.soort === "medewerker")
      .map((contact) => (contact.email ?? contact.medewerkerNaam ?? contact.naam).trim().toLowerCase()),
  );
  const medewerkers = DEMO_MIDDELEN_STATE.medewerkers
    .filter((medewerker) => !medewerker.uitDienst)
    .map((medewerker) => ({
      naam: medewerker.naam,
      functie: medewerker.functie,
      teams: medewerker.teams,
      email: medewerker.accountEmail,
      alContact:
        contactSleutels.has((medewerker.accountEmail ?? "").trim().toLowerCase()) ||
        contactSleutels.has(medewerker.naam.trim().toLowerCase()),
    }))
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  return { ok: true, bron: "lokaal", medewerkers };
}

// ── Instellingen ────────────────────────────────────────────────────────────

export async function haalFacturatieInstellingen(): Promise<
  Resultaat<{ instellingen: FacturatieInstellingen; revision: number }>
> {
  const { status, data } = await api<{ instellingen: FacturatieInstellingen; revision: number }>("instellingen");
  if (status === 200 && data) {
    return { ok: true, bron: "centraal", instellingen: data.instellingen, revision: data.revision };
  }
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };
  const state = lokaleState();
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", instellingen: state.instellingen, revision: 0 };
}

export async function bewaarFacturatieInstellingen(
  instellingen: FacturatieInstellingen,
  baseRevision: number,
): Promise<Resultaat<{ revision: number }>> {
  const { status, data } = await api<{ revision: number }>("instellingen", {
    method: "POST",
    body: JSON.stringify({ state: instellingen, baseRevision, operationId: crypto.randomUUID() }),
  });
  if (status === 200 && data) return { ok: true, bron: "centraal", revision: data.revision };
  if (status !== 501) return { ok: false, ...foutUit(status, data, NIET_BEREIKBAAR) };

  const state = lokaleState();
  state.instellingen = { ...instellingen, updatedAt: nu() };
  bewaarLokaal(state);
  return { ok: true, bron: "lokaal", revision: baseRevision + 1 };
}

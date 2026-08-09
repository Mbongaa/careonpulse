// Facturatie — handmatig uitgereikte facturen, contacten en instellingen
// (handoff 15). Deze data komt níét uit het EPD: de module beheert de eigen
// factuurstroom van de organisatie (detachering, particulieren, zakelijk),
// centraal (Supabase) of lokaal (demo-pad, storage.client.ts). Kolomnamen en
// btw-categorieën volgen bewust de EN 16931-semantiek zodat een latere
// UBL-export een serializer is, geen migratie.

export const BTW_TARIEVEN = ["vrijgesteld", "0", "9", "21"] as const;
export type BtwTarief = (typeof BTW_TARIEVEN)[number];

/** EN 16931 BT-151: E = vrijgesteld, Z = nultarief, S = standaard/verlaagd, AE = verlegd. */
export const BTW_CATEGORIEEN = ["E", "Z", "S", "AE"] as const;
export type BtwCategorie = (typeof BTW_CATEGORIEEN)[number];

// "Te laat" is bewust géén opgeslagen status: de lijst leidt hem af uit
// vervaldatum < vandaag ∧ status ∉ {betaald, gecrediteerd}.
export const FACTUUR_STATUSSEN = ["concept", "definitief", "verzonden", "betaald", "gecrediteerd"] as const;
export type FactuurStatus = (typeof FACTUUR_STATUSSEN)[number];

export const FACTUUR_SOORTEN = ["factuur", "creditfactuur"] as const;
export type FactuurSoort = (typeof FACTUUR_SOORTEN)[number];

export const CONTACT_SOORTEN = ["organisatie", "particulier", "verzekeraar", "gemeente", "medewerker"] as const;
export type ContactSoort = (typeof CONTACT_SOORTEN)[number];

export const MAIL_STATUSSEN = ["niet_verzonden", "in_wachtrij", "verzonden", "mislukt"] as const;
export type MailStatus = (typeof MAIL_STATUSSEN)[number];

export interface FactuurRegel {
  /** Client-uuid, alleen voor React-keys en volgorde. */
  id: string;
  /** BT-153. */
  omschrijving: string;
  /** Optionele prestatie-/tariefcode. */
  code?: string;
  /** BT-129 — maximaal 3 decimalen. */
  aantal: number;
  /** "uur" | "stuk" | "sessie" | … — vrije korte eenheid. */
  eenheid: string;
  /** BT-146, exclusief btw, in hele centen. */
  stukprijsCent: number;
  /** 0..100. */
  kortingPct?: number;
  btwTarief: BtwTarief;
  btwCategorie: BtwCategorie;
}

/** Totaalregel per tarief/vrijstelling (art. 35a lid 1 sub h + j). */
export interface BtwTotaal {
  tarief: BtwTarief;
  categorie: BtwCategorie;
  grondslagCent: number;
  btwCent: number;
}

/** Bevroren afnemergegevens op de factuur (BT-44..BT-49). */
export interface FactuurPartij {
  naam: string;
  contactpersoon?: string;
  adresRegel1?: string;
  adresRegel2?: string;
  postcode?: string;
  plaats?: string;
  land: string;
  kvkNummer?: string;
  btwId?: string;
  email?: string;
}

/** Bevroren afzendergegevens op de factuur (platgeslagen instellingen-snapshot). */
export interface FactuurAfzender {
  statutaireNaam: string;
  handelsnaam?: string;
  adresRegel1: string;
  adresRegel2?: string;
  postcode: string;
  plaats: string;
  land: string;
  kvkNummer: string;
  btwId?: string;
  agbCode?: string;
  email?: string;
  telefoon?: string;
  iban: string;
  bic?: string;
  tenaamstelling: string;
  betaalinstructie?: string;
  voettekst?: string;
  toonLogo: boolean;
}

export interface Factuur {
  id: string;
  status: FactuurStatus;
  soort: FactuurSoort;
  reeks: string;
  jaar: number;
  /** NULL zolang concept — toekenning is de atomaire RPC bij definitief maken. */
  volgnummer: number | null;
  /** BT-1; NULL zolang concept. */
  nummer: string | null;
  gecrediteerdeFactuurId?: string | null;
  /** BT-2, ISO-datum. */
  factuurdatum: string | null;
  /** BT-73/BT-74 — art. 35a lid 1 sub g. */
  prestatieVan: string | null;
  prestatieTot: string | null;
  /** BT-9, afgeleid uit factuurdatum + betaaltermijn. */
  vervaldatum: string | null;
  betaaltermijnDagen: number | null;
  contactId: string | null;
  afnemer: FactuurPartij | null;
  /** Bevroren bij definitief maken; tijdens concept afgeleid uit de instellingen. */
  afzender: FactuurAfzender | null;
  /** BT-10 inkoopreferentie ("uw kenmerk") — per factuur, voorgevuld uit het contact. */
  uwKenmerk?: string;
  /** BT-13 ordernummer. */
  orderReferentie?: string;
  regels: FactuurRegel[];
  btwTotalen: BtwTotaal[];
  /** BT-120 — verplicht zodra één regel vrijgesteld is. */
  vrijstellingTekst?: string;
  subtotaalCent: number;
  btwCent: number;
  totaalCent: number;
  valuta: "EUR";
  opmerking?: string;
  betaaldOp: string | null;
  pdfPad: string | null;
  mailStatus: MailStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FacturatieContact {
  id: string;
  soort: ContactSoort;
  bron: "handmatig" | "medewerker";
  naam: string;
  contactpersoon?: string;
  email?: string;
  telefoon?: string;
  adresRegel1?: string;
  adresRegel2?: string;
  postcode?: string;
  plaats?: string;
  land: string;
  kvkNummer?: string;
  btwId?: string;
  /** Uzovi-code (zorgverzekeraars), 4 cijfers. */
  uzovi?: string;
  agbCode?: string;
  betaaltermijnDagen?: number;
  /** Standaardreferentie; per factuur overschrijfbaar via `uwKenmerk`. */
  referentie?: string;
  notitie?: string;
  archief: boolean;
  /** Zachte koppeling naar het medewerkersregister — géén FK, naam is de sleutel daar. */
  medewerkerNaam?: string;
  medewerkerUserId?: string;
  updatedAt: string;
}

export interface FacturatieInstellingen {
  afzender: {
    statutaireNaam: string;
    handelsnaam?: string;
    adresRegel1: string;
    adresRegel2?: string;
    postcode: string;
    plaats: string;
    land: string;
    kvkNummer: string;
    /** NULL/leeg bij een volledig vrijgestelde entiteit. */
    btwId?: string;
    agbCode?: string;
    email?: string;
    telefoon?: string;
  };
  bank: { iban: string; bic?: string; tenaamstelling: string };
  nummering: {
    reeksFactuur: string;
    reeksCredit: string;
    /** Template met {reeks}, {jaar} en {nummer:4}; default "F2026-0001"-vorm. */
    formaat: string;
    /** Seedt de teller (aansluiten op een bestaande reeks); alleen wijzigbaar
        zolang er in die reeks/dat jaar geen definitieve factuur bestaat. */
    startVolgnummer: number;
  };
  betaling: { standaardTermijnDagen: number; betaalinstructie?: string };
  btw: { standaardTarief: BtwTarief; vrijstellingTekst: string };
  presentatie: { voettekst?: string; toonLogo: boolean; logoPad?: string; logoHash?: string };
  updatedAt: string;
}

/** Metadata bij een centrale wijziging. Bevat bewust geen namen of bedragen. */
export interface FacturatieChangeAudit {
  source: "manual";
}

// Grenzen voor de API-routes: ruim boven reëel gebruik, harde rem tegen
// misvormde of kwaadwillige payloads.
export const FACTURATIE_LIMITS = {
  regels: 100,
  omschrijving: 300,
  code: 40,
  eenheid: 20,
  aantal: 100_000,
  stukprijsCent: 100_000_000,
  naam: 160,
  contactpersoon: 120,
  email: 254,
  telefoon: 40,
  adres: 160,
  postcode: 12,
  plaats: 80,
  btwId: 20,
  agbCode: 12,
  referentie: 80,
  notitie: 500,
  opmerking: 1000,
  vrijstellingTekst: 400,
  betaaltermijnDagen: 180,
  reeks: 4,
  formaat: 40,
  volgnummer: 100_000_000,
  jaarMin: 2020,
  jaarMax: 2100,
  voettekst: 300,
  betaalinstructie: 300,
  contacten: 1000,
} as const;

const KVK_PATTERN = /^[0-9]{8}$/;
const UZOVI_PATTERN = /^[0-9]{4}$/;
const REEKS_PATTERN = /^[A-Z]{1,4}$/;
const ISO_DATUM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isTekst(value: unknown, max: number, verplicht = false): boolean {
  if (value === undefined) return !verplicht;
  return typeof value === "string" && (!verplicht || value.trim().length > 0) && value.length <= max;
}

function isIsoDatum(value: unknown): boolean {
  return typeof value === "string" && ISO_DATUM_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isIsoDatumOfNull(value: unknown): boolean {
  return value === null || isIsoDatum(value);
}

function isCentBedrag(value: unknown, max: number = FACTURATIE_LIMITS.stukprijsCent): boolean {
  // Creditregels zijn negatief, dus het bereik is symmetrisch.
  return typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= max;
}

export function isBtwTarief(value: unknown): value is BtwTarief {
  return typeof value === "string" && (BTW_TARIEVEN as readonly string[]).includes(value);
}

export function isFactuurRegel(value: unknown): value is FactuurRegel {
  if (typeof value !== "object" || value === null) return false;
  const regel = value as Record<string, unknown>;
  return (
    typeof regel.id === "string" &&
    regel.id.length > 0 &&
    regel.id.length <= 64 &&
    isTekst(regel.omschrijving, FACTURATIE_LIMITS.omschrijving, true) &&
    isTekst(regel.code, FACTURATIE_LIMITS.code) &&
    typeof regel.aantal === "number" &&
    Number.isFinite(regel.aantal) &&
    Math.abs(regel.aantal) <= FACTURATIE_LIMITS.aantal &&
    Math.round((regel.aantal as number) * 1000) === (regel.aantal as number) * 1000 &&
    isTekst(regel.eenheid, FACTURATIE_LIMITS.eenheid, true) &&
    isCentBedrag(regel.stukprijsCent) &&
    (regel.kortingPct === undefined ||
      (typeof regel.kortingPct === "number" &&
        Number.isFinite(regel.kortingPct) &&
        regel.kortingPct >= 0 &&
        regel.kortingPct <= 100)) &&
    isBtwTarief(regel.btwTarief) &&
    typeof regel.btwCategorie === "string" &&
    (BTW_CATEGORIEEN as readonly string[]).includes(regel.btwCategorie)
  );
}

function isBtwTotaal(value: unknown): value is BtwTotaal {
  if (typeof value !== "object" || value === null) return false;
  const totaal = value as Record<string, unknown>;
  return (
    isBtwTarief(totaal.tarief) &&
    typeof totaal.categorie === "string" &&
    (BTW_CATEGORIEEN as readonly string[]).includes(totaal.categorie) &&
    isCentBedrag(totaal.grondslagCent, Number.MAX_SAFE_INTEGER) &&
    isCentBedrag(totaal.btwCent, Number.MAX_SAFE_INTEGER)
  );
}

export function isFactuurPartij(value: unknown): value is FactuurPartij {
  if (typeof value !== "object" || value === null) return false;
  const partij = value as Record<string, unknown>;
  return (
    isTekst(partij.naam, FACTURATIE_LIMITS.naam, true) &&
    isTekst(partij.contactpersoon, FACTURATIE_LIMITS.contactpersoon) &&
    isTekst(partij.adresRegel1, FACTURATIE_LIMITS.adres) &&
    isTekst(partij.adresRegel2, FACTURATIE_LIMITS.adres) &&
    isTekst(partij.postcode, FACTURATIE_LIMITS.postcode) &&
    isTekst(partij.plaats, FACTURATIE_LIMITS.plaats) &&
    typeof partij.land === "string" &&
    partij.land.length === 2 &&
    (partij.kvkNummer === undefined || (typeof partij.kvkNummer === "string" && KVK_PATTERN.test(partij.kvkNummer))) &&
    isTekst(partij.btwId, FACTURATIE_LIMITS.btwId) &&
    isTekst(partij.email, FACTURATIE_LIMITS.email)
  );
}

export function isFactuurAfzender(value: unknown): value is FactuurAfzender {
  if (typeof value !== "object" || value === null) return false;
  const afzender = value as Record<string, unknown>;
  return (
    isTekst(afzender.statutaireNaam, FACTURATIE_LIMITS.naam, true) &&
    isTekst(afzender.handelsnaam, FACTURATIE_LIMITS.naam) &&
    isTekst(afzender.adresRegel1, FACTURATIE_LIMITS.adres, true) &&
    isTekst(afzender.adresRegel2, FACTURATIE_LIMITS.adres) &&
    isTekst(afzender.postcode, FACTURATIE_LIMITS.postcode, true) &&
    isTekst(afzender.plaats, FACTURATIE_LIMITS.plaats, true) &&
    typeof afzender.land === "string" &&
    afzender.land.length === 2 &&
    typeof afzender.kvkNummer === "string" &&
    KVK_PATTERN.test(afzender.kvkNummer) &&
    isTekst(afzender.btwId, FACTURATIE_LIMITS.btwId) &&
    isTekst(afzender.agbCode, FACTURATIE_LIMITS.agbCode) &&
    isTekst(afzender.email, FACTURATIE_LIMITS.email) &&
    isTekst(afzender.telefoon, FACTURATIE_LIMITS.telefoon) &&
    isTekst(afzender.iban, 34, true) &&
    isTekst(afzender.bic, 11) &&
    isTekst(afzender.tenaamstelling, FACTURATIE_LIMITS.naam, true) &&
    isTekst(afzender.betaalinstructie, FACTURATIE_LIMITS.betaalinstructie) &&
    isTekst(afzender.voettekst, FACTURATIE_LIMITS.voettekst) &&
    typeof afzender.toonLogo === "boolean"
  );
}

export function isFactuur(value: unknown): value is Factuur {
  if (typeof value !== "object" || value === null) return false;
  const factuur = value as Record<string, unknown>;
  return (
    typeof factuur.id === "string" &&
    factuur.id.length > 0 &&
    typeof factuur.status === "string" &&
    (FACTUUR_STATUSSEN as readonly string[]).includes(factuur.status) &&
    typeof factuur.soort === "string" &&
    (FACTUUR_SOORTEN as readonly string[]).includes(factuur.soort) &&
    typeof factuur.reeks === "string" &&
    REEKS_PATTERN.test(factuur.reeks) &&
    typeof factuur.jaar === "number" &&
    Number.isInteger(factuur.jaar) &&
    factuur.jaar >= FACTURATIE_LIMITS.jaarMin &&
    factuur.jaar <= FACTURATIE_LIMITS.jaarMax &&
    (factuur.volgnummer === null ||
      (typeof factuur.volgnummer === "number" &&
        Number.isInteger(factuur.volgnummer) &&
        factuur.volgnummer > 0 &&
        factuur.volgnummer <= FACTURATIE_LIMITS.volgnummer)) &&
    (factuur.nummer === null || isTekst(factuur.nummer, FACTURATIE_LIMITS.formaat, true)) &&
    (factuur.gecrediteerdeFactuurId === undefined ||
      factuur.gecrediteerdeFactuurId === null ||
      typeof factuur.gecrediteerdeFactuurId === "string") &&
    isIsoDatumOfNull(factuur.factuurdatum) &&
    isIsoDatumOfNull(factuur.prestatieVan) &&
    isIsoDatumOfNull(factuur.prestatieTot) &&
    isIsoDatumOfNull(factuur.vervaldatum) &&
    (factuur.betaaltermijnDagen === null ||
      (typeof factuur.betaaltermijnDagen === "number" &&
        Number.isInteger(factuur.betaaltermijnDagen) &&
        factuur.betaaltermijnDagen >= 0 &&
        factuur.betaaltermijnDagen <= FACTURATIE_LIMITS.betaaltermijnDagen)) &&
    (factuur.contactId === null || typeof factuur.contactId === "string") &&
    (factuur.afnemer === null || isFactuurPartij(factuur.afnemer)) &&
    (factuur.afzender === null || isFactuurAfzender(factuur.afzender)) &&
    isTekst(factuur.uwKenmerk, FACTURATIE_LIMITS.referentie) &&
    isTekst(factuur.orderReferentie, FACTURATIE_LIMITS.referentie) &&
    Array.isArray(factuur.regels) &&
    factuur.regels.length <= FACTURATIE_LIMITS.regels &&
    factuur.regels.every(isFactuurRegel) &&
    Array.isArray(factuur.btwTotalen) &&
    factuur.btwTotalen.length <= BTW_TARIEVEN.length &&
    factuur.btwTotalen.every(isBtwTotaal) &&
    isTekst(factuur.vrijstellingTekst, FACTURATIE_LIMITS.vrijstellingTekst) &&
    isCentBedrag(factuur.subtotaalCent, Number.MAX_SAFE_INTEGER) &&
    isCentBedrag(factuur.btwCent, Number.MAX_SAFE_INTEGER) &&
    isCentBedrag(factuur.totaalCent, Number.MAX_SAFE_INTEGER) &&
    factuur.valuta === "EUR" &&
    isTekst(factuur.opmerking, FACTURATIE_LIMITS.opmerking) &&
    isIsoDatumOfNull(factuur.betaaldOp) &&
    (factuur.pdfPad === null || typeof factuur.pdfPad === "string") &&
    typeof factuur.mailStatus === "string" &&
    (MAIL_STATUSSEN as readonly string[]).includes(factuur.mailStatus) &&
    typeof factuur.createdAt === "string" &&
    typeof factuur.updatedAt === "string"
  );
}

export function isFacturatieContact(value: unknown): value is FacturatieContact {
  if (typeof value !== "object" || value === null) return false;
  const contact = value as Record<string, unknown>;
  return (
    typeof contact.id === "string" &&
    contact.id.length > 0 &&
    typeof contact.soort === "string" &&
    (CONTACT_SOORTEN as readonly string[]).includes(contact.soort) &&
    (contact.bron === "handmatig" || contact.bron === "medewerker") &&
    isTekst(contact.naam, FACTURATIE_LIMITS.naam, true) &&
    isTekst(contact.contactpersoon, FACTURATIE_LIMITS.contactpersoon) &&
    isTekst(contact.email, FACTURATIE_LIMITS.email) &&
    isTekst(contact.telefoon, FACTURATIE_LIMITS.telefoon) &&
    isTekst(contact.adresRegel1, FACTURATIE_LIMITS.adres) &&
    isTekst(contact.adresRegel2, FACTURATIE_LIMITS.adres) &&
    isTekst(contact.postcode, FACTURATIE_LIMITS.postcode) &&
    isTekst(contact.plaats, FACTURATIE_LIMITS.plaats) &&
    typeof contact.land === "string" &&
    contact.land.length === 2 &&
    (contact.kvkNummer === undefined ||
      (typeof contact.kvkNummer === "string" && KVK_PATTERN.test(contact.kvkNummer))) &&
    isTekst(contact.btwId, FACTURATIE_LIMITS.btwId) &&
    (contact.uzovi === undefined || (typeof contact.uzovi === "string" && UZOVI_PATTERN.test(contact.uzovi))) &&
    isTekst(contact.agbCode, FACTURATIE_LIMITS.agbCode) &&
    (contact.betaaltermijnDagen === undefined ||
      (typeof contact.betaaltermijnDagen === "number" &&
        Number.isInteger(contact.betaaltermijnDagen) &&
        contact.betaaltermijnDagen >= 0 &&
        contact.betaaltermijnDagen <= FACTURATIE_LIMITS.betaaltermijnDagen)) &&
    isTekst(contact.referentie, FACTURATIE_LIMITS.referentie) &&
    isTekst(contact.notitie, FACTURATIE_LIMITS.notitie) &&
    typeof contact.archief === "boolean" &&
    isTekst(contact.medewerkerNaam, FACTURATIE_LIMITS.naam) &&
    (contact.medewerkerUserId === undefined || typeof contact.medewerkerUserId === "string") &&
    typeof contact.updatedAt === "string"
  );
}

export function isFacturatieInstellingen(value: unknown): value is FacturatieInstellingen {
  if (typeof value !== "object" || value === null) return false;
  const instellingen = value as Record<string, unknown>;
  const afzender = instellingen.afzender as Record<string, unknown> | null | undefined;
  const bank = instellingen.bank as Record<string, unknown> | null | undefined;
  const nummering = instellingen.nummering as Record<string, unknown> | null | undefined;
  const betaling = instellingen.betaling as Record<string, unknown> | null | undefined;
  const btw = instellingen.btw as Record<string, unknown> | null | undefined;
  const presentatie = instellingen.presentatie as Record<string, unknown> | null | undefined;
  if (!afzender || typeof afzender !== "object") return false;
  if (!bank || typeof bank !== "object") return false;
  if (!nummering || typeof nummering !== "object") return false;
  if (!betaling || typeof betaling !== "object") return false;
  if (!btw || typeof btw !== "object") return false;
  if (!presentatie || typeof presentatie !== "object") return false;
  return (
    // Afzender: velden mogen leeg zijn (EMPTY-seed) maar moeten qua vorm kloppen;
    // de art. 35a-validator dwingt de inhoud pas af bij definitief maken.
    isTekst(afzender.statutaireNaam, FACTURATIE_LIMITS.naam) &&
    typeof afzender.statutaireNaam === "string" &&
    isTekst(afzender.handelsnaam, FACTURATIE_LIMITS.naam) &&
    isTekst(afzender.adresRegel1, FACTURATIE_LIMITS.adres) &&
    typeof afzender.adresRegel1 === "string" &&
    isTekst(afzender.adresRegel2, FACTURATIE_LIMITS.adres) &&
    isTekst(afzender.postcode, FACTURATIE_LIMITS.postcode) &&
    typeof afzender.postcode === "string" &&
    isTekst(afzender.plaats, FACTURATIE_LIMITS.plaats) &&
    typeof afzender.plaats === "string" &&
    typeof afzender.land === "string" &&
    afzender.land.length === 2 &&
    typeof afzender.kvkNummer === "string" &&
    (afzender.kvkNummer === "" || KVK_PATTERN.test(afzender.kvkNummer)) &&
    isTekst(afzender.btwId, FACTURATIE_LIMITS.btwId) &&
    isTekst(afzender.agbCode, FACTURATIE_LIMITS.agbCode) &&
    isTekst(afzender.email, FACTURATIE_LIMITS.email) &&
    isTekst(afzender.telefoon, FACTURATIE_LIMITS.telefoon) &&
    typeof bank.iban === "string" &&
    bank.iban.length <= 34 &&
    isTekst(bank.bic, 11) &&
    typeof bank.tenaamstelling === "string" &&
    bank.tenaamstelling.length <= FACTURATIE_LIMITS.naam &&
    typeof nummering.reeksFactuur === "string" &&
    REEKS_PATTERN.test(nummering.reeksFactuur) &&
    typeof nummering.reeksCredit === "string" &&
    REEKS_PATTERN.test(nummering.reeksCredit) &&
    isTekst(nummering.formaat, FACTURATIE_LIMITS.formaat, true) &&
    typeof nummering.startVolgnummer === "number" &&
    Number.isInteger(nummering.startVolgnummer) &&
    nummering.startVolgnummer >= 1 &&
    nummering.startVolgnummer <= FACTURATIE_LIMITS.volgnummer &&
    typeof betaling.standaardTermijnDagen === "number" &&
    Number.isInteger(betaling.standaardTermijnDagen) &&
    betaling.standaardTermijnDagen >= 0 &&
    betaling.standaardTermijnDagen <= FACTURATIE_LIMITS.betaaltermijnDagen &&
    isTekst(betaling.betaalinstructie, FACTURATIE_LIMITS.betaalinstructie) &&
    isBtwTarief(btw.standaardTarief) &&
    typeof btw.vrijstellingTekst === "string" &&
    btw.vrijstellingTekst.length <= FACTURATIE_LIMITS.vrijstellingTekst &&
    isTekst(presentatie.voettekst, FACTURATIE_LIMITS.voettekst) &&
    typeof presentatie.toonLogo === "boolean" &&
    (presentatie.logoPad === undefined || typeof presentatie.logoPad === "string") &&
    (presentatie.logoHash === undefined || typeof presentatie.logoHash === "string") &&
    typeof instellingen.updatedAt === "string" &&
    !Number.isNaN(Date.parse(instellingen.updatedAt))
  );
}

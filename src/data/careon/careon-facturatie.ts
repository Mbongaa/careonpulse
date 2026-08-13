import type {
  BtwTarief,
  ContactSoort,
  FacturatieContact,
  FacturatieInstellingen,
  Factuur,
  FactuurStatus,
  FactuurTemplate,
} from "@/lib/careon-facturatie/types";

// Facturatie — client-requested beheerdersmodule (handoff 15). Deze pagina's
// zijn NIET onderdeel van de originele audit; de demo-seeds hieronder zijn
// voorbeelddata voor demo-modus. In productie start de registratie leeg en
// vult de beheerder haar zelf; opslag is centraal (Supabase) met een
// localStorage-demo-pad (B12).

export const FACTURATIE_PAGE_META = {
  overzicht: { title: "Facturen", sub: "Facturen opstellen, uitreiken en archiveren." },
  factuur: { title: "Factuur", sub: "Stel de factuur samen; het voorbeeld rechts is de definitieve pdf." },
  contacten: { title: "Contacten", sub: "Klanten, verzekeraars, gemeenten en medewerkers." },
  instellingen: { title: "Facturatie-instellingen", sub: "Bedrijfsgegevens, nummerreeks, btw en betaaltermijn." },
} as const;

export const FACTUUR_STATUS_LABELS: Record<FactuurStatus, string> = {
  concept: "Concept",
  definitief: "Definitief",
  verzonden: "Verzonden",
  betaald: "Betaald",
  gecrediteerd: "Gecrediteerd",
};

export const CONTACT_SOORT_LABELS: Record<ContactSoort, string> = {
  organisatie: "Organisatie",
  particulier: "Particulier",
  verzekeraar: "Verzekeraar",
  gemeente: "Gemeente",
  medewerker: "Medewerker",
};

export const BTW_TARIEF_LABELS: Record<BtwTarief, string> = {
  vrijgesteld: "Vrijgesteld",
  "0": "0%",
  "9": "9%",
  "21": "21%",
};

// Vrijstellingsteksten (art. 35a lid 1 sub l — BT-120). Default is de
// GGZ-vrijstelling; altijd bewerkbaar per organisatie én per factuur.
export const VRIJSTELLING_PRESETS = [
  {
    id: "ggz-11g",
    label: "Medische vrijstelling (art. 11-1-g)",
    tekst:
      "Vrijgesteld van btw op grond van artikel 11, lid 1, onderdeel g, sub 1° van de Wet op de omzetbelasting 1968 (medische vrijstelling).",
  },
  {
    id: "intramuraal-11c",
    label: "Intramurale zorg (art. 11-1-c)",
    tekst: "Vrijgesteld van btw op grond van artikel 11, lid 1, onderdeel c van de Wet op de omzetbelasting 1968.",
  },
  {
    id: "eu-132",
    label: "EU-verwijzing (Btw-richtlijn)",
    tekst: "Vrijgesteld van btw — artikel 132, lid 1, onder c, Btw-richtlijn 2006/112/EG.",
  },
  {
    id: "kor",
    label: "Kleineondernemersregeling",
    tekst: "Vrijgesteld van btw op grond van de kleineondernemersregeling (artikel 25 Wet op de omzetbelasting 1968).",
  },
  { id: "verlegd", label: "Btw verlegd", tekst: "Btw verlegd." },
] as const;

export const DEFAULT_VRIJSTELLING_TEKST = VRIJSTELLING_PRESETS[0].tekst;

/**
 * Ingebouwd sjabloon "Careon Group" — 1:1 naar het geïmporteerde ontwerp
 * "Factuur Careon Group.dc.html" (claude.ai/design-project 8c721b90):
 * merkgradient, tagline "Technology · Growth · Care", meegeleverd logo
 * (public/branding/careon-group-logo.png + pdf/assets), btw 21%. KvK/btw-id/
 * IBAN zijn de plaatshouders uit het ontwerp — de klant vult de echte
 * gegevens in op de sjabloon-instellingen.
 */
export const CAREONGROUP_TEMPLATE: FactuurTemplate = {
  id: "careongroup",
  naam: "Careon Group",
  tagline: "Technology · Growth · Care",
  afzender: {
    statutaireNaam: "Careon Group B.V.",
    adresRegel1: "",
    postcode: "",
    plaats: "",
    land: "NL",
    kvkNummer: "12345678",
    btwId: "NL001234567B01",
    email: "info@careongroup.nl",
  },
  bank: { iban: "NL00 BANK 0123 4567 89", tenaamstelling: "Careon Group B.V." },
  nummering: { reeksFactuur: "F", reeksCredit: "C", formaat: "{reeks}{jaar}-{nummer:4}", startVolgnummer: 1 },
  betaling: {
    standaardTermijnDagen: 30,
    betaalinstructie: "Gelieve het totaalbedrag binnen 30 dagen over te maken, onder vermelding van het factuurnummer.",
  },
  btw: { standaardTarief: "21", vrijstellingTekst: DEFAULT_VRIJSTELLING_TEKST },
  presentatie: { toonLogo: true, logoBron: "careongroup" },
};

/**
 * Startstand voor een organisatie zónder eigen instellingen (productie):
 * één neutraal startsjabloon met VOLLEDIG lege identiteit — geen naam, KvK,
 * btw-id, IBAN, logo of tagline. De ontwerp-plaatshouders van
 * CAREONGROUP_TEMPLATE ("Careon Group B.V.", KvK 12345678, IBAN NL00 …)
 * mogen hier nooit in: de art. 35a-validator toetst alleen op aanwezigheid,
 * dus elk vooringevuld identiteitsveld zou een verse organisatie een
 * onwijzigbare factuur onder andermans identiteit laten uitreiken
 * (auditbevinding 13-08). Het ontwerp-sjabloon mét plaatshouders bestaat
 * alleen in de demo. Btw start vrijgesteld (§3.1 + klantantwoord V12);
 * het id blijft "careongroup" zodat sjabloonverwijzingen stabiel zijn.
 */
export const EMPTY_FACTURATIE_INSTELLINGEN: FacturatieInstellingen = {
  templates: [
    {
      id: "careongroup",
      naam: "Standaardsjabloon",
      afzender: { statutaireNaam: "", adresRegel1: "", postcode: "", plaats: "", land: "NL", kvkNummer: "" },
      bank: { iban: "", tenaamstelling: "" },
      nummering: { ...CAREONGROUP_TEMPLATE.nummering },
      betaling: { ...CAREONGROUP_TEMPLATE.betaling },
      btw: { standaardTarief: "vrijgesteld", vrijstellingTekst: DEFAULT_VRIJSTELLING_TEKST },
      presentatie: { toonLogo: false },
    },
  ],
  standaardTemplateId: "careongroup",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

// Vaste seed-datum: demo blijft deterministisch (ook voor e2e-assertions).
const SEED_UPDATED_AT = "2026-07-01T09:00:00.000Z";

/** Fictieve demo-afzender van de tweede demo-template (geen echte KvK/IBAN). */
const TGC_TEMPLATE: FactuurTemplate = {
  id: "tgc-groep",
  naam: "TGC Groep",
  afzender: {
    statutaireNaam: "TGC Groep B.V.",
    adresRegel1: "Voorbeeldstraat 12",
    postcode: "5038 AA",
    plaats: "Tilburg",
    land: "NL",
    kvkNummer: "12345678",
    agbCode: "22-220000",
    email: "administratie@tgcgroep.nl",
    telefoon: "013 - 123 45 67",
  },
  bank: { iban: "NL02ABNA0123456789", bic: "ABNANL2A", tenaamstelling: "TGC Groep B.V." },
  nummering: { reeksFactuur: "F", reeksCredit: "C", formaat: "{reeks}{jaar}-{nummer:4}", startVolgnummer: 1 },
  betaling: {
    standaardTermijnDagen: 30,
    betaalinstructie: "Gelieve het totaalbedrag binnen 30 dagen over te maken o.v.v. het factuurnummer.",
  },
  btw: { standaardTarief: "vrijgesteld", vrijstellingTekst: DEFAULT_VRIJSTELLING_TEKST },
  presentatie: { voettekst: "KvK 12345678 · IBAN NL02ABNA0123456789", toonLogo: false },
};

/**
 * Demo: het ingebouwde Careon Group-sjabloon (mét ingevulde plaatshouder-
 * adresgegevens zodat de demo daadwerkelijk kan uitreiken) plus het
 * TGC-sjabloon — zo demonstreert de sjabloonlijst direct meerdere profielen.
 */
export const DEMO_FACTURATIE_INSTELLINGEN: FacturatieInstellingen = {
  templates: [
    {
      ...CAREONGROUP_TEMPLATE,
      afzender: {
        ...CAREONGROUP_TEMPLATE.afzender,
        adresRegel1: "Stationsplein 1",
        postcode: "5038 CB",
        plaats: "Tilburg",
      },
    },
    TGC_TEMPLATE,
  ],
  standaardTemplateId: "careongroup",
  updatedAt: SEED_UPDATED_AT,
};

export const DEMO_CONTACTEN: FacturatieContact[] = [
  {
    id: "demo-contact-zorgpartner",
    soort: "organisatie",
    bron: "handmatig",
    naam: "Zorggroep De Linde B.V.",
    contactpersoon: "Mw. H. Peters",
    email: "administratie@zorggroepdelinde.nl",
    telefoon: "013 - 987 65 43",
    adresRegel1: "Lindelaan 4",
    postcode: "5038 CD",
    plaats: "Tilburg",
    land: "NL",
    kvkNummer: "87654321",
    btwId: "NL876543210B01",
    betaaltermijnDagen: 30,
    referentie: "Overeenkomst detachering 2026",
    archief: false,
    updatedAt: SEED_UPDATED_AT,
  },
  {
    id: "demo-contact-dsw",
    soort: "verzekeraar",
    bron: "handmatig",
    naam: "DSW Zorgverzekeraar",
    email: "declaraties@dsw.nl",
    adresRegel1: "Postbus 173",
    postcode: "3100 AD",
    plaats: "Schiedam",
    land: "NL",
    uzovi: "7029",
    archief: false,
    updatedAt: SEED_UPDATED_AT,
  },
  {
    id: "demo-contact-gemeente",
    soort: "gemeente",
    bron: "handmatig",
    naam: "Gemeente Tilburg",
    adresRegel1: "Stadhuisplein 130",
    postcode: "5038 TC",
    plaats: "Tilburg",
    land: "NL",
    referentie: "Beschikking 2026-0412",
    notitie: "E-facturatie (UBL) vereist voor declaraties — pdf alleen ter info.",
    archief: false,
    updatedAt: SEED_UPDATED_AT,
  },
  {
    id: "demo-contact-particulier",
    soort: "particulier",
    bron: "handmatig",
    naam: "J. de Vries",
    email: "j.devries@example.nl",
    adresRegel1: "Kerkstraat 88",
    postcode: "4811 XC",
    plaats: "Breda",
    land: "NL",
    archief: false,
    updatedAt: SEED_UPDATED_AT,
  },
];

const DEMO_AFZENDER_SNAPSHOT = {
  templateId: "tgc-groep",
  templateNaam: "TGC Groep",
  statutaireNaam: "TGC Groep B.V.",
  adresRegel1: "Voorbeeldstraat 12",
  postcode: "5038 AA",
  plaats: "Tilburg",
  land: "NL",
  kvkNummer: "12345678",
  agbCode: "22-220000",
  email: "administratie@tgcgroep.nl",
  telefoon: "013 - 123 45 67",
  iban: "NL02ABNA0123456789",
  bic: "ABNANL2A",
  tenaamstelling: "TGC Groep B.V.",
  betaalinstructie: "Gelieve het totaalbedrag binnen 30 dagen over te maken o.v.v. het factuurnummer.",
  voettekst: "KvK 12345678 · IBAN NL02ABNA0123456789",
  toonLogo: false,
} as const;

// Totalen hieronder zijn met berekenTotalen() nagerekend; verify:careon
// asserteert die consistentie zodat de seed nooit van de rekenregels afwijkt.
export const DEMO_FACTUREN: Factuur[] = [
  {
    id: "demo-factuur-1",
    status: "verzonden",
    soort: "factuur",
    reeks: "F",
    jaar: 2026,
    volgnummer: 1,
    nummer: "F2026-0001",
    factuurdatum: "2026-06-05",
    prestatieVan: "2026-05-01",
    prestatieTot: "2026-05-31",
    vervaldatum: "2026-07-05",
    betaaltermijnDagen: 30,
    contactId: "demo-contact-zorgpartner",
    afnemer: {
      naam: "Zorggroep De Linde B.V.",
      contactpersoon: "Mw. H. Peters",
      adresRegel1: "Lindelaan 4",
      postcode: "5038 CD",
      plaats: "Tilburg",
      land: "NL",
      kvkNummer: "87654321",
      btwId: "NL876543210B01",
      email: "administratie@zorggroepdelinde.nl",
    },
    afzender: { ...DEMO_AFZENDER_SNAPSHOT },
    uwKenmerk: "Overeenkomst detachering 2026",
    regels: [
      {
        id: "demo-regel-1a",
        omschrijving: "Detachering GZ-psycholoog, mei 2026",
        aantal: 32,
        eenheid: "uur",
        stukprijsCent: 9_500,
        btwTarief: "21",
        btwCategorie: "S",
      },
    ],
    btwTotalen: [{ tarief: "21", categorie: "S", grondslagCent: 304_000, btwCent: 63_840 }],
    subtotaalCent: 304_000,
    btwCent: 63_840,
    totaalCent: 367_840,
    valuta: "EUR",
    betaaldOp: null,
    pdfPad: null,
    mailStatus: "niet_verzonden",
    createdAt: "2026-06-05T10:00:00.000Z",
    updatedAt: "2026-06-05T10:05:00.000Z",
  },
  {
    id: "demo-factuur-2",
    status: "betaald",
    soort: "factuur",
    reeks: "F",
    jaar: 2026,
    volgnummer: 2,
    nummer: "F2026-0002",
    factuurdatum: "2026-06-12",
    prestatieVan: "2026-05-01",
    prestatieTot: "2026-05-31",
    vervaldatum: "2026-07-12",
    betaaltermijnDagen: 30,
    contactId: "demo-contact-particulier",
    afnemer: {
      naam: "J. de Vries",
      adresRegel1: "Kerkstraat 88",
      postcode: "4811 XC",
      plaats: "Breda",
      land: "NL",
      email: "j.devries@example.nl",
    },
    afzender: { ...DEMO_AFZENDER_SNAPSHOT },
    regels: [
      {
        id: "demo-regel-2a",
        omschrijving: "Niet-vergoede consulten SGGZ, mei 2026",
        aantal: 3,
        eenheid: "sessie",
        stukprijsCent: 11_000,
        btwTarief: "vrijgesteld",
        btwCategorie: "E",
      },
    ],
    btwTotalen: [{ tarief: "vrijgesteld", categorie: "E", grondslagCent: 33_000, btwCent: 0 }],
    vrijstellingTekst: DEFAULT_VRIJSTELLING_TEKST,
    subtotaalCent: 33_000,
    btwCent: 0,
    totaalCent: 33_000,
    valuta: "EUR",
    betaaldOp: "2026-06-24",
    pdfPad: null,
    mailStatus: "niet_verzonden",
    createdAt: "2026-06-12T09:30:00.000Z",
    updatedAt: "2026-06-24T14:00:00.000Z",
  },
  {
    id: "demo-factuur-3",
    status: "concept",
    soort: "factuur",
    reeks: "F",
    jaar: 2026,
    volgnummer: null,
    nummer: null,
    factuurdatum: null,
    prestatieVan: "2026-06-01",
    prestatieTot: "2026-06-30",
    vervaldatum: null,
    betaaltermijnDagen: 30,
    contactId: "demo-contact-zorgpartner",
    afnemer: {
      naam: "Zorggroep De Linde B.V.",
      contactpersoon: "Mw. H. Peters",
      adresRegel1: "Lindelaan 4",
      postcode: "5038 CD",
      plaats: "Tilburg",
      land: "NL",
      kvkNummer: "87654321",
      btwId: "NL876543210B01",
      email: "administratie@zorggroepdelinde.nl",
    },
    afzender: null,
    uwKenmerk: "Overeenkomst detachering 2026",
    regels: [
      {
        id: "demo-regel-3a",
        omschrijving: "Detachering GZ-psycholoog, juni 2026",
        aantal: 28,
        eenheid: "uur",
        stukprijsCent: 9_500,
        btwTarief: "21",
        btwCategorie: "S",
      },
      {
        id: "demo-regel-3b",
        omschrijving: "Cursus 'Signaleren van overbelasting' (incompany)",
        aantal: 1,
        eenheid: "stuk",
        stukprijsCent: 45_000,
        btwTarief: "21",
        btwCategorie: "S",
      },
    ],
    btwTotalen: [{ tarief: "21", categorie: "S", grondslagCent: 311_000, btwCent: 65_310 }],
    subtotaalCent: 311_000,
    btwCent: 65_310,
    totaalCent: 376_310,
    valuta: "EUR",
    betaaldOp: null,
    pdfPad: null,
    mailStatus: "niet_verzonden",
    createdAt: "2026-07-01T08:45:00.000Z",
    updatedAt: SEED_UPDATED_AT,
  },
];

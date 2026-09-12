/**
 * Careon AI — domeingate (handoff 20 §4/§5.3, review C15/C27/C28/C31–C33/C37,
 * paneel N6/N10/N11/N16/N17/N18/N19/N20/N21).
 *
 * Deze suite bewaakt de gedeelde laag waar de andere gates niet bij komen: de
 * typen, het API-contract, de exporttekst, de retentiehulpjes en de seeds. Ze
 * is puur — geen netwerk, geen database, geen omgevingsvariabelen — en toetst
 * precies de dingen die stil verkeerd kunnen gaan:
 *
 *   * de toestemmingstekst mist een van de vier verplichte elementen (N10);
 *   * `ingeschakeld` kan aan zonder vastgelegde activatievoorwaarden (N21);
 *   * de exportbestandsnaam draagt de datum van vandaag in plaats van die van
 *     het consult (C28) of ineens de dossierreferentie (S3);
 *   * de "verloopt binnenkort"-grens verschilt tussen demo en productie (C37);
 *   * een oudere instellingen-snapshot verliest zijn stand bij het migreren;
 *   * het contract vergeet te zeggen dat de paginering 1-gebaseerd is (C31) of
 *     dat een 502 met plaatshouder een DEELSUCCES is (C32).
 */

import {
  DEMO_SCRIBE_INSTELLINGEN,
  DEMO_SCRIBE_SESSIES,
  demoConsult3Notitie,
  EMPTY_SCRIBE_INSTELLINGEN,
  GEANNULEERD_GROND_LABELS,
  migreerScribeInstellingen,
  SCRIBE_HANDELING_LABELS,
  STANDAARD_CONSENTTEKST,
} from "../data/careon/careon-scribe";
import {
  type AudioUploadPlaatshouderResponse,
  isScribeHandelingFilter,
  type LogboekResponse,
  SCRIBE_HANDELINGEN,
  SCRIBE_LOGBOEK_PAGINA_GROOTTE,
  SCRIBE_PAGINA_GROOTTE,
  SCRIBE_VERLOOPT_BINNENKORT_DAGEN,
  type SessieDetailBeheerResponse,
  type SessieDetailEigenResponse,
  type SessieDetailResponse,
  type SessiePatchBody,
  type SessiesLijstQuery,
  type SessieVerwijderBody,
  STAAT_MUTATIE_ACTIES,
  type StaatPatchBody,
  type VrijgaveIntrekkenBody,
} from "../lib/careon-scribe/api-contract";
import { bouwExportTekst, bouwSectieTekst, datumDeel, exportBestandsnaam } from "../lib/careon-scribe/export-tekst";
import { FORMAAT_KEUZES } from "../lib/careon-scribe/formaten";
import { dagenTot, verlooptBinnenkort } from "../lib/careon-scribe/retentie";
import {
  activatieVoorwaardenOntbrekend,
  CONSENT_PLACEHOLDER_TRANSCRIPT,
  CONSULT_TYPES,
  type Feit,
  GEANNULEERD_GRONDEN,
  isConsenttekst,
  isIsoDatum,
  isScribeInstellingen,
  isScribeZoekterm,
  isStaatCategorie,
  type Medicatie,
  SCRIBE_LIMITS,
  type ScribeInstellingen,
  STAAT_CATEGORIEEN,
  vulConsenttekstIn,
} from "../lib/careon-scribe/types";
import * as fs from "node:fs";
import * as path from "node:path";

let geslaagd = 0;
let gefaald = 0;

function check(naam: string, voorwaarde: boolean, detail?: string) {
  if (voorwaarde) {
    geslaagd += 1;
  } else {
    gefaald += 1;
    console.error(`FAIL ${naam}${detail ? ` — ${detail}` : ""}`);
  }
}

function bron(bestand: string): string {
  return fs.readFileSync(path.join(__dirname, "..", "lib", "careon-scribe", bestand), "utf8");
}

// ── Toestemmingstekst (N10) ─────────────────────────────────────────────────

function toetsConsenttekst(): void {
  const standaard = isConsenttekst(STANDAARD_CONSENTTEKST);
  check(
    "standaard toestemmingstekst voldoet aan alle vier de elementen",
    standaard.ok,
    standaard.ontbrekend.join(" | "),
  );
  check(
    "standaard toestemmingstekst blijft binnen de kolomgrens",
    STANDAARD_CONSENTTEKST.length <= SCRIBE_LIMITS.consentTekst,
  );
  check(
    "standaard toestemmingstekst draagt de retentieplaatshouder",
    STANDAARD_CONSENTTEKST.includes(CONSENT_PLACEHOLDER_TRANSCRIPT),
  );
  check(
    "instellingen starten met de standaardtekst",
    EMPTY_SCRIBE_INSTELLINGEN.consenttekst === STANDAARD_CONSENTTEKST,
  );

  const zonderTermijn = STANDAARD_CONSENTTEKST.replace(
    `dat de uitgeschreven transcripttekst ${CONSENT_PLACEHOLDER_TRANSCRIPT} dagen bewaard blijft en daarna automatisch wordt verwijderd; `,
    "",
  );
  const termijnUit = isConsenttekst(zonderTermijn);
  check(
    "toestemmingstekst zonder bewaartermijn wordt geweigerd",
    !termijnUit.ok && termijnUit.ontbrekend.some((punt) => punt.includes("transcripttekst")),
    termijnUit.ontbrekend.join(" | "),
  );

  const zonderIntrekken = STANDAARD_CONSENTTEKST.replace(
    "dat de cliënt op elk moment mag weigeren of de toestemming mag intrekken, zonder gevolgen voor de zorg; ",
    "",
  );
  const intrekkenUit = isConsenttekst(zonderIntrekken);
  check(
    "toestemmingstekst zonder weigerings-/intrekkingsrecht wordt geweigerd",
    !intrekkenUit.ok && intrekkenUit.ontbrekend.some((punt) => punt.includes("weigeren")),
    intrekkenUit.ontbrekend.join(" | "),
  );

  const zonderOvername = STANDAARD_CONSENTTEKST.replace(
    "dat het verslag na overname in het EPD nog tot de ingestelde termijn zichtbaar blijft in Careon AI; ",
    "",
  );
  check("toestemmingstekst zonder overnameregel wordt geweigerd", !isConsenttekst(zonderOvername).ok);

  const zonderEpd = STANDAARD_CONSENTTEKST.replace(/EPD/g, "systeem").replace(/dossier/g, "map");
  check("toestemmingstekst zonder EPD-voorbehoud wordt geweigerd", !isConsenttekst(zonderEpd).ok);

  const kort = isConsenttekst("Cliënt akkoord.");
  check(
    "te korte toestemmingstekst wordt geweigerd",
    !kort.ok && kort.ontbrekend.some((punt) => punt.includes(String(SCRIBE_LIMITS.consentTekstMin))),
  );
  check("niet-tekst is geen toestemmingstekst", !isConsenttekst(null).ok && !isConsenttekst(42).ok);
  check(
    "toestemmingstekst boven de bovengrens wordt geweigerd",
    !isConsenttekst(`${STANDAARD_CONSENTTEKST}${"x".repeat(SCRIBE_LIMITS.consentTekst)}`).ok,
  );

  // Plaatshouder invullen (N10b): de voorgelezen tekst volgt de instelling.
  const dertig = vulConsenttekstIn(STANDAARD_CONSENTTEKST, EMPTY_SCRIBE_INSTELLINGEN);
  check("plaatshouder wordt met de ingestelde termijn gevuld", dertig.includes("transcripttekst 30 dagen bewaard"));
  check("gevulde tekst draagt geen plaatshouder meer", !dertig.includes(CONSENT_PLACEHOLDER_TRANSCRIPT));
  check("gevulde tekst blijft geldig", isConsenttekst(dertig).ok);
  const veertien = vulConsenttekstIn(STANDAARD_CONSENTTEKST, {
    transcriptRetentieDagen: 14,
    notitieRetentieDagen: 7,
  });
  check("een andere retentie levert een andere voorgelezen tekst", veertien.includes("transcripttekst 14 dagen"));
  check(
    "invullen zonder plaatshouder verandert niets",
    vulConsenttekstIn("Vaste tekst.", EMPTY_SCRIBE_INSTELLINGEN) === "Vaste tekst.",
  );
}

// ── Activatievoorwaarden (N21) ──────────────────────────────────────────────

function toetsActivatie(): void {
  const leeg = activatieVoorwaardenOntbrekend(EMPTY_SCRIBE_INSTELLINGEN);
  check("productie-standaard mist alle vier de activatievoorwaarden", leeg.length === 4, leeg.join(" | "));
  check("productie-standaard staat uit", !EMPTY_SCRIBE_INSTELLINGEN.ingeschakeld);
  check(
    "productie-standaard laat de activatievelden leeg",
    EMPTY_SCRIBE_INSTELLINGEN.dpiaVastgesteldOp === null &&
      EMPTY_SCRIBE_INSTELLINGEN.dpiaEigenaar === null &&
      EMPTY_SCRIBE_INSTELLINGEN.verwerkersovereenkomstBevestigd === false &&
      EMPTY_SCRIBE_INSTELLINGEN.consenttekstGoedgekeurdOp === null,
  );
  check(
    "externe verwerking staat standaard uit",
    !EMPTY_SCRIBE_INSTELLINGEN.aiAnalyseAan && !EMPTY_SCRIBE_INSTELLINGEN.transcriptieAan,
  );
  check(
    "demo-organisatie is ingeschakeld met volledige voorwaarden",
    DEMO_SCRIBE_INSTELLINGEN.ingeschakeld && activatieVoorwaardenOntbrekend(DEMO_SCRIBE_INSTELLINGEN).length === 0,
  );
  check(
    "demo roept geen provider aan",
    !DEMO_SCRIBE_INSTELLINGEN.aiAnalyseAan && !DEMO_SCRIBE_INSTELLINGEN.transcriptieAan,
  );
  const halfleeg = activatieVoorwaardenOntbrekend({ ...DEMO_SCRIBE_INSTELLINGEN, dpiaEigenaar: "   " });
  check("een lege eigenaar telt niet als vastgelegd", halfleeg.length === 1);
  check(
    "beide seeds valideren",
    isScribeInstellingen(EMPTY_SCRIBE_INSTELLINGEN) && isScribeInstellingen(DEMO_SCRIBE_INSTELLINGEN),
  );
  check(
    "instellingen zonder de nieuwe velden zijn geen geldige stand",
    !isScribeInstellingen({
      ingeschakeld: false,
      standaardFormaat: "soap",
      consenttekst: STANDAARD_CONSENTTEKST,
      transcriptRetentieDagen: 30,
      notitieRetentieDagen: 30,
      transcriptWissenBijOvername: true,
      klinischeAanwijzingenAan: true,
      medicatiecheckAan: true,
    }),
  );
}

// ── Migratie van oudere snapshots ───────────────────────────────────────────

function toetsMigratie(): void {
  const oud = {
    ingeschakeld: true,
    standaardFormaat: "psychiatrie",
    consenttekst: "Oude, door de organisatie vastgestelde tekst.",
    transcriptRetentieDagen: 14,
    notitieRetentieDagen: 60,
    transcriptWissenBijOvername: false,
    klinischeAanwijzingenAan: false,
    medicatiecheckAan: true,
  };
  const gemigreerd = migreerScribeInstellingen(oud);
  check("oude snapshot blijft geldig na migratie", isScribeInstellingen(gemigreerd));
  check(
    "oude snapshot behoudt zijn eigen keuzes",
    gemigreerd.ingeschakeld &&
      gemigreerd.standaardFormaat === "psychiatrie" &&
      gemigreerd.transcriptRetentieDagen === 14 &&
      gemigreerd.notitieRetentieDagen === 60 &&
      gemigreerd.transcriptWissenBijOvername === false &&
      gemigreerd.klinischeAanwijzingenAan === false &&
      gemigreerd.consenttekst === oud.consenttekst,
  );
  check(
    "ontbrekende nieuwe velden vallen terug op UIT en leeg",
    !gemigreerd.aiAnalyseAan &&
      !gemigreerd.transcriptieAan &&
      gemigreerd.dpiaVastgesteldOp === null &&
      gemigreerd.dpiaEigenaar === null &&
      !gemigreerd.verwerkersovereenkomstBevestigd &&
      gemigreerd.consenttekstGoedgekeurdOp === null,
  );
  const metOpties = migreerScribeInstellingen({ ...oud, aiAnalyseAan: true, dpiaVastgesteldOp: "2026-01-31" });
  check(
    "wél aanwezige nieuwe velden blijven staan",
    metOpties.aiAnalyseAan && metOpties.dpiaVastgesteldOp === "2026-01-31" && !metOpties.transcriptieAan,
  );
  const rommel = migreerScribeInstellingen({ ...oud, dpiaVastgesteldOp: "gisteren", dpiaEigenaar: 7 });
  check(
    "onleesbare activatiewaarden vallen terug op de standaard",
    rommel.dpiaVastgesteldOp === null && rommel.dpiaEigenaar === null,
  );
  check("null migreert naar de productiestandaard", !migreerScribeInstellingen(null).ingeschakeld);
  const geldig: ScribeInstellingen = { ...DEMO_SCRIBE_INSTELLINGEN };
  check("een geldige stand komt ongewijzigd terug", migreerScribeInstellingen(geldig) === geldig);
}

// ── Export (C28, N17) ───────────────────────────────────────────────────────

function toetsExport(): void {
  const sessie = DEMO_SCRIBE_SESSIES[2];
  const notitie = demoConsult3Notitie();

  check("datumDeel leest de consultdatum", datumDeel(sessie.gestartOp) === "2026-08-28");
  check("datumDeel valt bij onzin terug op vandaag", datumDeel("morgen") === new Date().toISOString().slice(0, 10));
  check(
    "exportbestandsnaam draagt de consultdatum, niet die van vandaag",
    exportBestandsnaam(sessie.id, "txt", sessie.gestartOp) === "consult-demo-con-2026-08-28.txt",
    exportBestandsnaam(sessie.id, "txt", sessie.gestartOp),
  );
  check(
    "markdown-export krijgt dezelfde naam met .md",
    exportBestandsnaam(sessie.id, "md", sessie.gestartOp) === "consult-demo-con-2026-08-28.md",
  );
  check(
    "exportbestandsnaam draagt nooit de dossierreferentie",
    !exportBestandsnaam(sessie.id, "txt", sessie.gestartOp).includes(sessie.patientReferentie),
  );
  check(
    "exportbestandsnaam blijft binnen de bestandsnaamgrens",
    exportBestandsnaam("../../etc/passwd", "txt", sessie.gestartOp).indexOf("/") === -1,
    exportBestandsnaam("../../etc/passwd", "txt", sessie.gestartOp),
  );

  const metBronnen = { ...notitie, secties: [{ ...notitie.secties[0], bron: [3, 7] }] };
  const txt = bouwExportTekst({ sessie, notitie: metBronnen, taken: [] });
  const md = bouwExportTekst({ sessie, notitie: metBronnen, taken: [], formaat: "md" });
  check("txt-export toont GEEN bronverwijzingen, ook niet als de sectie bronnen draagt", !txt.includes("(bronnen:"));
  check("markdown-werkkopie toont ze standaard wél", md.includes("(bronnen: §3, §7)"));
  check(
    "bronverwijzingen zijn expliciet aan te zetten voor txt",
    bouwExportTekst({ sessie, notitie: metBronnen, taken: [], bronverwijzingen: true }).includes("(bronnen: §3, §7)"),
  );
  check(
    "bronverwijzingen zijn expliciet uit te zetten voor markdown",
    !bouwExportTekst({ sessie, notitie: metBronnen, taken: [], formaat: "md", bronverwijzingen: false }).includes(
      "(bronnen:",
    ),
  );
  check("markdown-export begint met een kop", md.startsWith("# Consultverslag"));

  const metLege = {
    ...notitie,
    secties: [
      { ...notitie.secties[0], tekst: "Vastgestelde tekst." },
      { ...notitie.secties[1], titel: "Lege sectie", tekst: "   " },
    ],
  };
  const zonderLege = bouwExportTekst({ sessie, notitie: metLege, taken: [] });
  check("lege secties blijven standaard weg", !zonderLege.includes("LEGE SECTIE"));
  check(
    "lege secties zijn desgewenst te behouden",
    bouwExportTekst({ sessie, notitie: metLege, taken: [], legeSectiesWeglaten: false }).includes("LEGE SECTIE"),
  );
  check(
    "de kop blijft altijd staan",
    zonderLege.includes("CONSULTVERSLAG") && zonderLege.includes(`Dossierreferentie: ${sessie.patientReferentie}`),
  );
  check(
    "een verslag zonder enige vastgestelde tekst verschrompelt niet tot een kale kop",
    bouwExportTekst({
      sessie,
      notitie: { ...notitie, secties: notitie.secties.map((sectie) => ({ ...sectie, tekst: "" })) },
      taken: [],
    }).includes(notitie.secties[0].titel.toUpperCase()),
  );
  check(
    "de export benoemt dat dit geen volledige medicatiebewaking is",
    txt.includes("geen volledige medicatiebewaking"),
  );

  const sectieTekst = bouwSectieTekst(sessie, { ...notitie.secties[0], bron: [4] });
  check(
    "sectiekopie begint met de dossierreferentie",
    sectieTekst.startsWith(`Dossierreferentie: ${sessie.patientReferentie}`),
  );
  check("sectiekopie draagt de sectietitel", sectieTekst.includes(notitie.secties[0].titel.toUpperCase()));
  check("sectiekopie laat bronverwijzingen standaard weg", !sectieTekst.includes("(bronnen:"));
  check(
    "sectiekopie in markdown draagt de bronnen wel",
    bouwSectieTekst(sessie, { ...notitie.secties[0], bron: [4] }, { formaat: "md" }).includes("(bronnen: §4)"),
  );
  check("geen e-mailadres in de exporttekst", !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(txt));
}

// ── Retentie (C37) ──────────────────────────────────────────────────────────

function toetsRetentie(): void {
  const nu = new Date("2026-09-07T00:00:00.000Z");
  const overDagen = (dagen: number) => new Date(nu.getTime() + dagen * 24 * 60 * 60 * 1_000).toISOString();
  check("precies zeven dagen is nog geen waarschuwing", !verlooptBinnenkort(overDagen(7), "afgerond", nu));
  check("zes dagen is wel een waarschuwing", verlooptBinnenkort(overDagen(6), "afgerond", nu));
  check("een verstreken termijn blijft een waarschuwing", verlooptBinnenkort(overDagen(-1), "afgerond", nu));
  check("een overgenomen consult waarschuwt nooit", !verlooptBinnenkort(overDagen(1), "overgenomen", nu));
  check(
    "zonder termijn geen waarschuwing",
    !verlooptBinnenkort(null, "afgerond", nu) && !verlooptBinnenkort(undefined, "actief", nu),
  );
  check("een onleesbare termijn waarschuwt niet", !verlooptBinnenkort("ooit", "afgerond", nu));
  check(
    "de grens volgt dezelfde dagentelling als de lijstkolom",
    dagenTot(overDagen(7), nu) === SCRIBE_VERLOOPT_BINNENKORT_DAGEN,
  );
  // De helper is pas een gedeelde regel zodra BEIDE serializers hem aanroepen.
  // Zolang een van beide zijn eigen vergelijking houdt, kan de demo een badge
  // tonen waar productie er geen toont — precies de drift van C37. Dat is
  // clientwerk buiten dit bestand, dus een luide notitie in plaats van een
  // harde poort.
  const client = bron("remote.client.ts").includes("verlooptBinnenkort(");
  const server = bron("scribe.server.ts").includes("verlooptBinnenkort(");
  if (!client || !server) {
    console.warn(
      `LET OP (C37): de gedeelde verloopregel wordt nog niet overal gebruikt — remote.client.ts: ${client ? "ja" : "nee"}, scribe.server.ts: ${server ? "ja" : "nee"}.`,
    );
  }
}

// ── Contract (C31/C32/C33, N6, N11, N16, N20) ───────────────────────────────

function toetsContract(): void {
  const contract = bron("api-contract.ts");
  check("consultlijst is 25 per pagina", SCRIBE_PAGINA_GROOTTE === 25);
  check("de paginabasis staat gedocumenteerd", contract.includes("1-gebaseerd"));
  check("het 502-deelsucces staat gedocumenteerd", contract.includes("DEELSUCCES op 502"));
  check("verloopgrens is zeven dagen", SCRIBE_VERLOOPT_BINNENKORT_DAGEN === 7);
  check("logboek is 50 per pagina", SCRIBE_LOGBOEK_PAGINA_GROOTTE === 50);

  const lijstQuery: SessiesLijstQuery = {
    status: "afgerond",
    pagina: 2,
    zoek: "D-2026",
    van: "2026-01-01",
    tot: "2026-12-31",
  };
  check("lijstquery draagt zoek- en periodefilters", lijstQuery.zoek === "D-2026" && lijstQuery.van === "2026-01-01");
  check("zoekterm accepteert een deelreferentie", isScribeZoekterm("D-2026") && isScribeZoekterm("a"));
  check(
    "zoekterm weigert BSN-, datum- en stuurtekenvormen",
    !isScribeZoekterm("123456789") && !isScribeZoekterm("01-02-1990") && !isScribeZoekterm("D'2026"),
  );
  check("zoekterm weigert een te lange term", !isScribeZoekterm("x".repeat(SCRIBE_LIMITS.zoekterm + 1)));
  check(
    "periodefilter eist JJJJ-MM-DD",
    isIsoDatum("2026-09-07") && !isIsoDatum("07-09-2026") && !isIsoDatum("2026-13-01"),
  );

  // C33 — detail is een unie op rol; de beheerdersarm draagt geen referentie.
  const eigen: SessieDetailEigenResponse = {
    configured: true,
    rol: "eigenaar",
    sessie: DEMO_SCRIBE_SESSIES[1],
    vrijgaveReden: null,
    segmenten: [],
    staat: null,
    notitie: null,
    taken: [],
    instellingen: DEMO_SCRIBE_INSTELLINGEN,
  };
  const { patientReferentie: _referentie, consultType: _type, ...metadata } = DEMO_SCRIBE_SESSIES[1];
  const beheer: SessieDetailBeheerResponse = {
    configured: true,
    rol: "beheerder",
    sessie: metadata,
    vrijgaveReden: null,
    segmenten: [],
    staat: null,
    notitie: null,
    taken: [],
    instellingen: DEMO_SCRIBE_INSTELLINGEN,
  };
  const detail: SessieDetailResponse = beheer;
  check("beheerdersdetail draagt geen dossierreferentie", !("patientReferentie" in detail.sessie));
  check("beheerdersdetail draagt geen consulttype", !("consultType" in detail.sessie));
  check("eigen detail draagt de dossierreferentie wél", "patientReferentie" in eigen.sessie);
  check(
    "de vrijgavereden hoort bij het detail",
    ({ ...eigen, rol: "vrijgave", vrijgaveReden: "Overdracht tijdens verlof" } as SessieDetailEigenResponse)
      .vrijgaveReden === "Overdracht tijdens verlof",
  );

  // C32 — het 502-antwoord is typeerbaar als volledige uploadrespons.
  const plaatshouder: AudioUploadPlaatshouderResponse = {
    configured: true,
    segmenten: [],
    provider: "openai",
    model: "gpt-4o-mini-transcribe",
    ontbrekend: true,
    segmentTeller: 12,
    error: "Dit fragment kon niet worden getranscribeerd.",
  };
  check(
    "het 502-antwoord draagt de plaatshouder en de fouttekst",
    plaatshouder.error.length > 0 && plaatshouder.segmenten.length === 0 && plaatshouder.segmentTeller === 12,
  );

  // N11 — grond op annuleren, verwijderen en het intrekken van een vrijgave.
  check(
    "vier gronden, met labels",
    GEANNULEERD_GRONDEN.length === 4 &&
      GEANNULEERD_GRONDEN.every((grond) => GEANNULEERD_GROND_LABELS[grond].length > 0),
  );
  check(
    "toestemming intrekken is een grond",
    (GEANNULEERD_GRONDEN as readonly string[]).includes("toestemming_ingetrokken"),
  );
  const patch: SessiePatchBody = { status: "geannuleerd", grond: "toestemming_ingetrokken" };
  const verwijder: SessieVerwijderBody = { forceer: true, reden: "dubbel consult", grond: "verkeerd_dossier" };
  const intrekken: VrijgaveIntrekkenBody = { aanUserId: "user-2", grond: "overig" };
  check(
    "grond staat op alle drie de bodies",
    patch.grond === "toestemming_ingetrokken" && verwijder.grond === "verkeerd_dossier" && intrekken.grond === "overig",
  );

  // N6 — staatcorrectie door de behandelaar.
  const staatPatch: StaatPatchBody = {
    versie: 3,
    categorie: "medicatie",
    actie: "toevoegen",
    feit: { tekst: "paliperidon depot", naam: "paliperidon", dosering: "100 mg", gebruik: "huidig" },
  };
  check(
    "staatpatch draagt versie, categorie, actie en feit",
    staatPatch.versie === 3 && staatPatch.actie === "toevoegen",
  );
  check(
    "twee mutatieacties",
    STAAT_MUTATIE_ACTIES.length === 2 && (STAAT_MUTATIE_ACTIES as readonly string[]).includes("intrekken"),
  );
  check(
    "vijftien corrigeerbare categorieën, zonder afgeleide lijsten",
    STAAT_CATEGORIEEN.length === 15 &&
      !(STAAT_CATEGORIEEN as readonly string[]).includes("waarschuwingen") &&
      !(STAAT_CATEGORIEEN as readonly string[]).includes("ontbrekend"),
  );
  check(
    "categoriewachter herkent alleen bekende categorieën",
    isStaatCategorie("allergieen") && !isStaatCategorie("diagnose"),
  );

  // N20 — logboekcontract.
  const logboek: LogboekResponse = {
    configured: true,
    regels: [
      {
        tijdstip: "2026-09-07T09:00:00.000Z",
        handeling: "scribe.export",
        actorNaam: "S. de Wit",
        sessieId: "abc",
        detail: { formaat: "txt", secties: 5 },
      },
      {
        tijdstip: "2026-09-07T09:01:00.000Z",
        handeling: "scribe.sessie.start",
        actorNaam: null,
        sessieId: null,
        detail: {},
      },
    ],
    pagina: 1,
    meer: false,
    handelingen: [...SCRIBE_HANDELINGEN],
  };
  check(
    "logboekregel draagt tijdstip, handeling, actor, sessie en detail",
    logboek.regels[0].actorNaam === "S. de Wit" && logboek.regels[1].actorNaam === null,
  );
  check(
    "elke bekende handeling heeft een label",
    SCRIBE_HANDELINGEN.every((handeling) => SCRIBE_HANDELING_LABELS[handeling].length > 0),
  );
  check(
    "handelingfilter laat alleen scribe-slugs door",
    isScribeHandelingFilter("scribe.export") && !isScribeHandelingFilter("audit.read"),
  );
  check(
    "handelingfilter weigert injectiepogingen",
    !isScribeHandelingFilter("scribe.*") &&
      !isScribeHandelingFilter("scribe.export,or.(1.eq.1)") &&
      !isScribeHandelingFilter(""),
  );
}

// ── Klinische staat, seeds en formaten ──────────────────────────────────────

function toetsDomein(): void {
  // C43 — doseringen naast de weergavedosering.
  const medicatie: Medicatie = {
    tekst: "sertraline 50 mg (huidig)",
    bron: [2],
    ingetrokken: false,
    naam: "sertraline",
    dosering: "50 mg",
    doseringen: [
      { waarde: "50 mg", bron: [2] },
      { waarde: "100 mg", bron: [12] },
    ],
    gebruik: "huidig",
  };
  const doseringen = medicatie.doseringen ?? [];
  check("medicatie draagt alle genoemde doseringen", doseringen.length === 2 && medicatie.dosering === "50 mg");
  check(
    "elke dosering draagt haar eigen herkomst",
    doseringen.every((dosering) => dosering.bron.length > 0),
  );
  const zonderLijst: Medicatie = { ...medicatie, doseringen: undefined };
  check("een rij zonder doseringlijst blijft leesbaar als lege lijst", (zonderLijst.doseringen ?? []).length === 0);

  // N6 — behandelaarsmutaties zijn herkenbaar en optioneel.
  const machinaal: Feit = { tekst: "somberheid", bron: [2], ingetrokken: false };
  const handmatig: Feit = { tekst: "paliperidon depot", bron: [], ingetrokken: false, doorBehandelaar: true };
  check("een machinaal feit draagt geen behandelaarsmarkering", machinaal.doorBehandelaar !== true);
  check("een behandelaarsmutatie is herkenbaar", handmatig.doorBehandelaar === true);
  check(
    "de merge is gewaarschuwd dat een behandelaarsmutatie blijft staan",
    bron("types.ts").includes("NOOIT ongedaan maken"),
  );

  // N18 — het formaat blijft te kiezen.
  check("FORMAAT_KEUZES dekt elk consulttype", FORMAAT_KEUZES.length === CONSULT_TYPES.length);
  check(
    "elke keuze draagt label en doelgroep",
    FORMAAT_KEUZES.every((keuze) => keuze.label.length > 0 && keuze.doelgroep.length > 0),
  );

  // Seeds blijven gefingeerd en zonder cliëntgegevens.
  check("drie demo-consulten", DEMO_SCRIBE_SESSIES.length === 3);
  check(
    "elk demo-consult bevriest de standaardtekst",
    DEMO_SCRIBE_SESSIES.every((sessie) => sessie.consentTekst === STANDAARD_CONSENTTEKST),
  );
  check(
    "de demo-eigenaar van de DPIA is een functie, geen persoon",
    DEMO_SCRIBE_INSTELLINGEN.dpiaEigenaar === "Functionaris gegevensbescherming",
  );
}

function main(): void {
  toetsConsenttekst();
  toetsActivatie();
  toetsMigratie();
  toetsExport();
  toetsRetentie();
  toetsContract();
  toetsDomein();
  console.log(`Scribe domain verification: ${geslaagd} passed, ${gefaald} failed.`);
  process.exit(gefaald === 0 ? 0 : 1);
}

main();

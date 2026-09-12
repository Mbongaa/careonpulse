/**
 * Careon Scribe — serverzijde gate (handoff 20 §9).
 *
 * Toetst de PURE verzoekopbouw van de provideradapters en de context-agent:
 * geen netwerk, geen sleutel, geen database. Deze suite bewaakt precies de
 * dingen die je pas in productie zou merken:
 *
 *   * `verbose_json`/`timestamp_granularities` mogen NOOIT in het
 *     transcriptieverzoek staan — de gpt-4o-*-transcribe-modellen kennen ze
 *     niet en zouden de aanvraag laten falen; tijdstempels komen uit de
 *     clientmeting.
 *   * `store: false` in élk modelverzoek — consultinhoud mag niet bij de
 *     provider blijven staan.
 *   * De strict-JSON-schema's dragen een `name`, en de chat-terugval gebruikt
 *     de geneste `response_format.json_schema`-vorm.
 *   * De Vertex-URL wijst naar een EU-locatie en het model komt uit de
 *     omgeving (D6: nooit hard-coded).
 *   * Beoordelingssecties (★) staan niet in het verslagschema en het model
 *     kent geen `diagnose`.
 */

import {
  ANALYSE_SCHEMA_NAAM,
  ANALYSE_SYSTEEMPROMPT,
  analyseerSegmenten,
  bouwAnalyseVerzoek,
  bouwVerslagVerzoek,
  SCRIBE_ANALYSE_JSON_SCHEMA,
  SCRIBE_PROMPT_VERSION,
  VERSLAG_SCHEMA_NAAM,
  VERSLAG_SYSTEEMPROMPT,
} from "../lib/careon-scribe/agent.server";
import { beoordelingsSectieIds, vrijeSectieIds } from "../lib/careon-scribe/formaten";
import { legeKlinischeStaat } from "../lib/careon-scribe/klinische-staat";
import {
  bewaarBehandelaarsfeiten,
  bouwCorrectieFilter,
  bouwStaatFeit,
  pasStaatMutatieToe,
} from "../lib/careon-scribe/scribe.server";
import {
  bouwOpenAITranscriptieVerzoek,
  bouwServiceAccountJwt,
  bouwVertexTranscriptieVerzoek,
  leesOpenAITranscriptie,
  leesVertexSegmenten,
  plaatsTranscriptieSegmenten,
  scribeLive,
  TRANSCRIPTIE_CONTEXT_MAX,
  type TranscriptieVerzoek,
  transcriptieProvider,
  vertexConfiguratie,
} from "../lib/careon-scribe/transcriptie.server";
import type { Allergiefeit, ConsultType, Feit, KlinischeStaat, ScribeSegment } from "../lib/careon-scribe/types";
import { generateKeyPairSync } from "node:crypto";
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

function tekstVan(waarde: unknown): string {
  return JSON.stringify(waarde);
}

const VERZOEK: TranscriptieVerzoek = {
  audio: new Uint8Array([1, 2, 3, 4]),
  mime: "audio/wav",
  taal: "nl",
  contextTekst: "De patiënt gebruikt sertraline vijftig milligram.",
};

function toetsOpenAiTranscriptie(): void {
  const standaard = bouwOpenAITranscriptieVerzoek(VERZOEK, "gpt-4o-mini-transcribe");
  const alles = tekstVan(standaard);
  check("openai-transcriptie richt zich op /audio/transcriptions", standaard.url.endsWith("/audio/transcriptions"));
  check("openai-transcriptie stuurt fragment.wav", standaard.bestandsnaam === "fragment.wav");
  check("openai-transcriptie vraagt json", standaard.velden.response_format === "json");
  check("openai-transcriptie vraagt NOOIT verbose_json", !alles.includes("verbose_json"));
  check("openai-transcriptie vraagt NOOIT timestamp_granularities", !alles.includes("timestamp_granularities"));
  check("openai-transcriptie geeft de taal mee", standaard.velden.language === "nl");
  check("openai-transcriptie geeft medische context mee", standaard.velden.prompt.includes("medisch consult"));
  check("openai-transcriptie neemt de staart van het transcript mee", standaard.velden.prompt.includes("sertraline"));
  check("openai-transcriptie zet geen chunking zonder diarisatie", !("chunking_strategy" in standaard.velden));

  const lang = { ...VERZOEK, contextTekst: "x".repeat(2_000) };
  const begrensd = bouwOpenAITranscriptieVerzoek(lang, "gpt-4o-mini-transcribe");
  check(
    "openai-transcriptie begrenst de contextstaart",
    begrensd.velden.prompt.length <= TRANSCRIPTIE_CONTEXT_MAX + 200,
    `lengte ${begrensd.velden.prompt.length}`,
  );

  const diarisatie = bouwOpenAITranscriptieVerzoek(VERZOEK, "gpt-4o-transcribe-diarize");
  check("diarisatiemodel vraagt diarized_json", diarisatie.velden.response_format === "diarized_json");
  check("diarisatiemodel zet chunking op auto", diarisatie.velden.chunking_strategy === "auto");
  check("diarisatiemodel verstuurt geen niet-ondersteunde prompt", !("prompt" in diarisatie.velden));
  check("diarisatiemodel vraagt nog steeds geen verbose_json", !tekstVan(diarisatie).includes("verbose_json"));
  check("OpenAI bewaart letterlijke tekst", leesOpenAITranscriptie({ text: "synthetic" })[0]?.tekst === "synthetic");
  check("OpenAI lege tekst is expliciete stilte", leesOpenAITranscriptie({ text: "" }).length === 0);
  const tijden = leesOpenAITranscriptie({
    segments: [
      { text: "First turn.", speaker: "A", start: 0.125, end: 1.5 },
      { text: "Second turn.", speaker: "B", start: 3.25, end: 8.75 },
    ],
  });
  const geplaatst = plaatsTranscriptieSegmenten(tijden, 31_000, 9_000, 1_000);
  check(
    "provider turn boundaries survive instead of equal time division",
    geplaatst[0]?.beginMs === 31_125 &&
      geplaatst[0]?.eindMs === 32_500 &&
      geplaatst[1]?.beginMs === 34_250 &&
      geplaatst[1]?.eindMs === 39_750,
  );
  check(
    "provider turn timing never turns neutral voices into clinical roles",
    geplaatst.every((segment) => segment.spreker === "onbekend"),
  );
  const geschat = plaatsTranscriptieSegmenten(
    Array.from({ length: 20 }, () => ({ tekst: "Turn", spreker: "onbekend" as const })),
    31_000,
    9_000,
    1_000,
  );
  check(
    "fallback timing divides only new audio and never produces reversed intervals",
    geschat.every(
      (segment) => segment.beginMs >= 32_000 && segment.eindMs >= segment.beginMs && segment.eindMs <= 40_000,
    ) && geschat.at(-1)?.eindMs === 40_000,
  );
  const ongeldig = plaatsTranscriptieSegmenten(
    [{ tekst: "Turn", spreker: "onbekend", relatieveBeginMs: 10_000, relatieveEindMs: 9_000 }],
    31_000,
    9_000,
    1_000,
  );
  check(
    "invalid provider time uses bounded measured fragment timing",
    ongeldig[0]?.beginMs === 32_000 && ongeldig[0]?.eindMs === 40_000,
  );
  check(
    "neutraal providerlabel wordt geen verzonnen klinische rol",
    leesOpenAITranscriptie({ segments: [{ text: "synthetic", speaker: "A" }] })[0]?.spreker === "onbekend",
  );
  for (const antwoord of [null, {}, { text: 12 }, { segments: [null] }, { segments: [{ speaker: "A" }] }]) {
    let geweigerd = false;
    try {
      leesOpenAITranscriptie(antwoord);
    } catch {
      geweigerd = true;
    }
    check("ongeldig OpenAI-antwoord wordt verliesmelding, geen stilte", geweigerd);
  }
  const engels = bouwOpenAITranscriptieVerzoek({ ...VERZOEK, taal: "en" });
  check(
    "Engelse transcriptie krijgt Engelse context",
    engels.velden.prompt.startsWith("English medical") && engels.velden.language === "en",
  );
}

function toetsVertexTranscriptie(): void {
  const opbouw = bouwVertexTranscriptieVerzoek(VERZOEK, {
    projectId: "careon-scribe-test",
    locatie: "europe-west4",
    model: "gemini-2.5-flash-test",
    serviceAccount: "",
  });
  check("vertex-URL gebruikt een EU-locatie", opbouw.url.startsWith("https://europe-west4-aiplatform.googleapis.com/"));
  check("vertex-URL bevat de EU-locatie ook in het pad", opbouw.url.includes("/locations/europe-west4/"));
  check("vertex-URL draagt het project", opbouw.url.includes("/projects/careon-scribe-test/"));
  check("vertex-URL draagt het model uit de omgeving", opbouw.url.includes("gemini-2.5-flash-test:generateContent"));
  const body = tekstVan(opbouw.body);
  check("vertex vraagt JSON terug", body.includes('"responseMimeType":"application/json"'));
  check("vertex stuurt het fragment als inlineData", body.includes('"inlineData"') && body.includes('"audio/wav"'));
  check("vertex vraagt letterlijke transcriptie", body.includes("letterlijk"));
  check("vertex vraagt sprekerlabels", body.includes("spreker") && body.includes("patient"));
  check("vertex zet temperatuur op 0", body.includes('"temperature":0'));

  // De adapter mag nooit een modelnaam zelf verzinnen (D6).
  const bron = fs.readFileSync(path.resolve(process.cwd(), "src/lib/careon-scribe/transcriptie.server.ts"), "utf8");
  check("geen hard-coded Gemini-model in de adapter", !/gemini-\d/.test(bron));
  check("Vertex-locatie valt terug op de EU", bron.includes('STANDAARD_VERTEX_LOCATIE = "europe-west4"'));
  check("audio wordt nooit gelogd", !/console\.[a-z]+\([^)]*audio/i.test(bron));
  check("lege Vertex-lijst is expliciete stilte", leesVertexSegmenten("[]").length === 0);
  check(
    "Vertex behoudt geldig transcript",
    leesVertexSegmenten('[{"tekst":"synthetic","spreker":"patient"}]')[0]?.tekst === "synthetic",
  );
  for (const antwoord of ["invalid synthetic response", "{}", "null", "[null]", '[{"unexpected":"synthetic"}]']) {
    let geweigerd = false;
    try {
      leesVertexSegmenten(antwoord);
    } catch {
      geweigerd = true;
    }
    check("ongeldig Vertex-antwoord wordt verliesmelding, geen stille succesvolle transcriptie", geweigerd);
  }

  const configuratie = {
    projectId: "careon-scribe-test",
    locatie: "europe-west4",
    model: "gemini-model-test",
    serviceAccount: "",
  };
  for (const locatie of ["us-central1", "global", "europe-west2", "europe-west6", "europe-west4.evil.test"]) {
    let geweigerd = false;
    try {
      bouwVertexTranscriptieVerzoek(VERZOEK, { ...configuratie, locatie });
    } catch {
      geweigerd = true;
    }
    check(`Vertex weigert bestemming ${locatie}`, geweigerd);
  }
  for (const extra of [{ projectId: "../another-project" }, { model: "model:generateContent?key=x" }]) {
    let geweigerd = false;
    try {
      bouwVertexTranscriptieVerzoek(VERZOEK, { ...configuratie, ...extra });
    } catch {
      geweigerd = true;
    }
    check("Vertex weigert pad- of queryinjectie", geweigerd);
  }
  const engels = tekstVan(bouwVertexTranscriptieVerzoek({ ...VERZOEK, taal: "en" }, configuratie).body);
  check(
    "Vertex Engels vraagt geen Nederlandse transcriptie",
    engels.includes("English medical") && !engels.includes("Nederlandstalig"),
  );

  const sleutels = [
    "CAREON_SCRIBE_VERTEX_PROJECT_ID",
    "CAREON_SCRIBE_VERTEX_LOCATION",
    "CAREON_SCRIBE_GEMINI_MODEL",
    "CAREON_SCRIBE_VERTEX_SERVICE_ACCOUNT_JSON",
  ];
  const bewaard = sleutels.map((naam) => process.env[naam]);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = {
    client_email: "scribe@careon.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  const encode = (waarde: unknown) => Buffer.from(JSON.stringify(waarde)).toString("base64");
  try {
    process.env.CAREON_SCRIBE_VERTEX_PROJECT_ID = configuratie.projectId;
    process.env.CAREON_SCRIBE_VERTEX_LOCATION = "";
    process.env.CAREON_SCRIBE_GEMINI_MODEL = configuratie.model;
    process.env.CAREON_SCRIBE_VERTEX_SERVICE_ACCOUNT_JSON = encode(account);
    check(
      "volledige Vertex-configuratie gebruikt goedgekeurde EU-regio",
      vertexConfiguratie()?.locatie === "europe-west4",
    );
    process.env.CAREON_SCRIBE_VERTEX_LOCATION = "us-central1";
    check("Vertex-configuratie weigert Amerikaanse regio", vertexConfiguratie() === null);
    process.env.CAREON_SCRIBE_VERTEX_LOCATION = "europe-west4";
    for (const fout of [
      null,
      {},
      { ...account, private_key: "invalid" },
      { ...account, token_uri: "https://example.invalid/token" },
    ]) {
      process.env.CAREON_SCRIBE_VERTEX_SERVICE_ACCOUNT_JSON = encode(fout);
      check("Vertex-configuratie weigert ongeldig serviceaccount/tokenendpoint", vertexConfiguratie() === null);
    }
  } finally {
    sleutels.forEach((naam, index) => {
      if (bewaard[index] === undefined) delete process.env[naam];
      else process.env[naam] = bewaard[index];
    });
  }
}

function toetsServiceAccountJwt(): void {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwt = bouwServiceAccountJwt(
    { client_email: "scribe@careon.iam.gserviceaccount.com", private_key: pem },
    1_757_000_000_000,
  );
  const delen = jwt.split(".");
  check("service-account-JWT heeft drie delen", delen.length === 3);
  const kop = JSON.parse(Buffer.from(delen[0], "base64url").toString("utf8")) as Record<string, unknown>;
  const lading = JSON.parse(Buffer.from(delen[1], "base64url").toString("utf8")) as Record<string, unknown>;
  check("service-account-JWT ondertekent met RS256", kop.alg === "RS256");
  check(
    "service-account-JWT vraagt cloud-platform-scope",
    lading.scope === "https://www.googleapis.com/auth/cloud-platform",
  );
  check("service-account-JWT richt zich op de tokenruil", lading.aud === "https://oauth2.googleapis.com/token");
  check("service-account-JWT verloopt binnen een uur", Number(lading.exp) - Number(lading.iat) === 3_600);
  check("service-account-JWT draagt de handtekening", delen[2].length > 100);
}

function toetsModelverzoeken(): void {
  const responses = bouwAnalyseVerzoek("invoer", "hash", "responses");
  check("analyse (responses) gaat naar /responses", responses.url.endsWith("/responses"));
  check("analyse (responses) slaat niets op bij de provider", responses.body.store === false);
  const format = (responses.body.text as { format?: Record<string, unknown> } | undefined)?.format;
  check("analyse (responses) gebruikt json_schema", format?.type === "json_schema");
  check("analyse (responses) geeft het schema een naam", format?.name === ANALYSE_SCHEMA_NAAM);
  check("analyse (responses) is strict", format?.strict === true);
  check("analyse (responses) stuurt het staatschema mee", Boolean(format?.schema));
  check("analyse (responses) draagt de systeemprompt", responses.body.instructions === ANALYSE_SYSTEEMPROMPT);

  const chat = bouwAnalyseVerzoek("invoer", "hash", "chat");
  check("analyse (chat) gaat naar /chat/completions", chat.url.endsWith("/chat/completions"));
  check("analyse (chat) slaat niets op bij de provider", chat.body.store === false);
  const responseFormat = chat.body.response_format as
    | { type?: string; json_schema?: { name?: string; strict?: boolean; schema?: unknown } }
    | undefined;
  check("analyse (chat) gebruikt de geneste json_schema-vorm", responseFormat?.type === "json_schema");
  check("analyse (chat) geeft het schema een naam", responseFormat?.json_schema?.name === ANALYSE_SCHEMA_NAAM);
  check("analyse (chat) is strict", responseFormat?.json_schema?.strict === true);
  check("analyse (chat) stuurt het schema mee", Boolean(responseFormat?.json_schema?.schema));
  check(
    "analyse (chat) zet de systeemprompt als system-bericht",
    Array.isArray(chat.body.messages) &&
      (chat.body.messages as { role: string; content: string }[])[0].content === ANALYSE_SYSTEEMPROMPT,
  );

  const verslag = bouwVerslagVerzoek("psychiatrie", "invoer", "hash", "responses");
  const verslagFormat = (verslag.body.text as { format?: Record<string, unknown> } | undefined)?.format;
  check("verslag (responses) slaat niets op bij de provider", verslag.body.store === false);
  check("verslag (responses) geeft het schema een naam", verslagFormat?.name === VERSLAG_SCHEMA_NAAM);
  check("verslag draagt zijn eigen systeemprompt", verslag.body.instructions === VERSLAG_SYSTEEMPROMPT);
  const verslagChat = bouwVerslagVerzoek("psychiatrie", "invoer", "hash", "chat");
  const verslagChatFormat = verslagChat.body.response_format as { json_schema?: { name?: string } } | undefined;
  check("verslag (chat) geeft het schema een naam", verslagChatFormat?.json_schema?.name === VERSLAG_SCHEMA_NAAM);
}

function toetsSchemas(): void {
  const analyse = tekstVan(SCRIBE_ANALYSE_JSON_SCHEMA);
  // De sleutel `diagnose` bestaat nergens; het woord komt uitsluitend voor in
  // de beschrijving die het model verbiedt er een te stellen.
  check("staatschema kent geen diagnose-sleutel", !analyse.includes('"diagnose"'));
  check("staatschema verbiedt een modeldiagnose expliciet", analyse.includes("Nooit een diagnose van het model."));
  check("staatschema laat het model alleen model-waarschuwingen schrijven", analyse.includes('"enum":["model"]'));
  check("staatschema staat additionalProperties nergens toe", !analyse.includes('"additionalProperties":true'));

  const typen: ConsultType[] = ["soap", "aobp", "soep", "psychiatrie", "verpleegkundig", "seh", "vervolg", "ontslag"];
  for (const type of typen) {
    const schema = tekstVan(bouwVerslagVerzoek(type, "invoer", "hash", "responses").body);
    const sterren = beoordelingsSectieIds(type);
    const vrij = vrijeSectieIds(type);
    check(
      `verslagschema ${type} bevat alle vrije secties`,
      vrij.every((id) => schema.includes(`"${id}"`)),
    );
    check(
      `verslagschema ${type} bevat geen beoordelingssectie`,
      sterren.every((id) => !schema.includes(`"${id}"`)),
      sterren.join(","),
    );
  }
}

function toetsPromptRegime(): void {
  check("promptversie is vastgelegd", SCRIBE_PROMPT_VERSION === "careon-scribe-2026-09-10.2");
  check("analyseprompt verbiedt diagnose", ANALYSE_SYSTEEMPROMPT.includes("stelt GEEN diagnose"));
  check(
    "analyseprompt verbiedt polariteit bij risico's",
    ANALYSE_SYSTEEMPROMPT.includes("NOOIT polariteit") && ANALYSE_SYSTEEMPROMPT.includes("beoordeling behandelaar"),
  );
  check("analyseprompt eist bronvermelding", ANALYSE_SYSTEEMPROMPT.includes("`bron`"));
  check(
    "verslagprompt laat beoordelingssecties met rust",
    VERSLAG_SYSTEEMPROMPT.includes("schrijft de behandelaar zelf"),
  );
}

function toetsOptIn(): void {
  const bewaard = { live: process.env.CAREON_SCRIBE_LIVE, provider: process.env.CAREON_SCRIBE_TRANSCRIPTION_PROVIDER };
  process.env.CAREON_SCRIBE_LIVE = "";
  process.env.CAREON_SCRIBE_TRANSCRIPTION_PROVIDER = "openai";
  check("zonder CAREON_SCRIBE_LIVE is er geen live regime", !scribeLive());
  check("zonder CAREON_SCRIBE_LIVE is er geen provider", transcriptieProvider() === null);
  process.env.CAREON_SCRIBE_LIVE = "1";
  process.env.CAREON_SCRIBE_TRANSCRIPTION_PROVIDER = "";
  check("zonder providerkeuze blijft de transcriptie uit", transcriptieProvider() === null);
  process.env.CAREON_SCRIBE_TRANSCRIPTION_PROVIDER = "gemini";
  check("gemini zonder Vertex-configuratie faalt gesloten", transcriptieProvider() === null);
  process.env.CAREON_SCRIBE_LIVE = bewaard.live ?? "";
  process.env.CAREON_SCRIBE_TRANSCRIPTION_PROVIDER = bewaard.provider ?? "";
}

function segment(volgnummer: number, tekst: string, extra: Partial<ScribeSegment> = {}): ScribeSegment {
  return {
    id: `s${volgnummer}`,
    volgnummer,
    spreker: "onbekend",
    tekst,
    tekstGecorrigeerd: null,
    correctieBron: null,
    beginMs: null,
    eindMs: null,
    bron: "handmatig",
    createdAt: "2026-09-07T10:00:00.000Z",
    ...extra,
  };
}

/**
 * C6/C8/C30 — het filter waarmee een AI-correctie wordt weggeschreven. De
 * NULL-onveilige vorm (`correctie_bron=not.eq.behandelaar`) matchte geen enkel
 * vers segment, waardoor de correctie nooit werd opgeslagen en de "AI-correctie"
 * chip dode UI was.
 */
function toetsCorrectieFilter(): void {
  const filter = bouwCorrectieFilter("sessie-1", "org-1", 4).toString();
  const leesbaar = decodeURIComponent(filter);
  check("correctiefilter is NULL-veilig", leesbaar.includes("or=(correctie_bron.is.null,correctie_bron.eq.ai)"));
  check("correctiefilter gebruikt geen not.eq", !leesbaar.includes("not.eq"));
  check(
    "correctiefilter blijft binnen sessie en organisatie",
    leesbaar.includes("sessie_id=eq.sessie-1") && leesbaar.includes("org_id=eq.org-1"),
  );
  check("correctiefilter richt zich op één segment", leesbaar.includes("volgnummer=eq.4"));
}

/**
 * N6/S7 — een mutatie van de behandelaar overleeft élke latere analysepas. De
 * merge vervangt de niet-veiligheidskritische lijsten met de nieuwe extractie;
 * zonder deze trechter zou een intrekking daarna gewoon terugkomen.
 */
function toetsBehandelaarsfeiten(): void {
  const vorige: KlinischeStaat = {
    ...legeKlinischeStaat(),
    allergieen: [
      { tekst: "amoxicilline", aard: "allergie", bron: [3], ingetrokken: true, doorBehandelaar: true } as Allergiefeit,
    ],
    symptomen: [{ tekst: "hoofdpijn", bron: [], ingetrokken: false, doorBehandelaar: true } as Feit],
  };
  const nieuw: KlinischeStaat = {
    ...legeKlinischeStaat(),
    allergieen: [{ tekst: "amoxicilline", aard: "allergie", bron: [3, 9], ingetrokken: false } as Allergiefeit],
    symptomen: [{ tekst: "misselijkheid", bron: [11], ingetrokken: false } as Feit],
  };
  const bewaard = bewaarBehandelaarsfeiten(vorige, nieuw);
  check("een ingetrokken allergie blijft ingetrokken na een modelpas", bewaard.allergieen[0].ingetrokken === true);
  check("de intrekking blijft van de behandelaar", bewaard.allergieen[0].doorBehandelaar === true);
  check(
    "een handmatig symptoom verdwijnt niet uit een vervangende pas",
    bewaard.symptomen.some((rij) => rij.tekst === "hoofdpijn" && rij.doorBehandelaar === true),
  );
  check(
    "de nieuwe extractie blijft daarnaast staan",
    bewaard.symptomen.some((rij) => rij.tekst === "misselijkheid"),
  );

  const toegevoegd = pasStaatMutatieToe(legeKlinischeStaat(), "medicatie", "toevoegen", {
    tekst: "paliperidon",
    naam: "paliperidon",
    dosering: "100 mg",
    gebruik: "huidig",
  });
  check("een handmatig middel komt in de staat", toegevoegd !== null && toegevoegd.medicatie.length === 1);
  check(
    "een handmatig middel draagt de behandelaarsmarkering en geen bron",
    toegevoegd !== null &&
      toegevoegd.medicatie[0].doorBehandelaar === true &&
      toegevoegd.medicatie[0].bron.length === 0,
  );
  check(
    "intrekken van een onbekend feit levert niets op",
    pasStaatMutatieToe(legeKlinischeStaat(), "allergieen", "intrekken", { tekst: "penicilline" }) === null,
  );
  const metAllergie: KlinischeStaat = {
    ...legeKlinischeStaat(),
    allergieen: [{ tekst: "penicilline", aard: "allergie", bron: [2], ingetrokken: false } as Allergiefeit],
  };
  const ingetrokken = pasStaatMutatieToe(metAllergie, "allergieen", "intrekken", { tekst: "penicilline" });
  check("intrekken haalt het feit door", ingetrokken !== null && ingetrokken.allergieen[0].ingetrokken === true);
  check(
    "een handmatige actie krijgt haar omschrijving",
    (bouwStaatFeit("acties", { tekst: "Lab aanvragen", soort: "lab" }).omschrijving as string) === "Lab aanvragen",
  );
}

/**
 * N19 — de organisatiepoort is een conjunct: zonder `aiToegestaan` blijft de
 * ronde deterministisch, ook wanneer het platform live zou staan.
 */
async function toetsOrganisatiepoort(): Promise<void> {
  const bewaard = process.env.CAREON_SCRIBE_LIVE;
  process.env.CAREON_SCRIBE_LIVE = "1";
  const invoer = {
    staat: legeKlinischeStaat(),
    nieuweSegmenten: [segment(1, "Ik ben somber sinds drie maanden.", { spreker: "patient" })],
    contextSegmenten: [],
    consultType: "psychiatrie" as ConsultType,
    taal: "nl" as const,
    actorHash: "hash",
    orgId: null,
    userId: null,
    signal: AbortSignal.timeout(5_000),
  };
  const uit = await analyseerSegmenten({ ...invoer, aiToegestaan: false });
  check("zonder organisatiekeuze blijft de analyse deterministisch", uit.bron === "deterministisch");
  check("zonder organisatiekeuze wordt er geen model gemeld", uit.model === null);
  process.env.CAREON_SCRIBE_LIVE = bewaard ?? "";
}

async function main(): Promise<void> {
  toetsOpenAiTranscriptie();
  toetsVertexTranscriptie();
  toetsServiceAccountJwt();
  toetsModelverzoeken();
  toetsSchemas();
  toetsPromptRegime();
  toetsOptIn();
  toetsCorrectieFilter();
  toetsBehandelaarsfeiten();
  await toetsOrganisatiepoort();
  console.log(`Scribe server verification: ${geslaagd} passed, ${gefaald} failed.`);
  process.exit(gefaald === 0 ? 0 : 1);
}

void main();

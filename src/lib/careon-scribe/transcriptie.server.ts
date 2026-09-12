import { fetchOpenAIWithRetry, OPENAI_API_BASE_URL } from "@/lib/careon-assistant/runtime.server";

import type { ScribeTaal, Spreker } from "./types";
import { createHash, createPrivateKey, createSign } from "node:crypto";

// Careon Scribe — transcriptie-adapters (handoff 20 §5.1).
//
// Drie regels beheersen dit bestand:
//   * OPT-IN (S4). Zonder CAREON_SCRIBE_LIVE=1 vindt er geen enkele
//     provideraanroep plaats; transcriptieProvider() geeft dan null en de
//     audioroute antwoordt 503. De rest van de module blijft werken met
//     handmatige invoer en de deterministische analyse.
//   * FAIL CLOSED. Een half geconfigureerde provider (model zonder sleutel,
//     Vertex zonder service-account) telt als "niet geconfigureerd" — nooit
//     een stille terugval op een andere leverancier.
//   * NOOIT INHOUD IN LOGS (S5/§6). Audio-bytes en herkende tekst verschijnen
//     in geen enkele console.*-regel; foutmeldingen dragen hoogstens een
//     statuscode en de providernaam.
//
// Careon bewaart geen audio: het fragment komt binnen, gaat door naar de
// provider en wordt daarna losgelaten. Er is geen Storage-bucket en geen
// tijdelijk bestand.

export type TranscriptieProviderNaamLive = "openai" | "gemini";

export interface TranscriptieVerzoek {
  audio: Uint8Array;
  mime: string;
  taal: ScribeTaal;
  /** Staart van de vorige segmenten (≤ 600 tekens) als herkenningscontext. */
  contextTekst: string;
}

export interface TranscriptieSegment {
  tekst: string;
  spreker: Spreker;
  /** Provider turn boundaries relative to this audio request, never inferred roles. */
  relatieveBeginMs?: number;
  relatieveEindMs?: number;
}

/** Retain provider turn timing; otherwise divide only the NEW audio duration. */
export function plaatsTranscriptieSegmenten(
  segmenten: TranscriptieSegment[],
  offsetMs: number,
  duurMs: number,
  overlapMs: number,
): (TranscriptieSegment & { beginMs: number; eindMs: number })[] {
  const nieuwBegin = Math.min(duurMs, Math.max(0, overlapMs));
  const nieuwDuur = Math.max(0, duurMs - nieuwBegin);
  return segmenten.map((segment, index) => {
    const providerBegin = segment.relatieveBeginMs;
    const providerEind = segment.relatieveEindMs;
    const geldig =
      typeof providerBegin === "number" &&
      typeof providerEind === "number" &&
      Number.isFinite(providerBegin) &&
      Number.isFinite(providerEind) &&
      providerBegin >= 0 &&
      providerEind >= providerBegin &&
      providerBegin <= duurMs &&
      providerEind <= duurMs + 250;
    const begin = geldig ? providerBegin : nieuwBegin + Math.round((index * nieuwDuur) / segmenten.length);
    const eind = geldig
      ? Math.min(duurMs, providerEind)
      : nieuwBegin + Math.round(((index + 1) * nieuwDuur) / segmenten.length);
    return { ...segment, beginMs: offsetMs + begin, eindMs: offsetMs + Math.max(begin, eind) };
  });
}

export interface TranscriptieResultaat {
  segmenten: TranscriptieSegment[];
  model: string;
  provider: TranscriptieProviderNaamLive;
}

/** Medische NL-context vóór de staart van het transcript (prompt-kop). */
export const TRANSCRIPTIE_CONTEXT_KOP =
  "Nederlandstalig medisch consult tussen behandelaar en patiënt. Schrijf medicijnnamen, doseringen en " +
  "medische termen correct. Transcribeer letterlijk; voeg niets toe.";

/** Maximale lengte van de meegestuurde transcriptstaart (§5.1). */
export const TRANSCRIPTIE_CONTEXT_MAX = 600;

const STANDAARD_OPENAI_MODEL = "gpt-4o-mini-transcribe";
const STANDAARD_VERTEX_LOCATIE = "europe-west4";
// Alleen de vastgelegde EU-doellocatie. Uitbreiding vereist een expliciete
// model-/regiobeoordeling; een willekeurig `europe-*`-endpoint is geen EU-garantie.
const TOEGESTANE_VERTEX_LOCATIES = new Set([STANDAARD_VERTEX_LOCATIE]);
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function geldigeVertexBestemming(projectId: string, locatie: string, model: string): boolean {
  return (
    /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId) &&
    TOEGESTANE_VERTEX_LOCATIES.has(locatie) &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(model)
  );
}

function env(naam: string): string {
  return (process.env[naam] ?? "").trim();
}

/** Kill switch én activatievoorwaarde: alles uit tot de eigenaar hem aanzet. */
export function scribeLive(): boolean {
  return env("CAREON_SCRIBE_LIVE") === "1";
}

export function openAiTranscriptieModel(): string {
  const gekozen = env("CAREON_SCRIBE_TRANSCRIPTION_MODEL");
  return gekozen.length > 0 ? gekozen : STANDAARD_OPENAI_MODEL;
}

export interface VertexConfiguratie {
  projectId: string;
  locatie: string;
  model: string;
  serviceAccount: string;
}

/**
 * Vertex-configuratie of null. Het model is bewust verplicht en nergens
 * hard-coded (D6): een modelnaam die in code staat, veroudert stil.
 */
export function vertexConfiguratie(): VertexConfiguratie | null {
  const projectId = env("CAREON_SCRIBE_VERTEX_PROJECT_ID");
  const model = env("CAREON_SCRIBE_GEMINI_MODEL");
  const serviceAccount = env("CAREON_SCRIBE_VERTEX_SERVICE_ACCOUNT_JSON");
  if (projectId.length === 0 || model.length === 0 || serviceAccount.length === 0) return null;
  const locatieUitEnv = env("CAREON_SCRIBE_VERTEX_LOCATION");
  const locatie = locatieUitEnv.length > 0 ? locatieUitEnv : STANDAARD_VERTEX_LOCATIE;
  if (!geldigeVertexBestemming(projectId, locatie, model) || !leesServiceAccount(serviceAccount)) return null;
  return {
    projectId,
    locatie,
    model,
    serviceAccount,
  };
}

/**
 * De actieve transcriptieprovider, of null. Null betekent: geen live
 * transcriptie (503 op de audioroute) — niet "kies er zelf maar een".
 */
export function transcriptieProvider(): TranscriptieProviderNaamLive | null {
  if (!scribeLive()) return null;
  const gekozen = env("CAREON_SCRIBE_TRANSCRIPTION_PROVIDER");
  if (gekozen === "openai") return env("OPENAI_API_KEY").length > 0 ? "openai" : null;
  if (gekozen === "gemini") return vertexConfiguratie() ? "gemini" : null;
  return null;
}

/** Modelnaam van de actieve provider — voor de providerstatus en de sessierij. */
export function transcriptieModel(): string | null {
  const provider = transcriptieProvider();
  if (provider === "openai") return openAiTranscriptieModel();
  if (provider === "gemini") {
    const configuratie = vertexConfiguratie();
    return configuratie ? configuratie.model : null;
  }
  return null;
}

/** Prompt/instructie: medische context plus de staart van het transcript. */
export function transcriptieContext(contextTekst: string, taal: ScribeTaal = "nl"): string {
  const staart = contextTekst.trim().slice(-TRANSCRIPTIE_CONTEXT_MAX);
  const kop =
    taal === "en"
      ? "English medical consultation between clinician and patient. Spell medications, doses and medical terms correctly. Transcribe literally; add nothing."
      : TRANSCRIPTIE_CONTEXT_KOP;
  return staart.length > 0
    ? `${kop}\n${taal === "en" ? "Previous conversation" : "Voorafgaand gesprek"}: ${staart}`
    : kop;
}

// ── OpenAI-adapter ──────────────────────────────────────────────────────────

export interface OpenAITranscriptieVerzoek {
  url: string;
  bestandsnaam: string;
  /** Tekstvelden van het multipart-formulier; het audiobestand komt apart. */
  velden: Record<string, string>;
}

/**
 * Pure verzoekopbouw (toetsbaar zonder netwerk, `verify:scribe`).
 *
 * `gpt-4o-*-transcribe` levert GEEN tijdstempels: `verbose_json` en
 * `timestamp_granularities` bestaan alleen voor `whisper-1`. De tijden komen
 * daarom uit de clientmeting (§5.3) en dit verzoek vraagt er bewust niet om —
 * de gate toetst dat letterlijk.
 */
export function bouwOpenAITranscriptieVerzoek(
  verzoek: TranscriptieVerzoek,
  model: string = openAiTranscriptieModel(),
): OpenAITranscriptieVerzoek {
  const diarisatie = model.includes("diarize");
  const velden: Record<string, string> = {
    model,
    language: verzoek.taal,
    response_format: diarisatie ? "diarized_json" : "json",
  };
  if (diarisatie) velden.chunking_strategy = "auto";
  else velden.prompt = transcriptieContext(verzoek.contextTekst, verzoek.taal);
  return { url: `${OPENAI_API_BASE_URL}/audio/transcriptions`, bestandsnaam: "fragment.wav", velden };
}

function sprekerVanLabel(label: string | undefined): Spreker {
  const genormaliseerd = (label ?? "").trim().toLowerCase();
  if (genormaliseerd === "arts" || genormaliseerd === "doctor" || genormaliseerd === "clinician") return "arts";
  if (genormaliseerd === "patient" || genormaliseerd === "patiënt") return "patient";
  if (genormaliseerd === "overig" || genormaliseerd === "other") return "overig";
  // Providerdiarisatie levert doorgaans neutrale labels (speaker_0/A/1). Die
  // dragen geen rol; de context-agent of de behandelaar kent de rol toe (S8).
  return "onbekend";
}

export function leesOpenAITranscriptie(payload: unknown): TranscriptieSegment[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("scribe-transcriptie: OpenAI gaf een ongeldig antwoord terug");
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.text !== "string" && !Array.isArray(record.segments)) {
    throw new Error("scribe-transcriptie: OpenAI gaf geen transcript terug");
  }
  const segmenten: TranscriptieSegment[] = Array.isArray(record.segments)
    ? record.segments
        .map((segment: unknown) => {
          if (!segment || typeof segment !== "object" || !("text" in segment) || typeof segment.text !== "string") {
            throw new Error("scribe-transcriptie: OpenAI gaf een ongeldig segment terug");
          }
          const label = "speaker" in segment && typeof segment.speaker === "string" ? segment.speaker : undefined;
          const tijd = segment as { start?: unknown; end?: unknown };
          const geldig =
            typeof tijd.start === "number" &&
            typeof tijd.end === "number" &&
            Number.isFinite(tijd.start) &&
            Number.isFinite(tijd.end) &&
            tijd.start >= 0 &&
            tijd.end >= tijd.start;
          return {
            tekst: segment.text.trim(),
            spreker: sprekerVanLabel(label),
            ...(geldig
              ? {
                  relatieveBeginMs: Math.round((tijd.start as number) * 1_000),
                  relatieveEindMs: Math.round((tijd.end as number) * 1_000),
                }
              : {}),
          };
        })
        .filter((segment) => segment.tekst.length > 0)
    : [];
  if (segmenten.length === 0 && typeof record.text === "string" && record.text.trim().length > 0) {
    segmenten.push({ tekst: record.text.trim(), spreker: "onbekend" });
  }
  return segmenten;
}

async function transcribeerOpenAI(verzoek: TranscriptieVerzoek, signal: AbortSignal): Promise<TranscriptieResultaat> {
  const model = openAiTranscriptieModel();
  const opbouw = bouwOpenAITranscriptieVerzoek(verzoek, model);
  const formulier = new FormData();
  // Kopie naar een losse ArrayBuffer: een Uint8Array-view op een gedeelde
  // buffer zou meer bytes meesturen dan het fragment groot is.
  const bytes = new Uint8Array(verzoek.audio.byteLength);
  bytes.set(verzoek.audio);
  formulier.append("file", new Blob([bytes], { type: verzoek.mime }), opbouw.bestandsnaam);
  for (const [naam, waarde] of Object.entries(opbouw.velden)) formulier.append(naam, waarde);

  const response = await fetchOpenAIWithRetry(
    opbouw.url,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` },
      body: formulier,
    },
    signal,
  );
  if (!response.ok) {
    await response.body?.cancel();
    // Bewust alleen de statuscode: het antwoordlichaam kan herkende tekst
    // bevatten en hoort niet in een logregel.
    throw new Error(`scribe-transcriptie: OpenAI antwoordde ${response.status}`);
  }
  const segmenten = leesOpenAITranscriptie(await response.json());
  return { segmenten, model, provider: "openai" };
}

// ── Vertex AI (Gemini, EU) ──────────────────────────────────────────────────

export const VERTEX_INSTRUCTIE =
  "Transcribeer dit Nederlandstalige medische consultfragment letterlijk. Scheid de sprekers en label ze als " +
  '"arts", "patient" of "overig"; weet u het niet, gebruik dan "onbekend". Voeg niets toe, vat niets samen en ' +
  'interpreteer niets. Antwoord uitsluitend met JSON: [{"spreker": "...", "tekst": "..."}].';

export interface VertexTranscriptieVerzoek {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Pure verzoekopbouw voor Vertex AI (EU). Niet live geverifieerd (§5.1); de
 * gate toetst uitsluitend de vorm, inclusief de EU-locatie in de URL — D17/D24
 * staat geen transcriptie buiten de EU toe.
 */
export function bouwVertexTranscriptieVerzoek(
  verzoek: TranscriptieVerzoek,
  configuratie: VertexConfiguratie,
): VertexTranscriptieVerzoek {
  if (!geldigeVertexBestemming(configuratie.projectId, configuratie.locatie, configuratie.model)) {
    throw new Error("scribe-transcriptie: Vertex-bestemming is niet toegestaan");
  }
  const audioBase64 = Buffer.from(verzoek.audio).toString("base64");
  const instructie =
    verzoek.taal === "en"
      ? 'Transcribe this English medical consultation literally. Separate speakers and label them "arts", "patient", "overig", or "onbekend" when uncertain. Do not add, summarize or interpret anything. Return only JSON: [{"spreker":"...","tekst":"..."}].'
      : VERTEX_INSTRUCTIE;
  return {
    url:
      `https://${configuratie.locatie}-aiplatform.googleapis.com/v1/projects/${configuratie.projectId}` +
      `/locations/${configuratie.locatie}/publishers/google/models/${configuratie.model}:generateContent`,
    body: {
      contents: [
        {
          role: "user",
          parts: [
            { text: `${instructie}\n\n${transcriptieContext(verzoek.contextTekst, verzoek.taal)}` },
            { inlineData: { mimeType: verzoek.mime, data: audioBase64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    },
  };
}

interface ServiceAccountSleutel {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function leesServiceAccount(base64: string): ServiceAccountSleutel | null {
  try {
    const ontleed: unknown = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    if (!ontleed || typeof ontleed !== "object" || Array.isArray(ontleed)) return null;
    const ruw = ontleed as Partial<ServiceAccountSleutel>;
    if (typeof ruw.client_email !== "string" || typeof ruw.private_key !== "string") return null;
    if (!/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/.test(ruw.client_email)) return null;
    if (ruw.token_uri !== undefined && ruw.token_uri !== GOOGLE_TOKEN_URL) return null;
    if (createPrivateKey(ruw.private_key).asymmetricKeyType !== "rsa") return null;
    return {
      client_email: ruw.client_email,
      private_key: ruw.private_key,
      token_uri: typeof ruw.token_uri === "string" ? ruw.token_uri : undefined,
    };
  } catch {
    return null;
  }
}

function base64Url(waarde: string | Buffer): string {
  return (typeof waarde === "string" ? Buffer.from(waarde, "utf8") : waarde).toString("base64url");
}

/**
 * Service-account-JWT (RS256) → OAuth2-toegangstoken. Bewust met node:crypto
 * en zonder Google-SDK: één afhankelijkheid minder in een route die
 * bijzondere-categoriedata verwerkt.
 */
export function bouwServiceAccountJwt(sleutel: ServiceAccountSleutel, nu: number = Date.now()): string {
  const uitgifte = Math.floor(nu / 1_000);
  const kop = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const lading = base64Url(
    JSON.stringify({
      iss: sleutel.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: GOOGLE_TOKEN_URL,
      iat: uitgifte,
      exp: uitgifte + 3_600,
    }),
  );
  const ondertekenaar = createSign("RSA-SHA256");
  ondertekenaar.update(`${kop}.${lading}`);
  ondertekenaar.end();
  return `${kop}.${lading}.${base64Url(ondertekenaar.sign(sleutel.private_key))}`;
}

/** Tokencache: ~50 minuten, ruim binnen de geldigheid van 60 minuten. */
const TOKEN_GELDIGHEID_MS = 50 * 60 * 1_000;
let vertexToken: { token: string; geldigTot: number; sleutelHash: string } | null = null;

function sleutelKenmerk(base64: string): string {
  return createHash("sha256").update(base64).digest("hex");
}

async function vertexToegangstoken(configuratie: VertexConfiguratie, signal: AbortSignal): Promise<string> {
  const kenmerk = sleutelKenmerk(configuratie.serviceAccount);
  if (vertexToken && vertexToken.geldigTot > Date.now() && vertexToken.sleutelHash === kenmerk) {
    return vertexToken.token;
  }
  const sleutel = leesServiceAccount(configuratie.serviceAccount);
  if (!sleutel) throw new Error("scribe-transcriptie: Vertex-serviceaccount is onleesbaar");
  const tokenUrl = GOOGLE_TOKEN_URL;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: bouwServiceAccountJwt(sleutel),
    }),
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`scribe-transcriptie: Vertex-tokenruil antwoordde ${response.status}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("scribe-transcriptie: Vertex-tokenruil leverde geen token");
  vertexToken = { token: payload.access_token, geldigTot: Date.now() + TOKEN_GELDIGHEID_MS, sleutelHash: kenmerk };
  return payload.access_token;
}

interface VertexAntwoord {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export function leesVertexSegmenten(tekst: string): TranscriptieSegment[] {
  let ontleed: unknown;
  try {
    ontleed = JSON.parse(tekst);
  } catch {
    throw new Error("scribe-transcriptie: Vertex gaf ongeldige JSON terug");
  }
  // Het model levert een array; een omhullend object met `segmenten` wordt
  // eveneens geaccepteerd, zodat een kleine schemaslip geen fragment kost.
  let rijen: unknown[] | null = null;
  if (Array.isArray(ontleed)) {
    rijen = ontleed;
  } else if (ontleed && typeof ontleed === "object") {
    const omhulsel = (ontleed as { segmenten?: unknown }).segmenten;
    if (Array.isArray(omhulsel)) rijen = omhulsel;
  }
  if (!rijen) throw new Error("scribe-transcriptie: Vertex gaf geen segmentenlijst terug");
  return rijen
    .map((rij) => {
      if (!rij || typeof rij !== "object" || Array.isArray(rij)) {
        throw new Error("scribe-transcriptie: Vertex gaf een ongeldig segment terug");
      }
      const record = rij as Record<string, unknown>;
      if (typeof record.tekst !== "string") {
        throw new Error("scribe-transcriptie: Vertex gaf een segment zonder tekst terug");
      }
      return {
        tekst: record.tekst.trim(),
        spreker: sprekerVanLabel(typeof record.spreker === "string" ? record.spreker : undefined),
      };
    })
    .filter((segment) => segment.tekst.length > 0);
}

async function transcribeerVertex(verzoek: TranscriptieVerzoek, signal: AbortSignal): Promise<TranscriptieResultaat> {
  const configuratie = vertexConfiguratie();
  if (!configuratie) throw new Error("scribe-transcriptie: Vertex is niet volledig geconfigureerd");
  const token = await vertexToegangstoken(configuratie, signal);
  const opbouw = bouwVertexTranscriptieVerzoek(verzoek, configuratie);
  // fetchOpenAIWithRetry is een generieke, afbreekbare retry-fetch (naam volgt
  // zijn eerste gebruiker); hij houdt hier hetzelfde herhaalgedrag aan.
  const response = await fetchOpenAIWithRetry(
    opbouw.url,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(opbouw.body),
    },
    signal,
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`scribe-transcriptie: Vertex antwoordde ${response.status}`);
  }
  const payload = (await response.json()) as VertexAntwoord;
  const tekst = payload.candidates?.[0]?.content?.parts?.map((deel) => deel.text ?? "").join("") ?? "";
  return { segmenten: leesVertexSegmenten(tekst), model: configuratie.model, provider: "gemini" };
}

/**
 * Eén audiofragment → segmenten. Werpt wanneer er geen provider is: de
 * audioroute vangt dat af met 503 en laat de behandelaar handmatig aanvullen.
 */
export async function transcribeer(verzoek: TranscriptieVerzoek, signal: AbortSignal): Promise<TranscriptieResultaat> {
  const provider = transcriptieProvider();
  try {
    if (provider === "openai") return await transcribeerOpenAI(verzoek, signal);
    if (provider === "gemini") return await transcribeerVertex(verzoek, signal);
    throw new Error("scribe-transcriptie: geen transcriptieprovider geconfigureerd");
  } catch {
    // JSON/parser/network errors can contain fragments of a provider response.
    // The route logs this message, so expose only fixed operational metadata.
    throw new Error(`scribe-transcriptie: ${provider ?? "geen provider"} verwerking mislukt`);
  }
}

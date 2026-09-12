/**
 * Teaching-audio browser harness only. The existing UI talks to this in-memory
 * adapter through Playwright routing; production routes, auth and DB are not used.
 * Call the environment isolation helper BEFORE importing/creating this adapter.
 * Provider functions are real. This is not Supabase/RLS/deployment acceptance.
 */

import type { NotitiePatchBody, StaatEnvelop, StaatPatchBody } from "../../lib/careon-scribe/api-contract";
import type { ScribeLocalState } from "../../lib/careon-scribe/storage.client";
import type {
  GeannuleerdGrond,
  KlinischeStaat,
  ScribeSegment,
  ScribeSessie,
  ScribeTaak,
} from "../../lib/careon-scribe/types";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ScribeBrowserTestRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Buffer | null;
}

export interface ScribeBrowserTestResponse {
  status: number;
  json?: unknown;
  body?: string;
  headers?: Record<string, string>;
}

export interface ScribeBrowserTestBackendOptions {
  outputDir: string;
  /** Optional active-session batching. Finishing always analyzes every segment. */
  analysisEverySegments?: number;
  providerTimeoutMs?: number;
  /** Explicit teaching-only evidence label; never a patient identifier. */
  label?: string;
}

export async function createScribeBrowserTestBackend(options: ScribeBrowserTestBackendOptions) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ACCESS_TOKEN ||
    (supabaseUrl && supabaseUrl !== "http://127.0.0.1:9")
  ) {
    throw new Error("Teaching harness requires isolated Supabase environment before provider module imports.");
  }
  const openaiBase = process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com/v1";
  if (openaiBase.replace(/\/$/, "") !== "https://api.openai.com/v1") {
    throw new Error("Teaching harness only permits the official OpenAI API destination.");
  }
  const store = await import("../../lib/careon-scribe/storage.client");
  const agent = await import("../../lib/careon-scribe/agent.server");
  const transcription = await import("../../lib/careon-scribe/transcriptie.server");
  const contract = await import("../../lib/careon-scribe/api-contract");
  const types = await import("../../lib/careon-scribe/types");
  const clinical = await import("../../lib/careon-scribe/klinische-staat");
  const deterministic = await import("../../lib/careon-scribe/deterministisch");
  const overlap = await import("../../lib/careon-scribe/overlap");
  const runtime = await import("../../lib/careon-assistant/runtime.server");
  const fixtures = await import("../../data/careon/careon-scribe");
  if (transcription.transcriptieProvider() !== "openai" || !agent.scribeAgentLive()) {
    throw new Error("Teaching harness requires a configured real OpenAI transcription and analysis provider.");
  }
  const now = () => new Date().toISOString();
  const state: ScribeLocalState = {
    sessies: [],
    segmenten: {},
    staat: {},
    notities: {},
    transcriptRevisies: {},
    notitieBronnen: {},
    fragmenten: {},
    taken: {},
    instellingen: {
      ...fixtures.DEMO_SCRIBE_INSTELLINGEN,
      transcriptieAan: true,
      aiAnalyseAan: true,
      consenttekst: "Geïsoleerde test met onderwijsopname. Geen echte patiënt of productiedossier.",
      dpiaEigenaar: "Test fixture only; does not establish production approval",
    },
    revision: 1,
    gemachtigden: [],
    vrijgaven: [],
    scriptPositie: {},
    logboek: [],
  };
  const events: Record<string, unknown>[] = [];
  const audioEvents: Record<string, unknown>[] = [];
  const analysisEvents: Record<string, unknown>[] = [];
  const noteEvents: Record<string, unknown>[] = [];
  const audioResults = new Map<string, ScribeBrowserTestResponse>();
  const analysisPending = new Map<string, Promise<StaatEnvelop>>();
  const timeoutMs = options.providerTimeoutMs ?? 55_000;
  const analysisThreshold = Math.max(1, Math.floor(options.analysisEverySegments ?? 1));
  const providerStatus = {
    live: true,
    transcriptieProvider: "openai" as const,
    transcriptieModel: transcription.transcriptieModel(),
    notitieModel: runtime.ASSISTANT_MODEL,
    promptVersie: agent.SCRIBE_CONTEXT_PROMPT_VERSION,
    analyseLive: true,
  };
  const ok = (json: unknown, status = 200): ScribeBrowserTestResponse => ({
    status,
    json,
    headers: { "Cache-Control": "no-store" },
  });
  const fail = (status: number, error: string) => ok({ error }, status);
  const session = (id: string) => store.vindSessie(state, id);
  const context = (sessie: ScribeSessie) => ({
    consultType: sessie.consultType,
    taal: sessie.taal,
    actorHash: "isolated-teaching-audio-test",
    orgId: null,
    userId: null,
    aiToegestaan: true,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const jsonBody = (request: ScribeBrowserTestRequest): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(request.body?.toString("utf8") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid request JSON");
    return parsed as Record<string, unknown>;
  };
  const sourceRevision = (id: string) => state.transcriptRevisies?.[id] ?? 0;
  const append = (
    sessie: ScribeSessie,
    input: Omit<ScribeSegment, "id" | "volgnummer" | "createdAt">[],
    endMs: number,
  ) => {
    const rows = input.slice(0, types.SCRIBE_LIMITS.segmentenPerSessie - sessie.segmentTeller).map((row) => ({
      ...row,
      id: randomUUID(),
      volgnummer: ++sessie.segmentTeller,
      createdAt: now(),
    }));
    state.segmenten[sessie.id].push(...rows);
    state.transcriptRevisies ??= {};
    if (rows.length) state.transcriptRevisies[sessie.id] = sourceRevision(sessie.id) + 1;
    sessie.duurMs = Math.max(sessie.duurMs, endMs);
    sessie.ontbrekendeFragmenten += rows.filter((row) => row.bron === "systeem").length;
    sessie.updatedAt = now();
    return rows;
  };
  // Mirrors the server's post-analysis preservation of clinician decisions,
  // without importing scribe.server.ts and its real DB access functions.
  const preserveClinicianFacts = (previous: KlinischeStaat, next: KlinischeStaat): KlinischeStaat => {
    const result = { ...next };
    for (const category of types.STAAT_CATEGORIEEN) {
      const key = (row: Record<string, unknown>) => {
        const text = (value: unknown) =>
          String(value ?? "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
        if (category === "medicatie") return `${text(row.naam)}|${String(row.gebruik ?? "")}`;
        if (category === "psychisch" || category === "leefstijl") return `${text(row.categorie)}|${text(row.tekst)}`;
        if (category === "acties") return `${text(row.omschrijving)}|${String(row.soort ?? "")}`;
        return text(row.tekst);
      };
      const owned = (previous[category] as unknown as Record<string, unknown>[]).filter(
        (row) => row.doorBehandelaar === true,
      );
      const keyed = new Map(owned.map((row) => [key(row), row]));
      const merged = (next[category] as unknown as Record<string, unknown>[]).map((row) => keyed.get(key(row)) ?? row);
      for (const row of owned) if (!merged.some((item) => key(item) === key(row))) merged.push(row);
      Object.assign(result, { [category]: merged });
    }
    return result;
  };
  const rebuildTasks = (id: string, clinicalState: KlinischeStaat) => {
    const current = store.takenVan(state, id);
    const tasks: ScribeTaak[] = [...current];
    for (const action of deterministic.extraheerTaken(clinicalState)) {
      if (
        tasks.some(
          (task) =>
            task.soort === action.soort && task.omschrijving.toLowerCase() === action.omschrijving.toLowerCase(),
        )
      )
        continue;
      tasks.push({
        id: randomUUID(),
        sessieId: id,
        omschrijving: action.omschrijving.slice(0, types.SCRIBE_LIMITS.taakOmschrijving),
        soort: action.soort,
        status: "voorgesteld",
        bronSegmenten: action.bron,
        createdAt: now(),
        updatedAt: now(),
      });
    }
    state.taken[id] = tasks;
  };
  const analyzeBatch = async (id: string, force = false): Promise<StaatEnvelop> => {
    const active = analysisPending.get(id);
    if (active) return active;
    const work = (async () => {
      const sessie = session(id);
      const previous = state.staat[id];
      if (!sessie || !previous) throw new Error("Unknown teaching session");
      const all = structuredClone(store.segmentenVan(state, id));
      const fresh = all
        .filter((row) => row.volgnummer > previous.laatsteSegment)
        .slice(0, types.SCRIBE_LIMITS.analyseSegmenten);
      if (fresh.length === 0 || (!force && fresh.length < analysisThreshold)) return previous;
      const started = Date.now();
      const transcriptBefore = sourceRevision(id);
      const result = await agent.analyseerSegmenten({
        ...context(sessie),
        staat:
          previous.verouderd && previous.laatsteSegment === 0
            ? clinical.heranalyseStartStaat(previous.staat)
            : structuredClone(previous.staat),
        nieuweSegmenten: fresh,
        contextSegmenten: all.filter((row) => row.volgnummer <= previous.laatsteSegment),
      });
      if (!session(id) || !["actief", "afgerond"].includes(session(id)?.status ?? ""))
        throw new Error("Session ended while analyzing");
      if (state.staat[id].versie !== previous.versie || state.staat[id].verouderd !== previous.verouderd)
        throw new Error("Clinical state changed while analyzing; retry");
      const sourceChanged = all.some((before) => {
        const after = store.segmentenVan(state, id).find((row) => row.id === before.id);
        return (
          !after ||
          before.spreker !== after.spreker ||
          before.sprekerBron !== after.sprekerBron ||
          before.tekstGecorrigeerd !== after.tekstGecorrigeerd
        );
      });
      if (sourceChanged) throw new Error("Transcript corrected while analyzing; retry");
      const speakerMap = new Map(result.sprekers.map((row) => [row.volgnummer, row.spreker]));
      const correctionMap = new Map(result.correcties.map((row) => [row.volgnummer, row.tekstGecorrigeerd]));
      for (const row of store.segmentenVan(state, id)) {
        const speaker = speakerMap.get(row.volgnummer);
        const correction = correctionMap.get(row.volgnummer);
        if (row.spreker === "onbekend" && row.sprekerBron !== "behandelaar" && speaker) {
          row.spreker = speaker;
          row.sprekerBron = "ai";
        }
        if (row.correctieBron !== "behandelaar" && correction !== undefined) {
          row.tekstGecorrigeerd = correction;
          row.correctieBron = "ai";
        }
      }
      const envelope: StaatEnvelop = {
        staat: preserveClinicianFacts(previous.staat, result.staat),
        versie: previous.versie + 1,
        epdLijstBeoordeeld: false,
        laatsteSegment: fresh.at(-1)?.volgnummer ?? previous.laatsteSegment,
        verouderd: false,
        bron: result.bron,
        model: result.model,
        updatedAt: now(),
      };
      state.staat[id] = envelope;
      rebuildTasks(id, envelope.staat);
      analysisEvents.push({
        sessionId: id,
        at: now(),
        durationMs: Date.now() - started,
        sourceRevision: transcriptBefore,
        firstSegment: fresh[0].volgnummer,
        lastSegment: envelope.laatsteSegment,
        source: result.bron,
        model: result.model,
        speakers: result.sprekers,
        corrections: result.correcties,
        state: structuredClone(envelope.staat),
      });
      return envelope;
    })();
    analysisPending.set(id, work);
    try {
      return await work;
    } finally {
      analysisPending.delete(id);
    }
  };
  const drainAnalysis = async (id: string) => {
    if (analysisPending.has(id)) await analysisPending.get(id);
    for (
      let count = 0;
      count < Math.ceil(types.SCRIBE_LIMITS.segmentenPerSessie / types.SCRIBE_LIMITS.analyseSegmenten) + 1;
      count++
    ) {
      const before = state.staat[id]?.laatsteSegment ?? 0;
      if (before >= (session(id)?.segmentTeller ?? 0) && !state.staat[id]?.verouderd) return;
      await analyzeBatch(id, true);
      if ((state.staat[id]?.laatsteSegment ?? 0) <= before) throw new Error("Analysis did not advance");
    }
    throw new Error("Analysis exceeded bounded catch-up count");
  };

  const dispatch = async (request: ScribeBrowserTestRequest): Promise<ScribeBrowserTestResponse> => {
    const url = new URL(request.url, "http://localhost");
    const match = /^\/api\/careon\/scribe\/(.*)$/.exec(url.pathname);
    if (!match) return fail(400, "Unsupported isolated teaching-test route.");
    const parts = match[1].split("/").map(decodeURIComponent);
    const method = request.method.toUpperCase();
    if (parts[0] === "instellingen" && method === "GET")
      return ok({ configured: true, instellingen: state.instellingen, revision: state.revision, providerStatus });
    if (parts[0] !== "sessies")
      return fail(400, "This endpoint is not supported by the isolated teaching-test adapter.");
    if (parts.length === 1 && method === "GET") {
      const filter = url.searchParams.get("status");
      const search = (url.searchParams.get("zoek") ?? "").toLowerCase();
      const rows = state.sessies.filter(
        (row) =>
          (!filter || filter === "alle" || row.status === filter) &&
          row.patientReferentie.toLowerCase().includes(search),
      );
      return ok({
        configured: true,
        sessies: rows.map((row) => ({ ...row, verlooptBinnenkort: false, verlooptOverDagen: 30 })),
        pagina: 1,
        meer: false,
        ingeschakeld: true,
        gemachtigd: true,
        beheerder: true,
      });
    }
    if (parts.length === 1 && method === "POST") {
      const body = jsonBody(request);
      if (
        !types.isPatientReferentie(body.patientReferentie) ||
        !types.isConsultType(body.consultType) ||
        !types.isScribeTaal(body.taal)
      )
        return fail(400, "Ongeldige testconsultgegevens.");
      if (body.consentBevestigd !== true || body.consentRevisie !== state.revision)
        return fail(409, "Bevestig de actuele testverklaring.");
      const sessie = store.maakSessieLokaal(state, {
        patientReferentie: body.patientReferentie,
        consultType: body.consultType,
        taal: body.taal,
        consentTekst: state.instellingen.consenttekst,
      });
      sessie.transcriptieProvider = "openai";
      sessie.transcriptieModel = providerStatus.transcriptieModel;
      sessie.notitieModel = providerStatus.notitieModel;
      return ok({ configured: true, sessie });
    }
    const id = parts[1];
    const sessie = session(id);
    if (!sessie) return fail(404, "Dit testconsult bestaat niet.");
    if (parts.length === 2 && method === "GET")
      return ok({
        configured: true,
        rol: "eigenaar",
        sessie,
        segmenten: store.segmentenVan(state, id),
        staat: state.staat[id] ?? null,
        notitie: store.laatsteNotitie(state, id),
        taken: store.takenVan(state, id),
        instellingen: state.instellingen,
        vrijgaveReden: null,
      });
    if (parts.length === 2 && method === "DELETE")
      return ok({ configured: true, verwijderd: true, ...store.verwijderSessieLokaal(state, id), rol: "eigenaar" });
    if (parts.length === 2 && method === "PATCH") {
      const body = jsonBody(request);
      if (body.status !== undefined) {
        if (!types.isSessieStatus(body.status)) return fail(400, "Ongeldige status.");
        if (body.status === "afgerond") await drainAnalysis(id);
        const grond =
          typeof body.grond === "string" && (types.GEANNULEERD_GRONDEN as readonly string[]).includes(body.grond)
            ? (body.grond as GeannuleerdGrond)
            : undefined;
        const result = store.zetStatusLokaal(state, id, body.status, grond);
        return result.ok
          ? ok({ configured: true, sessie: result.sessie })
          : fail(result.status ?? 409, result.fout ?? "Statusovergang geweigerd.");
      }
      if (!types.isPatientReferentie(body.patientReferentie)) return fail(400, "Ongeldige referentie.");
      sessie.patientReferentie = body.patientReferentie;
      return ok({ configured: true, sessie });
    }
    if (!["actief", "afgerond", "goedgekeurd"].includes(sessie.status))
      return fail(409, "Dit testconsult is afgesloten.");
    if (parts[2] === "audio" && method === "POST") {
      if (sessie.status !== "actief") return fail(409, "Dit testconsult neemt geen audio meer aan.");
      const headers = Object.fromEntries(
        Object.entries(request.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
      );
      const fragmentId = headers[contract.SCRIBE_FRAGMENT_ID_HEADER];
      if (!fragmentId || !/^[0-9a-f-]{36}$/i.test(fragmentId)) return fail(400, "Ongeldig fragmentkenmerk.");
      const cacheKey = `${id}/${fragmentId}`;
      const cached = audioResults.get(cacheKey);
      if (cached) return cached;
      const mime = (headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!(contract.SCRIBE_AUDIO_MIMES as readonly string[]).includes(mime))
        return fail(415, "Ongeldig audioformaat.");
      const audio = request.body;
      if (!audio?.length) return fail(400, "Leeg audiofragment.");
      if (audio.length > contract.SCRIBE_MAX_AUDIO_BYTES) return fail(413, "Audiofragment te groot.");
      const clamp = (value: string | undefined, min: number, max: number, fallback: number) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
      };
      const offsetMs = clamp(headers[contract.SCRIBE_FRAGMENT_OFFSET_HEADER], 0, 3_600_000, 0);
      const durationMs = clamp(headers[contract.SCRIBE_FRAGMENT_DUUR_HEADER], 1, 45_000, 8_000);
      const overlapMs = clamp(headers[contract.SCRIBE_FRAGMENT_OVERLAP_HEADER], 0, 2_000, 0);
      const contextText = store
        .segmentenVan(state, id)
        .slice(-3)
        .map((row) => row.tekstGecorrigeerd ?? row.tekst)
        .join(" ");
      const started = Date.now();
      const evidence: Record<string, unknown> = {
        sessionId: id,
        fragmentId,
        at: now(),
        offsetMs,
        durationMs,
        overlapMs,
        bytes: audio.length,
        sha256: createHash("sha256").update(audio).digest("hex"),
      };
      if (audio.length >= 44 && audio.toString("ascii", 0, 4) === "RIFF")
        Object.assign(evidence, {
          sampleRate: audio.readUInt32LE(24),
          channels: audio.readUInt16LE(22),
          bitsPerSample: audio.readUInt16LE(34),
          pcmDurationMs: ((audio.length - 44) * 1000) / audio.readUInt32LE(28),
        });
      let response: ScribeBrowserTestResponse;
      try {
        const result = await transcription.transcribeer(
          { audio, mime, taal: sessie.taal, contextTekst: contextText },
          AbortSignal.timeout(timeoutMs),
        );
        const cleaned = result.segmenten
          .map((row, index) => ({
            ...row,
            tekst: index === 0 ? overlap.verwijderOverlap(overlap.staartVan(contextText), row.tekst) : row.tekst,
          }))
          .filter((row) => row.tekst.trim());
        const rows = append(
          sessie,
          transcription.plaatsTranscriptieSegmenten(cleaned, offsetMs, durationMs, overlapMs).map((row) => ({
            ...row,
            tekst: row.tekst.slice(0, types.SCRIBE_LIMITS.segmentTekst),
            tekstGecorrigeerd: null,
            correctieBron: null,
            beginMs: row.beginMs,
            eindMs: row.eindMs,
            bron: "live" as const,
          })),
          offsetMs + durationMs,
        );
        response = ok({
          configured: true,
          segmenten: rows,
          provider: result.provider,
          model: result.model,
          ontbrekend: false,
          segmentTeller: sessie.segmentTeller,
        });
        Object.assign(evidence, {
          provider: result.provider,
          model: result.model,
          segmentCount: rows.length,
          rawSegments: structuredClone(result.segmenten),
          insertedSegments: structuredClone(rows),
          success: true,
        });
      } catch {
        const rows = append(
          sessie,
          [
            {
              tekst: `[fragment niet getranscribeerd — ${offsetMs} ms, transcriptiedienst niet bereikbaar]`,
              spreker: "onbekend",
              tekstGecorrigeerd: null,
              correctieBron: null,
              beginMs: offsetMs,
              eindMs: offsetMs + durationMs,
              bron: "systeem",
            },
          ],
          offsetMs + durationMs,
        );
        response = ok(
          {
            configured: true,
            segmenten: rows,
            provider: "openai",
            model: providerStatus.transcriptieModel,
            ontbrekend: true,
            segmentTeller: sessie.segmentTeller,
            error: "Dit fragment kon niet worden getranscribeerd.",
          },
          502,
        );
        Object.assign(evidence, { success: false, segmentCount: rows.length });
      }
      Object.assign(evidence, { processingMs: Date.now() - started });
      audioEvents.push(evidence);
      audioResults.set(cacheKey, response);
      return response;
    }
    if (parts[2] === "segmenten" && method === "POST") {
      const body = jsonBody(request);
      if (typeof body.tekst !== "string" || !body.tekst.trim()) return fail(400, "Lege transcriptregel.");
      const rows = store.voegHandmatigSegmentToe(
        state,
        id,
        body.tekst,
        types.isSpreker(body.spreker) ? body.spreker : "arts",
        body.bron === "systeem" ? "systeem" : "handmatig",
        typeof body.duurMs === "number" ? body.duurMs : 8_000,
        typeof body.fragmentId === "string" ? body.fragmentId : undefined,
      );
      return ok({
        configured: true,
        segmenten: rows,
        segmentTeller: session(id)?.segmentTeller,
        ontbrekendeFragmenten: session(id)?.ontbrekendeFragmenten,
      });
    }
    if (parts[2] === "segmenten" && parts[3] && method === "PATCH") {
      const body = jsonBody(request);
      const result = store.wijzigSegmentLokaal(state, id, Number(parts[3]), {
        ...(types.isSpreker(body.spreker) ? { spreker: body.spreker } : {}),
        ...(body.tekstGecorrigeerd === null || typeof body.tekstGecorrigeerd === "string"
          ? { tekstGecorrigeerd: body.tekstGecorrigeerd }
          : {}),
      });
      return result.ok
        ? ok({
            configured: true,
            segment: result.segment,
            verouderd: result.verouderd,
            laatsteSegment: result.laatsteSegment,
          })
        : fail(result.status ?? 400, result.fout ?? "Correctie geweigerd.");
    }
    if (parts[2] === "analyse" && method === "POST") {
      const before = analysisEvents.length;
      const envelope = await analyzeBatch(id);
      const event = analysisEvents.length > before ? analysisEvents.at(-1) : undefined;
      return ok({
        configured: true,
        ...envelope,
        sprekers: event?.speakers ?? [],
        correcties: event?.corrections ?? [],
        taken: store.takenVan(state, id),
      });
    }
    if (parts[2] === "staat" && method === "PATCH") {
      const result = store.wijzigStaatLokaal(state, id, jsonBody(request) as unknown as StaatPatchBody);
      return result.ok && result.envelop
        ? ok({ configured: true, ...result.envelop })
        : fail(result.status ?? 400, result.fout ?? "Staatmutatie geweigerd.");
    }
    if (parts[2] === "notitie" && !parts[3] && method === "POST") {
      if (sessie.status !== "afgerond") return fail(409, "Rond eerst het testconsult af.");
      const envelope = state.staat[id];
      if (envelope.verouderd || envelope.laatsteSegment < sessie.segmentTeller)
        return fail(409, "De analyse loopt achter op het transcript.");
      const body = jsonBody(request);
      const format = types.isConsultType(body.formaat) ? body.formaat : sessie.consultType;
      const started = Date.now();
      const result = await agent.genereerVerslag({
        ...context(sessie),
        consultType: format,
        staat: structuredClone(envelope.staat),
        citaten: agent.citaatSegmenten(envelope.staat, store.segmentenVan(state, id)),
        gatSegmenten: agent.gatSegmentenVan(store.segmentenVan(state, id)),
      });
      if (state.staat[id].versie !== envelope.versie)
        return fail(409, "De bron is tijdens verslaggeneratie gewijzigd.");
      const note = store.genereerNotitieLokaal(state, id, format);
      if (!note) return fail(500, "Testverslag kon niet worden aangemaakt.");
      Object.assign(note, { secties: result.secties, bron: result.bron, model: result.model });
      noteEvents.push({ sessionId: id, at: now(), durationMs: Date.now() - started, note: structuredClone(note) });
      return ok({ configured: true, notitie: note, bron: result.bron });
    }
    if (parts[2] === "notitie" && parts[3] && method === "PATCH") {
      const result = store.wijzigNotitieLokaal(state, id, parts[3], jsonBody(request) as unknown as NotitiePatchBody);
      return result.ok
        ? ok({
            configured: true,
            notitie: result.notitie,
            overgeslagen: result.overgeslagen ?? [],
            goedgekeurd: result.goedgekeurd === true,
          })
        : fail(result.status ?? 409, result.fout ?? "Verslagwijziging geweigerd.");
    }
    if (parts[2] === "taken" && parts[3] && method === "PATCH") {
      const body = jsonBody(request);
      if (!types.isTaakStatus(body.status)) return fail(400, "Ongeldige taakstatus.");
      const task = store.wijzigTaakLokaal(state, id, parts[3], body.status);
      return task ? ok({ configured: true, taak: task }) : fail(404, "Taak bestaat niet.");
    }
    return fail(400, "This operation is not implemented in the isolated teaching-test adapter.");
  };
  const snapshot = () =>
    structuredClone({
      label: options.label ?? "Isolated teaching-audio test",
      limitations:
        "In-memory persistence and demo page auth; not production API, RLS, provider quotas or database concurrency acceptance. Real UI recording, provider transcription and clinical agent functions.",
      state,
      providerStatus,
      events,
      audioEvents,
      analysisEvents,
      noteEvents,
    });
  return {
    handle: async (request: ScribeBrowserTestRequest): Promise<ScribeBrowserTestResponse> => {
      const started = Date.now();
      let result: ScribeBrowserTestResponse;
      try {
        result = await dispatch(request);
      } catch (error) {
        result = fail(
          error instanceof SyntaxError ? 400 : 409,
          "Isolated test adapter could not complete this operation; inspect test evidence and retry.",
        );
        events.push({
          at: now(),
          method: request.method,
          path: new URL(request.url, "http://localhost").pathname,
          exception: error instanceof Error ? error.name : "UnknownError",
        });
      }
      events.push({
        at: now(),
        method: request.method,
        path: new URL(request.url, "http://localhost").pathname,
        status: result.status,
        durationMs: Date.now() - started,
      });
      return result;
    },
    snapshot,
    save: (filename = "backend-evidence.json") => {
      const outputDir = path.resolve(options.outputDir);
      const destination = path.resolve(outputDir, filename);
      if (!destination.startsWith(outputDir + path.sep)) throw new Error("Evidence path must remain inside outputDir.");
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(destination, `${JSON.stringify(snapshot(), null, 2)}\n`, "utf8");
      return destination;
    },
  };
}

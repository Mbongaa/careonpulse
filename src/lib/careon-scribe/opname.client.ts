"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  acknowledgeScribePendingFragment,
  canPersistScribeFragments,
  readScribePendingFragments,
  saveScribePendingFragment,
  scribeDraftGeneration,
} from "./drafts.client";
import { type AudioFragmentInvoer, stuurAudioFragment, voegSegmentToe } from "./remote.client";
import type { ScribeSegment } from "./types";

// Opnamehook van Careon Scribe (handoff 20 §7.6).
//
// Waarom PCM/WAV en geen MediaRecorder-stream: elk fragment moet OP ZICHZELF
// afspeelbaar zijn voor de transcriptieprovider. Losse WebM/Opus-brokken uit
// één MediaRecorder-sessie missen na het eerste blok hun container-kop en zijn
// dus onbruikbaar. Daarom vangt deze hook ruwe samples, downsamplet naar
// 16 kHz mono en schrijft per fragment een volledige WAV-kop.
//
// Twee harde regels:
//   * S5 — audio wordt NERGENS bewaard: niet in localStorage, niet in
//     IndexedDB, niet in een blob-URL. De wachtrij leeft uitsluitend in
//     geheugen en is begrensd op twaalf fragmenten.
//   * Verlies is zichtbaar. Lukt verzenden niet, dan komt er een gatsegment
//     (`bron: "systeem"`) in het transcript in plaats van een stille sprong.
//     Lukt ook dát niet (dood netwerk), dan onthoudt de hook het gat in
//     `openstaandeGatenRef`, telt het mee in `lokaleGaten` — zodat de amber
//     banner tóch verschijnt — en schrijft het alsnog weg zodra er weer
//     verbinding is (N15c/N15d).
//
// Fragmenten van 8 seconden met 1 seconde overlap: zonder overlap knipt de
// grens midden in een woord (een medicijnnaam!). verwijderOverlap() op de
// server ontdubbelt de herhaalde kop weer.
//
// Robuustheid van de wachtrij (N15/C16/C29/C32):
//   * 429 wordt hoogstens MAX_429_POGINGEN keer afgewacht; daarna telt het
//     fragment als gat. Zonder die grens blijft `wachtrijLeeg` false en is
//     "Consult afronden" voorgoed uitgeschakeld.
//   * status 0/502/503/504 is een netwerkhapering: opnieuw proberen met
//     backoff 1s/3s/8s, met het fragment aan de kop van de wachtrij.
//   * de lus staat in try/finally, zodat `bezigRef` nooit blijft hangen.
//   * de teller telt het lopende fragment één keer: het blijft element 0 van
//     de array tot de upload klaar is.
//   * een 502 mét plaatshouder is DEELSUCCES — de route legde het gat al vast,
//     dus er mag geen tweede gatsegment bij.

const DOEL_SAMPLERATE = 16_000;
const FRAGMENT_SECONDEN = 8;
const OVERLAP_SECONDEN = 1;
const FRAGMENT_SAMPLES = DOEL_SAMPLERATE * FRAGMENT_SECONDEN;
const OVERLAP_SAMPLES = DOEL_SAMPLERATE * OVERLAP_SECONDEN;
const BUFFER_GROOTTE = 4_096;
/** Maximaal aantal fragmenten in geheugen; daarna volgt een gatsegment. */
const MAX_WACHTRIJ = 12;
/** RMS-drempel: onder deze waarde is het fragment stilte en gaat het niet weg. */
const STILTE_DREMPEL = 0.004;
/** Analyse-ritme (§7.6): tijd óf onverwerkte segmenten. */
const ANALYSE_INTERVAL_MS = 20_000;
const ANALYSE_SEGMENTEN = 3;
const MAX_RETRY_AFTER_MS = 30_000;
/** Zoveel keer wachten op Retry-After; daarna is het budget op en telt het fragment als gat. */
const MAX_429_POGINGEN = 3;
/** Backoff bij een netwerkhapering (N15a) — drie pogingen, daarna een gat. */
const NETWERK_BACKOFF_MS = [1_000, 3_000, 8_000] as const;
/** Statussen die op een hapering wijzen in plaats van op een definitieve weigering. */
const HERSTELBARE_STATUS: readonly number[] = [0, 502, 503, 504];

export type OpnameStatus = "uit" | "starten" | "opnemen" | "gepauzeerd" | "stoppen";

export interface ScribeOpnameOpties {
  sessieId: string;
  /** Persisted end of the consult timeline; retained across recording restarts. */
  beginMs?: number;
  /** Nieuwe segmenten uit een fragmentantwoord. */
  onSegmenten: (segmenten: ScribeSegment[], segmentTeller: number) => void;
  /** Er is transcript verloren gegaan; het gatsegment staat al in het transcript. */
  onGat: (segmenten: ScribeSegment[], duurMs: number, ontbrekendeFragmenten?: number) => void;
  onFout: (melding: string) => void;
  /** Ritme-trigger; de werkruimte bewaakt zelf dat er nooit twee analyses lopen. */
  onAnalyseNodig?: () => void;
}

export interface ScribeOpname {
  status: OpnameStatus;
  /** VU-niveau 0–1 van het laatst verwerkte blok. */
  niveau: number;
  /** Fragmenten die nog verzonden moeten worden (incl. het lopende). */
  wachtrij: number;
  /** Zijn alle fragmenten verwerkt? "Consult afronden" wacht hierop. */
  wachtrijLeeg: boolean;
  /** Geen netwerkverbinding — de opname pauzeert en de wachtrij blijft staan. */
  offline: boolean;
  /**
   * Gaten die de client wel zag maar niet kon wegschrijven (N15d). De
   * werkruimte telt ze op bij `sessie.ontbrekendeFragmenten`, zodat de amber
   * banner ook verschijnt wanneer de POST zelf het netwerk niet haalde.
   */
  lokaleGaten: number;
  ondersteund: boolean;
  start: () => Promise<void>;
  pauzeer: () => void;
  hervat: () => void;
  stop: () => Promise<void>;
  herprobeer: () => Promise<void>;
}

interface Fragment {
  blob: Blob;
  invoer: AudioFragmentInvoer;
}

/** Gemiddelde-decimatie naar 16 kHz; hoger dan de bronrate komt niet voor. */
function downsample(invoer: Float32Array, vanRate: number): Float32Array {
  if (vanRate <= DOEL_SAMPLERATE) return Float32Array.from(invoer);
  const verhouding = vanRate / DOEL_SAMPLERATE;
  const lengte = Math.floor(invoer.length / verhouding);
  const uit = new Float32Array(lengte);
  for (let index = 0; index < lengte; index += 1) {
    const start = Math.floor(index * verhouding);
    const eind = Math.min(invoer.length, Math.floor((index + 1) * verhouding));
    let som = 0;
    let aantal = 0;
    for (let positie = start; positie < eind; positie += 1) {
      som += invoer[positie];
      aantal += 1;
    }
    uit[index] = aantal > 0 ? som / aantal : 0;
  }
  return uit;
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let som = 0;
  for (let index = 0; index < samples.length; index += 1) som += samples[index] * samples[index];
  return Math.sqrt(som / samples.length);
}

/** 16-bit PCM WAV — één kanaal, 16 kHz, met volledige RIFF-kop per fragment. */
export function wavVanSamples(samples: Float32Array, sampleRate = DOEL_SAMPLERATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const schrijfTekst = (positie: number, tekst: string) => {
    for (let index = 0; index < tekst.length; index += 1) view.setUint8(positie + index, tekst.charCodeAt(index));
  };
  schrijfTekst(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  schrijfTekst(8, "WAVE");
  schrijfTekst(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  schrijfTekst(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let positie = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const waarde = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(positie, waarde < 0 ? waarde * 0x8000 : waarde * 0x7fff, true);
    positie += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function samplesNaarMs(samples: number): number {
  return Math.round((samples / DOEL_SAMPLERATE) * 1_000);
}

function gatSeconden(duurMs: number): number {
  return Math.max(1, Math.round(duurMs / 1_000));
}

function gatTekst(duurMs: number): string {
  return `[Transcriptie onderbroken — circa ${gatSeconden(duurMs)} seconden ontbreken]`;
}

function gatMelding(duurMs: number): string {
  return `Er ontbreken circa ${gatSeconden(duurMs)} seconden transcript. Vul de ontbrekende tekst handmatig aan.`;
}

function wacht(ms: number): Promise<void> {
  return new Promise((klaar) => {
    window.setTimeout(klaar, ms);
  });
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function useScribeOpname(opties: ScribeOpnameOpties): ScribeOpname {
  const [status, setStatus] = useState<OpnameStatus>("uit");
  const [niveau, setNiveau] = useState(0);
  const [wachtrijLengte, setWachtrijLengte] = useState(0);
  const [offline, setOffline] = useState(false);
  const [lokaleGaten, setLokaleGaten] = useState(() => readScribePendingFragments(opties.sessieId).length);
  const opslagTokenRef = useRef(scribeDraftGeneration(opties.sessieId));
  const [gebufferd, setGebufferd] = useState(false);
  const levenscyclusRef = useRef(0);
  const gemonteerdRef = useRef(true);
  const startenRef = useRef(false);
  const verwerkingRef = useRef<Promise<void> | null>(null);
  const gatenSchrijvenRef = useRef<Promise<void> | null>(null);

  // Callbacks in refs: de audio-callback leeft buiten de renderlus en mag geen
  // verouderde closure vasthouden.
  const optiesRef = useRef(opties);
  optiesRef.current = opties;

  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const bronRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const bufferRef = useRef<Float32Array[]>([]);
  const bufferLengteRef = useRef(0);
  const bufferFragmentRef = useRef<string | null>(null);
  const staartRef = useRef<Float32Array>(new Float32Array(0));
  /** Aantal NIEUWE (niet-overlappende) samples dat al is ingepakt. */
  const verzondenSamplesRef = useRef(0);
  const wachtrijRef = useRef<Fragment[]>([]);
  const bezigRef = useRef(false);
  const opnemendRef = useRef(false);
  const onverwerktRef = useRef(0);
  const laatsteAnalyseRef = useRef(0);
  /** Gaten die nog nergens staan; wegschrijven zodra de verbinding terug is. */
  const openstaandeGatenRef = useRef<{ id: string; duurMs: number }[]>(readScribePendingFragments(opties.sessieId));
  /** Gepauzeerd door de netwerklistener, niet door de gebruiker. */
  const netwerkPauzeRef = useRef(false);

  const meldWachtrij = useCallback(() => {
    // Het lopende fragment blijft element 0 van de array tot de upload klaar
    // is (verwerkWachtrij peekt met [0] en shift() pas daarna), dus de lengte
    // telt het al mee — een extra `bezig`-term zou het dubbel tellen (C29).
    setWachtrijLengte(wachtrijRef.current.length);
  }, []);

  /** Alsnog wegschrijven wat eerder het netwerk niet haalde (N15c). */
  const schrijfOpenstaandeGaten = useCallback((): Promise<void> => {
    if (gatenSchrijvenRef.current) return gatenSchrijvenRef.current;
    const werk = (async () => {
      while (openstaandeGatenRef.current.length > 0 && !isOffline()) {
        if (opslagTokenRef.current !== scribeDraftGeneration(optiesRef.current.sessieId)) return;
        const gat = openstaandeGatenRef.current[0];
        const resultaat = await voegSegmentToe(
          optiesRef.current.sessieId,
          gatTekst(gat.duurMs),
          "onbekend",
          "systeem",
          gat.duurMs,
          gat.id,
        );
        if (opslagTokenRef.current !== scribeDraftGeneration(optiesRef.current.sessieId)) return;
        if (!resultaat.ok) return;
        acknowledgeScribePendingFragment(optiesRef.current.sessieId, gat.id, opslagTokenRef.current);
        openstaandeGatenRef.current.shift();
        setLokaleGaten(openstaandeGatenRef.current.length);
        optiesRef.current.onGat(resultaat.segmenten, gat.duurMs, resultaat.ontbrekendeFragmenten);
      }
    })();
    gatenSchrijvenRef.current = werk;
    return werk.finally(() => {
      gatenSchrijvenRef.current = null;
    });
  }, []);

  const meldGat = useCallback(
    async (duurMs: number, id = crypto.randomUUID()) => {
      saveScribePendingFragment(optiesRef.current.sessieId, { id, duurMs }, opslagTokenRef.current);
      openstaandeGatenRef.current.push({ id, duurMs });
      setLokaleGaten(openstaandeGatenRef.current.length);
      optiesRef.current.onFout(gatMelding(duurMs));
      await schrijfOpenstaandeGaten();
    },
    [schrijfOpenstaandeGaten],
  );

  const verwerkWachtrij = useCallback((): Promise<void> => {
    if (verwerkingRef.current) return verwerkingRef.current;
    const werk = (async () => {
      bezigRef.current = true;
      let quotaPogingen = 0;
      let netwerkPogingen = 0;
      try {
        while (wachtrijRef.current.length > 0) {
          if (opslagTokenRef.current !== scribeDraftGeneration(optiesRef.current.sessieId)) {
            wachtrijRef.current = [];
            return;
          }
          if (isOffline()) {
            // Fragmenten blijven staan; de online-listener hervat de lus.
            optiesRef.current.onFout("Geen verbinding — de fragmenten wachten tot de verbinding terug is.");
            return;
          }
          const fragment = wachtrijRef.current[0];
          meldWachtrij();
          const resultaat = await stuurAudioFragment(optiesRef.current.sessieId, fragment.blob, fragment.invoer);
          if (opslagTokenRef.current !== scribeDraftGeneration(optiesRef.current.sessieId)) return;
          if (resultaat.ok) {
            acknowledgeScribePendingFragment(
              optiesRef.current.sessieId,
              fragment.invoer.fragmentId,
              opslagTokenRef.current,
            );
            quotaPogingen = 0;
            netwerkPogingen = 0;
            wachtrijRef.current.shift();
            if (resultaat.ontbrekend) {
              // C32 — deelsucces: de route legde de plaatshouder zelf al vast en
              // verhoogde `ontbrekende_fragmenten` met precies één. Een tweede
              // gatsegment zou het verlies dubbel tellen.
              if (resultaat.segmenten.length > 0) {
                optiesRef.current.onGat(resultaat.segmenten, fragment.invoer.duurMs);
              }
              optiesRef.current.onFout(gatMelding(fragment.invoer.duurMs));
              continue;
            }
            if (resultaat.segmenten.length > 0) {
              optiesRef.current.onSegmenten(resultaat.segmenten, resultaat.segmentTeller);
              onverwerktRef.current += resultaat.segmenten.length;
              const verstreken = Date.now() - laatsteAnalyseRef.current;
              if (onverwerktRef.current >= ANALYSE_SEGMENTEN || verstreken >= ANALYSE_INTERVAL_MS) {
                onverwerktRef.current = 0;
                laatsteAnalyseRef.current = Date.now();
                optiesRef.current.onAnalyseNodig?.();
              }
            }
            await schrijfOpenstaandeGaten();
            continue;
          }
          // Number.isFinite, niet `typeof === "number"`: een Retry-After in
          // HTTP-datumvorm levert NaN op en setTimeout(NaN) vuurt direct — dat is
          // een tight loop op de quotaroute.
          if (resultaat.status === 429 && Number.isFinite(resultaat.retryAfter) && quotaPogingen < MAX_429_POGINGEN) {
            quotaPogingen += 1;
            const wachtMs = Math.min(MAX_RETRY_AFTER_MS, Math.max(1, resultaat.retryAfter as number) * 1_000);
            optiesRef.current.onFout("Te veel fragmenten tegelijk — Careon wacht even en verzendt daarna verder.");
            await wacht(wachtMs);
            continue;
          }
          if (resultaat.code === "transcriptie_uitgeschakeld") {
            opnemendRef.current = false;
            setStatus("gepauzeerd");
            for (const track of streamRef.current?.getTracks() ?? []) track.stop();
          }
          if (
            resultaat.code !== "transcriptie_uitgeschakeld" &&
            HERSTELBARE_STATUS.includes(resultaat.status) &&
            netwerkPogingen < NETWERK_BACKOFF_MS.length
          ) {
            const wachtMs = NETWERK_BACKOFF_MS[netwerkPogingen];
            netwerkPogingen += 1;
            optiesRef.current.onFout(
              `Verbinding hapert — Careon probeert dit fragment opnieuw (poging ${netwerkPogingen} van ${NETWERK_BACKOFF_MS.length}).`,
            );
            await wacht(wachtMs);
            continue;
          }
          // Definitief mislukt: fragment weggooien en het gat zichtbaar maken.
          quotaPogingen = 0;
          netwerkPogingen = 0;
          wachtrijRef.current.shift();
          optiesRef.current.onFout(resultaat.fout);
          await meldGat(fragment.invoer.duurMs, fragment.invoer.fragmentId);
        }
      } finally {
        // Ook bij een worp: nooit met bezigRef === true eindigen, anders blijft
        // wachtrijLeeg false en is "Consult afronden" voorgoed dood (C16).
        bezigRef.current = false;
        meldWachtrij();
      }
    })();
    verwerkingRef.current = werk;
    return werk.finally(() => {
      verwerkingRef.current = null;
    });
  }, [meldGat, meldWachtrij, schrijfOpenstaandeGaten]);

  const zetInWachtrij = useCallback(
    (fragment: Fragment) => {
      if (
        !saveScribePendingFragment(
          optiesRef.current.sessieId,
          { id: fragment.invoer.fragmentId, duurMs: fragment.invoer.duurMs },
          opslagTokenRef.current,
        )
      ) {
        opnemendRef.current = false;
        setStatus("gepauzeerd");
        optiesRef.current.onFout(
          "Herstelmetadata kon niet worden bewaard. De opname is gepauzeerd; verwerk de resterende fragmenten voordat u deze pagina verlaat.",
        );
      }
      if (wachtrijRef.current.length >= MAX_WACHTRIJ) {
        // Vol: dit fragment gaat verloren. Bewust géén opslag op schijf (S5).
        void meldGat(fragment.invoer.duurMs, fragment.invoer.fragmentId);
        return;
      }
      wachtrijRef.current.push(fragment);
      meldWachtrij();
      void verwerkWachtrij();
    },
    [meldGat, meldWachtrij, verwerkWachtrij],
  );

  /** Persist only identity/duration before PCM can be lost on a reload or crash. */
  const bewaarBufferMetadata = useCallback(() => {
    if (bufferLengteRef.current === 0) return;
    bufferFragmentRef.current ??= crypto.randomUUID();
    if (
      !saveScribePendingFragment(
        optiesRef.current.sessieId,
        {
          id: bufferFragmentRef.current,
          duurMs: Math.max(1, samplesNaarMs(bufferLengteRef.current)),
        },
        opslagTokenRef.current,
      )
    ) {
      opnemendRef.current = false;
      setStatus("gepauzeerd");
      optiesRef.current.onFout(
        "Herstelmetadata kon niet worden bewaard. Stop de opname en verwerk de resterende fragmenten voordat u deze pagina verlaat.",
      );
    }
  }, []);

  /** Pakt precies FRAGMENT_SAMPLES nieuwe samples in, met de overlap-kop ervoor. */
  const pakFragment = useCallback(() => {
    const fragmentId = bufferFragmentRef.current ?? crypto.randomUUID();
    bufferFragmentRef.current = null;
    const totaal = new Float32Array(bufferLengteRef.current);
    let positie = 0;
    for (const blok of bufferRef.current) {
      totaal.set(blok, positie);
      positie += blok.length;
    }
    const nieuw = totaal.subarray(0, FRAGMENT_SAMPLES);
    const rest = totaal.slice(FRAGMENT_SAMPLES);
    bufferRef.current = rest.length > 0 ? [rest] : [];
    bufferLengteRef.current = rest.length;
    setGebufferd(rest.length > 0);
    bewaarBufferMetadata();

    const kop = staartRef.current;
    const samen = new Float32Array(kop.length + nieuw.length);
    samen.set(kop, 0);
    samen.set(nieuw, kop.length);
    staartRef.current = nieuw.slice(Math.max(0, nieuw.length - OVERLAP_SAMPLES));

    const offsetSamples = Math.max(0, verzondenSamplesRef.current - kop.length);
    verzondenSamplesRef.current += nieuw.length;

    if (rms(nieuw) < STILTE_DREMPEL) {
      acknowledgeScribePendingFragment(optiesRef.current.sessieId, fragmentId, opslagTokenRef.current);
      return;
    }
    zetInWachtrij({
      blob: wavVanSamples(samen),
      invoer: {
        fragmentId,
        offsetMs: samplesNaarMs(offsetSamples),
        duurMs: samplesNaarMs(samen.length),
        overlapMs: samplesNaarMs(kop.length),
        mime: "audio/wav",
      },
    });
  }, [bewaarBufferMetadata, zetInWachtrij]);

  /**
   * Restant korter dan een fragment alsnog inpakken (C18). Het einde van een
   * consult is juist het beleidsdeel, dus dit draait bij `stop()` én bij het
   * ontkoppelen van de component — de verzendlus overleeft de unmount.
   */
  const pakRestant = useCallback(() => {
    if (bufferLengteRef.current === 0) return;
    if (opslagTokenRef.current !== scribeDraftGeneration(optiesRef.current.sessieId)) return;
    const fragmentId = bufferFragmentRef.current ?? crypto.randomUUID();
    bufferFragmentRef.current = null;
    const totaal = new Float32Array(bufferLengteRef.current);
    let positie = 0;
    for (const blok of bufferRef.current) {
      totaal.set(blok, positie);
      positie += blok.length;
    }
    bufferRef.current = [];
    bufferLengteRef.current = 0;
    setGebufferd(false);
    const kop = staartRef.current;
    const samen = new Float32Array(kop.length + totaal.length);
    samen.set(kop, 0);
    samen.set(totaal, kop.length);
    const offsetSamples = Math.max(0, verzondenSamplesRef.current - kop.length);
    verzondenSamplesRef.current += totaal.length;
    if (rms(totaal) < STILTE_DREMPEL) {
      acknowledgeScribePendingFragment(optiesRef.current.sessieId, fragmentId, opslagTokenRef.current);
      return;
    }
    zetInWachtrij({
      blob: wavVanSamples(samen),
      invoer: {
        fragmentId,
        offsetMs: samplesNaarMs(offsetSamples),
        duurMs: samplesNaarMs(samen.length),
        overlapMs: samplesNaarMs(kop.length),
        mime: "audio/wav",
      },
    });
  }, [zetInWachtrij]);

  const ruimOp = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    bronRef.current?.disconnect();
    bronRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
    bufferRef.current = [];
    bufferLengteRef.current = 0;
    bufferFragmentRef.current = null;
    setGebufferd(false);
    staartRef.current = new Float32Array(0);
    opnemendRef.current = false;
    netwerkPauzeRef.current = false;
    setNiveau(0);
  }, []);

  const start = useCallback(async () => {
    if (startenRef.current || contextRef.current || !gemonteerdRef.current) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      optiesRef.current.onFout("Deze browser kan geen microfoonopname maken.");
      return;
    }
    if (!canPersistScribeFragments()) {
      optiesRef.current.onFout(
        "Deze browser kan geen herstelmetadata bewaren. Sta sessieopslag toe of voer gesprekstekst handmatig in.",
      );
      return;
    }
    if (isOffline()) {
      optiesRef.current.onFout("Geen verbinding — herstel de verbinding voordat u de opname start.");
      return;
    }
    const generatie = ++levenscyclusRef.current;
    startenRef.current = true;
    setStatus("starten");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (
        !gemonteerdRef.current ||
        generatie !== levenscyclusRef.current ||
        opslagTokenRef.current !== scribeDraftGeneration(optiesRef.current.sessieId)
      ) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const context = new AudioContext();
      contextRef.current = context;
      const bron = context.createMediaStreamSource(stream);
      bronRef.current = bron;
      const processor = context.createScriptProcessor(BUFFER_GROOTTE, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (gebeurtenis) => {
        if (!opnemendRef.current || !gemonteerdRef.current) return;
        if (opslagTokenRef.current !== scribeDraftGeneration(optiesRef.current.sessieId)) {
          ruimOp();
          return;
        }
        const blok = downsample(gebeurtenis.inputBuffer.getChannelData(0), context.sampleRate);
        bufferRef.current.push(blok);
        bufferLengteRef.current += blok.length;
        bewaarBufferMetadata();
        setGebufferd(true);
        setNiveau(Math.min(1, rms(blok) * 8));
        while (bufferLengteRef.current >= FRAGMENT_SAMPLES) pakFragment();
      };
      bron.connect(processor);
      const stil = context.createGain();
      stil.gain.value = 0;
      processor.connect(stil);
      stil.connect(context.destination);
      verzondenSamplesRef.current = Math.max(
        verzondenSamplesRef.current,
        Math.round(((optiesRef.current.beginMs ?? 0) * DOEL_SAMPLERATE) / 1000),
      );
      laatsteAnalyseRef.current = Date.now();
      onverwerktRef.current = 0;
      for (const track of stream.getTracks()) {
        track.addEventListener?.("ended", () => {
          if (!opnemendRef.current) return;
          opnemendRef.current = false;
          setStatus("gepauzeerd");
          optiesRef.current.onFout(
            "De microfoonverbinding is verbroken. Stop de opname en controleer het transcript voordat u opnieuw start.",
          );
        });
      }
      if (context.state === "suspended") await context.resume();
      if (!gemonteerdRef.current || generatie !== levenscyclusRef.current) {
        ruimOp();
        return;
      }
      opnemendRef.current = true;
      setStatus("opnemen");
    } catch {
      if (generatie !== levenscyclusRef.current) return;
      ruimOp();
      setStatus("uit");
      optiesRef.current.onFout(
        "Careon kon de microfoon niet openen. Controleer de browsertoestemming of voer gesprekstekst handmatig in.",
      );
    } finally {
      if (generatie === levenscyclusRef.current) startenRef.current = false;
    }
  }, [bewaarBufferMetadata, pakFragment, ruimOp]);

  const pauzeer = useCallback(() => {
    opnemendRef.current = false;
    netwerkPauzeRef.current = false;
    setNiveau(0);
    setStatus("gepauzeerd");
  }, []);

  const hervat = useCallback(() => {
    if (isOffline() || !streamRef.current?.getTracks().some((track) => track.readyState !== "ended")) return;
    netwerkPauzeRef.current = false;
    opnemendRef.current = true;
    setStatus("opnemen");
  }, []);

  const stop = useCallback(async () => {
    levenscyclusRef.current += 1;
    startenRef.current = false;
    setStatus("stoppen");
    opnemendRef.current = false;
    pakRestant();
    ruimOp();
    await verwerkWachtrij();
    await schrijfOpenstaandeGaten();
    setStatus("uit");
  }, [pakRestant, ruimOp, schrijfOpenstaandeGaten, verwerkWachtrij]);

  useEffect(() => {
    if (openstaandeGatenRef.current.length === 0) return;
    optiesRef.current.onFout(
      "De vorige opname bevatte nog onverwerkte fragmenten. Careon controleert deze en legt eventueel ontbrekende tekst vast.",
    );
    void schrijfOpenstaandeGaten();
  }, [schrijfOpenstaandeGaten]);

  // Waarschuwing bij wegnavigeren: een lopende opname of een niet-lege
  // wachtrij betekent transcript dat nog nergens staat. Clientnavigatie binnen
  // de app vuurt dit niet — die grens bewaakt de scribeschil zelf (N15,
  // scribe-navigatie.tsx).
  useEffect(() => {
    const bewaak = (gebeurtenis: BeforeUnloadEvent) => {
      if (
        !opnemendRef.current &&
        !startenRef.current &&
        bufferLengteRef.current === 0 &&
        openstaandeGatenRef.current.length === 0 &&
        wachtrijRef.current.length === 0 &&
        !bezigRef.current
      )
        return;
      gebeurtenis.preventDefault();
    };
    window.addEventListener("beforeunload", bewaak);
    return () => window.removeEventListener("beforeunload", bewaak);
  }, []);

  // Netwerkbewaking (N15b): offline pauzeert de opname en laat de wachtrij
  // staan; online hervat en draait de wachtrij plus de openstaande gaten leeg.
  useEffect(() => {
    setOffline(isOffline());
    const naarOffline = () => {
      setOffline(true);
      if (opnemendRef.current) {
        opnemendRef.current = false;
        netwerkPauzeRef.current = true;
        setNiveau(0);
        setStatus("gepauzeerd");
      }
    };
    const naarOnline = () => {
      setOffline(false);
      if (netwerkPauzeRef.current && contextRef.current) {
        netwerkPauzeRef.current = false;
        opnemendRef.current = true;
        setStatus("opnemen");
      }
      void verwerkWachtrij();
      void schrijfOpenstaandeGaten();
    };
    window.addEventListener("offline", naarOffline);
    window.addEventListener("online", naarOnline);
    return () => {
      window.removeEventListener("offline", naarOffline);
      window.removeEventListener("online", naarOnline);
    };
  }, [schrijfOpenstaandeGaten, verwerkWachtrij]);

  // Ontkoppelen: eerst het restant inpakken (het gaat mee in de losgekoppelde
  // verzendlus), dan pas de microfoon vrijgeven (C18).
  useEffect(() => {
    gemonteerdRef.current = true;
    return () => {
      gemonteerdRef.current = false;
      levenscyclusRef.current += 1;
      startenRef.current = false;
      // De verzendlus is bewust NIET afgebroken: hij draait losgekoppeld door
      // en levert de resterende fragmenten alsnog af (C18). De retries zijn
      // begrensd, dus hij eindigt altijd.
      pakRestant();
      ruimOp();
    };
  }, [pakRestant, ruimOp]);

  return {
    status,
    niveau,
    wachtrij: wachtrijLengte,
    wachtrijLeeg: wachtrijLengte === 0 && lokaleGaten === 0 && !gebufferd,
    offline,
    lokaleGaten,
    ondersteund: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    start,
    pauzeer,
    hervat,
    stop,
    herprobeer: async () => {
      await verwerkWachtrij();
      await schrijfOpenstaandeGaten();
    },
  };
}

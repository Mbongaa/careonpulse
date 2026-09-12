"use client";

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";

import { Loader2, Square, XCircle } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CONSULT_TYPE_LABELS,
  DEMO_SEGMENT_INTERVAL_MS,
  EMPTY_SCRIBE_INSTELLINGEN,
  GEANNULEERD_GROND_LABELS,
  SESSIE_STATUS_LABELS,
} from "@/data/careon/careon-scribe";
import { hasCareonNativeFileBridge } from "@/lib/careon-mobile/native-file.client";
import type {
  ScribeSessieMetadata,
  StaatEnvelop,
  StaatFeitInvoer,
  StaatMutatieActie,
} from "@/lib/careon-scribe/api-contract";
import { clearScribeDraft, hasUnsentScribeDraft, useUnsentScribeDraft } from "@/lib/careon-scribe/drafts.client";
import { useScribeOpname } from "@/lib/careon-scribe/opname.client";
import {
  analyseer,
  demoRestSegmenten,
  genereerNotitie,
  haalScribeInstellingen,
  haalSessie,
  type ScribeBron,
  speelDemoAlles,
  speelDemoOpname,
  voegSegmentToe,
  wijzigNotitie,
  wijzigSegment,
  wijzigSessie,
  wijzigStaat,
  wijzigTaak,
} from "@/lib/careon-scribe/remote.client";
import { extraheerEpdLijst } from "@/lib/careon-scribe/storage.client";
import {
  GEANNULEERD_GRONDEN,
  type GeannuleerdGrond,
  SCRIBE_LIMITS,
  type ScribeInstellingen,
  type ScribeNotitie,
  type ScribeSegment,
  type ScribeSessie,
  type ScribeTaak,
  type Spreker,
  type StaatCategorie,
  type TaakStatus,
  type VerslagSectie,
} from "@/lib/careon-scribe/types";

import { AanwijzingenPaneel } from "./aanwijzingen-paneel";
import { OpnameBesturing, opnameWachtrijTekst } from "./opname-besturing";
import { zetOpnameActief } from "./scribe-navigatie";
import { OntbrekendeFragmenten, ScribeStatusregel, TranscriptRuimte } from "./scribe-statusregel";
import { StaatPaneel } from "./staat-paneel";
import { TranscriptPaneel } from "./transcript-paneel";
import { VerslagReview } from "./verslag-review";

// Werkruimte en verslagreview van één consult (handoff 20 §7.3/§7.4).
//
// STABIELE TOEGANKELIJKE NAMEN — de e2e- en a11y-suites hangen hieraan; wijzig
// ze niet zonder de tests mee te nemen:
//   Knoppen:   "Nieuw consult", "Consult starten", "Demo-opname",
//              "Demo-opname stoppen" (alleen terwijl het gescripte consult
//              loopt), "Volledig afspelen", "Nu analyseren",
//              "Opnieuw analyseren", "Consult afronden", "Stop eerst de
//              opname" (alleen terwijl de microfoon loopt — dan is
//              "Consult afronden" uitgeschakeld), "Alles goedkeuren",
//              "Goedkeuren", "Bewerken", "Kopiëren voor EPD",
//              "Downloaden (.txt)", "Kopieer sectie", "Verslagtekst tonen",
//              "Verslagtekst verbergen", "Overgenomen in het EPD",
//              "Verwijderen", "Verslag vrijgeven", "Vrijgave intrekken",
//              "Opslaan", "Regel toevoegen", "Opnieuw verzenden",
//              "Correctie bewaren", "Herstel origineel", "Intrekken: <feit>",
//              "Medicatie toevoegen", "Allergie toevoegen",
//              "EPD-lijst plakken", "Lijst overnemen",
//              "Toestemming ingetrokken — werkkopie wissen",
//              "Logboek downloaden (.csv)", "Vorige", "Volgende"
//   Koppen:    "Consulten", "Nieuw consult", "Scribe-instellingen",
//              "Scribe-logboek", "Consult van een collega"
//   Tabs:      "Transcript", "Notities", "Aanwijzingen", "Verslag"
//   Badges:    "Actief", "Te beoordelen", "Goedgekeurd", "Overgenomen",
//              "Geannuleerd", "Zelf aangevuld", "Ingevuld"
//   Velden:    label "Dossierreferentie", "Consulttype", "Verslagformaat",
//              "Grond", "Middel", "Dosering", "Gebruik",
//              "Allergie of intolerantie", "Aard",
//              "Actuele medicatie & allergieën uit het EPD", "Handeling",
//              "Vanaf", "Tot en met", "Zoek op dossierreferentie", en het
//              toestemmingsvinkje waarvan het label begint met
//              "De cliënt is geïnformeerd"
//   Vinkjes:   "Ik heb het verslag in het EPD opgeslagen",
//              "Ik heb de ontbrekende fragmenten aangevuld of beoordeeld."
//
// Layout: op lg+ drie panelen naast elkaar, daaronder tabs — de drie panelen
// naast elkaar op een telefoon zou horizontaal scrollen betekenen, en dat mag
// niet (mobiele gate). De tabs zijn GECONTROLEERD (C22/N12): Radix ontkoppelt
// een inactieve TabsContent, dus een §n-sprong moet eerst naar het
// transcripttabblad schakelen en pas ná die commit scrollen. Boven de tabs
// staat een altijd-gemonteerde signaalstrip, zodat een medicatiewaarschuwing
// ook zichtbaar is terwijl paneel C niet in de DOM staat.

const DATUM_TIJD = new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function momentTekst(iso: string | null): string {
  if (!iso) return "—";
  const tijdstip = Date.parse(iso);
  return Number.isNaN(tijdstip) ? "—" : DATUM_TIJD.format(new Date(tijdstip));
}

function timerTekst(startIso: string | null, nu: number): string {
  if (!startIso) return "0:00";
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return "0:00";
  const totaal = Math.max(0, Math.round((nu - start) / 1_000));
  const minuten = Math.floor(totaal / 60);
  return `${minuten}:${String(totaal % 60).padStart(2, "0")}`;
}

/**
 * Bewust een matchMedia-hook in plaats van twee CSS-verborgen varianten: de
 * panelen dragen segment-id's (`scribe-segment-n`) waar de herkomstknoppen
 * naartoe scrollen. Twee keer dezelfde boom in de DOM zou die id's dubbel
 * maken — ongeldige HTML en een onvoorspelbare sprong.
 */
function useBreedScherm(): boolean {
  const [breed, setBreed] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const meet = () => setBreed(query.matches);
    meet();
    query.addEventListener("change", meet);
    return () => query.removeEventListener("change", meet);
  }, []);
  return breed;
}

/** Telbadge op een tabtrigger (N12) — nul toont niets. */
function TabTelling({ aantal }: Readonly<{ aantal: number }>) {
  if (aantal <= 0) return null;
  return (
    <Badge variant="secondary" className="ml-1.5 px-1.5 text-[0.65rem]">
      {aantal}
    </Badge>
  );
}

export function ConsultWerkruimte({ sessieId }: Readonly<{ sessieId: string }>) {
  const grondId = useId();
  const [sessie, setSessie] = useState<ScribeSessie | null>(null);
  const [metadata, setMetadata] = useState<ScribeSessieMetadata | null>(null);
  const [segmenten, setSegmenten] = useState<ScribeSegment[]>([]);
  const segmentenRef = useRef(segmenten);
  segmentenRef.current = segmenten;
  const [envelop, setEnvelop] = useState<StaatEnvelop | null>(null);
  const [notitie, setNotitie] = useState<ScribeNotitie | null>(null);
  const [taken, setTaken] = useState<ScribeTaak[]>([]);
  const [instellingen, setInstellingen] = useState<ScribeInstellingen>(EMPTY_SCRIBE_INSTELLINGEN);
  const [rol, setRol] = useState<"eigenaar" | "vrijgave" | "beheerder">("eigenaar");
  const [vrijgaveReden, setVrijgaveReden] = useState<string | null>(null);
  const [bron, setBron] = useState<ScribeBron>("centraal");
  const [providerBeschikbaar, setProviderBeschikbaar] = useState(false);
  const [webview, setWebview] = useState(false);
  const [gemarkeerd, setGemarkeerd] = useState<number[]>([]);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  // C24 — één vlag per operatie plus een re-entry-ref: een analyse die eerder
  // klaar is dan de PATCH mag "Consult afronden" niet middenin heropenen.
  const [analyseBezig, setAnalyseBezig] = useState(false);
  const [statusBezig, setStatusBezig] = useState(false);
  const [notitieBezig, setNotitieBezig] = useState(false);
  const [staatBezig, setStaatBezig] = useState(false);
  const [epdBezig, setEpdBezig] = useState(false);
  const onbewaardeTekst = useUnsentScribeDraft(sessieId);
  const [demoBezig, setDemoBezig] = useState(false);
  const [demoLoopt, setDemoLoopt] = useState(false);
  const [demoRest, setDemoRest] = useState(0);
  const [plafondBereikt, setPlafondBereikt] = useState(false);
  const [grond, setGrond] = useState<GeannuleerdGrond>("toestemming_ingetrokken");
  const [laden, setLaden] = useState(true);
  const [klok, setKlok] = useState(() => Date.now());
  const [werkTab, setWerkTab] = useState("transcript");
  const [verslagTab, setVerslagTab] = useState("verslag");
  const breedScherm = useBreedScherm();
  const analyseLooptRef = useRef(false);
  const statusLooptRef = useRef(false);
  const scrollDoelRef = useRef<number | null>(null);
  const envelopRef = useRef(envelop);
  envelopRef.current = envelop;
  const bewaarEnvelop = useCallback((value: StaatEnvelop | null) => {
    envelopRef.current = value;
    setEnvelop(value);
  }, []);
  const verouderAnalyse = (laatsteSegment: number) => {
    const huidig = envelopRef.current;
    if (!huidig) return;
    const { gesprekscontext: _verouderdeContext, ...staat } = huidig.staat;
    bewaarEnvelop({ ...huidig, staat, verouderd: true, laatsteSegment, epdLijstBeoordeeld: false });
  };
  const notitieRef = useRef(notitie);
  notitieRef.current = notitie;
  const notitieWachtrijRef = useRef<Promise<unknown>>(Promise.resolve());
  const notitiePendingRef = useRef(0);
  const bewaarNotitie = useCallback((value: ScribeNotitie | null) => {
    notitieRef.current = value;
    setNotitie(value);
  }, []);

  const laad = useCallback(async () => {
    const resultaat = await haalSessie(sessieId);
    if (!resultaat.ok) {
      setLaden(false);
      setFout(resultaat.fout);
      return;
    }
    if (resultaat.rol === "beheerder") {
      setMetadata(resultaat.sessie);
      setSessie(null);
    } else {
      setSessie(resultaat.sessie);
      setMetadata(null);
    }
    setSegmenten(resultaat.segmenten);
    bewaarEnvelop(resultaat.staat);
    bewaarNotitie(resultaat.notitie);
    setTaken(resultaat.taken);
    setInstellingen(resultaat.instellingen);
    setRol(resultaat.rol);
    setVrijgaveReden(resultaat.vrijgaveReden);
    setBron(resultaat.bron);
    setLaden(false);
    if (resultaat.bron === "lokaal") setDemoRest(demoRestSegmenten(sessieId));
  }, [sessieId, bewaarNotitie, bewaarEnvelop]);

  useEffect(() => {
    void laad();
  }, [laad]);

  useEffect(() => {
    setWebview(hasCareonNativeFileBridge());
    void (async () => {
      const resultaat = await haalScribeInstellingen();
      if (resultaat.ok)
        setProviderBeschikbaar(
          resultaat.instellingen.transcriptieAan && resultaat.providerStatus.transcriptieProvider !== null,
        );
    })();
  }, []);

  // Loopklok voor de consultduur; alleen relevant zolang het consult loopt.
  useEffect(() => {
    if (sessie?.status !== "actief") return;
    const interval = window.setInterval(() => setKlok(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [sessie?.status]);

  const voerAnalyseUit = useCallback(async () => {
    if (analyseLooptRef.current) return;
    analyseLooptRef.current = true;
    setAnalyseBezig(true);
    try {
      const resultaat = await analyseer(sessieId);
      if (!resultaat.ok) {
        setFout(resultaat.fout);
        return;
      }
      bewaarEnvelop(resultaat.envelop);
      setTaken(resultaat.taken);
      // C17/C54 — de ronde schreef sprekers en ASR-correcties al weg; die ter
      // plekke invoegen in plaats van alles opnieuw laden, want een volledige
      // herlaadslag racet met de fragmenten die tijdens de analyse binnenkomen.
      // De guards spiegelen de route: alleen een nog `onbekend` spreker, en
      // nooit over een behandelaarscorrectie heen (S8/S9).
      if (resultaat.sprekers.length > 0 || resultaat.correcties.length > 0) {
        const sprekerPer = new Map(resultaat.sprekers.map((rij) => [rij.volgnummer, rij.spreker]));
        const correctiePer = new Map(resultaat.correcties.map((rij) => [rij.volgnummer, rij.tekstGecorrigeerd]));
        setSegmenten((huidig) =>
          huidig.map((rij) => {
            const spreker = rij.spreker === "onbekend" ? sprekerPer.get(rij.volgnummer) : undefined;
            const correctie = rij.correctieBron === "behandelaar" ? undefined : correctiePer.get(rij.volgnummer);
            if (spreker === undefined && correctie === undefined) return rij;
            return {
              ...rij,
              spreker: spreker ?? rij.spreker,
              tekstGecorrigeerd: correctie ?? rij.tekstGecorrigeerd,
              correctieBron: correctie !== undefined ? "ai" : rij.correctieBron,
            };
          }),
        );
      }
      setFout(null);
    } finally {
      analyseLooptRef.current = false;
      setAnalyseBezig(false);
    }
  }, [sessieId, bewaarEnvelop]);

  const opname = useScribeOpname({
    sessieId,
    beginMs: segmenten.reduce((eind, segment) => Math.max(eind, segment.eindMs ?? 0), sessie?.duurMs ?? 0),
    onSegmenten: (nieuwe, teller) => {
      setSegmenten((huidig) => [...new Map([...huidig, ...nieuwe].map((rij) => [rij.id, rij])).values()]);
      setSessie((huidig) => (huidig ? { ...huidig, segmentTeller: teller } : huidig));
    },
    onGat: (nieuwe, _duurMs, ontbrekendeFragmenten) => {
      const bekende = new Set(segmentenRef.current.map((rij) => rij.id));
      const nieuweGaten = nieuwe.filter((rij) => rij.bron === "systeem" && !bekende.has(rij.id)).length;
      setSegmenten((huidig) => [...new Map([...huidig, ...nieuwe].map((rij) => [rij.id, rij])).values()]);
      setSessie((huidig) =>
        huidig
          ? { ...huidig, ontbrekendeFragmenten: ontbrekendeFragmenten ?? huidig.ontbrekendeFragmenten + nieuweGaten }
          : huidig,
      );
    },
    onFout: (tekst) => setFout(tekst),
    onAnalyseNodig: () => void voerAnalyseUit(),
  });

  const opnameLoopt = opname.status === "opnemen" || opname.status === "gepauzeerd" || opname.status === "starten";

  // N15 — de schil moet weten dát er wordt opgenomen: subnav, "Naar modules" en
  // uitloggen vragen dan eerst om bevestiging in plaats van stil weg te gaan.
  useEffect(() => {
    zetOpnameActief(opnameLoopt || !opname.wachtrijLeeg || onbewaardeTekst);
  }, [opnameLoopt, opname.wachtrijLeeg, onbewaardeTekst]);
  useEffect(() => () => zetOpnameActief(false), []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (hasUnsentScribeDraft(sessieId)) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [sessieId]);

  // De opnamehook wisselt van identiteit bij elke render; de effecten hieronder
  // mogen daar niet op afgaan, dus ze lezen hem uit een ref en hangen alleen aan
  // de twee statussen die er werkelijk toe doen.
  const opnameRef = useRef(opname);
  opnameRef.current = opname;
  const sessieStatus = sessie?.status ?? null;
  const segmentTeller = sessie?.segmentTeller ?? 0;
  const opnameStatus = opname.status;

  // N1 — verlaat het consult de status `actief` (afgerond, geannuleerd, of van
  // de server geladen als al beëindigd), dan gaat de microfoon uit. Anders
  // loopt de opname door en belandt het gesprek ná het consult in dit dossier.
  useEffect(() => {
    if (sessieStatus === null || sessieStatus === "actief") return;
    if (opnameStatus === "uit" || opnameStatus === "stoppen") return;
    void opnameRef.current.stop();
  }, [sessieStatus, opnameStatus]);

  // N15e — bij het segmentplafond stopt de opname zelf; doorpraten levert
  // alleen nog gatsegmenten op.
  useEffect(() => {
    if (segmentTeller < SCRIBE_LIMITS.segmentenPerSessie) return;
    setPlafondBereikt(true);
    if (opnameStatus === "opnemen" || opnameStatus === "gepauzeerd") void opnameRef.current.stop();
  }, [segmentTeller, opnameStatus]);

  // C35 (punt 3) — als de klokbewuste inhaallus van de server vóór het einde
  // van het transcript afbrak, weigert POST /notitie met 409 ("de analyse loopt
  // achter"). Zonder deze lus was dat na afronden een doodlopend pad: het
  // staatpaneel is dan al ontkoppeld. We halen de analyse hier in (max. 6
  // rondes, de server verwerkt er per ronde 40 segmenten) en proberen opnieuw.
  const genereerMetInhaal = async (formaat?: ScribeNotitie["formaat"]) => {
    let resultaat = await genereerNotitie(sessieId, formaat);
    for (let ronde = 0; !resultaat.ok && resultaat.status === 409 && ronde < 6; ronde += 1) {
      const analyse = await analyseer(sessieId);
      if (!analyse.ok) break;
      resultaat = await genereerNotitie(sessieId, formaat);
    }
    return resultaat;
  };

  const zetStatus = async (status: ScribeSessie["status"], annuleerGrond?: GeannuleerdGrond) => {
    if (statusLooptRef.current) return;
    if (status === "afgerond" && (hasUnsentScribeDraft(sessieId) || !opnameRef.current.wachtrijLeeg)) {
      setFout("Verzend of wis eerst de handmatige invoer en verwerk alle resterende fragmenten.");
      return;
    }
    statusLooptRef.current = true;
    setStatusBezig(true);
    try {
      // N1 — eerst de microfoon stoppen (dat leegt ook de wachtrij), pas daarna
      // de statusovergang.
      if (opname.status !== "uit" && opname.status !== "stoppen") await opname.stop();
      const resultaat = await wijzigSessie(sessieId, {
        status,
        ...(annuleerGrond ? { grond: annuleerGrond } : {}),
      });
      if (!resultaat.ok) {
        setFout(resultaat.fout);
        return;
      }
      setSessie(resultaat.sessie);
      setFout(null);
      if (status === "afgerond") {
        clearScribeDraft(sessieId);
        const verslag = await genereerMetInhaal();
        if (verslag.ok) bewaarNotitie(verslag.notitie);
        else setFout(verslag.fout);
      }
      setMelding(null);
      await laad();
    } finally {
      statusLooptRef.current = false;
      setStatusBezig(false);
    }
  };

  // ── Demo-motor (C20) ──────────────────────────────────────────────────────
  // "Demo-opname" is getempode weergave op DEMO_SEGMENT_INTERVAL_MS; "Volledig
  // afspelen" blijft de eenmalige sprong. De analyse draait NA de reeks — per
  // tik analyseren zou door `analyseLooptRef` stil worden weggegooid.
  useEffect(() => {
    if (!demoLoopt) return;
    const interval = window.setInterval(() => {
      const uitkomst = speelDemoOpname(sessieId);
      if (!uitkomst) {
        setDemoLoopt(false);
        return;
      }
      setSegmenten((huidig) => [...huidig, ...uitkomst.segmenten]);
      setDemoRest(uitkomst.rest);
      if (uitkomst.rest === 0) setDemoLoopt(false);
    }, DEMO_SEGMENT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [demoLoopt, sessieId]);

  // Het consult mag intussen zijn afgerond: dan stopt de gescripte weergave.
  useEffect(() => {
    if (demoLoopt && sessie && sessie.status !== "actief") setDemoLoopt(false);
  }, [demoLoopt, sessie]);

  const demoAfgerondRef = useRef(false);
  useEffect(() => {
    if (demoLoopt) {
      demoAfgerondRef.current = true;
      return;
    }
    if (!demoAfgerondRef.current) return;
    demoAfgerondRef.current = false;
    void (async () => {
      await voerAnalyseUit();
      await laad();
    })();
  }, [demoLoopt, voerAnalyseUit, laad]);

  const speelAlles = async () => {
    setDemoBezig(true);
    setDemoLoopt(false);
    const uitkomst = speelDemoAlles(sessieId);
    if (uitkomst) {
      setSegmenten((huidig) => [...huidig, ...uitkomst.segmenten]);
      setDemoRest(uitkomst.rest);
      await voerAnalyseUit();
      await laad();
    }
    setDemoBezig(false);
  };

  const wijzigSpreker = async (volgnummer: number, spreker: Spreker) => {
    const resultaat = await wijzigSegment(sessieId, volgnummer, { spreker });
    if (!resultaat.ok) {
      setFout(resultaat.fout);
      return;
    }
    setSegmenten((huidig) => huidig.map((rij) => (rij.volgnummer === volgnummer ? resultaat.segment : rij)));
    if (resultaat.verouderd) {
      verouderAnalyse(resultaat.laatsteSegment);
    }
    setFout(null);
  };

  /** C19 — de editor sluit alleen bij succes; de getypte correctie blijft anders staan. */
  const corrigeerSegment = async (volgnummer: number, tekst: string | null): Promise<boolean> => {
    const resultaat = await wijzigSegment(sessieId, volgnummer, { tekstGecorrigeerd: tekst });
    if (!resultaat.ok) {
      setFout(resultaat.fout);
      return false;
    }
    setSegmenten((huidig) => huidig.map((rij) => (rij.volgnummer === volgnummer ? resultaat.segment : rij)));
    if (resultaat.verouderd) {
      verouderAnalyse(resultaat.laatsteSegment);
    }
    setFout(null);
    return true;
  };

  /** N13/C19 — de invoerregel wist zichzelf pas na een geslaagde POST. */
  const voegHandmatigToe = async (tekst: string, spreker: Spreker): Promise<boolean> => {
    const resultaat = await voegSegmentToe(sessieId, tekst, spreker, "handmatig");
    if (!resultaat.ok) {
      setFout(resultaat.fout);
      return false;
    }
    setSegmenten((huidig) => [...huidig, ...resultaat.segmenten]);
    setSessie((huidig) => (huidig ? { ...huidig, segmentTeller: resultaat.segmentTeller } : huidig));
    setFout(null);
    return true;
  };

  /** N6/S7 — behandelaarscorrectie op de klinische staat. */
  const muteerStaat = async (
    categorie: StaatCategorie,
    actie: StaatMutatieActie,
    feit: StaatFeitInvoer,
  ): Promise<boolean> => {
    const huidige = envelopRef.current;
    if (!huidige) {
      setFout("Er is nog geen consultstaat om te corrigeren. Analyseer eerst het transcript.");
      return false;
    }
    setStaatBezig(true);
    try {
      const resultaat = await wijzigStaat(sessieId, { versie: huidige.versie, categorie, actie, feit });
      if (!resultaat.ok) {
        setFout(resultaat.fout);
        return false;
      }
      bewaarEnvelop(resultaat.envelop);
      setFout(null);
      return true;
    } finally {
      setStaatBezig(false);
    }
  };

  /**
   * N6 — geplakte EPD-lijst: dezelfde deterministische extractie als op het
   * transcript, daarna één mutatie per gevonden middel of allergie. De tekst
   * zelf verlaat de browser niet; alleen de gevonden feiten gaan mee.
   */
  const neemEpdLijstOver = async (tekst: string): Promise<boolean> => {
    const consultType = sessie?.consultType ?? instellingen.standaardFormaat;
    const { medicatie, allergieen } = extraheerEpdLijst(tekst, consultType);
    if (medicatie.length === 0 && allergieen.length === 0) {
      setFout("In deze lijst herkende Careon geen middel of allergie. Vul de regels los aan.");
      return false;
    }
    setEpdBezig(true);
    try {
      for (const rij of medicatie) {
        if (
          !(await muteerStaat("medicatie", "toevoegen", {
            tekst: rij.naam,
            naam: rij.naam,
            dosering: rij.dosering,
            gebruik: rij.gebruik,
          }))
        )
          return false;
      }
      for (const rij of allergieen) {
        if (!(await muteerStaat("allergieen", "toevoegen", { tekst: rij.tekst, aard: rij.aard }))) return false;
      }
      setMelding(
        `${medicatie.length} middel(en) en ${allergieen.length} allergie(ën) uit het EPD toegevoegd aan de consultstaat. Controleer de lijst en bevestig daarna uw beoordeling.`,
      );
      return true;
    } finally {
      setEpdBezig(false);
    }
  };

  const bevestigEpdLijst = async (): Promise<boolean> => {
    const huidige = envelopRef.current;
    if (!huidige) return false;
    setStaatBezig(true);
    try {
      const resultaat = await wijzigStaat(sessieId, { versie: huidige.versie, epdLijstBeoordeeld: true });
      if (!resultaat.ok) {
        setFout(resultaat.fout);
        return false;
      }
      bewaarEnvelop(resultaat.envelop);
      setFout(null);
      return true;
    } finally {
      setStaatBezig(false);
    }
  };

  const wachtrijNotitie = <T,>(actie: () => Promise<T>): Promise<T> => {
    notitiePendingRef.current += 1;
    setNotitieBezig(true);
    const werk = notitieWachtrijRef.current.catch(() => undefined).then(actie);
    notitieWachtrijRef.current = werk;
    return werk.finally(() => {
      notitiePendingRef.current -= 1;
      setNotitieBezig(notitiePendingRef.current > 0);
    });
  };

  const patchSectie = (
    sectieId: string,
    patch: { tekst?: string; status?: VerslagSectie["status"] },
    ontbrekendeFragmentenBeoordeeld?: boolean,
  ): Promise<boolean> =>
    wachtrijNotitie(async () => {
      const huidige = notitieRef.current;
      if (!huidige) return false;
      const resultaat = await wijzigNotitie(sessieId, huidige.id, {
        bewerkRevisie: huidige.bewerkRevisie,
        secties: [{ id: sectieId, ...patch }],
        ...(ontbrekendeFragmentenBeoordeeld === undefined ? {} : { ontbrekendeFragmentenBeoordeeld }),
      });
      if (!resultaat.ok) {
        setFout(resultaat.fout);
        return false;
      }
      bewaarNotitie(resultaat.notitie);
      setFout(null);
      if (resultaat.goedgekeurd) await laad();
      return true;
    });

  const keurAllesGoed = (ontbrekendeFragmentenBeoordeeld?: boolean): Promise<string[]> =>
    wachtrijNotitie(async () => {
      const huidige = notitieRef.current;
      if (!huidige) return [];
      const resultaat = await wijzigNotitie(sessieId, huidige.id, {
        bewerkRevisie: huidige.bewerkRevisie,
        alleGoedkeuren: true,
        ...(ontbrekendeFragmentenBeoordeeld === undefined ? {} : { ontbrekendeFragmentenBeoordeeld }),
      });
      if (!resultaat.ok) {
        setFout(resultaat.fout);
        return [];
      }
      bewaarNotitie(resultaat.notitie);
      setFout(null);
      if (resultaat.goedgekeurd) await laad();
      return resultaat.overgeslagen;
    });

  const genereerOpnieuw = async (formaat?: ScribeNotitie["formaat"]) => {
    setNotitieBezig(true);
    try {
      const resultaat = await genereerMetInhaal(formaat);
      if (!resultaat.ok) {
        setFout(resultaat.fout);
        return;
      }
      bewaarNotitie(resultaat.notitie);
      setFout(null);
      await laad();
    } finally {
      setNotitieBezig(false);
    }
  };

  const zetTaak = async (taakId: string, status: TaakStatus) => {
    const resultaat = await wijzigTaak(sessieId, taakId, status);
    if (!resultaat.ok) {
      setFout(resultaat.fout);
      return;
    }
    setTaken((huidig) => huidig.map((taak) => (taak.id === taakId ? resultaat.taak : taak)));
  };

  /**
   * C22/N12 — de sprong naar §n. Op een smal scherm staat het transcript niet
   * in de DOM zolang een ander tabblad actief is: eerst schakelen, dan pas
   * scrollen. Het doel blijft in een ref staan tot het element bestaat.
   */
  const markeerBron = (bronnen: number[]) => {
    setGemarkeerd(bronnen);
    const eerste = bronnen[0];
    if (eerste === undefined) return;
    scrollDoelRef.current = eerste;
    if (!breedScherm) {
      if (sessie?.status === "actief") setWerkTab("transcript");
      else setVerslagTab("transcript");
    }
  };

  // Bewust zonder dependency-array: draait na élke commit, dus ook na de commit
  // die het transcripttabblad monteert.
  useEffect(() => {
    const doel = scrollDoelRef.current;
    if (doel === null) return;
    const element = document.getElementById(`scribe-segment-${doel}`);
    if (!element) return;
    scrollDoelRef.current = null;
    element.scrollIntoView({ block: "center" });
  });

  if (laden) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // C33 — een beheerder krijgt van een collega-consult uitsluitend metadata:
  // geen dossierreferentie, geen consulttype, geen transcript en geen knoppen.
  // Precies zoals de lijst dat al doet; beheer loopt via verwijderen/vrijgave.
  if (rol === "beheerder" && metadata) {
    return (
      <div className="@container/main flex flex-col gap-4">
        <h1 className="font-semibold text-2xl tracking-tight">Consult van een collega</h1>
        <ScribeStatusregel toon="waarschuwing">
          U ziet alleen metadata. Dossierreferentie, consulttype, transcript en verslag blijven bij de behandelaar die
          het consult voerde.
        </ScribeStatusregel>
        <dl className="grid gap-2 rounded-lg border p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">Status</dt>
            <dd>{SESSIE_STATUS_LABELS[metadata.status]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">Gestart</dt>
            <dd>{momentTekst(metadata.gestartOp ?? metadata.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">Transcriptregels</dt>
            <dd className="tabular-nums">{metadata.segmentTeller}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">Opschoning</dt>
            <dd>{momentTekst(metadata.sessieVerwijderNa)}</dd>
          </div>
        </dl>
        <Button variant="outline" onClick={() => window.location.assign("/scribe")}>
          Terug naar consulten
        </Button>
      </div>
    );
  }

  if (!sessie) {
    return (
      <div className="space-y-3">
        <ScribeStatusregel toon="fout">{fout ?? "Dit consult bestaat niet (meer)."}</ScribeStatusregel>
        <Button variant="outline" onClick={() => window.location.assign("/scribe")}>
          Terug naar consulten
        </Button>
      </div>
    );
  }

  const actief = sessie.status === "actief";
  const staat = envelop?.staat ?? null;
  const regelWaarschuwingen = (staat?.waarschuwingen ?? []).filter((rij) => rij.herkomst === "regel");
  const openOntbrekend = (staat?.ontbrekend ?? []).filter((rij) => rij.status === "open");
  const verouderd = envelop?.verouderd === true;
  // N6 — de eerlijkheidsregel verdwijnt zodra de behandelaar zelf medicatie of
  // allergieën heeft aangevuld; dat is het moment waarop de check meer dekt dan
  // wat toevallig hardop is gezegd.
  const epdLijstIngevuld = envelop?.epdLijstBeoordeeld === true;
  const notitiesTelling = (staat?.medicatie.length ?? 0) + (staat?.allergieen.length ?? 0);
  const aanwijzingenTelling = regelWaarschuwingen.length + openOntbrekend.length;

  const transcriptPaneel = (
    <TranscriptPaneel
      sessieId={sessieId}
      segmenten={segmenten}
      gemarkeerd={gemarkeerd}
      bewerkbaar={rol === "eigenaar" && (actief || sessie.status === "afgerond")}
      invoerToegestaan={actief}
      onSpreker={(volgnummer, spreker) => void wijzigSpreker(volgnummer, spreker)}
      onCorrectie={corrigeerSegment}
      onHandmatig={voegHandmatigToe}
    />
  );
  const staatPaneelNode = (
    <StaatPaneel
      envelop={envelop}
      bezig={analyseBezig || staatBezig || epdBezig}
      bewerkbaar={rol === "eigenaar" && (actief || sessie.status === "afgerond")}
      epdLijstIngevuld={epdLijstIngevuld}
      onAnalyse={() => void voerAnalyseUit()}
      onBron={markeerBron}
      onMutatie={muteerStaat}
      onEpdLijst={neemEpdLijstOver}
      onEpdBeoordeeld={bevestigEpdLijst}
    />
  );
  const verslagNode = (
    <VerslagReview
      sessie={sessie}
      notitie={notitie}
      instellingen={instellingen}
      bron={bron}
      rol={rol}
      vrijgaveReden={vrijgaveReden}
      bezig={notitieBezig || statusBezig}
      bronVerouderd={verouderd}
      gesprekscontext={rol === "eigenaar" && !verouderd ? envelop?.staat.gesprekscontext : undefined}
      segmenten={rol === "eigenaar" ? segmenten : undefined}
      onSectie={patchSectie}
      onAlleGoedkeuren={keurAllesGoed}
      onOpnieuwGenereren={(formaat) => void genereerOpnieuw(formaat)}
      onOvergenomen={() => void zetStatus("overgenomen")}
      onWerkkopieWissen={(reden) => void zetStatus("geannuleerd", reden)}
      onBron={markeerBron}
    />
  );
  const aanwijzingenNode = (
    <AanwijzingenPaneel
      envelop={envelop}
      instellingen={instellingen}
      taken={taken}
      bewerkbaar={actief}
      epdLijstIngevuld={epdLijstIngevuld}
      onTaakStatus={(taakId, status) => void zetTaak(taakId, status)}
      onBron={markeerBron}
    />
  );

  /** N12 — altijd gemonteerd boven de tabs, ook als paneel C niet in de DOM staat. */
  const signaalStrip =
    !breedScherm && (regelWaarschuwingen.length > 0 || verouderd) ? (
      <div className="space-y-1">
        {regelWaarschuwingen.length > 0 ? (
          <div
            role="alert"
            className="rounded-md border border-amber-600/40 bg-amber-600/10 text-amber-900 dark:text-amber-200"
          >
            <button
              type="button"
              onClick={() => (actief ? setWerkTab("aanwijzingen") : setVerslagTab("verslag"))}
              className="w-full px-3 py-2 text-left text-xs"
            >
              {regelWaarschuwingen.length} gecontroleerd medicatiesignaal
              {regelWaarschuwingen.length === 1 ? "" : "en"}: {regelWaarschuwingen[0].tekst}
            </button>
          </div>
        ) : null}
        {verouderd ? (
          <div role="alert" className="rounded-md border text-amber-700 dark:text-amber-400">
            <button
              type="button"
              onClick={() => (actief ? setWerkTab("notities") : setVerslagTab("verslag"))}
              className="w-full px-3 py-2 text-left text-xs"
            >
              Analyse verouderd sinds uw correctie — opnieuw analyseren.
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

  // Één laagvariant tegelijk in de DOM (zie useBreedScherm): dubbele segment-
  // id's zouden de herkomstsprong onvoorspelbaar maken.
  let panelen: ReactNode;
  if (actief && breedScherm) {
    panelen = (
      <div className="grid gap-4 lg:grid-cols-3">
        {transcriptPaneel}
        {staatPaneelNode}
        {aanwijzingenNode}
      </div>
    );
  } else if (actief) {
    panelen = (
      <div className="space-y-2">
        {signaalStrip}
        <Tabs value={werkTab} onValueChange={setWerkTab}>
          <TabsList>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="notities">
              Notities
              <TabTelling aantal={notitiesTelling} />
            </TabsTrigger>
            <TabsTrigger value="aanwijzingen">
              Aanwijzingen
              <TabTelling aantal={aanwijzingenTelling} />
            </TabsTrigger>
          </TabsList>
          <TabsContent value="transcript">{transcriptPaneel}</TabsContent>
          <TabsContent value="notities">{staatPaneelNode}</TabsContent>
          <TabsContent value="aanwijzingen">{aanwijzingenNode}</TabsContent>
        </Tabs>
      </div>
    );
  } else if (breedScherm) {
    panelen = (
      <div className="grid gap-4 lg:grid-cols-2">
        {verslagNode}
        {transcriptPaneel}
      </div>
    );
  } else {
    panelen = (
      <div className="space-y-2">
        {signaalStrip}
        <Tabs value={verslagTab} onValueChange={setVerslagTab}>
          <TabsList>
            <TabsTrigger value="verslag">Verslag</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
          </TabsList>
          <TabsContent value="verslag">{verslagNode}</TabsContent>
          <TabsContent value="transcript">{transcriptPaneel}</TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="@container/main flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex flex-wrap items-center gap-2 font-semibold text-2xl tracking-tight">
            {sessie.patientReferentie}
            <Badge variant="outline">{CONSULT_TYPE_LABELS[sessie.consultType]}</Badge>
          </h1>
          <p className="text-muted-foreground text-sm">
            {actief ? `Loopt ${timerTekst(sessie.gestartOp, klok)}` : "Het EPD blijft het juridische dossier."}
          </p>
        </div>
        {actief ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={statusBezig || opnameLoopt || !opname.wachtrijLeeg || onbewaardeTekst}
              onClick={() => void zetStatus("afgerond")}
            >
              {statusBezig ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
              {opnameLoopt ? "Stop eerst de opname" : "Consult afronden"}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" className="text-muted-foreground" disabled={statusBezig}>
                  <XCircle className="size-4" />
                  Annuleren
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Dit consult annuleren?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Transcript en notities worden direct gewist. Alleen de sessiemetadata blijft nog kort staan en
                    verdwijnt bij de dagelijkse opschoning.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-1.5">
                  <Label htmlFor={grondId}>Grond</Label>
                  <NativeSelect
                    id={grondId}
                    className="w-full"
                    value={grond}
                    onChange={(gebeurtenis) => setGrond(gebeurtenis.target.value as GeannuleerdGrond)}
                  >
                    {GEANNULEERD_GRONDEN.map((waarde) => (
                      <NativeSelectOption key={waarde} value={waarde}>
                        {GEANNULEERD_GROND_LABELS[waarde]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <p className="text-muted-foreground text-xs">
                    De grond gaat metadata-only mee in het logboek; noteer nooit consultinhoud.
                  </p>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Terug</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void zetStatus("geannuleerd", grond)}>
                    Consult annuleren
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </div>

      {bron === "lokaal" ? (
        <ScribeStatusregel>Lokale demo-opslag — geen centrale registratie.</ScribeStatusregel>
      ) : null}
      <OntbrekendeFragmenten aantal={sessie.ontbrekendeFragmenten + opname.lokaleGaten} />
      {onbewaardeTekst ? (
        <ScribeStatusregel>
          Er staat nog handmatige invoer klaar. Verzend of wis die tekst voordat u het consult afrondt.
        </ScribeStatusregel>
      ) : null}
      {actief ? <TranscriptRuimte segmentTeller={sessie.segmentTeller} /> : null}
      {opname.offline ? (
        <p
          role="alert"
          className="rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-amber-800 text-xs dark:text-amber-300"
        >
          Geen verbinding — opname gepauzeerd, {opname.wachtrij} fragment
          {opname.wachtrij === 1 ? "" : "en"} wachten. Zodra de verbinding terug is, gaat het verzenden verder.
        </p>
      ) : null}
      {fout ? <ScribeStatusregel toon="fout">{fout}</ScribeStatusregel> : null}
      {melding ? <ScribeStatusregel toon="goed">{melding}</ScribeStatusregel> : null}
      {actief && !opname.wachtrijLeeg ? (
        <ScribeStatusregel toon="bezig">{opnameWachtrijTekst(opname.status)}</ScribeStatusregel>
      ) : null}

      {actief ? (
        <OpnameBesturing
          bron={bron}
          providerBeschikbaar={providerBeschikbaar}
          webview={webview}
          opname={opname}
          demoRest={demoRest}
          demoBezig={demoBezig}
          demoLoopt={demoLoopt}
          onDemoStap={() => setDemoLoopt((aan) => !aan)}
          onDemoAlles={() => void speelAlles()}
        />
      ) : null}

      {panelen}

      <AlertDialog open={plafondBereikt} onOpenChange={setPlafondBereikt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transcriptieruimte vol</AlertDialogTitle>
            <AlertDialogDescription>
              Dit consult heeft het maximum van {SCRIBE_LIMITS.segmentenPerSessie} transcriptregels bereikt. De opname
              is gestopt. Rond dit consult af en start zo nodig een vervolgconsult voor hetzelfde dossier.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Terug</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPlafondBereikt(false);
                void zetStatus("afgerond");
              }}
            >
              Consult afronden en vervolgconsult starten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

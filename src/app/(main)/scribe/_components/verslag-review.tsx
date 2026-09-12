"use client";

import { useEffect, useId, useRef, useState } from "react";

import { CheckCheck, Copy, Download, FileCheck2, FileText, Loader2, Pencil, RefreshCcw, Trash2 } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { GEANNULEERD_GROND_LABELS, SECTIE_STATUS_LABELS } from "@/data/careon/careon-scribe";
import { saveBlobThroughCareon } from "@/lib/careon-mobile/native-file.client";
import { ENGLISH_FACT_REPORT_HEADER } from "@/lib/careon-scribe/english-report";
import { bouwSectieTekst } from "@/lib/careon-scribe/export-tekst";
import { FORMAAT_KEUZES, isBeoordelingsSectie } from "@/lib/careon-scribe/formaten";
import {
  GESPREKSCONTEXT_KOP,
  geldigeGesprekscontext,
  renderGesprekscontext,
} from "@/lib/careon-scribe/gesprekscontext";
import { bronLabel } from "@/lib/careon-scribe/klinische-staat";
import { exporteerVerslag, registreerVerslagExport, type ScribeBron } from "@/lib/careon-scribe/remote.client";
import { berekenRetentie } from "@/lib/careon-scribe/retentie";
import {
  type ConsultType,
  GEANNULEERD_GRONDEN,
  type GeannuleerdGrond,
  type GespreksContext,
  SCRIBE_LIMITS,
  type ScribeInstellingen,
  type ScribeNotitie,
  type ScribeSegment,
  type ScribeSessie,
  type VerslagSectie,
} from "@/lib/careon-scribe/types";
import { cn } from "@/lib/utils";

import { ScribeStatusregel } from "./scribe-statusregel";

// Verslagreview (handoff 20 §7.4) — het scherm waar de behandelaar beslist.
//
// S10 is hier de hoofdregel: ★-secties (Analyse, Beoordeling, Evaluatie,
// Werkhypothese, Overwegingen, Risicotaxatie) worden NOOIT machinaal
// geschreven. Ze staan leeg met de citaten uit het consult eronder, vallen
// buiten "Alles goedkeuren" en moeten stuk voor stuk zelf geschreven én
// goedgekeurd worden.
//
// S2: Careon schrijft niets in het EPD. Het goedgekeurde verslag wordt
// gekopieerd of gedownload en de behandelaar bevestigt zelf de overname —
// pas dán mag de werkkopie verdwijnen. "Overgenomen in het EPD" is daarom
// uitgeschakeld tot de actuele volledige versie daadwerkelijk is geëxporteerd:
// anders wist iemand een verslag dat nergens anders staat.
//
// N14 — de exporttekst wordt vooruit opgehaald zodra het verslag goedgekeurd
// is, zodat `clipboard.writeText` SYNCHROON in de klikafhandeling draait.
// Safari verliest de user activation zodra er eerst een `await` op een fetch
// staat; dan faalt het kopiëren stil en zou "Overgenomen" ten onrechte
// ontgrendelen. Er is bovendien een derde, altijd werkende weg: "Verslagtekst
// tonen" klapt de volledige tekst uit om met de hand te selecteren.
//
// N17 — kopiëren kan ook per sectie: CareCheck heeft per rubriek een eigen
// veld. De sectiekopie draagt de dossierreferentie als eerste regel en laat de
// §-bronverwijzingen weg; die wijzen naar een transcript dat bij de overname
// juist wordt gewist.

const DATUM = new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
const BRONCITATEN_BEWERKEN = "Werk deze broncitaten uit tot een gecontroleerde notitie voordat u goedkeurt.";
type GespreksCitaat = GespreksContext["citaten"][number];

/** Keep unresolved source available without mixing it into accepted fact text. */
function resterendeGesprekscitaten(context: GespreksContext[], sectie: VerslagSectie): GespreksCitaat[] {
  const volledig = renderGesprekscontext(context, sectie.id);
  if (!volledig.tekst) return [];
  // Quote-only drafts already expose this exact source in their original preview.
  if (volledig.tekst && sectie.conceptTekst.includes(volledig.tekst)) return [];
  const feitenconcept = sectie.conceptTekst.includes(ENGLISH_FACT_REPORT_HEADER);
  const perBron = new Map<string, GespreksCitaat>();
  for (const rij of context) {
    if (rij.sectieId !== sectie.id) continue;
    for (const citaat of rij.citaten) {
      if (feitenconcept && sectie.bron.includes(citaat.volgnummer) && sectie.conceptTekst.includes(citaat.tekst))
        continue;
      perBron.set(citaat.segmentId, citaat);
    }
  }
  return [...perBron.values()].sort((a, b) => a.volgnummer - b.volgnummer);
}

function GesprekscitatenBlok({
  citaten,
  titel,
  volledigeHoogte = false,
  onBron,
}: Readonly<{
  citaten: GespreksCitaat[];
  titel: string;
  volledigeHoogte?: boolean;
  onBron: (bron: number[]) => void;
}>) {
  return (
    <details open={citaten.length <= 3} className="rounded-md border p-2 text-xs">
      <summary className="cursor-pointer font-medium">Nog te controleren gesprekscitaten ({citaten.length})</summary>
      <p className="py-2 text-muted-foreground">
        Deze gesprekstekst is niet als feit in het concept opgenomen. Controleer spreker, betekenis en relevantie
        voordat u iets overneemt.
      </p>
      <section
        aria-label={`Nog te controleren gesprekscitaten: ${titel}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: alle broncitaten moeten met het toetsenbord bereikbaar blijven in het scrollgebied.
        tabIndex={0}
        className={cn("space-y-3 overflow-y-auto", !volledigeHoogte && "max-h-64")}
      >
        {citaten.map((citaat) => (
          <div key={citaat.segmentId} className="space-y-1">
            <button
              type="button"
              aria-label={`Toon transcriptregel ${citaat.volgnummer}`}
              className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => onBron([citaat.volgnummer])}
            >
              §{citaat.volgnummer}
            </button>
            <blockquote className="whitespace-pre-wrap">{citaat.tekst}</blockquote>
          </div>
        ))}
      </section>
    </details>
  );
}

function ongewijzigdBronconcept(sectie: VerslagSectie, tekst: string): boolean {
  return (
    sectie.vereistBehandelaar &&
    sectie.conceptTekst.includes(GESPREKSCONTEXT_KOP) &&
    tekst.trim() === sectie.conceptTekst.trim()
  );
}

function datumTekst(iso: string): string {
  const tijdstip = Date.parse(iso);
  return Number.isNaN(tijdstip) ? "—" : DATUM.format(new Date(tijdstip));
}

/** Dialoogtekst afgeleid uit berekenRetentie + de organisatie-instellingen. */
export function overnameGevolgTekst(instellingen: ScribeInstellingen, nu: Date = new Date()): string {
  const retentie = berekenRetentie("overgenomen", instellingen, nu);
  const transcript = instellingen.transcriptWissenBijOvername
    ? "Het transcript wordt direct gewist"
    : `Het transcript blijft zichtbaar tot ${datumTekst(retentie.transcriptVerwijderNa)}`;
  const verslag =
    instellingen.notitieRetentieDagen === 0
      ? "het verslag wordt direct en onherstelbaar verwijderd."
      : `het verslag blijft zichtbaar tot ${datumTekst(retentie.sessieVerwijderNa)}.`;
  return `${transcript}; ${verslag}`;
}

function SectieBlok({
  sectie,
  beoordelingsSectie,
  bewerkbaar,
  bronVerouderd = false,
  gesprekscitaten = [],
  exporteerbaar,
  bezig,
  concept,
  onConcept,
  onBewaar,
  onGoedkeuren,
  onHeropenen,
  onKopieer,
  onBron,
}: Readonly<{
  sectie: VerslagSectie;
  beoordelingsSectie: boolean;
  bewerkbaar: boolean;
  bronVerouderd?: boolean;
  gesprekscitaten?: GespreksCitaat[];
  exporteerbaar: boolean;
  bezig: boolean;
  concept: string;
  onConcept: (tekst: string) => void;
  onBewaar: () => void;
  onGoedkeuren: () => void;
  onHeropenen: () => void;
  onKopieer: () => void;
  onBron: (bron: number[]) => void;
}>) {
  const veldId = useId();
  const broncitatenHintId = useId();
  const scrollHintId = useId();
  const [volledigeHoogte, setVolledigeHoogte] = useState(false);
  const langeTekst =
    Math.max(
      concept.length,
      sectie.tekst.length,
      sectie.conceptTekst.length,
      gesprekscitaten.reduce((totaal, citaat) => totaal + citaat.tekst.length, 0),
    ) > 1_200;
  const goedgekeurd = sectie.status === "goedgekeurd";
  const broncitaten =
    sectie.vereistBehandelaar &&
    !beoordelingsSectie &&
    sectie.tekst.trim().length > 0 &&
    sectie.conceptTekst.includes(GESPREKSCONTEXT_KOP);
  const bronconceptOngewijzigd = !beoordelingsSectie && ongewijzigdBronconcept(sectie, concept);
  const vastgelegdeFeiten =
    sectie.vereistBehandelaar &&
    !beoordelingsSectie &&
    sectie.tekst.trim().length > 0 &&
    sectie.conceptTekst.includes(ENGLISH_FACT_REPORT_HEADER);
  let handmatigLabel = "Handmatige invoer vereist";
  if (goedgekeurd) handmatigLabel = "Afzonderlijk goedgekeurd";
  else if (sectie.status === "bewerkt") handmatigLabel = "Handmatig bewerkt — afzonderlijk controleren";
  else if (broncitaten) handmatigLabel = "Broncitaten — afzonderlijk controleren";
  else if (vastgelegdeFeiten) handmatigLabel = "Vastgelegde feiten — afzonderlijk controleren";
  let handmatigeHint = broncitaten
    ? "Controleer spreker en betekenis, bewerk of corrigeer de tekst en keur deze sectie afzonderlijk goed."
    : "Vul deze sectie zelf in op basis van het transcript en keur haar afzonderlijk goed.";
  let contextLabel = "Context voor handmatige invoer";
  if (beoordelingsSectie) {
    handmatigLabel = "Beoordeling door behandelaar";
    handmatigeHint = "Beoordeling door behandelaar — wordt niet machinaal geschreven.";
    contextLabel = "Context voor uw beoordeling";
  } else if (vastgelegdeFeiten) {
    handmatigeHint =
      "Controleer de vastgelegde feiten, pas het concept zo nodig aan en keur deze sectie afzonderlijk goed.";
    contextLabel = "Oorspronkelijk feitenconcept";
  }

  return (
    <article className={cn("space-y-2 rounded-lg border p-3", sectie.vereistBehandelaar && "border-primary/40")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="font-medium text-sm">{sectie.titel}</h3>
          {sectie.vereistBehandelaar ? <p className="text-muted-foreground text-xs">{handmatigLabel}</p> : null}
          {sectie.bron.length > 0 ? (
            <button
              type="button"
              onClick={() => onBron(sectie.bron)}
              className="text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
            >
              bronnen {bronLabel(sectie.bron)}
            </button>
          ) : null}
        </div>
        <Badge variant={goedgekeurd ? "secondary" : "outline"} className="text-xs">
          {SECTIE_STATUS_LABELS[sectie.status]}
        </Badge>
      </div>

      {broncitaten && !goedgekeurd ? (
        <p id={broncitatenHintId} className="text-muted-foreground text-xs">
          {BRONCITATEN_BEWERKEN}
        </p>
      ) : null}
      {vastgelegdeFeiten && !goedgekeurd ? <p className="text-muted-foreground text-xs">{handmatigeHint}</p> : null}

      {langeTekst ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id={scrollHintId} className="text-muted-foreground text-xs">
            {volledigeHoogte
              ? "De volledige tekst is uitgeklapt."
              : "Scroll binnen de sectie om alle tekst te lezen, of klap de weergave uit."}
          </p>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={volledigeHoogte}
            aria-controls={veldId}
            onClick={() => setVolledigeHoogte((huidig) => !huidig)}
          >
            {volledigeHoogte ? "Weergave beperken" : "Weergave uitklappen"}
          </Button>
        </div>
      ) : null}

      {goedgekeurd || !bewerkbaar ? (
        <section
          id={veldId}
          aria-label={`Sectietekst: ${sectie.titel}`}
          aria-describedby={langeTekst ? scrollHintId : undefined}
          tabIndex={langeTekst && !volledigeHoogte ? 0 : undefined}
          className={cn("overflow-y-auto whitespace-pre-wrap text-sm", !volledigeHoogte && "max-h-64")}
        >
          {sectie.tekst.trim().length > 0 ? sectie.tekst : "—"}
        </section>
      ) : (
        <Textarea
          id={veldId}
          aria-label={sectie.titel}
          aria-describedby={
            [broncitaten ? broncitatenHintId : "", langeTekst ? scrollHintId : ""].filter(Boolean).join(" ") ||
            undefined
          }
          className={cn("resize-y overflow-y-auto", !volledigeHoogte && "max-h-64")}
          value={concept}
          readOnly={bezig}
          onChange={(gebeurtenis) => onConcept(gebeurtenis.target.value)}
          onBlur={onBewaar}
          maxLength={SCRIBE_LIMITS.sectieTekst}
          rows={sectie.vereistBehandelaar ? 4 : 5}
          placeholder={sectie.vereistBehandelaar ? handmatigeHint : "Vul aan of corrigeer."}
        />
      )}

      {sectie.vereistBehandelaar && sectie.bron.length > 0 ? (
        <p className="text-muted-foreground text-xs">Uitspraken hierover in dit consult: {bronLabel(sectie.bron)}</p>
      ) : null}
      {sectie.vereistBehandelaar && sectie.conceptTekst.trim().length > 0 ? (
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer">{contextLabel}</summary>
          <section
            aria-label={`Broncontext: ${sectie.titel}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: begrensde broncontext moet met het toetsenbord scrollbaar zijn.
            tabIndex={0}
            className={cn("overflow-y-auto whitespace-pre-wrap pt-1", !volledigeHoogte && "max-h-64")}
          >
            {sectie.conceptTekst}
          </section>
        </details>
      ) : null}

      {gesprekscitaten.length > 0 && !bronVerouderd ? (
        <GesprekscitatenBlok
          citaten={gesprekscitaten}
          titel={sectie.titel}
          volledigeHoogte={volledigeHoogte}
          onBron={onBron}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {bewerkbaar && goedgekeurd ? (
          <Button size="sm" variant="outline" onClick={onHeropenen}>
            <Pencil className="size-3.5" />
            Bewerken
          </Button>
        ) : null}
        {bewerkbaar && !goedgekeurd ? (
          <Button
            size="sm"
            variant="outline"
            disabled={bronVerouderd === true || bronconceptOngewijzigd}
            aria-describedby={broncitaten ? broncitatenHintId : undefined}
            onClick={onGoedkeuren}
          >
            <FileCheck2 className="size-3.5" />
            Goedkeuren
          </Button>
        ) : null}
        {/* N17 — per rubriek kopiëren; CareCheck heeft per sectie een eigen veld. */}
        {exporteerbaar && goedgekeurd && sectie.tekst.trim().length > 0 ? (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onKopieer}>
            <Copy className="size-3.5" />
            Kopieer sectie
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function VerslagReview({
  sessie,
  notitie,
  instellingen,
  bron,
  rol,
  vrijgaveReden,
  bezig,
  bronVerouderd = false,
  gesprekscontext,
  segmenten,
  onSectie,
  onAlleGoedkeuren,
  onOpnieuwGenereren,
  onOvergenomen,
  onWerkkopieWissen,
  onBron,
}: Readonly<{
  sessie: ScribeSessie;
  notitie: ScribeNotitie | null;
  instellingen: ScribeInstellingen;
  bron: ScribeBron;
  rol: "eigenaar" | "vrijgave" | "beheerder";
  vrijgaveReden: string | null;
  bezig: boolean;
  bronVerouderd?: boolean;
  gesprekscontext?: GespreksContext[];
  segmenten?: ScribeSegment[];
  onSectie: (
    sectieId: string,
    patch: { tekst?: string; status?: VerslagSectie["status"] },
    ontbrekendeFragmentenBeoordeeld?: boolean,
  ) => Promise<boolean>;
  onAlleGoedkeuren: (ontbrekendeFragmentenBeoordeeld?: boolean) => Promise<string[]>;
  onOpnieuwGenereren: (formaat?: ConsultType) => void;
  onOvergenomen: () => void;
  onWerkkopieWissen: (grond: GeannuleerdGrond) => void;
  onBron: (bron: number[]) => void;
}>) {
  const bevestigId = useId();
  const gatenId = useId();
  const laatsteGatenId = useId();
  const formaatId = useId();
  const wisGrondId = useId();
  const alleGoedkeurenHintId = useId();
  const bronStatusId = useId();
  const [concepten, setConcepten] = useState<Record<string, string>>({});
  // C25 — secties waarin nog ongeschreven typewerk staat. Een PATCH-antwoord
  // mag die textarea niet onder de cursor terugzetten; alleen wat de server
  // bevestigd heeft wordt overgenomen.
  const vuilRef = useRef<Set<string>>(new Set());
  const [overgeslagenResultaat, setOvergeslagenResultaat] = useState<{ notitieId: string; ids: string[] } | null>(null);
  const overgeslagen =
    notitie && overgeslagenResultaat && notitie.id === overgeslagenResultaat.notitieId
      ? notitie.secties.filter(
          (sectie) => overgeslagenResultaat.ids.includes(sectie.id) && sectie.status !== "goedgekeurd",
        )
      : [];
  let overgeslagenLabel =
    overgeslagen.length === 1 ? "sectie met handmatige invoer is" : "secties met handmatige invoer zijn";
  if (notitie && overgeslagen.every((sectie) => isBeoordelingsSectie(notitie.formaat, sectie.id))) {
    overgeslagenLabel = overgeslagen.length === 1 ? "beoordelingssectie is" : "beoordelingssecties zijn";
  }
  const [gedeeldeVersie, setGedeeldeVersie] = useState<string | null>(null);
  const [bevestigdeVersie, setBevestigdeVersie] = useState<string | null>(null);
  const [gatenBeoordeeld, setGatenBeoordeeld] = useState(false);
  const [laatsteSectieId, setLaatsteSectieId] = useState<string | null>(null);
  const [formaat, setFormaat] = useState<ConsultType>(sessie.consultType);
  const [wisGrond, setWisGrond] = useState<GeannuleerdGrond>("toestemming_ingetrokken");
  const [exportTekst, setExportTekst] = useState<string | null>(null);
  const [exportNaam, setExportNaam] = useState<string | null>(null);
  const [exportVersie, setExportVersie] = useState<string | null>(null);
  const versieSleutel = notitie ? `${notitie.id}:${notitie.bewerkRevisie}` : "";
  const versieRef = useRef(versieSleutel);
  versieRef.current = versieSleutel;
  const [zichtbareVersie, setZichtbareVersie] = useState<string | null>(null);
  const gedeeld = versieSleutel !== "" && gedeeldeVersie === versieSleutel;
  const bevestigd = versieSleutel !== "" && bevestigdeVersie === versieSleutel;
  const tekstZichtbaar = versieSleutel !== "" && zichtbareVersie === versieSleutel;
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const notitieId = notitie?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `notitieId` is juist de TRIGGER — bij een nieuwe verslagversie moeten de vuile concepten vervallen; de body leest hem niet
  useEffect(() => {
    // Nieuwe verslagversie: oude concepten mogen de opnieuw gegenereerde tekst
    // niet maskeren.
    vuilRef.current = new Set();
  }, [notitieId]);

  useEffect(() => {
    if (!notitie) return;
    setConcepten((huidig) =>
      Object.fromEntries(
        notitie.secties.map((sectie) => {
          const concept = huidig[sectie.id];
          if (concept === sectie.tekst) vuilRef.current.delete(sectie.id);
          return [sectie.id, vuilRef.current.has(sectie.id) && concept !== undefined ? concept : sectie.tekst];
        }),
      ),
    );
  }, [notitie]);

  useEffect(() => {
    if (notitie) setFormaat(notitie.formaat);
  }, [notitie]);

  // N14 — exporttekst vooruit ophalen zodra het verslag goedgekeurd is, zodat
  // het klembord synchroon in de klik kan worden gevuld.
  const goedgekeurd = notitie?.status === "goedgekeurd";
  const consultTijdstip = sessie.gestartOp ?? sessie.createdAt;
  useEffect(() => {
    setExportTekst(null);
    setExportNaam(null);
    setExportVersie(null);
    if (!goedgekeurd) return;
    let geldig = true;
    void (async () => {
      const resultaat = await exporteerVerslag(sessie.id, { formaat: "txt", consultTijdstip, preview: true });
      if (!geldig) return;
      if (resultaat.ok) {
        setExportTekst(resultaat.tekst);
        setExportNaam(resultaat.bestandsnaam);
        setExportVersie(versieSleutel);
      }
    })();
    return () => {
      geldig = false;
    };
  }, [goedgekeurd, sessie.id, consultTijdstip, versieSleutel]);

  if (!notitie) {
    return (
      <section aria-label="Verslag" className="space-y-3">
        <h2 className="font-medium text-sm">Verslag</h2>
        <p className="text-muted-foreground text-sm">
          Er is nog geen verslag opgesteld voor dit consult. Genereer er een uit de consultstaat.
        </p>
        <Button variant="outline" disabled={bezig} onClick={() => onOpnieuwGenereren()}>
          {bezig ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
          Verslag opstellen
        </Button>
      </section>
    );
  }

  const bewerkbaar =
    rol === "eigenaar" && !goedgekeurd && (sessie.status === "afgerond" || sessie.status === "goedgekeurd");
  const gaten = sessie.ontbrekendeFragmenten;
  const openSecties = notitie.secties.filter((sectie) => sectie.status !== "goedgekeurd");
  const samenGoedTeKeuren = openSecties.filter((sectie) => !sectie.vereistBehandelaar);
  const actueleContext =
    rol === "eigenaar" && !bronVerouderd
      ? geldigeGesprekscontext(gesprekscontext ?? [], segmenten ?? [], sessie.consultType)
      : [];
  const verslagSecties = new Set(notitie.secties.map((sectie) => sectie.id));
  const overigeCitaten = [
    ...new Map(
      actueleContext
        .filter((rij) => !verslagSecties.has(rij.sectieId))
        .flatMap((rij) => rij.citaten)
        .map((citaat) => [citaat.segmentId, citaat]),
    ).values(),
  ].sort((a, b) => a.volgnummer - b.volgnummer);

  const registreerExport = async (kanaal: "klembord" | "bestand", sectieId?: string): Promise<boolean> => {
    const versie = versieSleutel;
    const resultaat = await registreerVerslagExport(sessie.id, {
      kanaal,
      notitieId: notitie.id,
      bewerkRevisie: notitie.bewerkRevisie,
      ...(sectieId ? { sectieId } : {}),
    });
    if (versieRef.current !== versie) return false;
    if (!resultaat.ok) {
      setFout(
        "De kopie is gemaakt, maar de exportregistratie is niet gelukt. Exporteer opnieuw voordat u de overname bevestigt.",
      );
      return false;
    }
    if (!sectieId) setGedeeldeVersie(versie);
    setFout(null);
    return true;
  };

  const kopieerTekst = (tekst: string, gelukt: string, sectieId?: string) => {
    if (!navigator.clipboard?.writeText) {
      setFout("Kopiëren is niet beschikbaar. Toon de verslagtekst en kopieer die met de hand.");
      return;
    }
    // Keep this synchronous in the click event for Safari user activation.
    navigator.clipboard
      .writeText(tekst)
      .then(async () => {
        if (await registreerExport("klembord", sectieId)) setMelding(gelukt);
      })
      .catch(() => setFout("Kopiëren is niet gelukt. Toon de verslagtekst en kopieer die met de hand."));
  };

  const kopieer = () => {
    if (!exportTekst || exportVersie !== versieSleutel) {
      setFout("De actuele verslagtekst is nog niet opgehaald. Probeer het zo opnieuw.");
      return;
    }
    kopieerTekst(exportTekst, "Het verslag staat op het klembord. Plak het in het EPD.");
  };

  const download = async () => {
    const versie = versieSleutel;
    const resultaat =
      exportTekst && exportVersie === versie
        ? { tekst: exportTekst, bestandsnaam: exportNaam ?? "consult.txt" }
        : await exporteerVerslag(sessie.id, { formaat: "txt", consultTijdstip, preview: true }).then((uitkomst) =>
            uitkomst.ok ? uitkomst : null,
          );
    if (!resultaat || versieRef.current !== versie) {
      setFout("Het actuele verslag kon niet worden opgehaald.");
      return;
    }
    try {
      await saveBlobThroughCareon(
        new Blob([resultaat.tekst], { type: "text/plain;charset=utf-8" }),
        resultaat.bestandsnaam,
      );
      if (await registreerExport("bestand"))
        setMelding(`Gedownload als ${resultaat.bestandsnaam}. Verwijder het bestand na overname in het EPD.`);
    } catch {
      setFout("Downloaden is niet gelukt op dit apparaat. Kopieer het verslag in plaats daarvan.");
    }
  };

  const kopieerSectie = (sectie: VerslagSectie) => {
    if (!goedgekeurd || sectie.status !== "goedgekeurd") return;
    kopieerTekst(
      bouwSectieTekst(sessie, sectie, { formaat: "txt", bronverwijzingen: false }),
      `De sectie "${sectie.titel}" staat op het klembord.`,
      sectie.id,
    );
  };

  /** N22 — de laatste sectiegoedkeuring vraagt om de gatenbevestiging. */
  const goedkeuren = (sectie: VerslagSectie) => {
    if (bronVerouderd) return;
    if (
      notitie &&
      !isBeoordelingsSectie(notitie.formaat, sectie.id) &&
      ongewijzigdBronconcept(sectie, concepten[sectie.id] ?? sectie.tekst)
    ) {
      setFout(BRONCITATEN_BEWERKEN);
      return;
    }
    const isLaatste = openSecties.length === 1 && openSecties[0].id === sectie.id;
    if (isLaatste && gaten > 0 && !gatenBeoordeeld) {
      setLaatsteSectieId(sectie.id);
      return;
    }
    void onSectie(
      sectie.id,
      { tekst: concepten[sectie.id] ?? sectie.tekst, status: "goedgekeurd" },
      gaten > 0 ? gatenBeoordeeld : undefined,
    );
  };

  return (
    <section aria-label="Verslag" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-sm">Verslag</h2>
        {/* flex-wrap: op 390 px passen badge + knoppen niet naast elkaar (mobiele overflow-gate). */}
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Versie {notitie.versie}
          </Badge>
          {bewerkbaar ? (
            <>
              {/* N18 — formaat wisselen kan tot de goedkeuring; de API accepteert het al. */}
              <span className="flex items-center gap-1.5">
                <Label htmlFor={formaatId} className="text-muted-foreground text-xs">
                  Verslagformaat
                </Label>
                <NativeSelect
                  id={formaatId}
                  size="sm"
                  value={formaat}
                  disabled={goedgekeurd || bezig}
                  onChange={(gebeurtenis) => setFormaat(gebeurtenis.target.value as ConsultType)}
                >
                  {FORMAAT_KEUZES.map((keuze) => (
                    <NativeSelectOption key={keuze.waarde} value={keuze.waarde}>
                      {keuze.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </span>
              <Button size="sm" variant="ghost" disabled={bezig} onClick={() => onOpnieuwGenereren(formaat)}>
                <RefreshCcw className="size-3.5" />
                Verslag opnieuw genereren
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bezig || bronVerouderd === true || samenGoedTeKeuren.length === 0}
                    aria-describedby={
                      [bronVerouderd ? bronStatusId : "", samenGoedTeKeuren.length === 0 ? alleGoedkeurenHintId : ""]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  >
                    <CheckCheck className="size-3.5" />
                    Alles goedkeuren
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Alle secties goedkeuren?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Secties die uw eigen invoer vereisen worden overgeslagen: die schrijft en keurt u zelf, sectie
                      voor sectie. Controleer eerst of elke overige sectie klopt — u stelt het verslag hiermee vast.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {gaten > 0 ? (
                    <div className="flex items-start gap-2 rounded-md border border-amber-600/40 bg-amber-600/10 p-2">
                      <Checkbox
                        id={gatenId}
                        checked={gatenBeoordeeld}
                        onCheckedChange={(waarde) => setGatenBeoordeeld(waarde === true)}
                        className="mt-0.5"
                      />
                      <Label htmlFor={gatenId} className="font-normal text-sm">
                        Ik heb de ontbrekende fragmenten aangevuld of beoordeeld.
                      </Label>
                    </div>
                  ) : null}
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuleren</AlertDialogCancel>
                    {/* Geen preventDefault: Radix' composeEventHandlers slaat dan
                        onOpenChange(false) over en de dialoog blijft open, waardoor
                        de melding over overgeslagen secties achter een modale laag
                        verdwijnt. De dialoog sluit dus direct; de afhandeling loopt
                        asynchroon door (zelfde patroon als "Definitief maken"). */}
                    <AlertDialogAction
                      disabled={
                        bezig ||
                        bronVerouderd === true ||
                        samenGoedTeKeuren.length === 0 ||
                        (gaten > 0 && !gatenBeoordeeld)
                      }
                      onClick={(gebeurtenis) => {
                        if (bronVerouderd || samenGoedTeKeuren.length === 0 || (gaten > 0 && !gatenBeoordeeld)) {
                          gebeurtenis.preventDefault();
                          return;
                        }
                        void (async () => {
                          for (const sectie of notitie.secties) {
                            const tekst = concepten[sectie.id] ?? sectie.tekst;
                            if (
                              vuilRef.current.has(sectie.id) &&
                              tekst !== sectie.tekst &&
                              !(await onSectie(sectie.id, { tekst }))
                            ) {
                              setFout(
                                "De bewerkte tekst kon niet worden opgeslagen. Controleer die voordat u goedkeurt.",
                              );
                              return;
                            }
                          }
                          const ids = await onAlleGoedkeuren(gaten > 0 ? gatenBeoordeeld : undefined);
                          setOvergeslagenResultaat({ notitieId: notitie.id, ids });
                        })();
                      }}
                    >
                      Goedkeuren
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : null}
        </span>
      </div>

      {bronVerouderd ? (
        <div
          id={bronStatusId}
          role="alert"
          className="rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-amber-900 text-sm dark:text-amber-200"
        >
          Het transcript is gewijzigd. Dit verslag gebruikt nog de vorige bron. Genereer het verslag opnieuw voordat u
          goedkeurt.
        </div>
      ) : null}

      {bewerkbaar && samenGoedTeKeuren.length === 0 ? (
        <p id={alleGoedkeurenHintId} className="text-muted-foreground text-xs">
          {openSecties.length > 0
            ? "Alle resterende secties vereisen uw eigen invoer en afzonderlijke goedkeuring. Alles goedkeuren is daarom niet beschikbaar."
            : "Alle secties zijn al goedgekeurd."}
        </p>
      ) : null}

      {bron === "lokaal" ? (
        <ScribeStatusregel>Lokale demo-opslag — geen centrale registratie.</ScribeStatusregel>
      ) : null}

      {rol === "vrijgave" ? (
        <ScribeStatusregel toon="waarschuwing">
          Vrijgegeven door de beheerder{vrijgaveReden ? ` (${vrijgaveReden})` : ""}. U ziet alleen het goedgekeurde
          verslag, nooit het transcript.
        </ScribeStatusregel>
      ) : null}

      {overgeslagen.length > 0 ? (
        <ScribeStatusregel toon="waarschuwing">
          {overgeslagen.length} {overgeslagenLabel} overgeslagen: schrijf en keur die zelf goed.
        </ScribeStatusregel>
      ) : null}

      {sessie.status === "geannuleerd" ? (
        <ScribeStatusregel toon="waarschuwing">
          Dit consult is geannuleerd; transcript en consultstaat zijn gewist.
        </ScribeStatusregel>
      ) : null}

      <div className="space-y-3">
        {notitie.secties.map((sectie) => (
          <SectieBlok
            key={sectie.id}
            sectie={sectie}
            beoordelingsSectie={isBeoordelingsSectie(notitie.formaat, sectie.id)}
            bewerkbaar={bewerkbaar}
            bronVerouderd={bronVerouderd}
            gesprekscitaten={resterendeGesprekscitaten(actueleContext, sectie)}
            exporteerbaar={goedgekeurd}
            bezig={bezig}
            concept={concepten[sectie.id] ?? sectie.tekst}
            onConcept={(tekst) => {
              vuilRef.current.add(sectie.id);
              setConcepten((huidig) => ({ ...huidig, [sectie.id]: tekst }));
            }}
            onBewaar={() => {
              const tekst = concepten[sectie.id] ?? sectie.tekst;
              if (tekst !== sectie.tekst) void onSectie(sectie.id, { tekst });
              else vuilRef.current.delete(sectie.id);
            }}
            onGoedkeuren={() => goedkeuren(sectie)}
            onHeropenen={() => void onSectie(sectie.id, { status: "bewerkt" })}
            onKopieer={() => kopieerSectie(sectie)}
            onBron={onBron}
          />
        ))}
      </div>

      {overigeCitaten.length > 0 ? (
        <section aria-label="Gesprekscitaten buiten dit verslagformaat" className="space-y-2">
          <h3 className="font-medium text-sm">Gesprekscitaten buiten dit verslagformaat</h3>
          <p className="text-muted-foreground text-xs">
            Deze broncitaten horen bij het oorspronkelijke consultformaat. Ze zijn niet automatisch in dit
            verslagformaat ingedeeld.
          </p>
          <GesprekscitatenBlok citaten={overigeCitaten} titel="Oorspronkelijk consultformaat" onBron={onBron} />
        </section>
      ) : null}

      {/* N22 — bevestiging vóór de laatste individuele sectiegoedkeuring. */}
      <AlertDialog open={laatsteSectieId !== null} onOpenChange={(open) => !open && setLaatsteSectieId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Verslag vaststellen met ontbrekende fragmenten?</AlertDialogTitle>
            <AlertDialogDescription>
              Het transcript van dit consult mist {gaten} fragment(en). De ontbrekende minuut kan juist de plek zijn
              waar een medicatie-, dosis- of allergie-uitspraak viel — en dit verslag gaat het EPD in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-amber-600/40 bg-amber-600/10 p-2">
            <Checkbox
              id={laatsteGatenId}
              checked={gatenBeoordeeld}
              onCheckedChange={(waarde) => setGatenBeoordeeld(waarde === true)}
              className="mt-0.5"
            />
            <Label htmlFor={laatsteGatenId} className="font-normal text-sm">
              Ik heb de ontbrekende fragmenten aangevuld of beoordeeld.
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLaatsteSectieId(null)}>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              disabled={bronVerouderd === true || !gatenBeoordeeld}
              onClick={(gebeurtenis) => {
                if (bronVerouderd || !gatenBeoordeeld) {
                  gebeurtenis.preventDefault();
                  return;
                }
                const sectie = notitie.secties.find((rij) => rij.id === laatsteSectieId);
                setLaatsteSectieId(null);
                if (!sectie) return;
                void onSectie(sectie.id, { tekst: concepten[sectie.id] ?? sectie.tekst, status: "goedgekeurd" }, true);
              }}
            >
              Goedkeuren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {fout ? <ScribeStatusregel toon="fout">{fout}</ScribeStatusregel> : null}
      {melding ? <ScribeStatusregel toon="goed">{melding}</ScribeStatusregel> : null}

      {goedgekeurd ? (
        <div className="space-y-3 rounded-lg border border-emerald-600/40 bg-emerald-600/10 p-3">
          <p className="text-sm">
            Dit verslag is goedgekeurd. Neem het over in het EPD; het EPD blijft het juridische dossier. Een gedownload
            bestand valt buiten de bewaartermijn van Careon — verwijder het na overname.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={exportTekst === null || exportVersie !== versieSleutel}
              onClick={kopieer}
            >
              <Copy className="size-3.5" />
              Kopiëren voor EPD
            </Button>
            <Button size="sm" variant="outline" onClick={() => void download()}>
              <Download className="size-3.5" />
              Downloaden (.txt)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setZichtbareVersie(tekstZichtbaar ? null : versieSleutel);
              }}
            >
              <FileText className="size-3.5" />
              {tekstZichtbaar ? "Verslagtekst verbergen" : "Verslagtekst tonen"}
            </Button>
            {rol === "eigenaar" && sessie.status === "goedgekeurd" ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={!gedeeld}>
                    <FileCheck2 className="size-3.5" />
                    Overgenomen in het EPD
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Verslag overgenomen in het EPD?</AlertDialogTitle>
                    <AlertDialogDescription>{overnameGevolgTekst(instellingen)}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={bevestigId}
                      checked={bevestigd}
                      onCheckedChange={(waarde) => setBevestigdeVersie(waarde === true ? versieSleutel : null)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={bevestigId} className="font-normal text-sm">
                      Ik heb het verslag in het EPD opgeslagen
                    </Label>
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setBevestigdeVersie(null)}>Annuleren</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={!bevestigd}
                      onClick={(gebeurtenis) => {
                        if (!bevestigd) {
                          gebeurtenis.preventDefault();
                          return;
                        }
                        onOvergenomen();
                      }}
                    >
                      Bevestigen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
          {tekstZichtbaar ? (
            <div className="space-y-2">
              <Textarea
                readOnly
                aria-label="Verslagtekst"
                rows={14}
                value={exportTekst ?? "De verslagtekst wordt opgehaald…"}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!exportTekst || exportVersie !== versieSleutel}
                onClick={() => void registreerExport("klembord")}
              >
                Ik heb de volledige verslagtekst handmatig gekopieerd
              </Button>
            </div>
          ) : null}
          {!gedeeld && rol === "eigenaar" && sessie.status === "goedgekeurd" ? (
            <ScribeStatusregel>
              Kopieer of download het volledige actuele verslag eerst; pas daarna kunt u de overname bevestigen.
            </ScribeStatusregel>
          ) : null}
        </div>
      ) : null}

      {/* N11 — de cliënt kan de toestemming ná het consult intrekken. De RPC
          staat afgerond → geannuleerd en goedgekeurd → geannuleerd toe; zonder
          deze knop restte alleen "Verwijderen" in de lijst, ingericht als
          opruimen in plaats van als intrekking. */}
      {rol === "eigenaar" && (sessie.status === "afgerond" || sessie.status === "goedgekeurd") ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-muted-foreground">
              <Trash2 className="size-3.5" />
              Toestemming ingetrokken — werkkopie wissen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Werkkopie van dit consult wissen?</AlertDialogTitle>
              <AlertDialogDescription>
                Transcript, consultstaat, verslag en vervolgacties worden direct gewist; alleen de sessiemetadata blijft
                nog kort staan en verdwijnt bij de dagelijkse opschoning. Wat al in het EPD staat, blijft daar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={wisGrondId}>Grond</Label>
              <NativeSelect
                id={wisGrondId}
                className="w-full"
                value={wisGrond}
                onChange={(gebeurtenis) => setWisGrond(gebeurtenis.target.value as GeannuleerdGrond)}
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
              <AlertDialogAction onClick={() => onWerkkopieWissen(wisGrond)}>Werkkopie wissen</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </section>
  );
}

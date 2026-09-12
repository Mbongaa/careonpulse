"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowDown, ChevronDown, Pencil, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { SPREKER_LABELS } from "@/data/careon/careon-scribe";
import { SCRIBE_LIMITS, type ScribeSegment, type Spreker } from "@/lib/careon-scribe/types";
import { cn } from "@/lib/utils";

import { HandmatigeInvoer } from "./handmatige-invoer";

// Paneel A — Transcript (handoff 20 §7.3).
//
// S9 leeft hier zichtbaar: de letterlijk herkende tekst en de klinische
// interpretatie blijven gescheiden. Een gecorrigeerde regel is gemarkeerd
// (onderstreept, met een chip die zegt wie corrigeerde), de herkende brontekst
// blijft uitklapbaar en "Herstel origineel" zet hem terug. Een AI-correctie mag
// een correctie van de behandelaar nooit overschrijven — dat bewaakt de route,
// maar de UI laat het onderscheid altijd zien.
//
// S8: een expliciete sprekerkeuze bevestigt ook de huidige rol. Raakt die een al geanalyseerd segment, dan
// meldt paneel B "Analyse verouderd" en is heranalyse verplicht vóór het
// verslag.
//
// C19: de correctie-editor sluit UITSLUITEND na een geslaagde PATCH. Faalt de
// schrijfactie (409, 429, dood netwerk), dan blijft de getypte correctie in het
// veld staan — hij bestaat nergens anders.

function tijdLabel(beginMs: number | null): string {
  const totaal = Math.max(0, Math.round((beginMs ?? 0) / 1_000));
  const minuten = Math.floor(totaal / 60);
  const seconden = totaal % 60;
  return `${String(minuten).padStart(2, "0")}:${String(seconden).padStart(2, "0")}`;
}

const SPREKER_KEUZES: readonly Spreker[] = ["arts", "patient", "overig", "onbekend"];

function sprekerLabel(segment: ScribeSegment): string {
  const rol = SPREKER_LABELS[segment.spreker];
  if (segment.spreker === "onbekend") return `${rol} · niet bevestigd`;
  if (segment.sprekerBron === "behandelaar") return `${rol} · bevestigd`;
  return segment.sprekerBron === "ai" ? `${rol} · AI-voorstel, niet bevestigd` : `${rol} · niet bevestigd`;
}

function TranscriptRegel({
  segment,
  gemarkeerd,
  bewerkbaar,
  onSpreker,
  onCorrectie,
}: Readonly<{
  segment: ScribeSegment;
  gemarkeerd: boolean;
  bewerkbaar: boolean;
  onSpreker: (volgnummer: number, spreker: Spreker) => void;
  onCorrectie: (volgnummer: number, tekst: string | null) => Promise<boolean>;
}>) {
  const [bewerken, setBewerken] = useState(false);
  const [bewaren, setBewaren] = useState(false);
  const [concept, setConcept] = useState(segment.tekstGecorrigeerd ?? segment.tekst);
  const gecorrigeerd = segment.tekstGecorrigeerd !== null;
  const isGat = segment.bron === "systeem";

  return (
    <li
      id={`scribe-segment-${segment.volgnummer}`}
      className={cn(
        "flex flex-col gap-1 rounded-md px-2 py-1.5 sm:flex-row sm:items-start sm:gap-3",
        gemarkeerd && "bg-primary/10 ring-1 ring-primary/40",
        isGat && "bg-amber-600/10 text-amber-900 dark:text-amber-200",
      )}
    >
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-muted-foreground text-xs tabular-nums">{tijdLabel(segment.beginMs)}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={!bewerkbaar || isGat}
              aria-label={`Spreker van regel ${segment.volgnummer}: ${sprekerLabel(segment)} — kiezen en bevestigen`}
              className={cn(
                "h-auto whitespace-normal rounded-full px-2 py-0.5 text-xs",
                segment.spreker === "arts" && "border-primary/50 bg-primary/10",
                segment.spreker === "onbekend" && "text-muted-foreground",
              )}
            >
              {sprekerLabel(segment)}
              <ChevronDown className="size-3 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            <DropdownMenuLabel>Spreker voor §{segment.volgnummer}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {SPREKER_KEUZES.map((spreker) => (
              <DropdownMenuItem
                key={spreker}
                disabled={!bewerkbaar || isGat}
                onSelect={() => {
                  if (bewerkbaar && !isGat) onSpreker(segment.volgnummer, spreker);
                }}
                aria-label={`${spreker === "onbekend" ? "Kies" : "Bevestig"} ${SPREKER_LABELS[spreker]} voor regel ${segment.volgnummer}`}
              >
                {SPREKER_LABELS[spreker]}
                {spreker === segment.spreker ? (
                  <span className="ml-auto text-muted-foreground text-xs">Huidig</span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        {bewerken ? (
          <div className="space-y-1">
            <Textarea
              value={concept}
              onChange={(gebeurtenis) => setConcept(gebeurtenis.target.value)}
              maxLength={SCRIBE_LIMITS.segmentTekst}
              rows={2}
              aria-label={`Tekst van regel ${segment.volgnummer} corrigeren`}
            />
            <span className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={bewaren}
                onClick={() => {
                  void (async () => {
                    setBewaren(true);
                    const gelukt = await onCorrectie(segment.volgnummer, concept);
                    setBewaren(false);
                    if (gelukt) setBewerken(false);
                  })();
                }}
              >
                Correctie bewaren
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBewerken(false)}>
                Annuleren
              </Button>
            </span>
          </div>
        ) : (
          <p
            className={cn("text-sm leading-relaxed", gecorrigeerd && "underline decoration-dotted underline-offset-4")}
          >
            <span className="mr-1 text-muted-foreground text-xs tabular-nums">§{segment.volgnummer}</span>
            {segment.tekstGecorrigeerd ?? segment.tekst}
          </p>
        )}
        {gecorrigeerd && !bewerken ? (
          <div className="space-y-1">
            <Badge variant="outline" className="text-muted-foreground text-xs">
              {segment.correctieBron === "behandelaar" ? "Uw correctie" : "AI-correctie"}
            </Badge>
            <details className="text-muted-foreground text-xs">
              <summary className="cursor-pointer">herkend: …</summary>
              <p className="pt-1">{segment.tekst}</p>
            </details>
          </div>
        ) : null}
        {bewerkbaar && !bewerken ? (
          <span className="flex flex-wrap gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-muted-foreground text-xs"
              onClick={() => {
                setConcept(segment.tekstGecorrigeerd ?? segment.tekst);
                setBewerken(true);
              }}
            >
              <Pencil className="size-3" />
              Tekst corrigeren
            </Button>
            {gecorrigeerd ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-muted-foreground text-xs"
                onClick={() => void onCorrectie(segment.volgnummer, null)}
              >
                <Undo2 className="size-3" />
                Herstel origineel
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function TranscriptPaneel({
  sessieId,
  segmenten,
  gemarkeerd,
  bewerkbaar,
  invoerToegestaan = bewerkbaar,
  onSpreker,
  onCorrectie,
  onHandmatig,
}: Readonly<{
  sessieId: string;
  segmenten: ScribeSegment[];
  gemarkeerd: number[];
  bewerkbaar: boolean;
  invoerToegestaan?: boolean;
  onSpreker: (volgnummer: number, spreker: Spreker) => void;
  onCorrectie: (volgnummer: number, tekst: string | null) => Promise<boolean>;
  onHandmatig: (tekst: string, spreker: Spreker) => Promise<boolean>;
}>) {
  const lijstRef = useRef<HTMLElement | null>(null);
  const [nieuweRegels, setNieuweRegels] = useState(false);
  const aantalRef = useRef(segmenten.length);
  const [sprekerReview, setSprekerReview] = useState<{ sessieId: string; volgnummer: number } | null>(null);
  const reviewRegel = sprekerReview?.sessieId === sessieId ? sprekerReview.volgnummer : null;
  const gemarkeerdeSet = new Set(gemarkeerd);
  const onbekendeRegels = segmenten.filter((segment) => segment.spreker === "onbekend" && segment.bron !== "systeem");

  useEffect(() => {
    const element = lijstRef.current;
    if (!element) return;
    if (segmenten.length === aantalRef.current) return;
    aantalRef.current = segmenten.length;
    const onderaan = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (onderaan) {
      element.scrollTop = element.scrollHeight;
      setNieuweRegels(false);
    } else {
      setNieuweRegels(true);
    }
  }, [segmenten.length]);

  return (
    <section aria-label="Transcript" className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-sm">Transcript</h2>
        <span className="text-muted-foreground text-xs">{segmenten.length} regels</span>
      </div>
      {bewerkbaar && segmenten.length > 0 ? (
        <div className="flex flex-wrap items-start gap-2">
          <p className="min-w-0 flex-1 text-muted-foreground text-xs">
            Bevestig een spreker alleen als de hele regel bij die persoon hoort. Laat regels met meerdere of
            onduidelijke sprekers onbekend. Kies de huidige rol opnieuw om die te bevestigen.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={onbekendeRegels.length === 0}
            onClick={() => {
              const volgende =
                onbekendeRegels.find((segment) => segment.volgnummer > (reviewRegel ?? 0)) ?? onbekendeRegels[0];
              if (!volgende) return;
              setSprekerReview({ sessieId, volgnummer: volgende.volgnummer });
              const knop = lijstRef.current?.querySelector<HTMLButtonElement>(
                `#scribe-segment-${volgende.volgnummer} button`,
              );
              knop?.scrollIntoView({ block: "nearest" });
              knop?.focus({ preventScroll: true });
            }}
          >
            <ArrowDown className="size-3.5" />
            Volgende onbekende
          </Button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <section
          ref={lijstRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollbaar gebied moet met het toetsenbord bereikbaar zijn (axe scrollable-region-focusable)
          tabIndex={0}
          aria-label="Transcriptregels"
          className="max-h-[26rem] overflow-y-auto rounded-lg border p-2"
        >
          {segmenten.length === 0 ? (
            <p className="p-3 text-muted-foreground text-sm">
              Nog geen transcript. Start de opname of voer de gesprekstekst handmatig in.
            </p>
          ) : (
            <ul className="space-y-1">
              {segmenten.map((segment) => (
                <TranscriptRegel
                  key={segment.id}
                  segment={segment}
                  gemarkeerd={gemarkeerdeSet.has(segment.volgnummer) || reviewRegel === segment.volgnummer}
                  bewerkbaar={bewerkbaar}
                  onSpreker={onSpreker}
                  onCorrectie={onCorrectie}
                />
              ))}
            </ul>
          )}
        </section>
        {nieuweRegels ? (
          <Button
            size="sm"
            variant="outline"
            className="absolute bottom-3 left-1/2 -translate-x-1/2"
            onClick={() => {
              const element = lijstRef.current;
              if (element) element.scrollTop = element.scrollHeight;
              setNieuweRegels(false);
            }}
          >
            <ArrowDown className="size-3.5" />
            Nieuwe regels
          </Button>
        ) : null}
      </div>
      {invoerToegestaan ? <HandmatigeInvoer sessieId={sessieId} onToevoegen={onHandmatig} /> : null}
    </section>
  );
}

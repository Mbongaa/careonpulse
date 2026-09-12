"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { Loader2, Plus, Share2, Trash2 } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
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
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONSULT_TYPE_LABELS, SCRIBE_PAGE_META } from "@/data/careon/careon-scribe";
import type { SessieLijstFilter, SessieLijstRij } from "@/lib/careon-scribe/api-contract";
import { haalSessies, type ScribeBron, verwijderSessie } from "@/lib/careon-scribe/remote.client";
import { isIsoDatum, isScribeZoekterm, SCRIBE_LIMITS, type SessieStatus } from "@/lib/careon-scribe/types";
import { cn } from "@/lib/utils";

import { NieuwConsultForm } from "./nieuw-consult-form";
import { ScribeStatusregel } from "./scribe-statusregel";
import { VrijgaveDialoog, VrijgaveIntrekkenDialoog } from "./vrijgave-dialoog";

// Consultlijst (handoff 20 §7.2). Het dagelijkse werkscherm van de behandelaar:
// eigen consulten, vrijgegeven consulten en — voor een org_admin — de
// consulten van collega's als métadata zonder dossierreferentie en zonder
// consulttype (S12/V3). Die rijen zijn niet te openen; de beheerder kan ze
// verwijderen, het goedgekeurde verslag vrijgeven bij offboarding, of die
// vrijgave weer intrekken (N11).
//
// N16 — zoeken op dossierreferentie plus een periodefilter: terugvinden van één
// consult (afmaken, alsnog overnemen, of een inzage-/vernietigingsverzoek
// afhandelen) mag geen bladerwerk zijn. De zoekterm gaat door dezelfde
// validator als de invoer (S3), zodat er nooit een BSN-achtige term in een
// querylog belandt. Collega-rijen van een beheerder dragen geen referentie en
// vallen dus automatisch buiten de treffers.
//
// C31 — de paginanummering is 1-GEBASEERD, in de UI, in de client-laag en in de
// route. Een 0-gebaseerde teller leverde tweemaal dezelfde eerste pagina.

const FILTERS: { id: SessieLijstFilter; label: string }[] = [
  { id: "alle", label: "Alle" },
  { id: "actief", label: "Actief" },
  { id: "afgerond", label: "Te beoordelen" },
  { id: "goedgekeurd", label: "Goedgekeurd" },
  { id: "overgenomen", label: "Overgenomen" },
];

/** Badgetekst per status — kort en stabiel (§7.2). */
const STATUS_BADGE: Record<SessieStatus, string> = {
  actief: "Actief",
  afgerond: "Te beoordelen",
  goedgekeurd: "Goedgekeurd",
  overgenomen: "Overgenomen",
  geannuleerd: "Geannuleerd",
};

const DATUM_TIJD = new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const DATUM = new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });

function formatMoment(iso: string | null): string {
  if (!iso) return "—";
  const tijdstip = Date.parse(iso);
  return Number.isNaN(tijdstip) ? "—" : DATUM_TIJD.format(new Date(tijdstip));
}

function formatDatum(iso: string | null): string {
  if (!iso) return "—";
  const tijdstip = Date.parse(iso);
  return Number.isNaN(tijdstip) ? "—" : DATUM.format(new Date(tijdstip));
}

export function formatDuur(duurMs: number): string {
  const totaal = Math.max(0, Math.round(duurMs / 1_000));
  const minuten = Math.floor(totaal / 60);
  const seconden = totaal % 60;
  return `${minuten}:${String(seconden).padStart(2, "0")}`;
}

/** Badge-uitvoering per status; label en toon staan hier bij elkaar. */
const STATUS_BADGE_KLASSE: Record<SessieStatus, string> = {
  actief: "",
  afgerond: "",
  goedgekeurd: "bg-emerald-600/15 text-emerald-800 dark:text-emerald-400",
  overgenomen: "",
  geannuleerd: "text-muted-foreground",
};

const STATUS_BADGE_VARIANT: Record<SessieStatus, "default" | "secondary" | "outline"> = {
  actief: "default",
  afgerond: "secondary",
  goedgekeurd: "default",
  overgenomen: "outline",
  geannuleerd: "outline",
};

export function StatusBadge({ sessie }: Readonly<{ sessie: SessieLijstRij }>) {
  return (
    <Badge variant={STATUS_BADGE_VARIANT[sessie.status]} className={cn("text-xs", STATUS_BADGE_KLASSE[sessie.status])}>
      {STATUS_BADGE[sessie.status]}
    </Badge>
  );
}

/** Documentlading de werkruimte in (S16 — Permissions-Policy geldt per document). */
function openConsult(sessieId: string) {
  window.location.assign(`/scribe/${sessieId}`);
}

export function ConsultLijst() {
  const zoekId = useId();
  const vanId = useId();
  const totId = useId();
  const [filter, setFilter] = useState<SessieLijstFilter>("alle");
  const [sessies, setSessies] = useState<SessieLijstRij[] | null>(null);
  const [pagina, setPagina] = useState(1);
  const [zoek, setZoek] = useState("");
  const [zoekTerm, setZoekTerm] = useState("");
  const [van, setVan] = useState("");
  const [tot, setTot] = useState("");
  const [meer, setMeer] = useState(false);
  const [bron, setBron] = useState<ScribeBron>("centraal");
  const [ingeschakeld, setIngeschakeld] = useState(true);
  const [gemachtigd, setGemachtigd] = useState(true);
  const [beheerder, setBeheerder] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [nieuwOpen, setNieuwOpen] = useState(false);
  /** Consult waarvoor de gebruiker het geforceerde verwijderen moet bevestigen. */
  const [forceerId, setForceerId] = useState<string | null>(null);

  const laad = useCallback(async () => {
    const resultaat = await haalSessies(filter, pagina, {
      zoek: isScribeZoekterm(zoekTerm) ? zoekTerm.trim() : undefined,
      van: isIsoDatum(van) ? van : undefined,
      tot: isIsoDatum(tot) ? tot : undefined,
    });
    if (resultaat.ok) {
      setSessies(resultaat.sessies);
      setMeer(resultaat.meer);
      setBron(resultaat.bron);
      setIngeschakeld(resultaat.ingeschakeld);
      setGemachtigd(resultaat.gemachtigd);
      setBeheerder(resultaat.beheerder);
      setFout(null);
    } else {
      setSessies([]);
      setFout(resultaat.fout);
    }
  }, [filter, pagina, zoekTerm, van, tot]);

  useEffect(() => {
    void laad();
  }, [laad]);

  // Debounce op het zoekveld: elke toetsaanslag een lijstquery zou de route
  // (en het quotum) onnodig belasten. Alleen een ECHT gewijzigde term zet de
  // paginering terug: zonder die vergelijking liep de timer ook bij het laden
  // van de pagina en werd een "Volgende" binnen die 300 ms weer ongedaan gemaakt.
  useEffect(() => {
    if (zoek === zoekTerm) return undefined;
    const tijd = window.setTimeout(() => {
      setZoekTerm(zoek);
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(tijd);
  }, [zoek, zoekTerm]);

  const verwijder = async (sessie: SessieLijstRij, forceer: boolean) => {
    const resultaat = await verwijderSessie(
      sessie.id,
      forceer ? { forceer: true, reden: "Verwijderd vanuit de consultlijst.", grond: "overig" } : { grond: "overig" },
    );
    if (resultaat.ok) {
      setForceerId(null);
      setMelding("Het consult is verwijderd, met transcript, verslag en vervolgacties.");
      await laad();
      return;
    }
    if (resultaat.status === 409) {
      setForceerId(sessie.id);
      setFout(resultaat.fout);
      return;
    }
    setFout(resultaat.fout);
  };

  const geenToegang = !gemachtigd || !ingeschakeld;

  const sessieActies = (sessie: SessieLijstRij) => (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={!sessie.eigen && !sessie.vrijgegeven}
        onClick={() => openConsult(sessie.id)}
      >
        Openen
      </Button>
      {beheerder && sessie.status === "goedgekeurd" ? (
        <VrijgaveDialoog
          sessieId={sessie.id}
          onKlaar={(tekst) => {
            setMelding(tekst);
            void laad();
          }}
        />
      ) : null}
      {beheerder && sessie.vrijgegeven ? (
        <VrijgaveIntrekkenDialoog
          sessieId={sessie.id}
          onKlaar={(tekst) => {
            setMelding(tekst);
            void laad();
          }}
        />
      ) : null}
      {beheerder || sessie.eigen ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              aria-label={`Verwijder consult ${sessie.patientReferentie ?? sessie.id}`}
            >
              <Trash2 className="size-3.5" />
              Verwijderen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Dit consult verwijderen?</AlertDialogTitle>
              <AlertDialogDescription>
                Transcript, consultstaat, verslag en vervolgacties worden direct en onherstelbaar verwijderd. Het EPD
                blijft het dossier — een al overgenomen verslag staat daar en verdwijnt niet.
                {forceerId === sessie.id
                  ? " Er ligt nog een goedgekeurd verslag dat niet als overgenomen is gemarkeerd; bevestig om alsnog te verwijderen."
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuleren</AlertDialogCancel>
              <AlertDialogAction onClick={() => void verwijder(sessie, forceerId === sessie.id)}>
                Verwijderen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </span>
  );

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={SCRIBE_PAGE_META.overzicht.title}
        sub={SCRIBE_PAGE_META.overzicht.sub}
        action={
          <Button variant="outline" onClick={() => setNieuwOpen((open) => !open)} disabled={geenToegang}>
            <Plus className="size-4" />
            Nieuw consult
          </Button>
        }
      />

      {bron === "lokaal" ? (
        <ScribeStatusregel>Lokale demo-opslag — geen centrale registratie.</ScribeStatusregel>
      ) : null}

      {!gemachtigd ? (
        <Card>
          <CardContent className="py-6">
            <p role="alert" className="text-sm">
              U bent niet gemachtigd voor Careon AI. Vraag een beheerder van uw organisatie om u te machtigen in de
              Careon AI-instellingen.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {gemachtigd && !ingeschakeld ? (
        <Card>
          <CardContent className="py-6">
            <p role="alert" className="text-sm">
              Careon AI staat uit voor deze organisatie. Een beheerder zet de module aan in de Careon AI-instellingen,
              na het vaststellen van de toestemmingstekst.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {nieuwOpen && !geenToegang ? <NieuwConsultForm onAnnuleer={() => setNieuwOpen(false)} /> : null}

      {!geenToegang ? (
        <Card>
          <CardContent className="grid gap-4 py-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={zoekId}>Zoek op dossierreferentie</Label>
              <Input
                id={zoekId}
                value={zoek}
                onChange={(gebeurtenis) => setZoek(gebeurtenis.target.value)}
                maxLength={SCRIBE_LIMITS.zoekterm}
                aria-invalid={zoek.trim().length > 0 && !isScribeZoekterm(zoek)}
                placeholder="Bijv. D-2026-04"
              />
              {zoek.trim().length > 0 && !isScribeZoekterm(zoek) ? (
                <ScribeStatusregel toon="fout">
                  Gebruik een deel van het dossiernummer; nooit een BSN of geboortedatum.
                </ScribeStatusregel>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={vanId}>Vanaf</Label>
              <Input
                id={vanId}
                type="date"
                value={van}
                onChange={(gebeurtenis) => {
                  setVan(gebeurtenis.target.value);
                  setPagina(1);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={totId}>Tot en met</Label>
              <Input
                id={totId}
                type="date"
                value={tot}
                onChange={(gebeurtenis) => {
                  setTot(gebeurtenis.target.value);
                  setPagina(1);
                }}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!geenToegang ? (
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => {
                setFilter(item.id);
                setPagina(1);
              }}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs transition-colors",
                filter === item.id
                  ? "border-primary/50 bg-primary/10 font-medium text-foreground"
                  : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {fout ? <ScribeStatusregel toon="fout">{fout}</ScribeStatusregel> : null}
      {melding ? <ScribeStatusregel toon="goed">{melding}</ScribeStatusregel> : null}

      {!geenToegang ? (
        <Card className="py-0">
          <CardContent className="px-0">
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Referentie</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Gestart</TableHead>
                    <TableHead>Duur</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Opschoning</TableHead>
                    <TableHead className="w-56 pr-4 text-right" aria-label="Acties" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessies === null ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-muted-foreground text-sm">
                        <Loader2 className="mr-2 inline size-4 animate-spin" />
                        Laden…
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {sessies !== null && sessies.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-muted-foreground text-sm">
                        Nog geen consulten. Start een nieuw consult.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {(sessies ?? []).map((sessie) => (
                    <TableRow key={sessie.id}>
                      <TableCell className="pl-4 font-medium">{sessie.patientReferentie ?? "—"}</TableCell>
                      <TableCell>{sessie.consultType ? CONSULT_TYPE_LABELS[sessie.consultType] : "—"}</TableCell>
                      <TableCell>{formatMoment(sessie.gestartOp ?? sessie.createdAt)}</TableCell>
                      <TableCell className="tabular-nums">{formatDuur(sessie.duurMs)}</TableCell>
                      <TableCell>
                        <StatusBadge sessie={sessie} />
                      </TableCell>
                      <TableCell className="text-xs">
                        {sessie.verlooptBinnenkort && sessie.verlooptOverDagen !== null ? (
                          <Badge className="bg-amber-600/15 text-amber-800 dark:text-amber-300">
                            Verloopt over {sessie.verlooptOverDagen} dagen
                          </Badge>
                        ) : (
                          formatDatum(sessie.sessieVerwijderNa)
                        )}
                      </TableCell>
                      <TableCell className="pr-4 text-right">{sessieActies(sessie)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y md:hidden">
              {sessies === null ? <li className="p-4 text-center text-muted-foreground text-sm">Laden…</li> : null}
              {sessies !== null && sessies.length === 0 ? (
                <li className="p-4 text-center text-muted-foreground text-sm">
                  Nog geen consulten. Start een nieuw consult.
                </li>
              ) : null}
              {(sessies ?? []).map((sessie) => (
                <li key={sessie.id} className="flex flex-col gap-3 p-4">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-sm">{sessie.patientReferentie ?? "—"}</span>
                    <span className="block text-muted-foreground text-xs">
                      {[
                        sessie.consultType ? CONSULT_TYPE_LABELS[sessie.consultType] : "—",
                        formatMoment(sessie.gestartOp ?? sessie.createdAt),
                        formatDuur(sessie.duurMs),
                      ].join(" · ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge sessie={sessie} />
                    <span className="text-muted-foreground text-xs">
                      {sessie.verlooptBinnenkort && sessie.verlooptOverDagen !== null
                        ? `Verloopt over ${sessie.verlooptOverDagen} dagen`
                        : `Opschoning: ${formatDatum(sessie.sessieVerwijderNa)}`}
                    </span>
                  </span>
                  {sessieActies(sessie)}
                </li>
              ))}
            </ul>

            {pagina > 1 || meer ? (
              <div className="flex items-center justify-between border-t p-3">
                <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
                  Vorige
                </Button>
                <span className="text-muted-foreground text-xs">Pagina {pagina}</span>
                <Button variant="outline" size="sm" disabled={!meer} onClick={() => setPagina(pagina + 1)}>
                  Volgende
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {beheerder && !geenToegang ? (
        <p className="text-center text-muted-foreground text-xs">
          <Share2 className="mr-1 inline size-3" />
          Van consulten van collega's ziet u alleen metadata: dossierreferentie en consulttype blijven verborgen, het
          transcript is nooit leesbaar.
        </p>
      ) : null}
    </div>
  );
}

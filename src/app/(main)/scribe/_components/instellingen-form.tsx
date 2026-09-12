"use client";

import { useEffect, useId, useState } from "react";

import { Loader2, Save } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SCRIBE_PAGE_META } from "@/data/careon/careon-scribe";
import type { ScribeProviderStatus } from "@/lib/careon-scribe/api-contract";
import { FORMAAT_KEUZES } from "@/lib/careon-scribe/formaten";
import { bewaarScribeInstellingen, haalScribeInstellingen, type ScribeBron } from "@/lib/careon-scribe/remote.client";
import {
  activatieVoorwaardenOntbrekend,
  type ConsultType,
  SCRIBE_LIMITS,
  type ScribeInstellingen,
} from "@/lib/careon-scribe/types";

import { GemachtigdenForm } from "./gemachtigden-form";
import { ScribeStatusregel } from "./scribe-statusregel";

// Careon AI-instellingen (handoff 20 §7.5, beheerder). Eén append-only snapshot
// per organisatie met revisie-conflictdetectie, net als hr en facturatie.
//
// De module staat in productie standaard UIT: een beheerder zet haar pas aan
// nádat de toestemmingstekst is vastgesteld en behandelaren zijn gemachtigd.
// Een wijziging van de toestemmingstekst raakt alleen NIEUWE consulten — elk
// lopend consult draagt de tekst en revisie die de cliënt te horen kreeg (S13).
//
// Twee kaarten scheiden wat vaak door elkaar liep (N19/N21):
//   * "Klinische ondersteuning" gaat uitsluitend over WEERGAVE. Die twee
//     schakelaars raken geen enkele verwerking; het label zegt dat nu ook.
//   * "Externe verwerking" gaat wél over verwerking: `transcriptieAan` is de
//     voorwaarde voor de transcriptieprovider, `aiAnalyseAan` voor de
//     AI-analyse. Beide staan standaard UIT, zodat een organisatie waarvan de
//     DPIA alleen de deterministische laag dekt, de module kan draaien zonder
//     dat één fragment het platform verlaat.
//   * "Activatievoorwaarden" legt het bewijs vast dat vóór `ingeschakeld: true`
//     hoort te liggen; zolang er iets ontbreekt blijft de moduleschakelaar uit.

function RetentieUitleg() {
  return (
    <p className="text-muted-foreground text-xs">
      Wat na de termijn overblijft wordt opgeruimd bij de dagelijkse opschoning (uiterlijk 24 uur na de termijn).
      Wissingen bij annuleren en bij overname gebeuren direct.
    </p>
  );
}

function ProviderStatusKaart({ status }: Readonly<{ status: ScribeProviderStatus }>) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading font-medium text-base leading-snug">Providerstatus</h2>
        <p className="text-muted-foreground text-sm">
          Alleen ter informatie: dit wordt op het platform ingesteld, niet in deze module. Zonder provider werkt de
          module volledig deterministisch en voert u gesprekstekst handmatig in.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 text-sm">
        <Badge variant={status.live ? "default" : "outline"}>AI-ondersteuning {status.live ? "aan" : "uit"}</Badge>
        <Badge variant="outline">Transcriptie: {status.transcriptieProvider ?? "niet geconfigureerd"}</Badge>
        <Badge variant="outline">Transcriptiemodel: {status.transcriptieModel ?? "—"}</Badge>
        <Badge variant="outline">Notitiemodel: {status.notitieModel ?? "—"}</Badge>
        <Badge variant="outline">Promptversie: {status.promptVersie}</Badge>
      </CardContent>
    </Card>
  );
}

/** Datumveld dat een ISO-datum (JJJJ-MM-DD) of een leeg veld oplevert. */
function isoDatumVeld(waarde: string): string | null {
  return waarde.length > 0 ? waarde : null;
}

/** Activatievoorwaarden (N21): het bewijs dat vóór `ingeschakeld: true` hoort te liggen. */
function ActivatieKaart({
  instellingen,
  ontbrekend,
  onWijzig,
}: Readonly<{
  instellingen: ScribeInstellingen;
  ontbrekend: string[];
  onWijzig: (patch: Partial<ScribeInstellingen>) => void;
}>) {
  const dpiaDatumId = useId();
  const dpiaEigenaarId = useId();
  const verwerkersId = useId();
  const consentGoedgekeurdId = useId();

  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading font-medium text-base leading-snug">Activatievoorwaarden</h2>
        <p className="text-muted-foreground text-sm">
          De go-live-checklist hoort in het product te staan, niet alleen in een document. Zolang hier iets ontbreekt,
          blijft de moduleschakelaar uit. Noteer nooit een cliëntgegeven: de eigenaar is een functie of afdeling.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={dpiaDatumId}>DPIA vastgesteld op</Label>
            <Input
              id={dpiaDatumId}
              type="date"
              value={instellingen.dpiaVastgesteldOp?.slice(0, 10) ?? ""}
              onChange={(gebeurtenis) => onWijzig({ dpiaVastgesteldOp: isoDatumVeld(gebeurtenis.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={dpiaEigenaarId}>Eigenaar van de DPIA</Label>
            <Input
              id={dpiaEigenaarId}
              value={instellingen.dpiaEigenaar ?? ""}
              maxLength={SCRIBE_LIMITS.dpiaEigenaar}
              placeholder="Bijv. Functionaris gegevensbescherming"
              onChange={(gebeurtenis) =>
                onWijzig({ dpiaEigenaar: gebeurtenis.target.value.length > 0 ? gebeurtenis.target.value : null })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={consentGoedgekeurdId}>Toestemmingstekst goedgekeurd op</Label>
            <Input
              id={consentGoedgekeurdId}
              type="date"
              value={instellingen.consenttekstGoedgekeurdOp?.slice(0, 10) ?? ""}
              onChange={(gebeurtenis) =>
                onWijzig({ consenttekstGoedgekeurdOp: isoDatumVeld(gebeurtenis.target.value) })
              }
            />
          </div>
          <div className="flex items-center gap-3 pt-6">
            <Switch
              id={verwerkersId}
              checked={instellingen.verwerkersovereenkomstBevestigd}
              onCheckedChange={(waarde) => onWijzig({ verwerkersovereenkomstBevestigd: waarde })}
            />
            <Label htmlFor={verwerkersId}>Verwerkersovereenkomst met de transcriptiedienst bevestigd</Label>
          </div>
        </div>

        <dl className="grid gap-1 rounded-md border p-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground uppercase tracking-wide">DPIA</dt>
            <dd>{instellingen.dpiaVastgesteldOp ?? "nog niet vastgesteld"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground uppercase tracking-wide">Eigenaar</dt>
            <dd>{instellingen.dpiaEigenaar ?? "nog niet vastgelegd"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground uppercase tracking-wide">Verwerkersovereenkomst</dt>
            <dd>{instellingen.verwerkersovereenkomstBevestigd ? "bevestigd" : "nog niet bevestigd"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground uppercase tracking-wide">Toestemmingstekst</dt>
            <dd>{instellingen.consenttekstGoedgekeurdOp ?? "nog niet goedgekeurd"}</dd>
          </div>
        </dl>

        {ontbrekend.length === 0 ? (
          <p className="text-emerald-700 text-xs dark:text-emerald-400">
            Alle activatievoorwaarden zijn vastgelegd; de module mag aan.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ScribeInstellingenForm() {
  const moduleId = useId();
  const formaatId = useId();
  const consentId = useId();
  const transcriptDagenId = useId();
  const notitieDagenId = useId();
  const wisBijOvernameId = useId();
  const aanwijzingenId = useId();
  const medicatieId = useId();
  const aiAnalyseId = useId();
  const transcriptieId = useId();

  const [instellingen, setInstellingen] = useState<ScribeInstellingen | null>(null);
  const [providerStatus, setProviderStatus] = useState<ScribeProviderStatus | null>(null);
  const [revision, setRevision] = useState(0);
  const [bron, setBron] = useState<ScribeBron>("centraal");
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const resultaat = await haalScribeInstellingen();
      if (!resultaat.ok) {
        setFout(resultaat.fout);
        return;
      }
      setInstellingen(resultaat.instellingen);
      setProviderStatus(resultaat.providerStatus);
      setRevision(resultaat.revision);
      setBron(resultaat.bron);
    })();
  }, []);

  const wijzig = (patch: Partial<ScribeInstellingen>) => {
    setInstellingen((huidig) => (huidig ? { ...huidig, ...patch } : huidig));
    setMelding(null);
  };

  const bewaar = async () => {
    if (!instellingen) return;
    setBezig(true);
    const resultaat = await bewaarScribeInstellingen(instellingen, revision);
    setBezig(false);
    if (!resultaat.ok) {
      setFout(
        resultaat.status === 409
          ? "Iemand anders heeft de instellingen intussen gewijzigd. Laad de pagina opnieuw en voer uw wijziging opnieuw door."
          : resultaat.fout,
      );
      return;
    }
    setRevision(resultaat.revision);
    setBron(resultaat.bron);
    setFout(null);
    setMelding("De instellingen zijn opgeslagen.");
  };

  if (!instellingen) {
    return (
      <div className="@container/main flex flex-col gap-4 md:gap-6">
        <CareonPageHeader title={SCRIBE_PAGE_META.instellingen.title} sub={SCRIBE_PAGE_META.instellingen.sub} />
        {fout ? (
          <ScribeStatusregel toon="fout">{fout}</ScribeStatusregel>
        ) : (
          <p className="text-muted-foreground text-sm">Laden…</p>
        )}
      </div>
    );
  }

  const ontbrekend = activatieVoorwaardenOntbrekend(instellingen);

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={SCRIBE_PAGE_META.instellingen.title}
        sub={SCRIBE_PAGE_META.instellingen.sub}
        action={
          <Button variant="outline" disabled={bezig} onClick={() => void bewaar()}>
            {bezig ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Opslaan
          </Button>
        }
      />

      {bron === "lokaal" ? (
        <ScribeStatusregel>Lokale demo-opslag — geen centrale registratie.</ScribeStatusregel>
      ) : null}
      {fout ? <ScribeStatusregel toon="fout">{fout}</ScribeStatusregel> : null}
      {melding ? <ScribeStatusregel toon="goed">{melding}</ScribeStatusregel> : null}

      <Card>
        <CardHeader>
          <h2 className="font-heading font-medium text-base leading-snug">Module</h2>
          <p className="text-muted-foreground text-sm">
            Zet Careon AI pas aan nadat de toestemmingstekst is vastgesteld en de behandelaren zijn gemachtigd. Staat de
            module uit, dan kan er geen consult starten.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              id={moduleId}
              checked={instellingen.ingeschakeld}
              disabled={!instellingen.ingeschakeld && ontbrekend.length > 0}
              onCheckedChange={(waarde) => wijzig({ ingeschakeld: waarde })}
            />
            <Label htmlFor={moduleId}>Careon AI is ingeschakeld voor deze organisatie</Label>
          </div>
          {!instellingen.ingeschakeld && ontbrekend.length > 0 ? (
            <div
              role="alert"
              className="space-y-1 rounded-md border border-amber-600/40 bg-amber-600/10 p-2 text-amber-900 text-xs dark:text-amber-200"
            >
              <p className="font-medium">Eerst de activatievoorwaarden vastleggen:</p>
              <ul className="list-inside list-disc">
                {ontbrekend.map((punt) => (
                  <li key={punt}>{punt}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ActivatieKaart instellingen={instellingen} ontbrekend={ontbrekend} onWijzig={wijzig} />

      <GemachtigdenForm />

      <Card>
        <CardHeader>
          <h2 className="font-heading font-medium text-base leading-snug">Standaardformaat</h2>
          <p className="text-muted-foreground text-sm">
            Het verslagformaat dat een nieuw consult voorstelt. De behandelaar kan er per consult van afwijken.
          </p>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label htmlFor={formaatId}>Standaard consulttype</Label>
          <NativeSelect
            id={formaatId}
            className="w-full max-w-md"
            value={instellingen.standaardFormaat}
            onChange={(gebeurtenis) => wijzig({ standaardFormaat: gebeurtenis.target.value as ConsultType })}
          >
            {FORMAAT_KEUZES.map((keuze) => (
              <NativeSelectOption key={keuze.waarde} value={keuze.waarde}>
                {keuze.label} — {keuze.doelgroep}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-heading font-medium text-base leading-snug">Toestemmingstekst</h2>
          <p className="text-muted-foreground text-sm">
            Deze tekst leest de behandelaar voor aan de cliënt en vinkt hij per consult af. Een wijziging raakt alleen
            nieuwe consulten: elk lopend consult houdt de tekst en versie die de cliënt te horen kreeg.
          </p>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label htmlFor={consentId}>Toestemmingsverklaring</Label>
          <Textarea
            id={consentId}
            rows={5}
            maxLength={SCRIBE_LIMITS.consentTekst}
            value={instellingen.consenttekst}
            onChange={(gebeurtenis) => wijzig({ consenttekst: gebeurtenis.target.value })}
          />
          <p className="text-muted-foreground text-xs">
            {instellingen.consenttekst.length} / {SCRIBE_LIMITS.consentTekst} tekens · huidige versie {revision}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-heading font-medium text-base leading-snug">Retentie</h2>
          <p className="text-muted-foreground text-sm">
            Careon houdt een tijdelijke werkkopie, geen tweede dossier. Het transcript volgt altijd de kortste termijn.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={transcriptDagenId}>Transcript bewaren (dagen)</Label>
              <Input
                id={transcriptDagenId}
                type="number"
                min={1}
                max={SCRIBE_LIMITS.retentieDagenMax}
                value={instellingen.transcriptRetentieDagen}
                onChange={(gebeurtenis) =>
                  wijzig({
                    transcriptRetentieDagen: Math.min(
                      SCRIBE_LIMITS.retentieDagenMax,
                      Math.max(1, Number.parseInt(gebeurtenis.target.value, 10) || 1),
                    ),
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={notitieDagenId}>Verslag bewaren na overname (dagen)</Label>
              <Input
                id={notitieDagenId}
                type="number"
                min={0}
                max={SCRIBE_LIMITS.retentieDagenMax}
                value={instellingen.notitieRetentieDagen}
                onChange={(gebeurtenis) =>
                  wijzig({
                    notitieRetentieDagen: Math.min(
                      SCRIBE_LIMITS.retentieDagenMax,
                      Math.max(0, Number.parseInt(gebeurtenis.target.value, 10) || 0),
                    ),
                  })
                }
              />
              <p className="text-muted-foreground text-xs">0 dagen betekent: direct en onherstelbaar verwijderen.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id={wisBijOvernameId}
              checked={instellingen.transcriptWissenBijOvername}
              onCheckedChange={(waarde) => wijzig({ transcriptWissenBijOvername: waarde })}
            />
            <Label htmlFor={wisBijOvernameId}>Transcript direct wissen bij overname in het EPD</Label>
          </div>
          <RetentieUitleg />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-heading font-medium text-base leading-snug">Klinische ondersteuning</h2>
          <p className="text-muted-foreground text-sm">
            Uitsluitend weergave: deze twee schakelaars bepalen wat het scherm toont en raken geen enkele verwerking. De
            aanwijzingen zijn beslissingsondersteuning, geen voorschrift.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <Switch
              id={aanwijzingenId}
              checked={instellingen.klinischeAanwijzingenAan}
              onCheckedChange={(waarde) => wijzig({ klinischeAanwijzingenAan: waarde })}
            />
            <Label htmlFor={aanwijzingenId} className="block font-normal">
              <span className="block">Aanwijzingenpaneel tonen</span>
              <span className="block text-muted-foreground text-xs">weergave</span>
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id={medicatieId}
              checked={instellingen.medicatiecheckAan}
              onCheckedChange={(waarde) => wijzig({ medicatiecheckAan: waarde })}
            />
            <Label htmlFor={medicatieId} className="block font-normal">
              <span className="block">Medicatiesignalen tonen</span>
              <span className="block text-muted-foreground text-xs">weergave</span>
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-heading font-medium text-base leading-snug">Externe verwerking</h2>
          <p className="text-muted-foreground text-sm">
            Deze twee schakelaars bepalen wél of gespreksinhoud het platform verlaat. Staan ze uit, dan draait Careon
            Careon AI werkt volledig deterministisch: extractie, checklist, medicatieregels en verslagopbouw gebeuren
            binnen Careon, en gesprekstekst voert u handmatig in.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <Switch
              id={transcriptieId}
              checked={instellingen.transcriptieAan}
              onCheckedChange={(waarde) => wijzig({ transcriptieAan: waarde })}
            />
            <Label htmlFor={transcriptieId} className="block font-normal">
              <span className="block">Audiofragmenten laten transcriberen</span>
              <span className="block text-muted-foreground text-xs">
                verwerker: {providerStatus?.transcriptieProvider ?? "nog niet geconfigureerd"} — fragmenten worden
                kortstondig verwerkt onder een verwerkersovereenkomst en niet bewaard.
              </span>
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id={aiAnalyseId}
              checked={instellingen.aiAnalyseAan}
              onCheckedChange={(waarde) => wijzig({ aiAnalyseAan: waarde })}
            />
            <Label htmlFor={aiAnalyseId} className="block font-normal">
              <span className="block">AI-analyse van het transcript inschakelen</span>
              <span className="block text-muted-foreground text-xs">
                verwerker: {providerStatus?.notitieModel ?? "nog niet geconfigureerd"} — zonder deze schakelaar blijft
                de analyse deterministisch.
              </span>
            </Label>
          </div>
        </CardContent>
      </Card>

      {providerStatus ? <ProviderStatusKaart status={providerStatus} /> : null}
    </div>
  );
}

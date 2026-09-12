"use client";

import { useEffect, useId, useState } from "react";

import { Loader2, Mic } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EMPTY_SCRIBE_INSTELLINGEN, STANDAARD_CONSENTTEKST } from "@/data/careon/careon-scribe";
import { FORMAAT_KEUZES } from "@/lib/careon-scribe/formaten";
import { haalScribeInstellingen, maakSessie } from "@/lib/careon-scribe/remote.client";
import {
  type ConsultType,
  isConsultType,
  isPatientReferentie,
  PATIENT_REFERENTIE_MELDING,
  SCRIBE_LIMITS,
  type ScribeTaal,
  vulConsenttekstIn,
} from "@/lib/careon-scribe/types";

import { ScribeStatusregel } from "./scribe-statusregel";

// "Nieuw consult" (handoff 20 §7.2). Drie dingen zijn hier hard:
//   * S3 — de dossierreferentie is de énige patiëntsleutel; de validator
//     weigert een BSN-vormige reeks en een geboortedatum, en de hint zegt
//     waarom.
//   * S13 — zonder aangevinkte toestemmingsverklaring geen consult. De client
//     stuurt de revisie mee van de instellingen waaruit hij de tekst las; is
//     die intussen gewijzigd, dan antwoordt de server 409 en leest de
//     behandelaar de nieuwe tekst opnieuw voor.
//   * S16 — starten is een documentlading (window.location.assign), zodat
//     `Permissions-Policy: microphone=(self)` van /scribe daadwerkelijk geldt.
//   * N10 — de organisatie bewaart de toestemmingstekst MÉT plaatshouder
//     `{transcriptRetentieDagen}`; dit formulier vult hem in met de werkelijke
//     retentie-instelling vóór het voorlezen, zodat wat de cliënt hoort nooit
//     uit de pas loopt met wat er gebeurt. De ingevulde tekst gaat mee naar de
//     sessie, samen met de revisie waaruit hij kwam.
//   * N18 — het laatst gekozen consulttype van deze behandelaar staat in
//     localStorage en is de voorselectie; de organisatie-instelling is de
//     terugval.

/** Voorselectie van het consulttype per behandelaar (N18). */
const LAATSTE_FORMAAT_SLEUTEL = "careon-scribe-laatste-formaat";

const ENGELSE_ANALYSE_MELDINGEN = {
  laden: "De beschikbaarheid van AI-analyse wordt gecontroleerd…",
  onbekend:
    "De beschikbaarheid van AI-analyse kon niet worden gecontroleerd. Zonder AI-analyse vult u bij Engelse gesprekken iedere verslagsectie zelf in.",
  beschikbaar:
    "AI-analyse is ingeschakeld. Bij Engelse gesprekken kunnen notities onvolledig blijven of handmatige invoer vereisen. Controleer het transcript en alle notities; beoordelingssecties schrijft en keurt u zelf.",
  handmatig:
    "Automatische extractie is hier niet beschikbaar voor Engels. Controleer het transcript en vul iedere verslagsectie zelf in en keur die afzonderlijk goed.",
};

function leesLaatsteFormaat(): ConsultType | null {
  try {
    const waarde = window.localStorage.getItem(LAATSTE_FORMAAT_SLEUTEL);
    return isConsultType(waarde) ? waarde : null;
  } catch {
    return null;
  }
}

function bewaarLaatsteFormaat(formaat: ConsultType): void {
  try {
    window.localStorage.setItem(LAATSTE_FORMAAT_SLEUTEL, formaat);
  } catch {
    // Zonder localStorage blijft de organisatie-instelling de voorselectie.
  }
}

export function NieuwConsultForm({ onAnnuleer }: Readonly<{ onAnnuleer: () => void }>) {
  const referentieId = useId();
  const typeId = useId();
  const taalId = useId();
  const consentId = useId();

  const [referentie, setReferentie] = useState("");
  const [consultType, setConsultType] = useState<ConsultType>("soap");
  const [taal, setTaal] = useState<ScribeTaal>("nl");
  const [consent, setConsent] = useState(false);
  const [consenttekst, setConsenttekst] = useState(() =>
    vulConsenttekstIn(STANDAARD_CONSENTTEKST, EMPTY_SCRIBE_INSTELLINGEN),
  );
  const [revisie, setRevisie] = useState(0);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [analyseStatus, setAnalyseStatus] = useState<keyof typeof ENGELSE_ANALYSE_MELDINGEN>("laden");

  useEffect(() => {
    void (async () => {
      const resultaat = await haalScribeInstellingen();
      if (!resultaat.ok) {
        setAnalyseStatus("onbekend");
        return;
      }
      setAnalyseStatus(
        resultaat.instellingen.aiAnalyseAan && resultaat.providerStatus.live && resultaat.providerStatus.analyseLive
          ? "beschikbaar"
          : "handmatig",
      );
      setConsenttekst(vulConsenttekstIn(resultaat.instellingen.consenttekst, resultaat.instellingen));
      setConsultType(leesLaatsteFormaat() ?? resultaat.instellingen.standaardFormaat);
      setRevisie(resultaat.revision);
    })();
  }, []);

  const referentieGeldig = isPatientReferentie(referentie);

  const start = async () => {
    if (!consent) {
      setFout("Vink de toestemmingsverklaring aan; zonder toestemming kan er geen consult starten.");
      return;
    }
    if (!referentieGeldig) {
      setFout(PATIENT_REFERENTIE_MELDING);
      return;
    }
    setBezig(true);
    const resultaat = await maakSessie({
      patientReferentie: referentie.trim(),
      consultType,
      taal,
      consentRevisie: revisie,
      // De ingevulde tekst is wat de cliënt hoorde; die bevriest het consult.
      consentTekst: consenttekst,
    });
    if (!resultaat.ok) {
      setBezig(false);
      setFout(resultaat.fout);
      if (resultaat.status === 409) {
        setConsent(false);
        const opnieuw = await haalScribeInstellingen();
        if (opnieuw.ok) {
          setConsenttekst(vulConsenttekstIn(opnieuw.instellingen.consenttekst, opnieuw.instellingen));
          setRevisie(opnieuw.revision);
        }
      }
      return;
    }
    bewaarLaatsteFormaat(consultType);
    window.location.assign(`/scribe/${resultaat.sessie.id}`);
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading font-medium text-base leading-snug">Nieuw consult</h2>
        <p className="text-muted-foreground text-sm">
          Careon houdt alleen een tijdelijke werkkopie; het EPD blijft het juridische dossier.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={referentieId}>Dossierreferentie</Label>
            <Input
              id={referentieId}
              autoFocus
              value={referentie}
              onChange={(gebeurtenis) => setReferentie(gebeurtenis.target.value)}
              maxLength={SCRIBE_LIMITS.patientReferentieMax}
              aria-invalid={referentie.length > 0 && !referentieGeldig}
              aria-describedby={`${referentieId}-hint`}
              placeholder="Bijv. D-2026-0417"
            />
            <p id={`${referentieId}-hint`} className="text-muted-foreground text-xs">
              {PATIENT_REFERENTIE_MELDING}
            </p>
            {referentie.trim().length > 0 && !referentieGeldig ? (
              <ScribeStatusregel toon="fout">
                Deze dossierreferentie is niet toegestaan. Gebruik het dossiernummer uit het EPD.
              </ScribeStatusregel>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={typeId}>Consulttype</Label>
            <NativeSelect
              id={typeId}
              className="w-full"
              value={consultType}
              onChange={(gebeurtenis) => setConsultType(gebeurtenis.target.value as ConsultType)}
            >
              {FORMAAT_KEUZES.map((keuze) => (
                <NativeSelectOption key={keuze.waarde} value={keuze.waarde}>
                  {keuze.label} — {keuze.doelgroep}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={taalId}>Taal</Label>
            <NativeSelect
              id={taalId}
              className="w-full"
              value={taal}
              aria-describedby={taal === "en" ? `${taalId}-hint` : undefined}
              onChange={(gebeurtenis) => setTaal(gebeurtenis.target.value as ScribeTaal)}
            >
              <NativeSelectOption value="nl">Nederlands</NativeSelectOption>
              <NativeSelectOption value="en">Engels</NativeSelectOption>
            </NativeSelect>
            {taal === "en" ? (
              <p id={`${taalId}-hint`} role="status" className="text-muted-foreground text-xs">
                {ENGELSE_ANALYSE_MELDINGEN[analyseStatus]}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border p-3">
          <Checkbox
            id={consentId}
            checked={consent}
            onCheckedChange={(waarde) => setConsent(waarde === true)}
            className="mt-0.5"
          />
          <Label htmlFor={consentId} className="block font-normal text-sm leading-relaxed">
            {consenttekst}
          </Label>
        </div>

        {fout ? <ScribeStatusregel toon="fout">{fout}</ScribeStatusregel> : null}

        {!consent ? (
          <ScribeStatusregel>Zonder aangevinkte toestemmingsverklaring kan er geen consult starten.</ScribeStatusregel>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void start()} disabled={bezig || !consent || !referentieGeldig}>
            {bezig ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
            Consult starten
          </Button>
          <Button variant="ghost" onClick={onAnnuleer} disabled={bezig}>
            Annuleren
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

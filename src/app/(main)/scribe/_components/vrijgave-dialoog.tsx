"use client";

import { useEffect, useId, useState } from "react";

import { Share2, Undo2 } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { GEANNULEERD_GROND_LABELS } from "@/data/careon/careon-scribe";
import { haalGemachtigden, maakVrijgave, trekVrijgaveIn, vrijgaveKandidaten } from "@/lib/careon-scribe/remote.client";
import { DEMO_ACTOR_ID } from "@/lib/careon-scribe/storage.client";
import {
  GEANNULEERD_GRONDEN,
  type GeannuleerdGrond,
  SCRIBE_LIMITS,
  type ScribeGemachtigde,
} from "@/lib/careon-scribe/types";

import { ScribeStatusregel } from "./scribe-statusregel";

// Vrijgave bij offboarding (handoff 20 §7.2, S12/V3). Een org_admin kan het
// GOEDGEKEURDE VERSLAG — nooit het transcript — eenmalig en geauditeerd aan een
// aangewezen collega geven, zodat documentatie niet onbereikbaar wordt wanneer
// een behandelaar vertrekt. De ontvanger krijgt het verslag read-only plus de
// export; het transcript blijft eigenaar-gebonden.
//
// Drie grenzen die N11 hier hard maakt:
//   * de keuzelijst toont uitsluitend GEMACHTIGDE collega's — een vrijgave aan
//     iemand zonder machtiging levert een verslag op dat de module zelf
//     blokkeert;
//   * de handelende gebruiker staat er nooit tussen: een beheerder die het
//     verslag aan zichzelf vrijgeeft, omzeilt precies de grens van V3;
//   * een vrijgave is intrekbaar ("Vrijgave intrekken"), met een grond die
//     metadata-only in het logboek belandt.
//
// C23 — de dialoog is GECONTROLEERD en sluit alleen op de succespad. Het
// `preventDefault()` op de actieknop blijft staan: zonder dat sluit Radix de
// dialoog vóór het serverantwoord en verdwijnt elke foutmelding ongezien.

/** Eigen e-mailadres uit de sessie; `null` op het demo-pad (route antwoordt 501). */
function useEigenEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { email?: unknown };
        if (typeof data.email === "string") setEmail(data.email);
      } catch {
        // Geen sessie-informatie: de route weigert een vrijgave aan uzelf alsnog.
      }
    })();
  }, []);
  return email;
}

export function VrijgaveDialoog({
  sessieId,
  onKlaar,
}: Readonly<{ sessieId: string; onKlaar: (melding: string) => void }>) {
  const collegaId = useId();
  const redenId = useId();
  const [open, setOpen] = useState(false);
  const [collegas, setCollegas] = useState<ScribeGemachtigde[]>([]);
  const [aanUserId, setAanUserId] = useState("");
  const [reden, setReden] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const eigenEmail = useEigenEmail();

  useEffect(() => {
    void (async () => {
      const resultaat = await haalGemachtigden();
      if (!resultaat.ok) return;
      setCollegas(resultaat.gemachtigden);
    })();
  }, []);

  const kandidaten = vrijgaveKandidaten(collegas, {
    userId: eigenEmail === null ? DEMO_ACTOR_ID : null,
    email: eigenEmail,
  });

  // Stabiele sleutel: `kandidaten` is elke render een nieuwe array, dus het
  // effect hangt aan de id-reeks in plaats van aan de arrayidentiteit.
  const kandidaatIds = kandidaten.map((rij) => rij.userId).join(",");
  useEffect(() => {
    const ids = kandidaatIds.length > 0 ? kandidaatIds.split(",") : [];
    setAanUserId((huidig) => (ids.includes(huidig) ? huidig : (ids[0] ?? "")));
  }, [kandidaatIds]);

  const geef = async () => {
    if (!aanUserId) {
      setFout("Kies eerst de gemachtigde collega die het verslag overneemt.");
      return;
    }
    if (reden.trim().length === 0) {
      setFout("Noteer waarom u dit verslag vrijgeeft; die reden wordt geauditeerd.");
      return;
    }
    setBezig(true);
    const resultaat = await maakVrijgave(sessieId, aanUserId, reden.trim());
    setBezig(false);
    if (!resultaat.ok) {
      setFout(resultaat.fout);
      return;
    }
    setFout(null);
    setReden("");
    setOpen(false);
    onKlaar("Het goedgekeurde verslag is vrijgegeven; de vrijgave is geauditeerd.");
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nieuw) => {
        setOpen(nieuw);
        if (!nieuw) setFout(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Share2 className="size-3.5" />
          Verslag vrijgeven
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Verslag vrijgeven aan een collega?</AlertDialogTitle>
          <AlertDialogDescription>
            De collega krijgt uitsluitend het goedgekeurde verslag te zien, nooit het transcript of de consultstaat. De
            vrijgave wordt vastgelegd in het auditlogboek en is later intrekbaar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={collegaId}>Collega</Label>
            <NativeSelect
              id={collegaId}
              className="w-full"
              value={aanUserId}
              onChange={(gebeurtenis) => setAanUserId(gebeurtenis.target.value)}
            >
              {kandidaten.length === 0 ? (
                <NativeSelectOption value="">Geen gemachtigde collega's gevonden</NativeSelectOption>
              ) : null}
              {kandidaten.map((collega) => (
                <NativeSelectOption key={collega.userId} value={collega.userId}>
                  {collega.naam} ({collega.email})
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-muted-foreground text-xs">
              Alleen gemachtigde behandelaren; uzelf staat er bewust niet tussen.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={redenId}>Reden</Label>
            <Input
              id={redenId}
              value={reden}
              onChange={(gebeurtenis) => setReden(gebeurtenis.target.value)}
              maxLength={SCRIBE_LIMITS.vrijgaveReden}
              placeholder="Bijv. behandelaar uit dienst per 1 oktober"
            />
          </div>
          {fout ? <ScribeStatusregel toon="fout">{fout}</ScribeStatusregel> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuleren</AlertDialogCancel>
          <AlertDialogAction
            disabled={bezig}
            onClick={(gebeurtenis) => {
              gebeurtenis.preventDefault();
              void geef();
            }}
          >
            Vrijgeven
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Vrijgave intrekken (N11): alle vrijgaven van dit consult vervallen. */
export function VrijgaveIntrekkenDialoog({
  sessieId,
  onKlaar,
}: Readonly<{ sessieId: string; onKlaar: (melding: string) => void }>) {
  const grondId = useId();
  const [open, setOpen] = useState(false);
  const [grond, setGrond] = useState<GeannuleerdGrond>("overig");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const trekIn = async () => {
    setBezig(true);
    const resultaat = await trekVrijgaveIn(sessieId, undefined, grond);
    setBezig(false);
    if (!resultaat.ok) {
      setFout(resultaat.fout);
      return;
    }
    setFout(null);
    setOpen(false);
    onKlaar(
      resultaat.aantal > 0
        ? "De vrijgave is ingetrokken; de collega ziet het verslag niet meer."
        : "Er stond geen vrijgave meer open voor dit consult.",
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nieuw) => {
        setOpen(nieuw);
        if (!nieuw) setFout(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Undo2 className="size-3.5" />
          Vrijgave intrekken
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Vrijgave van dit verslag intrekken?</AlertDialogTitle>
          <AlertDialogDescription>
            Alle vrijgaven van dit consult vervallen; de collega verliest de toegang tot het verslag direct. De
            intrekking wordt metadata-only vastgelegd in het logboek.
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
        </div>
        {fout ? <ScribeStatusregel toon="fout">{fout}</ScribeStatusregel> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Annuleren</AlertDialogCancel>
          <AlertDialogAction
            disabled={bezig}
            onClick={(gebeurtenis) => {
              gebeurtenis.preventDefault();
              void trekIn();
            }}
          >
            Vrijgave intrekken
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

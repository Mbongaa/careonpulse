"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Plus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { SPREKER_LABELS } from "@/data/careon/careon-scribe";
import {
  clearSubmittedScribeDraft,
  readScribeDraft,
  scribeDraftGeneration,
  setScribeDraftPending,
  writeScribeDraft,
} from "@/lib/careon-scribe/drafts.client";
import { SCRIBE_LIMITS, SPREKERS, type Spreker } from "@/lib/careon-scribe/types";

import { ScribeStatusregel } from "./scribe-statusregel";

// Handmatige invoerregel onderaan het transcript (handoff 20 §7.3). Dit is
// géén randgeval: zonder transcriptieprovider (503), zonder microfoonrechten,
// in de WebView van de shell en na een ontbrekend fragment is dit de manier om
// het consult toch vast te leggen. De module blijft daardoor bruikbaar
// wanneer er niets van de AI-laag draait.
//
// Daarom mag de getypte tekst NOOIT verdwijnen als verzenden mislukt (N13/C19):
//   * `onToevoegen` geeft `false` terug bij een 409/413/429 of een dood
//     netwerk; het veld blijft dan staan met een expliciete retryknop.
//   * het concept staat tussentijds in sessionStorage onder
//     `careon-scribe-concept-<sessieId>` — precies zolang het tabblad leeft, en
//     nooit in localStorage: een consultfragment mag geen browsersessie
//     overleven. Bij succes wordt het gewist.

export function HandmatigeInvoer({
  sessieId,
  onToevoegen,
}: Readonly<{ sessieId: string; onToevoegen: (tekst: string, spreker: Spreker) => Promise<boolean> }>) {
  const tekstId = useId();
  const sprekerId = useId();
  const [tekst, setTekst] = useState("");
  const [spreker, setSpreker] = useState<Spreker>("arts");
  const [bezig, setBezig] = useState(false);
  const [mislukt, setMislukt] = useState(false);
  const revisionRef = useRef(0);
  const sendingRef = useRef(false);
  const tokenRef = useRef(scribeDraftGeneration(sessieId));

  // Het concept staat al in sessionStorage wanneer een eerdere poging faalde en
  // de behandelaar het tabblad ververste.
  useEffect(() => {
    const bewaard = readScribeDraft(sessieId);
    tokenRef.current = scribeDraftGeneration(sessieId);
    if (bewaard.tekst.length > 0) {
      setTekst(bewaard.tekst);
      setSpreker(bewaard.spreker);
      setMislukt(true);
    }
  }, [sessieId]);

  const wijzig = (waarde: string) => {
    revisionRef.current += 1;
    setTekst(waarde);
    writeScribeDraft(sessieId, waarde, spreker, tokenRef.current);
  };

  const voegToe = async () => {
    const schoon = tekst.trim();
    if (schoon.length === 0 || sendingRef.current) return;
    const revision = revisionRef.current;
    const token = tokenRef.current;
    sendingRef.current = true;
    setBezig(true);
    setScribeDraftPending(sessieId, 1);
    try {
      const gelukt = await onToevoegen(schoon, spreker);
      if (token !== scribeDraftGeneration(sessieId)) return;
      setMislukt(!gelukt);
      if (gelukt && revision === revisionRef.current) {
        setTekst("");
        clearSubmittedScribeDraft(sessieId, token);
      }
    } finally {
      sendingRef.current = false;
      setBezig(false);
      if (token === scribeDraftGeneration(sessieId)) setScribeDraftPending(sessieId, -1);
    }
  };

  return (
    <div className="grid gap-2 rounded-lg border p-2">
      <Label htmlFor={tekstId} className="text-muted-foreground text-xs">
        Gesprekstekst handmatig toevoegen
      </Label>
      <Textarea
        id={tekstId}
        value={tekst}
        onChange={(gebeurtenis) => wijzig(gebeurtenis.target.value)}
        maxLength={SCRIBE_LIMITS.segmentTekst}
        rows={2}
        placeholder="Typ wat er is gezegd…"
      />
      {mislukt ? <ScribeStatusregel toon="fout">Niet verzonden — probeer opnieuw</ScribeStatusregel> : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={sprekerId} className="text-muted-foreground text-xs">
            Spreker
          </Label>
          <NativeSelect
            id={sprekerId}
            size="sm"
            value={spreker}
            onChange={(gebeurtenis) => {
              const value = gebeurtenis.target.value as Spreker;
              revisionRef.current += 1;
              setSpreker(value);
              writeScribeDraft(sessieId, tekst, value, tokenRef.current);
            }}
          >
            {SPREKERS.map((waarde) => (
              <NativeSelectOption key={waarde} value={waarde}>
                {SPREKER_LABELS[waarde]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={bezig || tekst.trim().length === 0}
          onClick={() => void voegToe()}
        >
          {mislukt ? <RotateCcw className="size-3.5" /> : <Plus className="size-3.5" />}
          {mislukt ? "Opnieuw verzenden" : "Regel toevoegen"}
        </Button>
      </div>
    </div>
  );
}

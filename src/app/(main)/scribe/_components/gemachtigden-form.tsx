"use client";

import { useEffect, useState } from "react";

import { Loader2, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { bewaarGemachtigden, haalGemachtigden } from "@/lib/careon-scribe/remote.client";
import type { ScribeGemachtigde } from "@/lib/careon-scribe/types";

import { ScribeStatusregel } from "./scribe-statusregel";

// Gemachtigde behandelaren (handoff 20 §7.5, S12). De kring rond
// bijzondere-categoriedata blijft zo klein mogelijk: alleen wie hier is
// aangevinkt kan een consult voeren. Organisatiebeheerders zijn per definitie
// gemachtigd en daarom niet uitvinkbaar — anders zou een beheerder zichzelf uit
// zijn eigen module kunnen sluiten en de instellingen onbereikbaar maken.

export function GemachtigdenForm() {
  const [gemachtigden, setGemachtigden] = useState<ScribeGemachtigde[] | null>(null);
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const resultaat = await haalGemachtigden();
      if (resultaat.ok) setGemachtigden(resultaat.gemachtigden);
      else setFout(resultaat.fout);
    })();
  }, []);

  const bewaar = async () => {
    if (!gemachtigden) return;
    setBezig(true);
    const resultaat = await bewaarGemachtigden(gemachtigden.filter((rij) => rij.gemachtigd).map((rij) => rij.userId));
    setBezig(false);
    if (!resultaat.ok) {
      setFout(
        resultaat.status === 409
          ? "Iemand anders heeft de machtigingen intussen gewijzigd. Laad de pagina opnieuw."
          : resultaat.fout,
      );
      return;
    }
    setGemachtigden(resultaat.gemachtigden);
    setFout(null);
    setMelding("De machtigingen zijn opgeslagen.");
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading font-medium text-base leading-snug">Gemachtigde behandelaren</h2>
        {/* C26 — de vorige formulering ("blijft altijd zichtbaar … ook voor u
            niet") zei letterlijk het tegenovergestelde van S12/V3 én botste met
            de retentieregel van S15. Deze zin sluit aan op de twee andere
            beheerdersvlakken: "het transcript is nooit leesbaar". */}
        <p className="text-muted-foreground text-sm">
          Alleen gemachtigde behandelaren kunnen consulten voeren. Het transcript is uitsluitend leesbaar voor de
          behandelaar die het consult voerde — ook u als beheerder kunt het niet inzien. Van consulten van collega's
          ziet u alleen metadata; u kunt het goedgekeurde verslag vrijgeven en die vrijgave weer intrekken.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {gemachtigden === null ? (
          <p className="text-muted-foreground text-sm">Laden…</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {gemachtigden.length === 0 ? (
              <li className="p-3 text-muted-foreground text-sm">Geen organisatieleden gevonden.</li>
            ) : null}
            {gemachtigden.map((rij) => {
              const vast = rij.orgRole === "org_admin";
              return (
                <li key={rij.userId} className="flex items-center justify-between gap-3 p-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <Checkbox
                      id={`gemachtigde-${rij.userId}`}
                      checked={rij.gemachtigd}
                      disabled={vast}
                      onCheckedChange={(waarde) =>
                        setGemachtigden((huidig) =>
                          (huidig ?? []).map((item) =>
                            item.userId === rij.userId ? { ...item, gemachtigd: waarde === true } : item,
                          ),
                        )
                      }
                    />
                    <Label htmlFor={`gemachtigde-${rij.userId}`} className="block min-w-0 font-normal">
                      <span className="block truncate text-sm">{rij.naam}</span>
                      <span className="block truncate text-muted-foreground text-xs">{rij.email}</span>
                    </Label>
                  </span>
                  {vast ? (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      Beheerder — altijd gemachtigd
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {fout ? <ScribeStatusregel toon="fout">{fout}</ScribeStatusregel> : null}
        {melding ? <ScribeStatusregel toon="goed">{melding}</ScribeStatusregel> : null}
        <Button variant="outline" disabled={bezig || gemachtigden === null} onClick={() => void bewaar()}>
          {bezig ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Machtigingen opslaan
        </Button>
      </CardContent>
    </Card>
  );
}

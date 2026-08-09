"use client";

import { useState } from "react";

import { BadgeEuro, Download, FileCheck2, Loader2, RefreshCcw, Send, Undo2 } from "lucide-react";

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
import type { FacturatieBron } from "@/lib/careon-facturatie/remote.client";
import { formatEuro } from "@/lib/careon-facturatie/totalen";
import type { Factuur } from "@/lib/careon-facturatie/types";

// Actiebalk (handoff 15 §4.3). "Definitief maken" is de enige handeling met
// een AlertDialog — bewuste, gedocumenteerde uitzondering op de Careon-
// huisstijl zonder dialogen: het nummer wordt verbruikt en de factuur wordt
// juridisch onwijzigbaar. Download loopt bij centrale opslag via de
// archiefroute; in demo via de client-blob van het voorbeeld.

export function FactuurStatusActies({
  factuur,
  bron,
  bezig,
  onDefinitief,
  onStatus,
  onCrediteer,
  onPdfHerstel,
}: Readonly<{
  factuur: Factuur;
  bron: FacturatieBron;
  bezig: boolean;
  onDefinitief: () => void;
  onStatus: (status: "verzonden" | "betaald", betaaldOp?: string) => void;
  onCrediteer: () => void;
  onPdfHerstel: () => void;
}>) {
  const [betaaldOp, setBetaaldOp] = useState(() => new Date().toISOString().slice(0, 10));

  if (factuur.status === "concept") {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={bezig || factuur.regels.length === 0}>
            {bezig ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
            Definitief maken
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Factuur definitief maken?</AlertDialogTitle>
            <AlertDialogDescription>
              De factuur krijgt het eerstvolgende nummer in de reeks en kan daarna niet meer worden gewijzigd of
              verwijderd — corrigeren kan alleen nog met een creditfactuur. Totaal: {formatEuro(factuur.totaalCent)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction onClick={onDefinitief}>Definitief maken</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  const kanVerzonden = factuur.status === "definitief";
  const kanBetaald = factuur.status === "definitief" || factuur.status === "verzonden";
  const kanCrediteren = factuur.soort === "factuur" && ["definitief", "verzonden", "betaald"].includes(factuur.status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {bron === "centraal" && factuur.pdfPad ? (
        <Button asChild variant="outline" size="sm">
          <a href={`/api/careon/facturatie/facturen/${factuur.id}/pdf`}>
            <Download className="size-3.5" />
            Pdf downloaden
          </a>
        </Button>
      ) : null}
      {bron === "centraal" && !factuur.pdfPad ? (
        <Button variant="outline" size="sm" disabled={bezig} onClick={onPdfHerstel}>
          <RefreshCcw className="size-3.5" />
          Pdf opnieuw genereren
        </Button>
      ) : null}
      {kanVerzonden ? (
        <Button variant="outline" size="sm" disabled={bezig} onClick={() => onStatus("verzonden")}>
          <Send className="size-3.5" />
          Verzonden markeren
        </Button>
      ) : null}
      {kanBetaald ? (
        <span className="flex items-center gap-1">
          <Input
            type="date"
            value={betaaldOp}
            onChange={(event) => setBetaaldOp(event.target.value)}
            aria-label="Datum van betaling"
            className="h-8 w-36 text-xs"
          />
          <Button variant="outline" size="sm" disabled={bezig} onClick={() => onStatus("betaald", betaaldOp)}>
            <BadgeEuro className="size-3.5" />
            Betaald markeren
          </Button>
        </span>
      ) : null}
      {kanCrediteren ? (
        <Button variant="outline" size="sm" disabled={bezig} onClick={onCrediteer}>
          <Undo2 className="size-3.5" />
          Crediteren
        </Button>
      ) : null}
    </div>
  );
}

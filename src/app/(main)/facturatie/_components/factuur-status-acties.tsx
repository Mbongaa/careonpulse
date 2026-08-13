"use client";

import { useState } from "react";

import { BadgeEuro, Download, FileCheck2, Loader2, Mail, RefreshCcw, Send, Undo2, X } from "lucide-react";

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
import { type Factuur, isEmailAdres } from "@/lib/careon-facturatie/types";

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
  onVerwijder,
  onMail,
}: Readonly<{
  factuur: Factuur;
  bron: FacturatieBron;
  bezig: boolean;
  onDefinitief: () => void;
  onStatus: (status: "verzonden" | "betaald", betaaldOp?: string) => void;
  onCrediteer: () => void;
  onPdfHerstel: () => void;
  onVerwijder: () => void;
  onMail: (ontvanger: string) => void;
}>) {
  const [betaaldOp, setBetaaldOp] = useState(() => new Date().toISOString().slice(0, 10));
  // Ontvanger volgt de afnemer-snapshot: het component blijft gemount over de
  // concept→definitief-overgang heen, dus een mount-time-initializer zou het
  // adres van een eerder gekozen (of gedupliceerd) contact vasthouden — en de
  // factuur van klant B naar klant A sturen. Render-time-resync (het officiële
  // "adjusting state when props change"-patroon): wisselt de afnemer, dan
  // wisselt het veld mee; een handmatige correctie blijft staan tot dat moment.
  const afnemerEmail = factuur.afnemer?.email ?? "";
  const [ontvanger, setOntvanger] = useState(afnemerEmail);
  const [basisEmail, setBasisEmail] = useState(afnemerEmail);
  if (afnemerEmail !== basisEmail) {
    setBasisEmail(afnemerEmail);
    setOntvanger(afnemerEmail);
  }

  if (factuur.status === "concept") {
    return (
      <div className="flex flex-wrap items-center gap-2">
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
        <Button variant="outline" size="sm" disabled={bezig} onClick={onVerwijder} className="text-muted-foreground">
          <X className="size-3.5" />
          Concept verwijderen
        </Button>
      </div>
    );
  }

  const kanVerzonden = factuur.status === "definitief";
  const kanBetaald = factuur.status === "definitief" || factuur.status === "verzonden";
  const kanCrediteren = factuur.soort === "factuur" && ["definitief", "verzonden", "betaald"].includes(factuur.status);
  // Fase B: mailen kan zodra de factuur is uitgereikt; centraal bovendien pas
  // als het pdf-archief er is (de route eist de bijlage), in demo gesimuleerd.
  const kanMailen =
    ["definitief", "verzonden", "betaald"].includes(factuur.status) && (bron === "lokaal" || factuur.pdfPad !== null);

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
      {kanMailen ? (
        <span className="flex flex-wrap items-center gap-1">
          <Input
            type="email"
            value={ontvanger}
            onChange={(event) => setOntvanger(event.target.value)}
            placeholder="ontvanger@voorbeeld.nl"
            aria-label="Ontvanger (e-mailadres)"
            className="h-8 w-56 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={bezig || !isEmailAdres(ontvanger.trim())}
            onClick={() => onMail(ontvanger.trim())}
          >
            <Mail className="size-3.5" />
            {factuur.mailStatus === "niet_verzonden" ? "Versturen per e-mail" : "Opnieuw versturen"}
          </Button>
        </span>
      ) : null}
      {factuur.mailStatus === "verzonden" && factuur.mailVerzondenOp ? (
        <span className="text-muted-foreground text-xs">
          Per e-mail verzonden op{" "}
          {new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" }).format(
            new Date(factuur.mailVerzondenOp),
          )}
        </span>
      ) : null}
      {factuur.mailStatus === "mislukt" ? (
        <span role="status" className="text-red-700 text-xs dark:text-red-400">
          Laatste e-mailverzending mislukt.
        </span>
      ) : null}
      {factuur.mailStatus === "in_wachtrij" ? (
        <span role="status" className="text-amber-700 text-xs dark:text-amber-400">
          Verzending onderweg of afgebroken — controleer de verzendhistorie voordat u opnieuw verstuurt.
        </span>
      ) : null}
    </div>
  );
}

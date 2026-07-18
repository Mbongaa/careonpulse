"use client";

import { type DragEvent, useRef, useState } from "react";

import { CheckCircle2, Database, ShieldCheck, TriangleAlert } from "lucide-react";

import { type ActivationResult, useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { computeProductionSnapshot } from "@/lib/careon-production/compute-snapshot";
import { parseClientExport } from "@/lib/careon-production/parse-export";
import type { ImportWarning, ParseExportResult, ProductionState } from "@/lib/careon-production/types";
import { cn } from "@/lib/utils";

// Productie-modus: importeert de volledige ZSG-cliëntendata-export (geen
// KPI-totalen maar cliëntrijen) en berekent de dashboards uit echte data.
// Persoonsgegevens (naam, geboortedatum, verzekeringsnummer) worden bij het
// parsen weggegooid en verlaten de browser niet.

interface ImportPreview {
  fileName: string;
  parse: ParseExportResult;
  state: ProductionState;
  stats: { actief: number; wachtlijst: number; zonderDiagnose: number };
}

export function ProductieImportCard() {
  const { activateProduction, isProduction, source } = useCareon();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorWarnings, setErrorWarnings] = useState<ImportWarning[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [activation, setActivation] = useState<ActivationResult | null>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const parse = parseClientExport(file.name, String(reader.result ?? ""));
      setActivation(null);
      if (!parse.ok) {
        setPreview(null);
        setError(parse.error ?? "Bestand kon niet worden gelezen.");
        // Rij-waarschuwingen verklaren wáárom niets gelezen kon worden
        // (bijv. elke rij zonder Cliënt ID) — anders is de fout ondoorgrondelijk.
        setErrorWarnings(parse.warnings.slice(0, 4));
        return;
      }
      const state: ProductionState = {
        fileName: file.name,
        importedAt: new Date().toISOString(),
        records: parse.records,
      };
      // Zelfde referentiedatum als de provider straks gebruikt (importmoment),
      // zodat de preview-cijfers exact overeenkomen met het dashboard.
      const snapshot = computeProductionSnapshot(state, { locatie: "Alle locaties" }, new Date(state.importedAt));
      setError(null);
      setErrorWarnings([]);
      setPreview({
        fileName: file.name,
        parse,
        state,
        stats: {
          actief: snapshot.meta.activeClients,
          wachtlijst: snapshot.dossiersProductie.wachtlijst.totaal,
          zonderDiagnose: snapshot.dossiercontrole.checks[0].n,
        },
      });
    };
    reader.readAsText(file);
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleFile(file);
    }
  }

  async function activate() {
    if (!preview) return;
    setPreview(null);
    const result = await activateProduction(preview.state);
    setActivation(result);
  }

  return (
    <Card className="border-violet-600/30">
      <CardHeader>
        <CardDescription>
          <Badge variant="outline" className="border-violet-600/40 text-violet-700 dark:text-violet-400">
            Productie · cliëntendata-export
          </Badge>
        </CardDescription>
        <CardTitle>Productie-modus: volledige EPD-export</CardTitle>
        <CardDescription>
          Importeer de ZSG-cliëntendata-export (per cliënt één rij). Careon Pulse berekent instroom, caseload,
          wachtlijst, populatie en dossiercontroles rechtstreeks uit uw EPD-data; widgets zonder EPD-bron blijven als
          demo gemarkeerd.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isProduction && (
          <p className="flex items-center gap-2 text-emerald-700 text-sm dark:text-emerald-400">
            <CheckCircle2 className="size-4 shrink-0" />
            Productie-modus actief — {source.detail}. Importeer een nieuwer bestand om te verversen.
          </p>
        )}

        {/* Statusmeldingen alleen zolang productie-modus actief is: na een
            tussentijdse "Herstel demo-data" zou "Centraal opgeslagen" misleiden. */}
        {isProduction && activation && !activation.persisted && (
          <p className="flex items-start gap-2 text-amber-700 text-sm dark:text-amber-400" role="status">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            Let op: opslaan in de browser is mislukt (bestand te groot voor de browseropslag). Productie-modus is actief
            in dit tabblad, maar overleeft geen herlaad.
          </p>
        )}
        {isProduction && activation?.sync === "failed" && (
          <p className="flex items-start gap-2 text-amber-700 text-sm dark:text-amber-400" role="status">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            Centrale opslag mislukt — deze import is alleen in deze browser beschikbaar. Collega&apos;s en andere
            apparaten zien mogelijk een oudere import; controleer de Supabase-configuratie.
          </p>
        )}
        {isProduction && activation?.sync === "ok" && (
          <p className="text-muted-foreground text-xs" role="status">
            Centraal opgeslagen (Supabase) — collega&apos;s zien dezelfde import na herladen.
          </p>
        )}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40",
          )}
        >
          <Database className="size-6 text-muted-foreground" />
          <span className="font-medium text-sm">Sleep de cliëntendata-export hierheen of klik om te bladeren</span>
          <span className="text-muted-foreground text-xs">
            ZSG-formaat: <code>Cliënt ID;…;Wachtlijst Status;…</code> (puntkomma-gescheiden)
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              handleFile(file);
            }
            event.target.value = "";
          }}
        />

        {error && (
          <div role="status" className="space-y-1 text-sm">
            <p className="text-destructive">{error}</p>
            {errorWarnings.length > 0 && (
              <ul className="list-inside list-disc text-muted-foreground text-xs">
                {errorWarnings.map((warning) => (
                  <li key={`${warning.row}-${warning.message}`}>
                    {warning.row > 0 ? `Rij ${warning.row}: ` : ""}
                    {warning.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {preview && (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3" role="status">
            <p className="font-medium text-sm">
              {preview.fileName} gecontroleerd — {preview.parse.records.length} cliëntrijen gelezen
              {preview.parse.skippedRows > 0 && `, ${preview.parse.skippedRows} overgeslagen`}.
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border bg-background px-2 py-1.5">
                <p className="font-medium text-sm tabular-nums">{preview.stats.actief}</p>
                <p className="text-muted-foreground text-xs">actieve cliënten</p>
              </div>
              <div className="rounded-md border bg-background px-2 py-1.5">
                <p className="font-medium text-sm tabular-nums">{preview.stats.wachtlijst}</p>
                <p className="text-muted-foreground text-xs">op wachtlijst</p>
              </div>
              <div className="rounded-md border bg-background px-2 py-1.5">
                <p className="font-medium text-sm tabular-nums">{preview.stats.zonderDiagnose}</p>
                <p className="text-muted-foreground text-xs">zonder diagnose</p>
              </div>
            </div>
            {preview.parse.warnings.length > 0 && (
              <div className="flex flex-col gap-1 text-muted-foreground text-xs">
                <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="size-3.5" />
                  {preview.parse.warnings.length} aandachtspunt(en) bij het lezen
                </p>
                <ul className="list-inside list-disc">
                  {preview.parse.warnings.slice(0, 4).map((warning) => (
                    <li key={`${warning.row}-${warning.message}`}>
                      {warning.row > 0 ? `Rij ${warning.row}: ` : ""}
                      {warning.message}
                    </li>
                  ))}
                  {preview.parse.warnings.length > 4 && <li>… en {preview.parse.warnings.length - 4} meer.</li>}
                </ul>
              </div>
            )}
            <Button size="sm" className="self-start" onClick={() => void activate()}>
              Activeer productie-modus
            </Button>
          </div>
        )}

        <p className="flex items-start gap-2 text-muted-foreground text-xs">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          Privacy: namen, geboortedatums en verzekeringsnummers worden bij het inlezen verwijderd en nooit opgeslagen.
          Alleen gepseudonimiseerde dossierkenmerken blijven in deze browser bewaard.
        </p>
      </CardContent>
    </Card>
  );
}

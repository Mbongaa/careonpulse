"use client";

import { type DragEvent, useRef, useState } from "react";

import { Download, UploadCloud } from "lucide-react";

import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseKpiCsv, SAMPLE_CSV_CONTENT, SAMPLE_CSV_FILENAME } from "@/data/careon/careon-databron";
import { cn } from "@/lib/utils";

export function CsvImportCard() {
  const { overrides, setOverrides, setSource } = useCareon();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      // De al geïmporteerde overrides gaan mee: bij een tweede, gedeeltelijke
      // import moet de afgeleide "Totale omzet" op die waarden verder rekenen.
      const result = parseKpiCsv(file.name, String(reader.result ?? ""), overrides);
      setMessage({ text: result.message, ok: result.ok });
      if (result.ok) {
        setOverrides({ ...overrides, ...result.overrides });
        setSource({ mode: "csv", label: "CSV-import", detail: file.name });
      }
    };
    // Zonder deze tak doet de kaart bij een onleesbaar bestand (rechten,
    // netwerkschijf, ingetrokken USB) zichtbaar niets.
    reader.onerror = () => {
      setMessage({ text: `${file.name} kon niet worden gelezen — probeer het bestand opnieuw.`, ok: false });
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

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV_CONTENT], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = SAMPLE_CSV_FILENAME;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          <Badge variant="outline">Stap 1 · vandaag live</Badge>
        </CardDescription>
        <CardTitle>CSV-import uit uw EPD</CardTitle>
        <CardDescription>
          Sleep de maandelijkse KPI-export uit uw EPD hierin; Careon Pulse herkent de KPI-waarden automatisch.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
          <UploadCloud className="size-6 text-muted-foreground" />
          <span className="font-medium text-sm">Sleep uw CSV hierheen of klik om te bladeren</span>
          <span className="text-muted-foreground text-xs">
            Formaat: <code>kpi;huidig;vorige_maand</code>
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

        {message && (
          <p
            role="status"
            className={cn("text-sm", message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}
          >
            {message.text}
          </p>
        )}

        <Button variant="outline" size="sm" className="self-start" onClick={downloadSample}>
          <Download className="size-3.5" />
          Voorbeeld-CSV downloaden
        </Button>
      </CardContent>
    </Card>
  );
}

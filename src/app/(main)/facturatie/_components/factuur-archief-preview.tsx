"use client";

import { useEffect, useState } from "react";

import { ExternalLink, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Factuur } from "@/lib/careon-facturatie/types";
import { hasCareonNativeFileBridge, saveBlobThroughCareon } from "@/lib/careon-mobile/native-file.client";

/** Uitgereikte facturen tonen en downloaden uitsluitend de onveranderlijke
 * archiefbytes; een later gewijzigd logo of documentontwerp mag ze niet wijzigen. */
export function FactuurArchiefPreview({
  factuur,
  bezig,
  onHerstel,
}: Readonly<{ factuur: Factuur; bezig: boolean; onHerstel: () => void }>) {
  const [bestand, setBestand] = useState<{ blob: Blob; url: string } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [ontbreekt, setOntbreekt] = useState(!factuur.pdfPad);
  const [poging, setPoging] = useState(0);
  const [nativeBridge, setNativeBridge] = useState(false);

  useEffect(() => setNativeBridge(hasCareonNativeFileBridge()), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Herladen na pdf-herstel of een expliciete herhaalpoging.
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setBestand(null);
    setFout(null);
    setOntbreekt(!factuur.pdfPad);
    if (!factuur.pdfPad) return;

    void (async () => {
      try {
        const response = await fetch(`/api/careon/facturatie/facturen/${factuur.id}/pdf`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          if (controller.signal.aborted) return;
          setOntbreekt(response.status === 409);
          throw new Error(data?.error ?? "De pdf kon niet worden geladen. Probeer het opnieuw.");
        }
        if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("application/pdf")) {
          throw new Error("De pdf kon niet worden geladen. Meld u zo nodig opnieuw aan.");
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (blob.size === 0) throw new Error("De opgeslagen pdf is leeg. Probeer het opnieuw.");
        objectUrl = URL.createObjectURL(blob);
        setBestand({ blob, url: objectUrl });
      } catch (error) {
        if (!controller.signal.aborted) {
          setFout(error instanceof Error ? error.message : "De pdf kon niet worden geladen.");
        }
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [factuur.id, factuur.pdfPad, factuur.updatedAt, poging]);

  const download = async () => {
    if (!bestand) return;
    try {
      await saveBlobThroughCareon(bestand.blob, `${factuur.nummer ?? "factuur"}.pdf`);
    } catch (error) {
      setFout(error instanceof Error ? error.message : "De pdf kon niet worden opgeslagen.");
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {bestand ? "Gearchiveerde factuur — klaar om te downloaden." : "Gearchiveerde factuur"}
        </p>
        {bestand ? (
          <span className="flex items-center gap-2">
            {!nativeBridge ? (
              <Button asChild variant="outline" size="sm">
                <a href={bestand.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                  Voorbeeld openen
                </a>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void download()}>
              Pdf {nativeBridge ? "opslaan" : "downloaden"}
            </Button>
          </span>
        ) : null}
      </div>
      {bestand ? (
        <iframe
          title="Voorbeeld van de factuur"
          src={`${bestand.url}#toolbar=0&navpanes=0&view=FitH`}
          className="hidden h-full min-h-[480px] w-full rounded-lg border bg-white lg:block"
        />
      ) : null}
      {!bestand && !fout && !ontbreekt ? (
        <>
          <p role="status" className="text-muted-foreground text-xs">
            Pdf laden…
          </p>
          <Skeleton className="hidden h-full min-h-[480px] w-full rounded-lg lg:block" />
        </>
      ) : null}
      {fout || ontbreekt ? (
        <div className="space-y-2 rounded-lg border p-3">
          <p role="alert" className="text-destructive text-xs">
            {fout ?? "De factuur is uitgereikt, maar de pdf ontbreekt nog. Genereer de pdf om deze te downloaden."}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={bezig}
            onClick={ontbreekt ? onHerstel : () => setPoging((value) => value + 1)}
          >
            <RefreshCcw className="size-3.5" />
            {ontbreekt ? "Pdf opnieuw genereren" : "Pdf opnieuw laden"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

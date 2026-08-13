"use client";

import { useEffect, useRef, useState } from "react";

import { usePDF } from "@react-pdf/renderer";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FactuurDocument } from "@/lib/careon-facturatie/pdf/factuur-document";
import { registreerPdfFonts } from "@/lib/careon-facturatie/pdf/fonts.client";
import type { Factuur } from "@/lib/careon-facturatie/types";

// Live pdf-voorbeeld (handoff 15 §5.2): wat u ziet ís de pdf. De ENIGE module
// die @react-pdf/renderer client-side importeert; de editor laadt haar met
// dynamic({ ssr: false }). Debounce 400 ms — elke render draait Yoga + PDFKit.
// De iframe-src wisselt pas wanneer de render klaar is (anders knippert de
// native viewer wit); de vórige object-URL wordt ge-revoked, nooit de huidige.
// Mobiel (iframe rendert geen pdf op iOS/Chrome-Android): knop die de blob in
// een nieuw tabblad opent — enige, klant-goedgekeurde afwijking van
// mobile-first (V21).

registreerPdfFonts();

function useDebouncedValue<T>(waarde: T, vertragingMs: number): T {
  const [traag, setTraag] = useState(waarde);
  useEffect(() => {
    const timer = window.setTimeout(() => setTraag(waarde), vertragingMs);
    return () => window.clearTimeout(timer);
  }, [waarde, vertragingMs]);
  return traag;
}

export default function FactuurPdfPreview({ factuur, logoSrc }: Readonly<{ factuur: Factuur; logoSrc?: string }>) {
  const traag = useDebouncedValue(factuur, 400);
  const [instance, update] = usePDF({ document: <FactuurDocument factuur={traag} logoSrc={logoSrc} /> });

  // Bewust een ref + expliciete update-aanroep: de factuurstate is immutable
  // (React Compiler memoïseert op identiteit), dus elke nieuwe `traag` is een
  // nieuwe render van het document.
  const eersteRender = useRef(true);
  useEffect(() => {
    if (eersteRender.current) {
      eersteRender.current = false;
      return;
    }
    update(<FactuurDocument factuur={traag} logoSrc={logoSrc} />);
  }, [traag, logoSrc, update]);

  const [zichtbareUrl, setZichtbareUrl] = useState<string | null>(null);
  const vorigeUrl = useRef<string | null>(null);
  useEffect(() => {
    if (instance.loading || !instance.url) return;
    const vorige = vorigeUrl.current;
    vorigeUrl.current = instance.url;
    setZichtbareUrl(instance.url);
    if (vorige && vorige !== instance.url) URL.revokeObjectURL(vorige);
  }, [instance.loading, instance.url]);

  const bestandsnaam = `${factuur.nummer ?? "concept"}.pdf`;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">Voorbeeld — dit is de definitieve pdf.</p>
        <span className="flex items-center gap-2">
          {zichtbareUrl ? (
            <Button asChild variant="outline" size="sm" className="lg:hidden">
              <a href={zichtbareUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                Voorbeeld openen
              </a>
            </Button>
          ) : null}
          {zichtbareUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={zichtbareUrl} download={bestandsnaam}>
                Pdf downloaden
              </a>
            </Button>
          ) : null}
        </span>
      </div>
      {zichtbareUrl ? (
        <iframe
          title="Voorbeeld van de factuur"
          src={`${zichtbareUrl}#toolbar=0&navpanes=0&view=FitH`}
          className="hidden h-full min-h-[480px] w-full rounded-lg border bg-white lg:block"
        />
      ) : (
        <Skeleton className="hidden h-full min-h-[480px] w-full rounded-lg lg:block" />
      )}
      <p className="text-muted-foreground text-xs lg:hidden">
        Het ingebouwde voorbeeld is beschikbaar op een groter scherm; open de pdf hierboven in een nieuw tabblad.
      </p>
    </div>
  );
}

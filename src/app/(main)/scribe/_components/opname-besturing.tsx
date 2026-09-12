"use client";

import { FastForward, Loader2, Mic, Pause, Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ScribeOpname } from "@/lib/careon-scribe/opname.client";
import type { ScribeBron } from "@/lib/careon-scribe/remote.client";

// Opnamebesturing (handoff 20 §7.3/§7.6). Vier standen, allemaal met een
// bruikbaar alternatief — de module mag nooit doodlopen op een ontbrekende
// microfoon of provider:
//   1. WebView van de shell: de fase-1-shell weigert elk permissieverzoek
//      (blueprint §5 / D12), dus daar staat een uitleg in plaats van de knop.
//   2. Geen transcriptieprovider (503): banner + handmatige invoer.
//   3. Demo-pad: het gescripte consult, zónder microfoon (S5/S14).
//   4. Normaal: starten, pauzeren, stoppen met VU-meter.

const OPNAME_TEKSTEN: Record<ScribeOpname["status"], string> = {
  uit: "Opname staat uit",
  starten: "Microfoon wordt geopend…",
  opnemen: "Opname loopt",
  gepauzeerd: "Opname gepauzeerd",
  stoppen: "Laatste fragmenten verwerken…",
};

export function opnameWachtrijTekst(status: ScribeOpname["status"]): string {
  return status === "stoppen" || status === "uit" ? "Laatste fragmenten verwerken…" : "Fragmenten verwerken…";
}

function opnameStatusTekst(opname: ScribeOpname): string {
  // De teller telt het lopende fragment één keer (C29), dus de waarde 1 is nu
  // bereikbaar en "1 fragmenten" zou fout Nederlands zijn.
  const staart =
    opname.wachtrij > 0
      ? ` — ${opname.wachtrij} ${opname.wachtrij === 1 ? "fragment" : "fragmenten"} in de wachtrij`
      : "";
  return `${OPNAME_TEKSTEN[opname.status]}${staart}`;
}

export function OpnameBesturing({
  bron,
  providerBeschikbaar,
  webview,
  opname,
  demoRest,
  demoBezig,
  demoLoopt,
  onDemoStap,
  onDemoAlles,
}: Readonly<{
  bron: ScribeBron;
  providerBeschikbaar: boolean;
  webview: boolean;
  opname: ScribeOpname;
  demoRest: number;
  demoBezig: boolean;
  /** Loopt de getempode weergave van het gescripte consult (C20)? */
  demoLoopt: boolean;
  onDemoStap: () => void;
  onDemoAlles: () => void;
}>) {
  const demo = bron === "lokaal";

  return (
    <div className="flex flex-col gap-2">
      {webview ? (
        <p className="rounded-md border p-2 text-muted-foreground text-xs">
          In de Careon Pulse-app is opnemen nog niet beschikbaar: de app geeft nog geen microfoontoegang aan modules.
          Voer de gesprekstekst hier handmatig in, of open dit consult in een browser.
        </p>
      ) : null}

      {opname.offline ? (
        <p
          role="alert"
          className="rounded-md border border-amber-600/40 bg-amber-600/10 p-2 text-amber-800 text-xs dark:text-amber-300"
        >
          Geen verbinding — opname gepauzeerd. Zodra de verbinding terug is, hervat Careon de opname en verzendt zij de
          wachtende fragmenten.
        </p>
      ) : null}

      {!demo && !providerBeschikbaar ? (
        <p role="alert" className="rounded-md border p-2 text-muted-foreground text-xs">
          Transcriptie is nog niet geactiveerd voor dit platform. U kunt gesprekstekst handmatig invoeren.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {demo ? (
          <>
            {/* C20 — "Demo-opname" is getempode weergave (DEMO_SEGMENT_INTERVAL_MS);
                "Volledig afspelen" blijft de eenmalige sprong. */}
            <Button
              size="sm"
              variant="outline"
              disabled={demoBezig || (demoRest === 0 && !demoLoopt)}
              onClick={onDemoStap}
            >
              {demoLoopt ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
              {demoLoopt ? "Demo-opname stoppen" : "Demo-opname"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={demoBezig || demoLoopt || demoRest === 0}
              onClick={onDemoAlles}
            >
              <FastForward className="size-3.5" />
              Volledig afspelen
            </Button>
            <span className="text-muted-foreground text-xs">
              {demoRest > 0
                ? `${demoRest} Nederlandse gescripte regels resteren`
                : "Het Nederlandse demo-consult is volledig afgespeeld"}
            </span>
          </>
        ) : null}

        {!demo && providerBeschikbaar && !webview ? (
          <>
            {opname.status === "uit" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!opname.ondersteund || opname.offline || !opname.wachtrijLeeg}
                onClick={() => void opname.start()}
              >
                <Mic className="size-3.5" />
                Opname starten
              </Button>
            ) : null}
            {opname.status === "opnemen" ? (
              <Button size="sm" variant="outline" onClick={opname.pauzeer}>
                <Pause className="size-3.5" />
                Opname pauzeren
              </Button>
            ) : null}
            {opname.status === "gepauzeerd" ? (
              <Button size="sm" variant="outline" disabled={opname.offline} onClick={opname.hervat}>
                <Play className="size-3.5" />
                Opname hervatten
              </Button>
            ) : null}
            {opname.status === "opnemen" || opname.status === "gepauzeerd" || opname.status === "starten" ? (
              <Button size="sm" variant="ghost" onClick={() => void opname.stop()}>
                <Square className="size-3.5" />
                Opname stoppen
              </Button>
            ) : null}
            {opname.status === "opnemen" || opname.status === "gepauzeerd" ? (
              <span aria-hidden="true" className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full bg-primary transition-[width] duration-150"
                  style={{ width: `${Math.round(opname.niveau * 100)}%` }}
                />
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      {opname.status === "uit" && !opname.wachtrijLeeg ? (
        <Button size="sm" variant="outline" disabled={opname.offline} onClick={() => void opname.herprobeer()}>
          Resterende fragmenten opnieuw verwerken
        </Button>
      ) : null}

      <p aria-live="polite" className="text-muted-foreground text-xs">
        {demo
          ? "Demo-opname gebruikt een vast Nederlands script, ook bij taalkeuze Engels. Er wordt geen microfoon gebruikt en geen audio verwerkt."
          : opnameStatusTekst(opname)}
      </p>
    </div>
  );
}

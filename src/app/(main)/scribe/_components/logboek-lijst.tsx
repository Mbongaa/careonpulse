"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { Download, Loader2 } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SCRIBE_HANDELING_LABELS } from "@/data/careon/careon-scribe";
import { saveBlobThroughCareon } from "@/lib/careon-mobile/native-file.client";
import type { LogboekRegel, ScribeHandeling } from "@/lib/careon-scribe/api-contract";
import { haalLogboek, type ScribeBron } from "@/lib/careon-scribe/remote.client";
import { isIsoDatum } from "@/lib/careon-scribe/types";

import { ScribeStatusregel } from "./scribe-statusregel";

// Careon AI-logboek (handoff 20, N20). De verwerkingsverantwoordelijke moet zelf
// kunnen vaststellen wie een consult opende, hoe vaak een verslag is
// geëxporteerd en wat een beheerder verwijderde — zonder tussenkomst van de
// Careon-superadmin.
//
// Wat hier NOOIT staat: transcripttekst, verslaginhoud of een dossierreferentie.
// De regels dragen uitsluitend metadata (tellingen, rollen, formaten) plus de
// naam van de actor uit `organization_members`. Het sessie-id is een technische
// sleutel, geen patiëntgegeven.
//
// STABIELE TOEGANKELIJKE NAMEN (test-agent): kop "Careon AI-logboek"; velden
// "Handeling", "Vanaf", "Tot en met"; knoppen "Logboek downloaden (.csv)",
// "Vorige", "Volgende".

const TIJDSTIP = new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatTijdstip(iso: string): string {
  const tijdstip = Date.parse(iso);
  return Number.isNaN(tijdstip) ? "—" : TIJDSTIP.format(new Date(tijdstip));
}

function handelingLabel(handeling: string): string {
  return SCRIBE_HANDELING_LABELS[handeling as ScribeHandeling] ?? handeling;
}

/** Metadata-detail als leesbare `sleutel: waarde`-reeks; nooit consultinhoud. */
function detailTekst(detail: LogboekRegel["detail"]): string {
  const delen = Object.entries(detail)
    .filter(([, waarde]) => waarde !== null && waarde !== "")
    .map(([sleutel, waarde]) => `${sleutel}: ${String(waarde)}`);
  return delen.length > 0 ? delen.join(" · ") : "—";
}

function csvVeld(waarde: string): string {
  return `"${waarde.replaceAll('"', '""')}"`;
}

function bouwCsv(regels: LogboekRegel[]): string {
  const kop = ["tijdstip", "handeling", "actor", "sessie", "details"].join(";");
  const rijen = regels.map((regel) =>
    [
      csvVeld(regel.tijdstip),
      csvVeld(handelingLabel(regel.handeling)),
      csvVeld(regel.actorNaam ?? "onbekend"),
      csvVeld(regel.sessieId ?? ""),
      csvVeld(detailTekst(regel.detail)),
    ].join(";"),
  );
  return [kop, ...rijen].join("\r\n");
}

export function LogboekLijst() {
  const handelingId = useId();
  const vanId = useId();
  const totId = useId();

  const [regels, setRegels] = useState<LogboekRegel[] | null>(null);
  const [handelingen, setHandelingen] = useState<string[]>([]);
  const [handeling, setHandeling] = useState("");
  const [van, setVan] = useState("");
  const [tot, setTot] = useState("");
  const [pagina, setPagina] = useState(1);
  const [meer, setMeer] = useState(false);
  const [bron, setBron] = useState<ScribeBron>("centraal");
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);

  const laad = useCallback(async () => {
    const resultaat = await haalLogboek({
      handeling: handeling || undefined,
      van: isIsoDatum(van) ? van : undefined,
      tot: isIsoDatum(tot) ? tot : undefined,
      pagina,
    });
    if (!resultaat.ok) {
      setRegels([]);
      setFout(resultaat.fout);
      return;
    }
    setRegels(resultaat.regels);
    setHandelingen(resultaat.handelingen);
    setMeer(resultaat.meer);
    setBron(resultaat.bron);
    setFout(null);
  }, [handeling, van, tot, pagina]);

  useEffect(() => {
    void laad();
  }, [laad]);

  const download = async () => {
    if (!regels || regels.length === 0) {
      setFout("Er is niets te downloaden voor deze selectie.");
      return;
    }
    const bestandsnaam = `careon-ai-logboek-${new Date().toISOString().slice(0, 10)}.csv`;
    try {
      await saveBlobThroughCareon(new Blob([bouwCsv(regels)], { type: "text/csv;charset=utf-8" }), bestandsnaam);
      setFout(null);
      setMelding(`Gedownload als ${bestandsnaam}.`);
    } catch {
      setFout("Downloaden is niet gelukt op dit apparaat.");
    }
  };

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title="Careon AI-logboek"
        sub="Wie opende welk consult, wat is geëxporteerd en wat verwijderde een beheerder — uitsluitend metadata."
        action={
          <Button variant="outline" disabled={regels === null} onClick={() => void download()}>
            <Download className="size-4" />
            Logboek downloaden (.csv)
          </Button>
        }
      />

      {bron === "lokaal" ? (
        <ScribeStatusregel>Lokale demo-opslag — afgeleid uit de handelingen in deze browser.</ScribeStatusregel>
      ) : null}

      <Card>
        <CardContent className="grid gap-4 py-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={handelingId}>Handeling</Label>
            <NativeSelect
              id={handelingId}
              className="w-full"
              value={handeling}
              onChange={(gebeurtenis) => {
                setHandeling(gebeurtenis.target.value);
                setPagina(1);
              }}
            >
              <NativeSelectOption value="">Alle handelingen</NativeSelectOption>
              {handelingen.map((waarde) => (
                <NativeSelectOption key={waarde} value={waarde}>
                  {handelingLabel(waarde)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={vanId}>Vanaf</Label>
            <Input
              id={vanId}
              type="date"
              value={van}
              onChange={(gebeurtenis) => {
                setVan(gebeurtenis.target.value);
                setPagina(1);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={totId}>Tot en met</Label>
            <Input
              id={totId}
              type="date"
              value={tot}
              onChange={(gebeurtenis) => {
                setTot(gebeurtenis.target.value);
                setPagina(1);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {fout ? <ScribeStatusregel toon="fout">{fout}</ScribeStatusregel> : null}
      {melding ? <ScribeStatusregel toon="goed">{melding}</ScribeStatusregel> : null}

      <Card className="py-0">
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Tijdstip</TableHead>
                  <TableHead>Handeling</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Sessie</TableHead>
                  <TableHead className="pr-4">Aantallen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regels === null ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground text-sm">
                      <Loader2 className="mr-2 inline size-4 animate-spin" />
                      Laden…
                    </TableCell>
                  </TableRow>
                ) : null}
                {regels !== null && regels.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground text-sm">
                      Geen handelingen gevonden voor deze selectie.
                    </TableCell>
                  </TableRow>
                ) : null}
                {(regels ?? []).map((regel) => (
                  <TableRow key={`${regel.tijdstip}-${regel.handeling}-${regel.sessieId ?? "org"}`}>
                    <TableCell className="whitespace-nowrap pl-4 tabular-nums">
                      {formatTijdstip(regel.tijdstip)}
                    </TableCell>
                    <TableCell>{handelingLabel(regel.handeling)}</TableCell>
                    <TableCell>{regel.actorNaam ?? "onbekend"}</TableCell>
                    <TableCell className="font-mono text-xs">{regel.sessieId ?? "—"}</TableCell>
                    <TableCell className="pr-4 text-muted-foreground text-xs">{detailTekst(regel.detail)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {pagina > 1 || meer ? (
            <div className="flex items-center justify-between border-t p-3">
              <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
                Vorige
              </Button>
              <span className="text-muted-foreground text-xs">Pagina {pagina}</span>
              <Button variant="outline" size="sm" disabled={!meer} onClick={() => setPagina(pagina + 1)}>
                Volgende
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-center text-muted-foreground text-xs">
        Het logboek toont uitsluitend metadata: nooit transcripttekst, verslaginhoud of een dossierreferentie.
      </p>
    </div>
  );
}

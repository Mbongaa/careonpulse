"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Copy, FilePlus2, Loader2, X } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FACTURATIE_PAGE_META, FACTUUR_STATUS_LABELS } from "@/data/careon/careon-facturatie";
import { isTeLaat } from "@/lib/careon-facturatie/nummer";
import {
  type FacturatieBron,
  haalFacturen,
  maakConcept,
  verwijderConcept,
} from "@/lib/careon-facturatie/remote.client";
import { formatEuro } from "@/lib/careon-facturatie/totalen";
import type { Factuur, FactuurStatus } from "@/lib/careon-facturatie/types";

// Facturenlijst (handoff 15 §4.2): het dagelijkse werkscherm. Standaardfilter
// lopend jaar, statusknoppen, zoeken op nummer/afnemer, rij-acties openen /
// dupliceren / concept verwijderen.

type StatusFilter = "alle" | FactuurStatus | "openstaand" | "te_laat";

// Statusknoppen exact §4.2: "Openstaand" bundelt definitief + verzonden —
// uitgereikt maar nog niet betaald, de dagelijkse beheerdersvraag.
const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "alle", label: "Alle" },
  { id: "concept", label: "Concept" },
  { id: "openstaand", label: "Openstaand" },
  { id: "te_laat", label: "Te laat" },
  { id: "betaald", label: "Betaald" },
  { id: "gecrediteerd", label: "Gecrediteerd" },
];

const DATUM_FORMAT = new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });

function formatDatum(isoDatum: string | null): string {
  return isoDatum ? DATUM_FORMAT.format(new Date(`${isoDatum}T00:00:00Z`)) : "—";
}

function vandaagIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function StatusBadge({ factuur }: Readonly<{ factuur: Factuur }>) {
  if (factuur.status !== "concept" && isTeLaat(factuur, vandaagIso())) {
    return <Badge className="bg-red-600/15 text-red-800 dark:text-red-400">Te laat</Badge>;
  }
  switch (factuur.status) {
    case "concept":
      return <Badge variant="outline">Concept</Badge>;
    case "definitief":
      return <Badge variant="secondary">Definitief</Badge>;
    case "verzonden":
      return <Badge>Verzonden</Badge>;
    case "betaald":
      return <Badge className="bg-emerald-600/15 text-emerald-800 dark:text-emerald-400">Betaald</Badge>;
    case "gecrediteerd":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          Gecrediteerd
        </Badge>
      );
  }
}

export function FacturatieLijst() {
  const router = useRouter();
  const huidigJaar = new Date().getUTCFullYear();
  const [filter, setFilter] = useState<StatusFilter>("alle");
  const [jaar, setJaar] = useState<number | null>(huidigJaar);
  const [zoek, setZoek] = useState("");
  const [pagina, setPagina] = useState(0);
  const [facturen, setFacturen] = useState<Factuur[] | null>(null);
  const [heeftMeer, setHeeftMeer] = useState(false);
  const [bron, setBron] = useState<FacturatieBron>("centraal");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => {
    const resultaat = await haalFacturen({
      jaar: jaar ?? undefined,
      status: filter === "alle" ? undefined : filter,
      zoek: zoek.trim() || undefined,
      pagina,
    });
    if (resultaat.ok) {
      setFacturen(resultaat.facturen);
      setHeeftMeer(resultaat.heeftMeer);
      setBron(resultaat.bron);
      setFout(null);
    } else {
      setFacturen([]);
      setFout(resultaat.fout);
    }
  }, [filter, jaar, zoek, pagina]);

  useEffect(() => {
    void laad();
  }, [laad]);

  const nieuweFactuur = async (dupliceerVan?: string) => {
    setBezig(true);
    const resultaat = await maakConcept(dupliceerVan);
    setBezig(false);
    if (resultaat.ok) {
      router.push(`/facturatie/${resultaat.factuur.id}`);
    } else {
      setFout(resultaat.fout);
    }
  };

  const verwijder = async (factuur: Factuur) => {
    const resultaat = await verwijderConcept(factuur.id);
    if (resultaat.ok) {
      void laad();
    } else {
      setFout(resultaat.fout);
    }
  };

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={FACTURATIE_PAGE_META.overzicht.title}
        sub={FACTURATIE_PAGE_META.overzicht.sub}
        action={
          <Button variant="outline" onClick={() => void nieuweFactuur()} disabled={bezig}>
            {bezig ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
            Nieuwe factuur
          </Button>
        }
      />

      {bron === "lokaal" ? (
        <p className="text-muted-foreground text-xs">Lokale demo-opslag — geen centrale registratie.</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => {
              setFilter(item.id);
              setPagina(0);
            }}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
              filter === item.id
                ? "border-primary/50 bg-primary/10 font-medium text-foreground"
                : "text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={jaar !== null}
          onClick={() => {
            setJaar(jaar === null ? huidigJaar : null);
            setPagina(0);
          }}
          className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
            jaar !== null
              ? "border-primary/50 bg-primary/10 font-medium text-foreground"
              : "text-muted-foreground hover:border-primary/40 hover:text-foreground"
          }`}
        >
          {jaar !== null ? `Jaar ${jaar}` : "Alle jaren"}
        </button>
        <Input
          value={zoek}
          onChange={(event) => {
            setZoek(event.target.value);
            setPagina(0);
          }}
          placeholder="Zoek op nummer of afnemer"
          aria-label="Zoek op factuurnummer of afnemernaam"
          className="h-8 max-w-56 text-xs"
        />
      </div>

      {fout ? (
        <p role="alert" className="text-red-700 text-xs dark:text-red-400">
          {fout}
        </p>
      ) : null}

      <Card className="py-0">
        <CardContent className="px-0">
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Nummer</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Afnemer</TableHead>
                  <TableHead className="text-right">Bedrag</TableHead>
                  <TableHead>Vervaldatum</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20 pr-4 text-right" aria-label="Acties" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {facturen === null ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground text-sm">
                      Laden…
                    </TableCell>
                  </TableRow>
                ) : null}
                {facturen !== null && facturen.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground text-sm">
                      Nog geen facturen. Maak uw eerste factuur.
                    </TableCell>
                  </TableRow>
                ) : null}
                {(facturen ?? []).map((factuur) => (
                  <TableRow key={factuur.id}>
                    <TableCell className="pl-4 font-medium">
                      <Link
                        href={`/facturatie/${factuur.id}`}
                        className={`hover:underline ${factuur.status === "gecrediteerd" ? "text-muted-foreground line-through" : ""}`}
                      >
                        {factuur.nummer ?? "Concept"}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDatum(factuur.factuurdatum)}</TableCell>
                    <TableCell className="max-w-56 truncate">{factuur.afnemer?.naam ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(factuur.totaalCent)}</TableCell>
                    <TableCell>{formatDatum(factuur.vervaldatum)}</TableCell>
                    <TableCell>
                      <StatusBadge factuur={factuur} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          aria-label={`Dupliceer factuur ${factuur.nummer ?? "concept"}`}
                          onClick={() => void nieuweFactuur(factuur.id)}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                        {factuur.status === "concept" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground"
                            aria-label="Verwijder concept"
                            onClick={() => void verwijder(factuur)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="divide-y md:hidden">
            {facturen === null ? <li className="p-4 text-center text-muted-foreground text-sm">Laden…</li> : null}
            {facturen !== null && facturen.length === 0 ? (
              <li className="p-4 text-center text-muted-foreground text-sm">
                Nog geen facturen. Maak uw eerste factuur.
              </li>
            ) : null}
            {(facturen ?? []).map((factuur) => (
              <li key={factuur.id}>
                <Link href={`/facturatie/${factuur.id}`} className="flex items-center justify-between gap-3 p-4">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-sm">
                      <span className={factuur.status === "gecrediteerd" ? "text-muted-foreground line-through" : ""}>
                        {factuur.nummer ?? "Concept"}
                      </span>{" "}
                      · {factuur.afnemer?.naam ?? "—"}
                    </span>
                    <span className="block text-muted-foreground text-xs">
                      {[
                        factuur.factuurdatum ? formatDatum(factuur.factuurdatum) : null,
                        FACTUUR_STATUS_LABELS[factuur.status],
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm tabular-nums">{formatEuro(factuur.totaalCent)}</span>
                    <StatusBadge factuur={factuur} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {pagina > 0 || heeftMeer ? (
            <div className="flex items-center justify-between border-t p-3">
              <Button variant="outline" size="sm" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>
                Vorige
              </Button>
              <span className="text-muted-foreground text-xs">Pagina {pagina + 1}</span>
              <Button variant="outline" size="sm" disabled={!heeftMeer} onClick={() => setPagina(pagina + 1)}>
                Volgende
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-center text-muted-foreground text-xs">
        Handmatige registratie — deze facturen komen niet uit het EPD en tellen niet mee in de omzetrapportage op
        Financieel.
      </p>
    </div>
  );
}

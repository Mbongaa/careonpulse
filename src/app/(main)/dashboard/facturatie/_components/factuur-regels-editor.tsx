"use client";

import { type FormEvent, useState } from "react";

import { ListPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BTW_TARIEF_LABELS } from "@/data/careon/careon-facturatie";
import { formatEuro, regelBedragCent } from "@/lib/careon-facturatie/totalen";
import { BTW_TARIEVEN, type BtwTarief, type FactuurRegel } from "@/lib/careon-facturatie/types";

// Regelseditor in de middelen-stijl: tekstvelden committen onBlur via
// key={id:waarde} + defaultValue; numerieke velden houden de rauwe tekst
// lokaal tot er een geldig getal uit komt (voorkomt dat "0" wordt opgeslagen
// tijdens het typen). Btw per regel (handoff 15 B10); de EN 16931-categorie
// volgt het tarief (E = vrijgesteld, S = 9/21, Z = 0).

function categorieVoor(tarief: BtwTarief): FactuurRegel["btwCategorie"] {
  if (tarief === "vrijgesteld") return "E";
  if (tarief === "0") return "Z";
  return "S";
}

function BedragInput({
  regel,
  onWijzig,
}: Readonly<{ regel: FactuurRegel; onWijzig: (patch: Partial<FactuurRegel>) => void }>) {
  const [ruw, setRuw] = useState<string | null>(null);
  return (
    <Input
      inputMode="decimal"
      value={ruw ?? String(regel.stukprijsCent / 100).replace(".", ",")}
      aria-label={`Stukprijs — ${regel.omschrijving || "nieuwe regel"}`}
      className="h-8 w-24 text-right text-xs tabular-nums"
      onChange={(event) => {
        setRuw(event.target.value);
        const getal = Number.parseFloat(event.target.value.replace(",", "."));
        if (Number.isFinite(getal)) onWijzig({ stukprijsCent: Math.round(getal * 100) });
      }}
      onBlur={() => setRuw(null)}
    />
  );
}

function AantalInput({
  regel,
  onWijzig,
}: Readonly<{ regel: FactuurRegel; onWijzig: (patch: Partial<FactuurRegel>) => void }>) {
  const [ruw, setRuw] = useState<string | null>(null);
  return (
    <Input
      inputMode="decimal"
      value={ruw ?? String(regel.aantal).replace(".", ",")}
      aria-label={`Aantal — ${regel.omschrijving || "nieuwe regel"}`}
      className="h-8 w-20 text-right text-xs tabular-nums"
      onChange={(event) => {
        setRuw(event.target.value);
        const getal = Number.parseFloat(event.target.value.replace(",", "."));
        if (Number.isFinite(getal)) onWijzig({ aantal: Math.round(getal * 1000) / 1000 });
      }}
      onBlur={() => setRuw(null)}
    />
  );
}

function RegelToevoegen({ onToevoegen }: Readonly<{ onToevoegen: (omschrijving: string) => void }>) {
  const [omschrijving, setOmschrijving] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (omschrijving.trim() === "") return;
    onToevoegen(omschrijving.trim());
    setOmschrijving("");
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-t p-4">
      <Input
        value={omschrijving}
        onChange={(event) => setOmschrijving(event.target.value)}
        placeholder="Omschrijving van de nieuwe regel"
        aria-label="Omschrijving nieuwe factuurregel"
        className="h-8 max-w-md text-xs"
      />
      <Button type="submit" size="sm" variant="outline" disabled={omschrijving.trim() === ""}>
        <ListPlus className="size-3.5" />
        Regel toevoegen
      </Button>
    </form>
  );
}

export function FactuurRegelsEditor({
  regels,
  standaardTarief,
  onWijzig,
}: Readonly<{
  regels: FactuurRegel[];
  standaardTarief: BtwTarief;
  onWijzig: (regels: FactuurRegel[]) => void;
}>) {
  const wijzigRegel = (id: string, patch: Partial<FactuurRegel>) => {
    onWijzig(regels.map((regel) => (regel.id === id ? { ...regel, ...patch } : regel)));
  };

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Omschrijving</TableHead>
            <TableHead className="text-right">Aantal</TableHead>
            <TableHead>Eenheid</TableHead>
            <TableHead className="text-right">Stukprijs</TableHead>
            <TableHead>Btw</TableHead>
            <TableHead className="text-right">Bedrag</TableHead>
            <TableHead className="w-10 pr-4" aria-label="Acties" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {regels.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-6 text-center text-muted-foreground text-sm">
                Nog geen regels. Voeg er hieronder een toe.
              </TableCell>
            </TableRow>
          ) : (
            regels.map((regel, index) => (
              <TableRow key={regel.id}>
                <TableCell className="min-w-56 pl-4">
                  <Input
                    key={`${regel.id}:${regel.omschrijving}`}
                    defaultValue={regel.omschrijving}
                    aria-label={`Omschrijving — regel ${index + 1}`}
                    className="h-8 text-xs"
                    onBlur={(event) => wijzigRegel(regel.id, { omschrijving: event.target.value })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex justify-end">
                    <AantalInput regel={regel} onWijzig={(patch) => wijzigRegel(regel.id, patch)} />
                  </span>
                </TableCell>
                <TableCell>
                  <Input
                    key={`${regel.id}:${regel.eenheid}`}
                    defaultValue={regel.eenheid}
                    aria-label={`Eenheid — regel ${index + 1}`}
                    className="h-8 w-20 text-xs"
                    onBlur={(event) => wijzigRegel(regel.id, { eenheid: event.target.value || "stuk" })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex justify-end">
                    <BedragInput regel={regel} onWijzig={(patch) => wijzigRegel(regel.id, patch)} />
                  </span>
                </TableCell>
                <TableCell>
                  <NativeSelect
                    value={regel.btwTarief}
                    aria-label={`Btw-tarief — regel ${index + 1}`}
                    className="h-8 w-28 text-xs"
                    onChange={(event) => {
                      const tarief = event.target.value as BtwTarief;
                      wijzigRegel(regel.id, { btwTarief: tarief, btwCategorie: categorieVoor(tarief) });
                    }}
                  >
                    {BTW_TARIEVEN.map((tarief) => (
                      <NativeSelectOption key={tarief} value={tarief}>
                        {BTW_TARIEF_LABELS[tarief]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatEuro(regelBedragCent(regel))}</TableCell>
                <TableCell className="pr-4 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    aria-label={`Verwijder regel ${index + 1}`}
                    onClick={() => onWijzig(regels.filter((rij) => rij.id !== regel.id))}
                  >
                    <X className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <RegelToevoegen
        onToevoegen={(omschrijving) =>
          onWijzig([
            ...regels,
            {
              id: crypto.randomUUID(),
              omschrijving,
              aantal: 1,
              eenheid: "stuk",
              stukprijsCent: 0,
              btwTarief: standaardTarief,
              btwCategorie: categorieVoor(standaardTarief),
            },
          ])
        }
      />
    </div>
  );
}

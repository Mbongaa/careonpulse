"use client";

import { type FormEvent, useState } from "react";

import { UserRoundPlus, X } from "lucide-react";

import { useCareonHr } from "@/app/(main)/dashboard/_components/careon/careon-hr-provider";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bigDagenTot, type HrBigRegistratie } from "@/lib/careon-hr/types";
import { cn } from "@/lib/utils";

import { bigDagenBadgeClass, bigDagenLabel } from "./big-badge";

// Beheer van alle BIG-registraties. Het paneel hierboven toont alleen wat
// binnen 90 dagen verloopt; hier staat de volledige lijst. De resterende dagen
// worden live berekend uit de verloopdatum.
function TekstCel({
  index,
  veld,
  waarde,
  label,
  placeholder,
}: Readonly<{
  index: number;
  veld: "naam" | "functie";
  waarde: string;
  label: string;
  placeholder: string;
}>) {
  const { setBigVeld } = useCareonHr();
  return (
    <Input
      key={`${index}:${waarde}`}
      defaultValue={waarde}
      placeholder={placeholder}
      aria-label={`${label} — rij ${index + 1}`}
      className="h-8 min-w-32 text-xs"
      onBlur={(event) => {
        if (event.target.value !== waarde) {
          setBigVeld(index, veld, event.target.value);
        }
      }}
    />
  );
}

function DagenBadge({ dagen }: Readonly<{ dagen: number }>) {
  return (
    <Badge variant="outline" className={cn("tabular-nums", bigDagenBadgeClass(dagen))}>
      {bigDagenLabel(dagen)}
    </Badge>
  );
}

function RegistratieToevoegen() {
  const { addBig } = useCareonHr();
  const [naam, setNaam] = useState("");
  const [functie, setFunctie] = useState("");
  const [verloopt, setVerloopt] = useState("");
  const [fout, setFout] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (addBig(naam, functie, verloopt)) {
      setNaam("");
      setFunctie("");
      setVerloopt("");
      setFout("");
    } else {
      setFout("Controleer de datum; dezelfde medewerker en verloopdatum kunnen niet dubbel worden toegevoegd.");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border-t p-4">
      <Input
        value={naam}
        onChange={(event) => setNaam(event.target.value)}
        placeholder="Naam"
        aria-label="Naam nieuwe BIG-registratie"
        className="h-8 max-w-40 text-xs"
      />
      <Input
        value={functie}
        onChange={(event) => setFunctie(event.target.value)}
        placeholder="Functie"
        aria-label="Functie nieuwe BIG-registratie"
        className="h-8 max-w-44 text-xs"
      />
      <Input
        type="date"
        value={verloopt}
        onChange={(event) => setVerloopt(event.target.value)}
        aria-label="Verloopdatum nieuwe BIG-registratie"
        className="h-8 max-w-40 text-xs"
      />
      <Button type="submit" size="sm" variant="outline" disabled={naam.trim() === "" || verloopt === ""}>
        <UserRoundPlus className="size-3.5" />
        Registratie toevoegen
      </Button>
      {fout && (
        <p role="alert" className="basis-full text-red-700 text-xs dark:text-red-400">
          {fout}
        </p>
      )}
    </form>
  );
}

export function HrBigEditor({ registraties, vandaag }: Readonly<{ registraties: HrBigRegistratie[]; vandaag: Date }>) {
  const { setBigVeld, removeBig } = useCareonHr();

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-medium text-sm">
          BIG-registraties beheren
          <CareonHandmatigBadge />
        </h2>
        <p className="text-muted-foreground text-xs">
          Volledige lijst; de resterende dagen worden automatisch uit de verloopdatum berekend.
        </p>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Naam</TableHead>
                  <TableHead>Functie</TableHead>
                  <TableHead>Verloopt</TableHead>
                  <TableHead className="text-right">Resterend</TableHead>
                  <TableHead className="w-10 pr-4" aria-label="Acties" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {registraties.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground text-sm">
                      Nog geen BIG-registraties. Voeg er hieronder een toe.
                    </TableCell>
                  </TableRow>
                ) : (
                  registraties.map((registratie, index) => (
                    <TableRow key={`${registratie.naam}:${registratie.verloopt}`}>
                      <TableCell className="pl-4">
                        <TekstCel index={index} veld="naam" waarde={registratie.naam} label="Naam" placeholder="Naam" />
                      </TableCell>
                      <TableCell>
                        <TekstCel
                          index={index}
                          veld="functie"
                          waarde={registratie.functie}
                          label="Functie"
                          placeholder="Functie"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          value={registratie.verloopt}
                          aria-label={`Verloopdatum — ${registratie.naam}`}
                          className="h-8 min-w-36 text-xs"
                          onChange={(event) => setBigVeld(index, "verloopt", event.target.value)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <DagenBadge dagen={bigDagenTot(registratie.verloopt, vandaag)} />
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          aria-label={`Verwijder registratie ${registratie.naam}`}
                          onClick={() => removeBig(index)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <RegistratieToevoegen />
        </CardContent>
      </Card>
    </div>
  );
}

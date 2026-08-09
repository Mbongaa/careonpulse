"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

import { UserRoundPlus, X } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONTACT_SOORT_LABELS, FACTURATIE_PAGE_META } from "@/data/careon/careon-facturatie";
import {
  bewaarContact,
  type FacturatieBron,
  haalContacten,
  haalMedewerkers,
  type MedewerkerUnieRij,
  verwijderContact,
} from "@/lib/careon-facturatie/remote.client";
import { CONTACT_SOORTEN, type ContactSoort, type FacturatieContact } from "@/lib/careon-facturatie/types";

import { FacturatieSubnav } from "./facturatie-subnav";

// Contactenregister (handoff 15 §4.1) + de categorie "Medewerkers": read-only
// unie uit dashboardaccounts en middelenregister met een expliciete
// "Overnemen als contact" — geen sync (B11). Verwijderen van een contact dat
// op een factuur staat, wordt automatisch archiveren.

type Filter = "alle" | ContactSoort;

function leegContact(): FacturatieContact {
  return {
    id: "",
    soort: "organisatie",
    bron: "handmatig",
    naam: "",
    land: "NL",
    archief: false,
    updatedAt: new Date().toISOString(),
  };
}

function ContactToevoegen({ onToegevoegd }: Readonly<{ onToegevoegd: () => void }>) {
  const [naam, setNaam] = useState("");
  const [soort, setSoort] = useState<ContactSoort>("organisatie");
  const [email, setEmail] = useState("");
  const [fout, setFout] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (naam.trim() === "") return;
    const resultaat = await bewaarContact(
      { ...leegContact(), naam: naam.trim(), soort, email: email.trim() || undefined },
      true,
    );
    if (resultaat.ok) {
      setNaam("");
      setEmail("");
      setFout(null);
      onToegevoegd();
    } else {
      setFout(resultaat.fout);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-t p-4">
      <Input
        value={naam}
        onChange={(event) => setNaam(event.target.value)}
        placeholder="Naam van het contact"
        aria-label="Naam nieuw contact"
        className="h-8 max-w-56 text-xs"
      />
      <NativeSelect
        value={soort}
        aria-label="Soort nieuw contact"
        className="h-8 w-32 text-xs"
        onChange={(event) => setSoort(event.target.value as ContactSoort)}
      >
        {CONTACT_SOORTEN.filter((rij) => rij !== "medewerker").map((rij) => (
          <NativeSelectOption key={rij} value={rij}>
            {CONTACT_SOORT_LABELS[rij]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Input
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="E-mailadres (optioneel)"
        aria-label="E-mailadres nieuw contact"
        className="h-8 max-w-56 text-xs"
      />
      <Button type="submit" size="sm" variant="outline" disabled={naam.trim() === ""}>
        <UserRoundPlus className="size-3.5" />
        Contact toevoegen
      </Button>
      {fout ? (
        <p role="alert" className="basis-full text-red-700 text-xs dark:text-red-400">
          {fout}
        </p>
      ) : null}
    </form>
  );
}

const BEWERKBAAR = [
  { veld: "contactpersoon", label: "Contactpersoon" },
  { veld: "email", label: "E-mail" },
  { veld: "adresRegel1", label: "Adres" },
  { veld: "postcode", label: "Postcode" },
  { veld: "plaats", label: "Plaats" },
  { veld: "referentie", label: "Referentie" },
] as const;

export function ContactenContent() {
  const [contacten, setContacten] = useState<FacturatieContact[] | null>(null);
  const [medewerkers, setMedewerkers] = useState<MedewerkerUnieRij[]>([]);
  const [filter, setFilter] = useState<Filter>("alle");
  const [bron, setBron] = useState<FacturatieBron>("centraal");
  const [fout, setFout] = useState<string | null>(null);

  const laad = useCallback(async () => {
    const [contactenResultaat, medewerkersResultaat] = await Promise.all([haalContacten(), haalMedewerkers()]);
    if (contactenResultaat.ok) {
      setContacten(contactenResultaat.contacten);
      setBron(contactenResultaat.bron);
    } else {
      setContacten([]);
      setFout(contactenResultaat.fout);
    }
    if (medewerkersResultaat.ok) setMedewerkers(medewerkersResultaat.medewerkers);
  }, []);

  useEffect(() => {
    void laad();
  }, [laad]);

  const wijzigVeld = async (contact: FacturatieContact, patch: Partial<FacturatieContact>) => {
    const resultaat = await bewaarContact({ ...contact, ...patch }, false);
    if (resultaat.ok) void laad();
    else setFout(resultaat.fout);
  };

  const verwijder = async (contact: FacturatieContact) => {
    const resultaat = await verwijderContact(contact.id);
    if (resultaat.ok) {
      void laad();
      return;
    }
    if (resultaat.status === 409) {
      // Op een factuur → archiveren in plaats van verwijderen.
      await wijzigVeld(contact, { archief: true });
      return;
    }
    setFout(resultaat.fout);
  };

  const overnemen = async (medewerker: MedewerkerUnieRij) => {
    const resultaat = await bewaarContact(
      {
        ...leegContact(),
        soort: "medewerker",
        bron: "medewerker",
        naam: medewerker.naam,
        email: medewerker.email,
        notitie: medewerker.functie,
        medewerkerNaam: medewerker.naam,
        medewerkerUserId: medewerker.userId,
      },
      true,
    );
    if (resultaat.ok) void laad();
    else setFout(resultaat.fout);
  };

  const zichtbaar = (contacten ?? []).filter((contact) => filter === "alle" || contact.soort === filter);

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader title={FACTURATIE_PAGE_META.contacten.title} sub={FACTURATIE_PAGE_META.contacten.sub} />

      <div className="flex flex-wrap items-center gap-2">
        <CareonHandmatigBadge />
        {bron === "lokaal" ? (
          <span className="text-muted-foreground text-xs">Lokale demo-opslag — geen centrale registratie.</span>
        ) : null}
        <span className="ml-auto">
          <FacturatieSubnav />
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["alle", ...CONTACT_SOORTEN] as Filter[]).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
              filter === item
                ? "border-primary/50 bg-primary/10 font-medium text-foreground"
                : "text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {item === "alle" ? "Alle" : CONTACT_SOORT_LABELS[item]}
          </button>
        ))}
      </div>

      {fout ? (
        <p role="alert" className="text-red-700 text-xs dark:text-red-400">
          {fout}
        </p>
      ) : null}

      <Card className="py-0">
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Naam</TableHead>
                  <TableHead>Soort</TableHead>
                  {BEWERKBAAR.map((kolom) => (
                    <TableHead key={kolom.veld}>{kolom.label}</TableHead>
                  ))}
                  <TableHead className="w-10 pr-4" aria-label="Acties" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacten === null ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-muted-foreground text-sm">
                      Laden…
                    </TableCell>
                  </TableRow>
                ) : null}
                {contacten !== null && zichtbaar.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-muted-foreground text-sm">
                      Nog geen contacten. Voeg er hieronder een toe.
                    </TableCell>
                  </TableRow>
                ) : null}
                {zichtbaar.map((contact) => (
                  <TableRow key={contact.id} className={contact.archief ? "opacity-60" : undefined}>
                    <TableCell className="min-w-44 pl-4">
                      <span className="flex items-center gap-2">
                        <Input
                          key={`${contact.id}:${contact.naam}`}
                          defaultValue={contact.naam}
                          aria-label={`Naam — ${contact.naam}`}
                          className="h-8 text-xs"
                          onBlur={(event) => {
                            if (event.target.value.trim() && event.target.value !== contact.naam) {
                              void wijzigVeld(contact, { naam: event.target.value.trim() });
                            }
                          }}
                        />
                        {contact.archief ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            archief
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <NativeSelect
                        value={contact.soort}
                        aria-label={`Soort — ${contact.naam}`}
                        className="h-8 w-28 text-xs"
                        onChange={(event) => void wijzigVeld(contact, { soort: event.target.value as ContactSoort })}
                      >
                        {CONTACT_SOORTEN.map((rij) => (
                          <NativeSelectOption key={rij} value={rij}>
                            {CONTACT_SOORT_LABELS[rij]}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </TableCell>
                    {BEWERKBAAR.map((kolom) => (
                      <TableCell key={kolom.veld}>
                        <Input
                          key={`${contact.id}:${kolom.veld}:${contact[kolom.veld] ?? ""}`}
                          defaultValue={contact[kolom.veld] ?? ""}
                          aria-label={`${kolom.label} — ${contact.naam}`}
                          className="h-8 min-w-28 text-xs"
                          onBlur={(event) => {
                            const waarde = event.target.value.trim() || undefined;
                            if (waarde !== (contact[kolom.veld] ?? undefined)) {
                              void wijzigVeld(contact, { [kolom.veld]: waarde });
                            }
                          }}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="pr-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground"
                        aria-label={`Verwijder ${contact.naam} uit de contacten`}
                        onClick={() => void verwijder(contact)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ContactToevoegen onToegevoegd={() => void laad()} />
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div>
          <h2 className="font-medium text-sm">Medewerkers</h2>
          <p className="text-muted-foreground text-xs">
            Medewerkers komen uit het medewerkersregister en de dashboardaccounts van uw organisatie. Overnemen maakt
            een los contact aan; latere wijzigingen aan de medewerker werken niet automatisch door.
          </p>
        </div>
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Naam</TableHead>
                  <TableHead>Functie</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead className="w-44 pr-4 text-right" aria-label="Acties" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {medewerkers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground text-sm">
                      Geen medewerkers gevonden.
                    </TableCell>
                  </TableRow>
                ) : (
                  medewerkers.map((medewerker) => (
                    <TableRow key={`${medewerker.naam}:${medewerker.email ?? ""}`}>
                      <TableCell className="pl-4">{medewerker.naam}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{medewerker.functie ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{medewerker.email ?? "—"}</TableCell>
                      <TableCell className="pr-4 text-right">
                        {medewerker.alContact ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            al contact
                          </Badge>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => void overnemen(medewerker)}>
                            <UserRoundPlus className="size-3.5" />
                            Overnemen als contact
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

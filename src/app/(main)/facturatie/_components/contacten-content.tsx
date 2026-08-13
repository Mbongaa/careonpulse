"use client";

import { type FormEvent, Fragment, useCallback, useEffect, useRef, useState } from "react";

import { ChevronDown, UserRoundPlus, X } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CONTACT_SOORT_LABELS, FACTURATIE_PAGE_META } from "@/data/careon/careon-facturatie";
import {
  bewaarContact,
  type FacturatieBron,
  haalContacten,
  haalMedewerkers,
  type MedewerkerUnieRij,
  verwijderContact,
} from "@/lib/careon-facturatie/remote.client";
import {
  CONTACT_SOORTEN,
  type ContactSoort,
  FACTURATIE_LIMITS,
  type FacturatieContact,
} from "@/lib/careon-facturatie/types";

// Contactenregister (handoff 15 §4.1) + de categorie "Medewerkers": read-only
// unie uit dashboardaccounts en middelenregister met een expliciete
// "Overnemen als contact" — geen sync (B11). Verwijderen van een contact dat
// op een factuur staat, wordt automatisch archiveren.
//
// De tabel toont de kernvelden inline; de resterende velden (telefoon, tweede
// adresregel, KvK, btw-id, Uzovi, AGB, betaaltermijn, notitie) staan achter een
// "Details"-uitklapregel per contact — acht kolommen erbij maakt de tabel op
// mobiel onbruikbaar breed, en de module vermijdt bewust dialogen. Bewerken
// blijft overal hetzelfde idioom als in de middelen-tabellen: defaultValue +
// commit onBlur, rauwe tekst-state voor het numerieke veld.

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

/** Naam + soort + de bewerkbare kolommen + de actiekolom. */
const KOLOMMEN = BEWERKBAAR.length + 3;

// Spiegelt de typeguards in types.ts (isFacturatieContact) zodat een ongeldige
// waarde hier al een inline melding geeft in plaats van een 400 van de API.
const KVK_PATROON = /^[0-9]{8}$/;
const UZOVI_PATROON = /^[0-9]{4}$/;

type DetailVeldNaam = "telefoon" | "adresRegel2" | "kvkNummer" | "btwId" | "uzovi" | "agbCode" | "notitie";

interface DetailVeld {
  veld: DetailVeldNaam;
  label: string;
  max: number;
  placeholder?: string;
  patroon?: RegExp;
  patroonFout?: string;
  meerregelig?: boolean;
}

const DETAILS: readonly DetailVeld[] = [
  { veld: "telefoon", label: "Telefoon", max: FACTURATIE_LIMITS.telefoon, placeholder: "013 - 123 45 67" },
  { veld: "adresRegel2", label: "Adres (regel 2)", max: FACTURATIE_LIMITS.adres },
  {
    veld: "kvkNummer",
    label: "KvK-nummer",
    max: 8,
    placeholder: "8 cijfers",
    patroon: KVK_PATROON,
    patroonFout: "KvK-nummer bestaat uit 8 cijfers.",
  },
  { veld: "btwId", label: "Btw-id", max: FACTURATIE_LIMITS.btwId, placeholder: "NL123456789B01" },
  {
    veld: "uzovi",
    label: "Uzovi-code",
    max: 4,
    placeholder: "4 cijfers",
    patroon: UZOVI_PATROON,
    patroonFout: "Uzovi-code bestaat uit 4 cijfers.",
  },
  { veld: "agbCode", label: "AGB-code", max: FACTURATIE_LIMITS.agbCode, placeholder: "bijv. 06012345" },
  { veld: "notitie", label: "Notitie", max: FACTURATIE_LIMITS.notitie, meerregelig: true },
];

function DetailVeldInvoer({
  contact,
  veld,
  onWijzig,
}: Readonly<{
  contact: FacturatieContact;
  veld: DetailVeld;
  onWijzig: (patch: Partial<FacturatieContact>) => void;
}>) {
  const [fout, setFout] = useState<string | null>(null);
  const huidig = contact[veld.veld] ?? "";
  const id = `contact-${contact.id}-${veld.veld}`;

  const commit = (ruweWaarde: string) => {
    const waarde = ruweWaarde.trim();
    if (waarde.length > veld.max) {
      setFout(`Maximaal ${veld.max} tekens.`);
      return;
    }
    if (waarde !== "" && veld.patroon && !veld.patroon.test(waarde)) {
      setFout(veld.patroonFout ?? "Ongeldige waarde.");
      return;
    }
    setFout(null);
    const nieuw = waarde === "" ? undefined : waarde;
    if (nieuw !== (contact[veld.veld] ?? undefined)) onWijzig({ [veld.veld]: nieuw });
  };

  // Zelfde remount-truc als in de rest van de tabel: de sleutel bevat de
  // opgeslagen waarde, zodat het veld na een geslaagde commit de nieuwe
  // defaultValue overneemt.
  const sleutel = `${contact.id}:${veld.veld}:${huidig}`;
  const gedeeld = {
    id,
    defaultValue: huidig,
    placeholder: veld.placeholder,
    "aria-label": `${veld.label} — ${contact.naam}`,
    "aria-invalid": fout ? true : undefined,
    onBlur: (event: { target: { value: string } }) => commit(event.target.value),
  };

  return (
    <div className={`space-y-1 ${veld.meerregelig ? "sm:col-span-2 lg:col-span-4" : ""}`}>
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {veld.label}
      </Label>
      {veld.meerregelig ? (
        <Textarea key={sleutel} {...gedeeld} className="min-h-14 text-xs" />
      ) : (
        <Input key={sleutel} {...gedeeld} className="h-8 text-xs" />
      )}
      {fout ? (
        <p role="alert" className="text-red-700 text-xs dark:text-red-400">
          {fout}
        </p>
      ) : null}
    </div>
  );
}

function BetaaltermijnInvoer({
  contact,
  onWijzig,
}: Readonly<{ contact: FacturatieContact; onWijzig: (patch: Partial<FacturatieContact>) => void }>) {
  // Rauwe tekst blijft lokaal tot het veld verlaten wordt, zodat half getypte
  // of gewiste invoer nooit als 0 in de registratie belandt (idioom uit de
  // middelen-/regelseditors); commit en validatie gebeuren onBlur.
  const [ruw, setRuw] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const opgeslagen = contact.betaaltermijnDagen === undefined ? "" : String(contact.betaaltermijnDagen);
  const id = `contact-${contact.id}-betaaltermijn`;

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        Betaaltermijn (dagen)
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        value={ruw ?? opgeslagen}
        placeholder={`0 t/m ${FACTURATIE_LIMITS.betaaltermijnDagen}`}
        aria-label={`Betaaltermijn (dagen) — ${contact.naam}`}
        aria-invalid={fout ? true : undefined}
        className="h-8 text-right text-xs tabular-nums"
        onChange={(event) => setRuw(event.target.value)}
        onBlur={() => {
          const waarde = (ruw ?? opgeslagen).trim();
          if (waarde === "") {
            setFout(null);
            setRuw(null);
            if (contact.betaaltermijnDagen !== undefined) onWijzig({ betaaltermijnDagen: undefined });
            return;
          }
          const getal = Number(waarde);
          if (
            !Number.isInteger(getal) ||
            getal < 0 ||
            getal > FACTURATIE_LIMITS.betaaltermijnDagen ||
            !/^[0-9]+$/.test(waarde)
          ) {
            setFout(`Betaaltermijn is een geheel getal van 0 t/m ${FACTURATIE_LIMITS.betaaltermijnDagen} dagen.`);
            return;
          }
          setFout(null);
          setRuw(null);
          if (getal !== contact.betaaltermijnDagen) onWijzig({ betaaltermijnDagen: getal });
        }}
      />
      {fout ? (
        <p role="alert" className="text-red-700 text-xs dark:text-red-400">
          {fout}
        </p>
      ) : null}
    </div>
  );
}

export function ContactenContent() {
  const [contacten, setContacten] = useState<FacturatieContact[] | null>(null);
  const [medewerkers, setMedewerkers] = useState<MedewerkerUnieRij[]>([]);
  const [filter, setFilter] = useState<Filter>("alle");
  const [bron, setBron] = useState<FacturatieBron>("centraal");
  const [fout, setFout] = useState<string | null>(null);
  /** Contacten waarvan de detailregel openstaat. */
  const [uitgeklapt, setUitgeklapt] = useState<readonly string[]>([]);

  // Verse stand buiten de render-closure om: veld-commits mogen nooit vanuit
  // een verouderde rij-snapshot de hele rij PATCHen (twee snelle opeenvolgende
  // blurs zouden elkaars wijziging terugdraaien).
  const laatsteContacten = useRef<FacturatieContact[] | null>(null);
  const commitKetting = useRef<Promise<void>>(Promise.resolve());

  const laad = useCallback(async () => {
    const [contactenResultaat, medewerkersResultaat] = await Promise.all([haalContacten(), haalMedewerkers()]);
    if (contactenResultaat.ok) {
      laatsteContacten.current = contactenResultaat.contacten;
      setContacten(contactenResultaat.contacten);
      setBron(contactenResultaat.bron);
    } else {
      laatsteContacten.current = [];
      setContacten([]);
      setFout(contactenResultaat.fout);
    }
    if (medewerkersResultaat.ok) setMedewerkers(medewerkersResultaat.medewerkers);
  }, []);

  useEffect(() => {
    void laad();
  }, [laad]);

  // Geserialiseerd per component: elke commit wacht op de vorige (incl. de
  // herlaad), en pakt dán pas de verse rij — zo bevat de tweede PATCH ook de
  // eerste wijziging.
  const wijzigVeld = (contact: FacturatieContact, patch: Partial<FacturatieContact>): Promise<void> => {
    commitKetting.current = commitKetting.current.then(async () => {
      const basis = laatsteContacten.current?.find((rij) => rij.id === contact.id) ?? contact;
      const resultaat = await bewaarContact({ ...basis, ...patch }, false);
      if (resultaat.ok) await laad();
      else setFout(resultaat.fout);
    });
    return commitKetting.current;
  };

  const wisselDetails = (contactId: string) => {
    setUitgeklapt((huidig) =>
      huidig.includes(contactId) ? huidig.filter((id) => id !== contactId) : [...huidig, contactId],
    );
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

      {bron === "lokaal" ? (
        <p className="text-muted-foreground text-xs">Lokale demo-opslag — geen centrale registratie.</p>
      ) : null}

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
                  <TableHead className="w-32 pr-4" aria-label="Acties" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacten === null ? (
                  <TableRow>
                    <TableCell colSpan={KOLOMMEN} className="py-6 text-center text-muted-foreground text-sm">
                      Laden…
                    </TableCell>
                  </TableRow>
                ) : null}
                {contacten !== null && zichtbaar.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={KOLOMMEN} className="py-6 text-center text-muted-foreground text-sm">
                      Nog geen contacten. Voeg er hieronder een toe.
                    </TableCell>
                  </TableRow>
                ) : null}
                {zichtbaar.map((contact) => (
                  <Fragment key={contact.id}>
                    <TableRow className={contact.archief ? "opacity-60" : undefined}>
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
                        <span className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-muted-foreground text-xs"
                            aria-expanded={uitgeklapt.includes(contact.id)}
                            aria-label={`Details — ${contact.naam}`}
                            onClick={() => wisselDetails(contact.id)}
                          >
                            <ChevronDown
                              className={`size-3.5 transition-transform ${
                                uitgeklapt.includes(contact.id) ? "rotate-180" : ""
                              }`}
                            />
                            Details
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground"
                            aria-label={`Verwijder ${contact.naam} uit de contacten`}
                            onClick={() => void verwijder(contact)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                    {uitgeklapt.includes(contact.id) ? (
                      <TableRow className={`bg-muted/40 ${contact.archief ? "opacity-60" : ""}`}>
                        <TableCell colSpan={KOLOMMEN} className="px-4 py-4">
                          {/* De detailregel is zo breed als de (op mobiel scrollende) tabel;
                            begrenzen op de vensterbreedte houdt alle velden bereikbaar
                            zonder horizontaal te scrollen. */}
                          <div className="w-[min(100%,calc(100vw-3rem))]">
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              {/* Eerst de enkelregelige velden, dan de betaaltermijn, dan de
                                notitie die de volle breedte krijgt. */}
                              {DETAILS.filter((veld) => !veld.meerregelig).map((veld) => (
                                <DetailVeldInvoer
                                  key={veld.veld}
                                  contact={contact}
                                  veld={veld}
                                  onWijzig={(patch) => void wijzigVeld(contact, patch)}
                                />
                              ))}
                              <BetaaltermijnInvoer
                                contact={contact}
                                onWijzig={(patch) => void wijzigVeld(contact, patch)}
                              />
                              {DETAILS.filter((veld) => veld.meerregelig).map((veld) => (
                                <DetailVeldInvoer
                                  key={veld.veld}
                                  contact={contact}
                                  veld={veld}
                                  onWijzig={(patch) => void wijzigVeld(contact, patch)}
                                />
                              ))}
                            </div>
                            <p className="pt-3 text-muted-foreground text-xs">
                              De Uzovi-code geldt voor zorgverzekeraars; KvK, btw-id en AGB komen op de factuur van de
                              afnemer terecht. De betaaltermijn wordt voorgesteld bij een nieuwe factuur.
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
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

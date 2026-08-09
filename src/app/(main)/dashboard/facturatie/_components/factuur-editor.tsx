"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowLeft } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { FACTURATIE_PAGE_META, VRIJSTELLING_PRESETS } from "@/data/careon/careon-facturatie";
import { berekenVervaldatum, uitreikingstermijnOverschreden } from "@/lib/careon-facturatie/nummer";
import {
  bewaarConcept,
  crediteer,
  type FacturatieBron,
  haalContacten,
  haalFacturatieInstellingen,
  haalFactuur,
  herstelPdf,
  maakDefinitief,
  wijzigStatus,
} from "@/lib/careon-facturatie/remote.client";
import { berekenTotalen, heeftVrijgesteldeRegels } from "@/lib/careon-facturatie/totalen";
import type { FacturatieContact, FacturatieInstellingen, Factuur } from "@/lib/careon-facturatie/types";
import { afzenderUitInstellingen, ONTBREKEND_LABELS, type OntbrekendVeld } from "@/lib/careon-facturatie/validatie";

import { StatusBadge } from "./facturatie-lijst";
import { FactuurRegelsEditor } from "./factuur-regels-editor";
import { FactuurStatusActies } from "./factuur-status-acties";
import { FactuurTotalenBlok } from "./factuur-totalen";

// Factuureditor met live pdf-voorbeeld (handoff 15 §4.3): formulier links,
// voorbeeld sticky rechts. Concepten autosaven debounced (800 ms) met
// updated_at-conflictdetectie; uitgereikte facturen zijn read-only met de
// statusacties. De preview-module is de enige met @react-pdf client-side en
// laadt via dynamic({ ssr: false }) — verplicht binnen een client component.

const FactuurPdfPreview = dynamic(() => import("./factuur-pdf-preview"), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[480px] w-full rounded-lg" />,
});

type SyncStatus = "laden" | "opgeslagen" | "bezig" | "lokaal" | "conflict" | "fout";

const SYNC_TEKST: Record<SyncStatus, string> = {
  laden: "Laden…",
  opgeslagen: "Opgeslagen",
  bezig: "Opslaan…",
  lokaal: "Lokaal opgeslagen (demo)",
  conflict: "Conflict — kies een versie",
  fout: "Opslaan mislukt",
};

function vandaagIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function FactuurEditor({ factuurId }: Readonly<{ factuurId: string }>) {
  const router = useRouter();
  const [factuur, setFactuur] = useState<Factuur | null>(null);
  const [instellingen, setInstellingen] = useState<FacturatieInstellingen | null>(null);
  const [contacten, setContacten] = useState<FacturatieContact[]>([]);
  const [bron, setBron] = useState<FacturatieBron>("centraal");
  const [sync, setSync] = useState<SyncStatus>("laden");
  const [fout, setFout] = useState<string | null>(null);
  const [ontbrekend, setOntbrekend] = useState<OntbrekendVeld[]>([]);
  const [conflictVersie, setConflictVersie] = useState<Factuur | null>(null);
  const [bezig, setBezig] = useState(false);
  const [afwijkendAdres, setAfwijkendAdres] = useState(false);

  // Versiebeheer voor autosave: server-updatedAt van de laatst bevestigde staat.
  const baseUpdatedAt = useRef<string>("");
  const vuil = useRef(false);

  useEffect(() => {
    let actief = true;
    void (async () => {
      const [factuurResultaat, instellingenResultaat, contactenResultaat] = await Promise.all([
        haalFactuur(factuurId),
        haalFacturatieInstellingen(),
        haalContacten(),
      ]);
      if (!actief) return;
      if (!factuurResultaat.ok) {
        setSync("fout");
        setFout(factuurResultaat.fout);
        return;
      }
      baseUpdatedAt.current = factuurResultaat.factuur.updatedAt;
      setFactuur(factuurResultaat.factuur);
      setBron(factuurResultaat.bron);
      if (instellingenResultaat.ok) setInstellingen(instellingenResultaat.instellingen);
      if (contactenResultaat.ok) setContacten(contactenResultaat.contacten);
      setSync(factuurResultaat.bron === "lokaal" ? "lokaal" : "opgeslagen");
    })();
    return () => {
      actief = false;
    };
  }, [factuurId]);

  const totalen = useMemo(() => berekenTotalen(factuur?.regels ?? []), [factuur?.regels]);

  // Voorbeeld: concepten tonen de afzender uit de instellingen en de afgeleide
  // vervaldatum, zodat wat u ziet exact de uit te reiken pdf is.
  const previewFactuur = useMemo(() => {
    if (!factuur) return null;
    const betaaltermijn = factuur.betaaltermijnDagen ?? instellingen?.betaling.standaardTermijnDagen ?? 30;
    const datum = factuur.factuurdatum ?? vandaagIso();
    return {
      ...factuur,
      afzender: factuur.afzender ?? (instellingen ? afzenderUitInstellingen(instellingen) : null),
      factuurdatum: factuur.status === "concept" ? datum : factuur.factuurdatum,
      vervaldatum: factuur.status === "concept" ? berekenVervaldatum(datum, betaaltermijn) : factuur.vervaldatum,
      subtotaalCent: totalen.subtotaalCent,
      btwCent: totalen.btwCent,
      totaalCent: totalen.totaalCent,
      btwTotalen: totalen.btwTotalen,
    } satisfies Factuur;
  }, [factuur, instellingen, totalen]);

  // Debounced autosave voor concepten (800 ms na de laatste wijziging).
  useEffect(() => {
    if (factuur?.status !== "concept" || !vuil.current || conflictVersie) return;
    const timer = window.setTimeout(async () => {
      vuil.current = false;
      setSync("bezig");
      const resultaat = await bewaarConcept(factuur, baseUpdatedAt.current);
      if (resultaat.ok) {
        baseUpdatedAt.current = resultaat.factuur.updatedAt;
        setBron(resultaat.bron);
        setSync(resultaat.bron === "lokaal" ? "lokaal" : "opgeslagen");
      } else if (resultaat.status === 409 && resultaat.factuur) {
        setConflictVersie(resultaat.factuur);
        setSync("conflict");
      } else {
        setSync("fout");
        setFout(resultaat.fout);
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [factuur, conflictVersie]);

  const wijzig = useCallback((patch: Partial<Factuur>) => {
    vuil.current = true;
    setFactuur((huidig) => (huidig ? { ...huidig, ...patch } : huidig));
  }, []);

  const herlaad = useCallback(async () => {
    const resultaat = await haalFactuur(factuurId);
    if (resultaat.ok) {
      baseUpdatedAt.current = resultaat.factuur.updatedAt;
      setFactuur(resultaat.factuur);
      setSync(resultaat.bron === "lokaal" ? "lokaal" : "opgeslagen");
    }
  }, [factuurId]);

  const definitief = async () => {
    if (!factuur) return;
    setBezig(true);
    setOntbrekend([]);
    // Eventuele laatste wijzigingen eerst persistent maken.
    if (vuil.current && factuur.status === "concept") {
      const opgeslagen = await bewaarConcept(factuur, baseUpdatedAt.current);
      if (opgeslagen.ok) {
        baseUpdatedAt.current = opgeslagen.factuur.updatedAt;
        vuil.current = false;
      }
    }
    const resultaat = await maakDefinitief(factuur.id, factuur.factuurdatum ?? undefined);
    setBezig(false);
    if (resultaat.ok) {
      baseUpdatedAt.current = resultaat.factuur.updatedAt;
      setFactuur(resultaat.factuur);
      setFout(resultaat.pdfOntbreekt ? (resultaat.melding ?? null) : null);
    } else {
      setFout(resultaat.fout);
      if (resultaat.ontbrekend) setOntbrekend(resultaat.ontbrekend as OntbrekendVeld[]);
    }
  };

  const statusActie = async (naarStatus: "verzonden" | "betaald", betaaldOp?: string) => {
    if (!factuur) return;
    setBezig(true);
    const resultaat = await wijzigStatus(factuur.id, naarStatus, betaaldOp);
    setBezig(false);
    if (resultaat.ok) setFactuur(resultaat.factuur);
    else setFout(resultaat.fout);
  };

  const crediteerActie = async () => {
    if (!factuur) return;
    setBezig(true);
    const resultaat = await crediteer(factuur.id);
    setBezig(false);
    if (resultaat.ok) router.push(`/dashboard/facturatie/${resultaat.factuur.id}`);
    else setFout(resultaat.fout);
  };

  const pdfHerstel = async () => {
    if (!factuur) return;
    setBezig(true);
    const resultaat = await herstelPdf(factuur.id);
    setBezig(false);
    if (resultaat.ok) void herlaad();
    else setFout(resultaat.fout);
  };

  if (!factuur) {
    return (
      <div className="@container/main flex flex-col gap-4 md:gap-6">
        <CareonPageHeader title={FACTURATIE_PAGE_META.factuur.title} sub={FACTURATIE_PAGE_META.factuur.sub} />
        {fout ? (
          <p role="alert" className="text-red-700 text-xs dark:text-red-400">
            {fout}
          </p>
        ) : (
          <Skeleton className="h-64 w-full rounded-lg" />
        )}
      </div>
    );
  }

  const isConcept = factuur.status === "concept";
  const instellingenLeeg = instellingen !== null && instellingen.afzender.statutaireNaam.trim().length === 0;
  const gekozenContact = contacten.find((contact) => contact.id === factuur.contactId) ?? null;
  const vrijgesteld = heeftVrijgesteldeRegels(factuur.regels);
  const artikel34g =
    isConcept &&
    factuur.prestatieTot !== null &&
    uitreikingstermijnOverschreden(factuur.prestatieTot, factuur.factuurdatum ?? vandaagIso());

  const kiesContact = (contactId: string) => {
    const contact = contacten.find((rij) => rij.id === contactId) ?? null;
    wijzig({
      contactId: contact?.id ?? null,
      afnemer: contact
        ? {
            naam: contact.naam,
            contactpersoon: contact.contactpersoon,
            adresRegel1: contact.adresRegel1,
            adresRegel2: contact.adresRegel2,
            postcode: contact.postcode,
            plaats: contact.plaats,
            land: contact.land,
            kvkNummer: contact.kvkNummer,
            btwId: contact.btwId,
            email: contact.email,
          }
        : null,
      uwKenmerk: contact?.referentie ?? factuur.uwKenmerk,
      betaaltermijnDagen: contact?.betaaltermijnDagen ?? factuur.betaaltermijnDagen,
    });
  };

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={factuur.nummer ?? "Nieuwe factuur"}
        sub={FACTURATIE_PAGE_META.factuur.sub}
        action={
          <span className="flex items-center gap-3">
            <span aria-live="polite" className="text-muted-foreground text-xs">
              {SYNC_TEKST[sync]}
            </span>
            <StatusBadge factuur={factuur} />
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/facturatie">
                <ArrowLeft className="size-3.5" />
                Facturen
              </Link>
            </Button>
          </span>
        }
      />

      {instellingenLeeg ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-800 text-xs dark:text-amber-300"
        >
          Vul eerst uw bedrijfsgegevens in bij{" "}
          <Link href="/dashboard/facturatie/instellingen" className="underline">
            Facturatie-instellingen
          </Link>
          ; zonder afzendergegevens kan de factuur niet worden uitgereikt.
        </p>
      ) : null}
      {fout ? (
        <p role="alert" className="text-red-700 text-xs dark:text-red-400">
          {fout}
          {ontbrekend.length > 0
            ? ` Ontbrekend: ${ontbrekend.map((veld) => ONTBREKEND_LABELS[veld]).join(", ")}.`
            : null}
        </p>
      ) : null}
      {conflictVersie ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-800 text-xs dark:text-amber-300"
        >
          Deze factuur is intussen door iemand anders gewijzigd.
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              baseUpdatedAt.current = conflictVersie.updatedAt;
              setFactuur(conflictVersie);
              setConflictVersie(null);
              vuil.current = false;
              setSync("opgeslagen");
            }}
          >
            Centrale versie
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              baseUpdatedAt.current = conflictVersie.updatedAt;
              setConflictVersie(null);
              vuil.current = true;
              setSync("bezig");
            }}
          >
            Mijn versie
          </Button>
        </div>
      ) : null}
      {!isConcept ? (
        <p className="text-muted-foreground text-xs">
          Deze factuur is uitgereikt en kan niet meer worden gewijzigd. Maak een creditfactuur om te corrigeren.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Afnemer</CardTitle>
              <CardDescription>Kies een contact of vul een afwijkend adres in.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect
                  value={factuur.contactId ?? ""}
                  aria-label="Afnemer (contact)"
                  className="h-8 max-w-72 text-xs"
                  disabled={!isConcept}
                  onChange={(event) => kiesContact(event.target.value)}
                >
                  <NativeSelectOption value="">— Kies een contact —</NativeSelectOption>
                  {contacten
                    .filter((contact) => !contact.archief)
                    .map((contact) => (
                      <NativeSelectOption key={contact.id} value={contact.id}>
                        {contact.naam}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
                <Button asChild variant="outline" size="sm">
                  <Link href="/dashboard/facturatie/contacten">Nieuw contact</Link>
                </Button>
                {isConcept ? (
                  <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <input
                      type="checkbox"
                      checked={afwijkendAdres}
                      onChange={(event) => setAfwijkendAdres(event.target.checked)}
                    />
                    Afwijkend adres gebruiken
                  </label>
                ) : null}
              </div>
              {afwijkendAdres && isConcept ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["naam", "Naam"],
                      ["adresRegel1", "Adres"],
                      ["postcode", "Postcode"],
                      ["plaats", "Plaats"],
                      ["kvkNummer", "KvK-nummer"],
                      ["btwId", "Btw-identificatienummer"],
                      ["email", "E-mail"],
                    ] as const
                  ).map(([veld, label]) => (
                    <div key={veld} className="space-y-1">
                      <Label htmlFor={`afnemer-${veld}`} className="text-xs">
                        {label}
                      </Label>
                      <Input
                        id={`afnemer-${veld}`}
                        key={`${factuur.id}-${veld}-${factuur.afnemer?.[veld] ?? ""}`}
                        defaultValue={factuur.afnemer?.[veld] ?? ""}
                        className="h-8 text-xs"
                        onBlur={(event) =>
                          wijzig({
                            afnemer: {
                              land: "NL",
                              ...factuur.afnemer,
                              naam: factuur.afnemer?.naam ?? "",
                              [veld]: event.target.value || undefined,
                            },
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              {!(afwijkendAdres && isConcept) && (gekozenContact || factuur.afnemer) ? (
                <p className="text-muted-foreground text-xs">
                  {[
                    factuur.afnemer?.naam,
                    factuur.afnemer?.adresRegel1,
                    [factuur.afnemer?.postcode, factuur.afnemer?.plaats].filter(Boolean).join(" "),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
              <div className="space-y-1">
                <Label htmlFor="uw-kenmerk" className="text-xs">
                  Uw kenmerk / referentie
                </Label>
                <Input
                  id="uw-kenmerk"
                  key={`${factuur.id}-kenmerk-${factuur.uwKenmerk ?? ""}`}
                  defaultValue={factuur.uwKenmerk ?? ""}
                  className="h-8 max-w-72 text-xs"
                  disabled={!isConcept}
                  onBlur={(event) => wijzig({ uwKenmerk: event.target.value || undefined })}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Datums en betaaltermijn</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="factuurdatum" className="text-xs">
                  Factuurdatum
                </Label>
                <Input
                  id="factuurdatum"
                  type="date"
                  value={factuur.factuurdatum ?? vandaagIso()}
                  className="h-8 w-36 text-xs"
                  disabled={!isConcept}
                  onChange={(event) => wijzig({ factuurdatum: event.target.value || null })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="prestatie-van" className="text-xs">
                  Prestatie van
                </Label>
                <Input
                  id="prestatie-van"
                  type="date"
                  value={factuur.prestatieVan ?? ""}
                  className="h-8 w-36 text-xs"
                  disabled={!isConcept}
                  onChange={(event) => wijzig({ prestatieVan: event.target.value || null })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="prestatie-tot" className="text-xs">
                  Prestatie t/m
                </Label>
                <Input
                  id="prestatie-tot"
                  type="date"
                  value={factuur.prestatieTot ?? ""}
                  className="h-8 w-36 text-xs"
                  disabled={!isConcept}
                  onChange={(event) => wijzig({ prestatieTot: event.target.value || null })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="betaaltermijn" className="text-xs">
                  Betaaltermijn (dagen)
                </Label>
                <Input
                  id="betaaltermijn"
                  type="number"
                  min={0}
                  max={180}
                  value={factuur.betaaltermijnDagen ?? 30}
                  className="h-8 w-28 text-right text-xs"
                  disabled={!isConcept}
                  onChange={(event) => {
                    const getal = event.target.valueAsNumber;
                    if (Number.isFinite(getal)) wijzig({ betaaltermijnDagen: Math.max(0, Math.min(180, getal)) });
                  }}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Vervaldatum:{" "}
                {previewFactuur?.vervaldatum
                  ? new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" }).format(
                      new Date(`${previewFactuur.vervaldatum}T00:00:00Z`),
                    )
                  : "—"}
              </p>
              {artikel34g ? (
                <p role="status" className="basis-full text-amber-700 text-xs dark:text-amber-400">
                  Let op: de uitreikingstermijn (vóór de 15e van de maand na de prestatie) is verstreken.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardContent className="px-0">
              {isConcept ? (
                <FactuurRegelsEditor
                  regels={factuur.regels}
                  standaardTarief={instellingen?.btw.standaardTarief ?? "vrijgesteld"}
                  onWijzig={(regels) => wijzig({ regels })}
                />
              ) : (
                <div className="p-4">
                  <p className="mb-2 font-medium text-sm">Regels</p>
                  <ul className="space-y-1 text-muted-foreground text-xs">
                    {factuur.regels.map((regel) => (
                      <li key={regel.id}>
                        {regel.omschrijving} — {regel.aantal} {regel.eenheid}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="px-4 pb-4">
                <FactuurTotalenBlok regels={factuur.regels} totalen={totalen} />
              </div>
            </CardContent>
          </Card>

          {vrijgesteld ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Btw-vrijstelling</CardTitle>
                <CardDescription>
                  Verplichte vermelding zodra een regel vrijgesteld is (art. 35a sub l).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <NativeSelect
                  aria-label="Vrijstellingstekst-preset"
                  className="h-8 max-w-96 text-xs"
                  disabled={!isConcept}
                  value={
                    VRIJSTELLING_PRESETS.find((preset) => preset.tekst === factuur.vrijstellingTekst)?.id ?? "aangepast"
                  }
                  onChange={(event) => {
                    const preset = VRIJSTELLING_PRESETS.find((rij) => rij.id === event.target.value);
                    if (preset) wijzig({ vrijstellingTekst: preset.tekst });
                  }}
                >
                  {VRIJSTELLING_PRESETS.map((preset) => (
                    <NativeSelectOption key={preset.id} value={preset.id}>
                      {preset.label}
                    </NativeSelectOption>
                  ))}
                  <NativeSelectOption value="aangepast">Aangepast</NativeSelectOption>
                </NativeSelect>
                <Textarea
                  key={`${factuur.id}-vrijstelling-${factuur.vrijstellingTekst ?? ""}`}
                  defaultValue={factuur.vrijstellingTekst ?? ""}
                  aria-label="Vrijstellingstekst"
                  className="min-h-16 text-xs"
                  disabled={!isConcept}
                  onBlur={(event) => wijzig({ vrijstellingTekst: event.target.value || undefined })}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Opmerking</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                key={`${factuur.id}-opmerking-${factuur.opmerking ?? ""}`}
                defaultValue={factuur.opmerking ?? ""}
                aria-label="Opmerking op de factuur"
                placeholder="Optionele tekst onderaan de factuur"
                className="min-h-16 text-xs"
                disabled={!isConcept}
                onBlur={(event) => wijzig({ opmerking: event.target.value || undefined })}
              />
            </CardContent>
          </Card>

          <div className="sticky bottom-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
            <FactuurStatusActies
              factuur={factuur}
              bron={bron}
              bezig={bezig}
              onDefinitief={() => void definitief()}
              onStatus={(naarStatus, betaaldOp) => void statusActie(naarStatus, betaaldOp)}
              onCrediteer={() => void crediteerActie()}
              onPdfHerstel={() => void pdfHerstel()}
            />
          </div>
        </div>

        <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)]">
          {previewFactuur ? <FactuurPdfPreview factuur={previewFactuur} /> : null}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import Image from "next/image";

import { ArrowLeft, Copy, Loader2, Plus, Save, Star, X } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { BTW_TARIEF_LABELS, FACTURATIE_PAGE_META, VRIJSTELLING_PRESETS } from "@/data/careon/careon-facturatie";
import { formatFactuurnummer } from "@/lib/careon-facturatie/nummer";
import {
  bewaarFacturatieInstellingen,
  type FacturatieBron,
  haalFacturatieInstellingen,
} from "@/lib/careon-facturatie/remote.client";
import {
  BTW_TARIEVEN,
  type BtwTarief,
  FACTURATIE_LIMITS,
  type FacturatieInstellingen,
  type FactuurTemplate,
} from "@/lib/careon-facturatie/types";

// Facturatie-instellingen als sjabloonbibliotheek (klantverzoek 09-08-2026):
// eerst een lijst van organisatiesjablonen (afzenderprofielen — het eerste is
// het ingebouwde "Careon Group"-sjabloon uit het geïmporteerde ontwerp);
// aanklikken opent de detailweergave met de bekende instellingenkaarten voor
// dát sjabloon. Per factuur kiest de editor welk sjabloon geldt; hier wordt
// alleen het standaardsjabloon voor níéuwe facturen bepaald. Opslag blijft
// één append-only snapshot met revisie-conflictdetectie.

type Status = "laden" | "klaar" | "bezig" | "opgeslagen" | "lokaal" | "fout";

function leegTemplate(id: string, naam: string): FactuurTemplate {
  return {
    id,
    naam,
    afzender: { statutaireNaam: "", adresRegel1: "", postcode: "", plaats: "", land: "NL", kvkNummer: "" },
    bank: { iban: "", tenaamstelling: "" },
    nummering: { reeksFactuur: "F", reeksCredit: "C", formaat: "{reeks}{jaar}-{nummer:4}", startVolgnummer: 1 },
    betaling: { standaardTermijnDagen: 30 },
    btw: { standaardTarief: "vrijgesteld", vrijstellingTekst: VRIJSTELLING_PRESETS[0].tekst },
    presentatie: { toonLogo: false },
  };
}

function vrijTemplateId(instellingen: FacturatieInstellingen, basis: string): string {
  const bestaand = new Set(instellingen.templates.map((template) => template.id));
  if (!bestaand.has(basis)) return basis;
  for (let volgnummer = 2; ; volgnummer += 1) {
    const kandidaat = `${basis}-${volgnummer}`;
    if (!bestaand.has(kandidaat)) return kandidaat;
  }
}

export function InstellingenForm() {
  const [instellingen, setInstellingen] = useState<FacturatieInstellingen | null>(null);
  const [revision, setRevision] = useState(0);
  const [bron, setBron] = useState<FacturatieBron>("centraal");
  const [status, setStatus] = useState<Status>("laden");
  const [fout, setFout] = useState<string | null>(null);
  const [logoStatus, setLogoStatus] = useState<string | null>(null);
  /** null = sjabloonlijst; anders de detailweergave van dat sjabloon. */
  const [gekozenId, setGekozenId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const resultaat = await haalFacturatieInstellingen();
      if (resultaat.ok) {
        setInstellingen(resultaat.instellingen);
        setRevision(resultaat.revision);
        setBron(resultaat.bron);
        setStatus("klaar");
      } else {
        setStatus("fout");
        setFout(resultaat.fout);
      }
    })();
  }, []);

  if (!instellingen) {
    return (
      <div className="@container/main flex flex-col gap-4 md:gap-6">
        <CareonPageHeader title={FACTURATIE_PAGE_META.instellingen.title} sub={FACTURATIE_PAGE_META.instellingen.sub} />
        {fout ? (
          <p role="alert" className="text-red-700 text-xs dark:text-red-400">
            {fout}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">Laden…</p>
        )}
      </div>
    );
  }

  const gekozen = instellingen.templates.find((template) => template.id === gekozenId) ?? null;

  const wijzig = (patch: Partial<FacturatieInstellingen>) => {
    setInstellingen({ ...instellingen, ...patch });
    setStatus("klaar");
  };

  const wijzigTemplate = (templateId: string, patch: Partial<FactuurTemplate>) => {
    wijzig({
      templates: instellingen.templates.map((template) =>
        template.id === templateId ? { ...template, ...patch } : template,
      ),
    });
  };

  const bewaar = async () => {
    setStatus("bezig");
    const resultaat = await bewaarFacturatieInstellingen(instellingen, revision);
    if (resultaat.ok) {
      setRevision(resultaat.revision);
      setBron(resultaat.bron);
      setStatus(resultaat.bron === "lokaal" ? "lokaal" : "opgeslagen");
      setFout(null);
    } else {
      setStatus("fout");
      setFout(resultaat.fout);
    }
  };

  const nieuwTemplate = (basis?: FactuurTemplate) => {
    if (instellingen.templates.length >= FACTURATIE_LIMITS.templates) {
      setFout(`Maximaal ${FACTURATIE_LIMITS.templates} sjablonen.`);
      return;
    }
    const id = vrijTemplateId(instellingen, basis ? basis.id : "sjabloon");
    const template: FactuurTemplate = basis
      ? { ...JSON.parse(JSON.stringify(basis)), id, naam: `${basis.naam} (kopie)` }
      : leegTemplate(id, "Nieuw sjabloon");
    wijzig({ templates: [...instellingen.templates, template] });
    setGekozenId(id);
  };

  const verwijderTemplate = (template: FactuurTemplate) => {
    if (instellingen.templates.length <= 1) {
      setFout("Minimaal één sjabloon is vereist.");
      return;
    }
    const rest = instellingen.templates.filter((rij) => rij.id !== template.id);
    wijzig({
      templates: rest,
      standaardTemplateId:
        instellingen.standaardTemplateId === template.id ? rest[0].id : instellingen.standaardTemplateId,
    });
    if (gekozenId === template.id) setGekozenId(null);
  };

  const uploadLogo = async (template: FactuurTemplate, bestand: File) => {
    setLogoStatus("Uploaden…");
    const response = await fetch(
      `/api/careon/facturatie/instellingen/logo?template=${encodeURIComponent(template.id)}`,
      { method: "POST", headers: { "Content-Type": "image/png" }, body: bestand },
    ).catch(() => null);
    if (response?.ok) {
      const data = (await response.json()) as { pad: string; hash: string };
      wijzigTemplate(template.id, {
        presentatie: {
          ...template.presentatie,
          toonLogo: true,
          logoBron: "upload",
          logoPad: data.pad,
          logoHash: data.hash,
        },
      });
      setLogoStatus("Logo geüpload — vergeet niet op te slaan.");
    } else if (response?.status === 501) {
      setLogoStatus("In demo-modus is er geen centrale opslag voor het logo.");
    } else {
      const data = (await response?.json().catch(() => null)) as { error?: string } | null;
      setLogoStatus(data?.error ?? "Uploaden mislukt.");
    }
  };

  const statusregel = (
    <div className="flex flex-wrap items-center gap-2">
      <span aria-live="polite" className="text-muted-foreground text-xs">
        {status === "opgeslagen" ? "Opgeslagen" : null}
        {status === "lokaal" || bron === "lokaal" ? "Lokale demo-opslag — geen centrale registratie." : null}
      </span>
    </div>
  );

  // ── Lijstweergave: de sjabloonbibliotheek ─────────────────────────────────
  if (!gekozen) {
    return (
      <div className="@container/main flex flex-col gap-4 md:gap-6">
        <CareonPageHeader
          title={FACTURATIE_PAGE_META.instellingen.title}
          sub="Kies een sjabloon om de gegevens te bewerken; het standaardsjabloon geldt voor nieuwe facturen."
          action={
            <span className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => nieuwTemplate()}>
                <Plus className="size-3.5" />
                Nieuw sjabloon
              </Button>
              <Button variant="outline" onClick={() => void bewaar()} disabled={status === "bezig"}>
                {status === "bezig" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Opslaan
              </Button>
            </span>
          }
        />
        {statusregel}
        {fout ? (
          <p role="alert" className="text-red-700 text-xs dark:text-red-400">
            {fout}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {instellingen.templates.map((template) => {
            const standaard = template.id === instellingen.standaardTemplateId;
            return (
              <Card key={template.id} className="group relative transition-colors hover:border-primary/60">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setGekozenId(template.id)}
                      className="rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <CardTitle className="text-base">{template.naam}</CardTitle>
                      <CardDescription>
                        {template.afzender.statutaireNaam || "Bedrijfsgegevens nog niet ingevuld"}
                      </CardDescription>
                    </button>
                    {template.presentatie.logoBron === "careongroup" ? (
                      <Image
                        src="/branding/careon-group-logo.png"
                        alt=""
                        width={72}
                        height={64}
                        className="h-12 w-auto shrink-0"
                      />
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-muted-foreground text-xs">
                    {template.tagline ? `${template.tagline} · ` : ""}
                    Eerstvolgend nummer{" "}
                    <span className="font-medium tabular-nums">
                      {formatFactuurnummer(
                        template.nummering.formaat,
                        template.nummering.reeksFactuur,
                        new Date().getUTCFullYear(),
                        template.nummering.startVolgnummer,
                      )}
                    </span>{" "}
                    · Btw {BTW_TARIEF_LABELS[template.btw.standaardTarief]}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {standaard ? (
                      <Badge variant="secondary">
                        <Star className="size-3" />
                        Standaard
                      </Badge>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => wijzig({ standaardTemplateId: template.id })}>
                        <Star className="size-3.5" />
                        Als standaard
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setGekozenId(template.id)}>
                      Openen
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground"
                      aria-label={`Dupliceer sjabloon ${template.naam}`}
                      onClick={() => nieuwTemplate(template)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    {instellingen.templates.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground"
                        aria-label={`Verwijder sjabloon ${template.naam}`}
                        onClick={() => verwijderTemplate(template)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <p className="text-center text-muted-foreground text-xs">
          Uitgereikte facturen behouden altijd de gegevens van het moment van uitreiken — een sjabloon wijzigen of
          verwijderen verandert bestaande facturen nooit.
        </p>
      </div>
    );
  }

  // ── Detailweergave: instellingen van één sjabloon ─────────────────────────
  const afzenderVelden = [
    ["statutaireNaam", "Statutaire naam", true],
    ["handelsnaam", "Handelsnaam (optioneel)", false],
    ["adresRegel1", "Adres", true],
    ["adresRegel2", "Adres (regel 2, optioneel)", false],
    ["postcode", "Postcode", true],
    ["plaats", "Plaats", true],
    ["kvkNummer", "KvK-nummer (8 cijfers)", true],
    ["btwId", "Btw-identificatienummer (leeg laten indien volledig vrijgesteld)", false],
    ["agbCode", "AGB-code (optioneel)", false],
    ["email", "E-mailadres", false],
    ["telefoon", "Telefoon", false],
  ] as const;

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={gekozen.naam}
        sub={FACTURATIE_PAGE_META.instellingen.sub}
        action={
          <span className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setGekozenId(null)}>
              <ArrowLeft className="size-3.5" />
              Alle sjablonen
            </Button>
            <Button variant="outline" onClick={() => void bewaar()} disabled={status === "bezig"}>
              {status === "bezig" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Opslaan
            </Button>
          </span>
        }
      />
      {statusregel}
      {fout ? (
        <p role="alert" className="text-red-700 text-xs dark:text-red-400">
          {fout}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sjabloon</CardTitle>
            <CardDescription>Naam en ondertitel zoals ze in de bibliotheek en op de factuurvoet staan.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="template-naam" className="text-xs">
                Naam
              </Label>
              <Input
                id="template-naam"
                key={`naam:${gekozen.id}:${gekozen.naam}`}
                defaultValue={gekozen.naam}
                className="h-8 text-xs"
                onBlur={(event) => {
                  if (event.target.value.trim()) wijzigTemplate(gekozen.id, { naam: event.target.value.trim() });
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="template-tagline" className="text-xs">
                Ondertitel (factuurvoet, optioneel)
              </Label>
              <Input
                id="template-tagline"
                key={`tagline:${gekozen.id}:${gekozen.tagline ?? ""}`}
                defaultValue={gekozen.tagline ?? ""}
                placeholder="Bijv. Technology · Growth · Care"
                className="h-8 text-xs"
                onBlur={(event) => wijzigTemplate(gekozen.id, { tagline: event.target.value.trim() || undefined })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Bankgegevens</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["iban", "IBAN"],
                ["bic", "BIC (optioneel)"],
                ["tenaamstelling", "Tenaamstelling"],
              ] as const
            ).map(([veld, label]) => (
              <div key={veld} className="space-y-1">
                <Label htmlFor={`bank-${veld}`} className="text-xs">
                  {label}
                </Label>
                <Input
                  id={`bank-${veld}`}
                  key={`${gekozen.id}:${veld}:${gekozen.bank[veld] ?? ""}`}
                  defaultValue={gekozen.bank[veld] ?? ""}
                  className="h-8 text-xs"
                  onBlur={(event) =>
                    wijzigTemplate(gekozen.id, {
                      bank: { ...gekozen.bank, [veld]: event.target.value || undefined },
                    })
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Bedrijfsgegevens</CardTitle>
            <CardDescription>Deze gegevens komen als afzender op elke factuur (art. 35a Wet OB).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {afzenderVelden.map(([veld, label]) => (
              <div key={veld} className="space-y-1">
                <Label htmlFor={`afzender-${veld}`} className="text-xs">
                  {label}
                </Label>
                <Input
                  id={`afzender-${veld}`}
                  key={`${gekozen.id}:${veld}:${gekozen.afzender[veld] ?? ""}`}
                  defaultValue={gekozen.afzender[veld] ?? ""}
                  className="h-8 text-xs"
                  onBlur={(event) =>
                    wijzigTemplate(gekozen.id, {
                      afzender: { ...gekozen.afzender, [veld]: event.target.value || undefined },
                    })
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Nummering</CardTitle>
              <CardDescription>
                Eerstvolgend nummer:{" "}
                <span className="font-medium tabular-nums">
                  {formatFactuurnummer(
                    gekozen.nummering.formaat,
                    gekozen.nummering.reeksFactuur,
                    new Date().getUTCFullYear(),
                    gekozen.nummering.startVolgnummer,
                  )}
                </span>
                . De reeks is bevroren zodra er in dit jaar een uitgereikte factuur bestaat.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="reeks-factuur" className="text-xs">
                  Reeks facturen
                </Label>
                <Input
                  id="reeks-factuur"
                  key={`rf:${gekozen.id}:${gekozen.nummering.reeksFactuur}`}
                  defaultValue={gekozen.nummering.reeksFactuur}
                  className="h-8 w-20 text-xs uppercase"
                  onBlur={(event) => {
                    const waarde = event.target.value.trim().toUpperCase();
                    if (/^[A-Z]{1,4}$/.test(waarde)) {
                      wijzigTemplate(gekozen.id, { nummering: { ...gekozen.nummering, reeksFactuur: waarde } });
                    }
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reeks-credit" className="text-xs">
                  Reeks creditfacturen
                </Label>
                <Input
                  id="reeks-credit"
                  key={`rc:${gekozen.id}:${gekozen.nummering.reeksCredit}`}
                  defaultValue={gekozen.nummering.reeksCredit}
                  className="h-8 w-20 text-xs uppercase"
                  onBlur={(event) => {
                    const waarde = event.target.value.trim().toUpperCase();
                    if (/^[A-Z]{1,4}$/.test(waarde)) {
                      wijzigTemplate(gekozen.id, { nummering: { ...gekozen.nummering, reeksCredit: waarde } });
                    }
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="startvolgnummer" className="text-xs">
                  Startvolgnummer
                </Label>
                <Input
                  id="startvolgnummer"
                  type="number"
                  min={1}
                  value={gekozen.nummering.startVolgnummer}
                  className="h-8 w-28 text-right text-xs"
                  onChange={(event) => {
                    const getal = event.target.valueAsNumber;
                    if (Number.isInteger(getal) && getal >= 1) {
                      wijzigTemplate(gekozen.id, { nummering: { ...gekozen.nummering, startVolgnummer: getal } });
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Presentatie</CardTitle>
              <CardDescription>Logo en voettekst (PNG, transparant, minimaal 600 px breed).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="voettekst" className="text-xs">
                  Voettekst
                </Label>
                <Input
                  id="voettekst"
                  key={`voet:${gekozen.id}:${gekozen.presentatie.voettekst ?? ""}`}
                  defaultValue={gekozen.presentatie.voettekst ?? ""}
                  className="h-8 text-xs"
                  onBlur={(event) =>
                    wijzigTemplate(gekozen.id, {
                      presentatie: { ...gekozen.presentatie, voettekst: event.target.value || undefined },
                    })
                  }
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <input
                    type="checkbox"
                    checked={gekozen.presentatie.toonLogo}
                    onChange={(event) =>
                      wijzigTemplate(gekozen.id, {
                        presentatie: { ...gekozen.presentatie, toonLogo: event.target.checked },
                      })
                    }
                  />
                  Logo tonen op de factuur
                </label>
                {gekozen.presentatie.logoBron === "careongroup" ? (
                  <span className="text-muted-foreground text-xs">Ingebouwd Careon Group-logo</span>
                ) : null}
                <Input
                  type="file"
                  accept="image/png"
                  aria-label="Sjabloonlogo uploaden (PNG)"
                  className="h-8 max-w-64 text-xs"
                  onChange={(event) => {
                    const bestand = event.target.files?.[0];
                    if (bestand) void uploadLogo(gekozen, bestand);
                  }}
                />
              </div>
              {logoStatus ? (
                <p role="status" className="text-muted-foreground text-xs">
                  {logoStatus}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Btw &amp; betaling</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="standaard-tarief" className="text-xs">
                  Standaard btw-tarief
                </Label>
                <NativeSelect
                  id="standaard-tarief"
                  value={gekozen.btw.standaardTarief}
                  className="h-8 w-32 text-xs"
                  onChange={(event) =>
                    wijzigTemplate(gekozen.id, {
                      btw: { ...gekozen.btw, standaardTarief: event.target.value as BtwTarief },
                    })
                  }
                >
                  {BTW_TARIEVEN.map((tarief) => (
                    <NativeSelectOption key={tarief} value={tarief}>
                      {BTW_TARIEF_LABELS[tarief]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="betaaltermijn" className="text-xs">
                  Standaard betaaltermijn (dagen)
                </Label>
                <Input
                  id="betaaltermijn"
                  type="number"
                  min={0}
                  max={180}
                  value={gekozen.betaling.standaardTermijnDagen}
                  className="h-8 w-28 text-right text-xs"
                  onChange={(event) => {
                    const getal = event.target.valueAsNumber;
                    if (Number.isInteger(getal) && getal >= 0 && getal <= 180) {
                      wijzigTemplate(gekozen.id, {
                        betaling: { ...gekozen.betaling, standaardTermijnDagen: getal },
                      });
                    }
                  }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="vrijstelling-preset" className="text-xs">
                Standaard vrijstellingstekst
              </Label>
              <NativeSelect
                id="vrijstelling-preset"
                className="h-8 max-w-96 text-xs"
                value={
                  VRIJSTELLING_PRESETS.find((preset) => preset.tekst === gekozen.btw.vrijstellingTekst)?.id ??
                  "aangepast"
                }
                onChange={(event) => {
                  const preset = VRIJSTELLING_PRESETS.find((rij) => rij.id === event.target.value);
                  if (preset) wijzigTemplate(gekozen.id, { btw: { ...gekozen.btw, vrijstellingTekst: preset.tekst } });
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
                key={`vrijstelling:${gekozen.id}:${gekozen.btw.vrijstellingTekst}`}
                defaultValue={gekozen.btw.vrijstellingTekst}
                aria-label="Vrijstellingstekst"
                className="min-h-16 text-xs"
                onBlur={(event) =>
                  wijzigTemplate(gekozen.id, { btw: { ...gekozen.btw, vrijstellingTekst: event.target.value } })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="betaalinstructie" className="text-xs">
                Betaalinstructie (op de factuur)
              </Label>
              <Textarea
                id="betaalinstructie"
                key={`instructie:${gekozen.id}:${gekozen.betaling.betaalinstructie ?? ""}`}
                defaultValue={gekozen.betaling.betaalinstructie ?? ""}
                className="min-h-12 text-xs"
                onBlur={(event) =>
                  wijzigTemplate(gekozen.id, {
                    betaling: { ...gekozen.betaling, betaalinstructie: event.target.value || undefined },
                  })
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

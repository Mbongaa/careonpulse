"use client";

import { useEffect, useState } from "react";

import { Loader2, Save } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
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
import { BTW_TARIEVEN, type BtwTarief, type FacturatieInstellingen } from "@/lib/careon-facturatie/types";

import { FacturatieSubnav } from "./facturatie-subnav";

// Facturatie-instellingen (handoff 15 §4.1): de afzendergegevens die op elke
// factuur bevroren worden. Append-only snapshot met revisie-conflictdetectie;
// de nummerreeks is bevroren zodra er in die reeks/dat jaar een uitgereikte
// factuur bestaat (de API weigert dan met een 409).

type Status = "laden" | "klaar" | "bezig" | "opgeslagen" | "lokaal" | "fout";

export function InstellingenForm() {
  const [instellingen, setInstellingen] = useState<FacturatieInstellingen | null>(null);
  const [revision, setRevision] = useState(0);
  const [bron, setBron] = useState<FacturatieBron>("centraal");
  const [status, setStatus] = useState<Status>("laden");
  const [fout, setFout] = useState<string | null>(null);
  const [logoStatus, setLogoStatus] = useState<string | null>(null);

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

  const wijzig = (patch: Partial<FacturatieInstellingen>) => {
    setInstellingen({ ...instellingen, ...patch });
    setStatus("klaar");
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

  const uploadLogo = async (bestand: File) => {
    setLogoStatus("Uploaden…");
    const response = await fetch("/api/careon/facturatie/instellingen/logo", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: bestand,
    }).catch(() => null);
    if (response?.ok) {
      const data = (await response.json()) as { pad: string; hash: string };
      wijzig({ presentatie: { ...instellingen.presentatie, toonLogo: true, logoPad: data.pad, logoHash: data.hash } });
      setLogoStatus("Logo geüpload — vergeet niet op te slaan.");
    } else if (response?.status === 501) {
      setLogoStatus("In demo-modus is er geen centrale opslag voor het logo.");
    } else {
      const data = (await response?.json().catch(() => null)) as { error?: string } | null;
      setLogoStatus(data?.error ?? "Uploaden mislukt.");
    }
  };

  const voorbeeldNummer = formatFactuurnummer(
    instellingen.nummering.formaat,
    instellingen.nummering.reeksFactuur,
    new Date().getUTCFullYear(),
    instellingen.nummering.startVolgnummer,
  );

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
        title={FACTURATIE_PAGE_META.instellingen.title}
        sub={FACTURATIE_PAGE_META.instellingen.sub}
        action={
          <Button variant="outline" onClick={() => void bewaar()} disabled={status === "bezig"}>
            {status === "bezig" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Opslaan
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <CareonHandmatigBadge />
        <span aria-live="polite" className="text-muted-foreground text-xs">
          {status === "opgeslagen" ? "Opgeslagen" : null}
          {status === "lokaal" || bron === "lokaal" ? "Lokale demo-opslag — geen centrale registratie." : null}
        </span>
        <span className="ml-auto">
          <FacturatieSubnav />
        </span>
      </div>
      {fout ? (
        <p role="alert" className="text-red-700 text-xs dark:text-red-400">
          {fout}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
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
                  key={`${veld}:${instellingen.afzender[veld] ?? ""}`}
                  defaultValue={instellingen.afzender[veld] ?? ""}
                  className="h-8 text-xs"
                  onBlur={(event) =>
                    wijzig({ afzender: { ...instellingen.afzender, [veld]: event.target.value || undefined } })
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
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
                    key={`${veld}:${instellingen.bank[veld] ?? ""}`}
                    defaultValue={instellingen.bank[veld] ?? ""}
                    className="h-8 text-xs"
                    onBlur={(event) =>
                      wijzig({ bank: { ...instellingen.bank, [veld]: event.target.value || undefined } })
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Nummering</CardTitle>
              <CardDescription>
                Eerstvolgend nummer: <span className="font-medium tabular-nums">{voorbeeldNummer}</span>. De reeks is
                bevroren zodra er in dit jaar een uitgereikte factuur bestaat.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="reeks-factuur" className="text-xs">
                  Reeks facturen
                </Label>
                <Input
                  id="reeks-factuur"
                  key={`rf:${instellingen.nummering.reeksFactuur}`}
                  defaultValue={instellingen.nummering.reeksFactuur}
                  className="h-8 w-20 text-xs uppercase"
                  onBlur={(event) => {
                    const waarde = event.target.value.trim().toUpperCase();
                    if (/^[A-Z]{1,4}$/.test(waarde)) {
                      wijzig({ nummering: { ...instellingen.nummering, reeksFactuur: waarde } });
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
                  key={`rc:${instellingen.nummering.reeksCredit}`}
                  defaultValue={instellingen.nummering.reeksCredit}
                  className="h-8 w-20 text-xs uppercase"
                  onBlur={(event) => {
                    const waarde = event.target.value.trim().toUpperCase();
                    if (/^[A-Z]{1,4}$/.test(waarde)) {
                      wijzig({ nummering: { ...instellingen.nummering, reeksCredit: waarde } });
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
                  value={instellingen.nummering.startVolgnummer}
                  className="h-8 w-28 text-right text-xs"
                  onChange={(event) => {
                    const getal = event.target.valueAsNumber;
                    if (Number.isInteger(getal) && getal >= 1) {
                      wijzig({ nummering: { ...instellingen.nummering, startVolgnummer: getal } });
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
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
                  value={instellingen.btw.standaardTarief}
                  className="h-8 w-32 text-xs"
                  onChange={(event) =>
                    wijzig({ btw: { ...instellingen.btw, standaardTarief: event.target.value as BtwTarief } })
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
                  value={instellingen.betaling.standaardTermijnDagen}
                  className="h-8 w-28 text-right text-xs"
                  onChange={(event) => {
                    const getal = event.target.valueAsNumber;
                    if (Number.isInteger(getal) && getal >= 0 && getal <= 180) {
                      wijzig({ betaling: { ...instellingen.betaling, standaardTermijnDagen: getal } });
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
                  VRIJSTELLING_PRESETS.find((preset) => preset.tekst === instellingen.btw.vrijstellingTekst)?.id ??
                  "aangepast"
                }
                onChange={(event) => {
                  const preset = VRIJSTELLING_PRESETS.find((rij) => rij.id === event.target.value);
                  if (preset) wijzig({ btw: { ...instellingen.btw, vrijstellingTekst: preset.tekst } });
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
                key={`vrijstelling:${instellingen.btw.vrijstellingTekst}`}
                defaultValue={instellingen.btw.vrijstellingTekst}
                aria-label="Vrijstellingstekst"
                className="min-h-16 text-xs"
                onBlur={(event) => wijzig({ btw: { ...instellingen.btw, vrijstellingTekst: event.target.value } })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="betaalinstructie" className="text-xs">
                Betaalinstructie (op de factuur)
              </Label>
              <Textarea
                id="betaalinstructie"
                key={`instructie:${instellingen.betaling.betaalinstructie ?? ""}`}
                defaultValue={instellingen.betaling.betaalinstructie ?? ""}
                className="min-h-12 text-xs"
                onBlur={(event) =>
                  wijzig({ betaling: { ...instellingen.betaling, betaalinstructie: event.target.value || undefined } })
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Presentatie</CardTitle>
            <CardDescription>Voettekst en organisatielogo (PNG, transparant, minimaal 600 px breed).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="voettekst" className="text-xs">
                Voettekst
              </Label>
              <Input
                id="voettekst"
                key={`voet:${instellingen.presentatie.voettekst ?? ""}`}
                defaultValue={instellingen.presentatie.voettekst ?? ""}
                className="h-8 text-xs"
                onBlur={(event) =>
                  wijzig({ presentatie: { ...instellingen.presentatie, voettekst: event.target.value || undefined } })
                }
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <input
                  type="checkbox"
                  checked={instellingen.presentatie.toonLogo}
                  onChange={(event) =>
                    wijzig({ presentatie: { ...instellingen.presentatie, toonLogo: event.target.checked } })
                  }
                />
                Logo tonen op de factuur
              </label>
              <Input
                type="file"
                accept="image/png"
                aria-label="Organisatielogo uploaden (PNG)"
                className="h-8 max-w-64 text-xs"
                onChange={(event) => {
                  const bestand = event.target.files?.[0];
                  if (bestand) void uploadLogo(bestand);
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
    </div>
  );
}

"use client";

import { type DragEvent, type ReactNode, useRef, useState } from "react";

import { CalendarDays, CheckCircle2, Euro, FileCheck2, ShieldCheck, Stethoscope, TriangleAlert } from "lucide-react";

import { type ActivationResult, useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseAgendaExport } from "@/lib/careon-production/parse-agenda";
import { parseDeclaratiesExport } from "@/lib/careon-production/parse-declaraties";
import { parseToeslagenExport } from "@/lib/careon-production/parse-toeslagen";
import { parseVerwijzersExport } from "@/lib/careon-production/parse-verwijzers";
import { agendaHistorischEinde, type ImportWarning } from "@/lib/careon-production/types";
import { cn } from "@/lib/utils";

// Aanvullende EPD-exports naast de cliëntendata: agenda/afspraken (planning,
// no-show, uren, omzet), huisartsen/verwijzers (verwijsnetwerk), toeslagen en
// het declaratie-totaaloverzicht. Alles wordt bij het parsen direct
// geaggregeerd — cliëntnamen, memo's en BSN verlaten de browser nooit.

const nl = new Intl.NumberFormat("nl-NL");

interface SlotPreview {
  fileName: string;
  samenvatting: { label: string; waarde: string }[];
  warnings: ImportWarning[];
  activeer: () => Promise<ActivationResult>;
}

function ImportSlot({
  titel,
  hint,
  icoon,
  actief,
  parseFile,
  disabled,
}: Readonly<{
  titel: string;
  hint: string;
  icoon: ReactNode;
  /** Beschrijving van de nu actieve import (null = nog niet gekoppeld). */
  actief: string | null;
  parseFile: (file: File, text: string) => { error: string | null; preview: SlotPreview | null };
  disabled: boolean;
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SlotPreview | null>(null);
  const [activation, setActivation] = useState<ActivationResult | null>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const { error: parseError, preview: parsed } = parseFile(file, String(reader.result ?? ""));
      setActivation(null);
      setError(parseError);
      setPreview(parsed);
    };
    reader.readAsText(file);
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function activeer() {
    if (!preview) return;
    const doel = preview;
    setPreview(null);
    const result = await doel.activeer();
    setActivation(result);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 font-medium text-sm">
        {icoon}
        {titel}
      </p>
      {actief && (
        <p className="flex items-start gap-2 text-emerald-700 text-xs dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          {actief}
        </p>
      )}
      {activation && !activation.persisted && (
        <p className="flex items-start gap-2 text-amber-700 text-xs dark:text-amber-400" role="status">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Opslaan in de browser is mislukt — de import is actief in dit tabblad, maar overleeft geen herlaad.
        </p>
      )}
      {activation?.sync === "failed" && (
        <p className="flex items-start gap-2 text-amber-700 text-xs dark:text-amber-400" role="status">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Centrale opslag mislukt — deze import is alleen in deze browser beschikbaar.
        </p>
      )}
      {activation?.sync === "ok" && (
        <p className="text-muted-foreground text-xs" role="status">
          Centraal opgeslagen (Supabase) — collega&apos;s zien dezelfde import na herladen.
        </p>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-5 text-center transition-colors",
          disabled && "cursor-not-allowed opacity-50",
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40",
        )}
      >
        <span className="font-medium text-sm">Sleep het bestand hierheen of klik om te bladeren</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
          event.target.value = "";
        }}
      />

      {error && (
        <p role="status" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {preview && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3" role="status">
          <p className="font-medium text-sm">{preview.fileName} gecontroleerd.</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {preview.samenvatting.map((item) => (
              <div key={item.label} className="rounded-md border bg-background px-2 py-1.5">
                <p className="font-medium text-sm tabular-nums">{item.waarde}</p>
                <p className="text-muted-foreground text-xs">{item.label}</p>
              </div>
            ))}
          </div>
          {preview.warnings.length > 0 && (
            <div className="flex flex-col gap-1 text-muted-foreground text-xs">
              <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                <TriangleAlert className="size-3.5" />
                {preview.warnings.length} aandachtspunt(en) bij het lezen
              </p>
              <ul className="list-inside list-disc">
                {preview.warnings.slice(0, 4).map((warning) => (
                  <li key={`${warning.row}-${warning.message}`}>
                    {warning.row > 0 ? `Rij ${warning.row}: ` : ""}
                    {warning.message}
                  </li>
                ))}
                {preview.warnings.length > 4 && <li>… en {preview.warnings.length - 4} meer.</li>}
              </ul>
            </div>
          )}
          <Button size="sm" className="self-start" onClick={() => void activeer()}>
            Koppel deze export
          </Button>
        </div>
      )}
    </div>
  );
}

export function AanvullendeExportsCard() {
  const { isProduction, production, activateAgenda, activateVerwijzers, activateToeslagen, activateDeclaraties } =
    useCareon();

  const agendaMeta = production?.agenda?.meta;
  const netwerk = production?.verwijzerNetwerk;
  const toeslagen = production?.toeslagen;
  const declaraties = production?.declaraties;

  const datumNl = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  return (
    <Card className="border-violet-600/30">
      <CardHeader>
        <CardDescription>
          <Badge variant="outline" className="border-violet-600/40 text-violet-700 dark:text-violet-400">
            Productie · aanvullende exports
          </Badge>
        </CardDescription>
        <CardTitle>Aanvullende EPD-exports koppelen</CardTitle>
        <CardDescription>
          Verrijk de productie-modus met vier aanvullende exports: de agenda-/afsprakenexport (planning, no-show, uren
          en omzet), de huisarts/verwijzer-export (verwijsnetwerk), de toeslagen-export (reistijd-, tolk- en
          diagnostiektoeslagen) en het declaratie-totaaloverzicht (openstaand en toegekend per factuur). De bestanden
          worden bij het inlezen direct geaggregeerd.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!isProduction && (
          <p className="flex items-start gap-2 text-muted-foreground text-sm" role="status">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            Importeer eerst de cliëntendata-export (kaart hierboven) — de aanvullende exports bouwen daarop voort.
          </p>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ImportSlot
            titel="Agenda / afspraken"
            hint="ZSG-formaat: Soort;Instelling;Behandelaar;…;Datum;… (puntkomma-gescheiden)"
            icoon={<CalendarDays className="size-4 text-violet-600 dark:text-violet-400" />}
            actief={
              agendaMeta
                ? `Gekoppeld: ${agendaMeta.fileName} — ${nl.format(agendaMeta.sessieRows)} sessies t/m ${datumNl(agendaHistorischEinde(agendaMeta))}. Importeer een nieuwer bestand om te verversen.`
                : null
            }
            disabled={!isProduction}
            parseFile={(file, text) => {
              const parsed = parseAgendaExport(file.name, text);
              if (!parsed.ok || !parsed.facts) {
                return { error: parsed.error ?? "Bestand kon niet worden gelezen.", preview: null };
              }
              const facts = parsed.facts;
              return {
                error: null,
                preview: {
                  fileName: file.name,
                  samenvatting: [
                    { label: "sessies", waarde: nl.format(facts.sessieRows) },
                    { label: "periode", waarde: `${datumNl(facts.bronVan)} – ${datumNl(facts.bronTot)}` },
                    facts.toekomst
                      ? { label: "gepland (vooruitblik)", waarde: nl.format(facts.toekomst.sessies) }
                      : { label: "cliënten met afspraak", waarde: nl.format(facts.clienten.length) },
                  ],
                  warnings: parsed.warnings,
                  activeer: () => activateAgenda(facts),
                },
              };
            }}
          />

          <ImportSlot
            titel="Huisartsen / verwijzers"
            hint="ZSG-formaat: Cliënt ID;Cliënt Code;Naam;Rol;…;AGB Code;… (puntkomma-gescheiden)"
            icoon={<Stethoscope className="size-4 text-violet-600 dark:text-violet-400" />}
            actief={
              netwerk
                ? `Gekoppeld: ${netwerk.fileName} — ${nl.format(netwerk.contacten.length)} verwijzers, ${nl.format(netwerk.clienten)} cliëntkoppelingen.`
                : null
            }
            disabled={!isProduction}
            parseFile={(file, text) => {
              const parsed = parseVerwijzersExport(file.name, text);
              if (!parsed.ok || !parsed.facts) {
                return { error: parsed.error ?? "Bestand kon niet worden gelezen.", preview: null };
              }
              const facts = parsed.facts;
              return {
                error: null,
                preview: {
                  fileName: file.name,
                  samenvatting: [
                    { label: "verwijzers", waarde: nl.format(facts.contacten.length) },
                    { label: "cliëntkoppelingen", waarde: nl.format(facts.clienten) },
                    {
                      label: "met Zorgmail",
                      waarde: `${Math.round((facts.contacten.filter((contact) => contact.zorgmail).length / facts.contacten.length) * 100)}%`,
                    },
                  ],
                  warnings: parsed.warnings,
                  activeer: () => activateVerwijzers(facts),
                },
              };
            }}
          />
          <ImportSlot
            titel="Toeslagen (declared surcharges)"
            hint="ZSG-formaat: Cliënt;Instelling;…;Code;Omschrijving;Prijs;Factuurnummer;Factuurdatum"
            icoon={<Euro className="size-4 text-violet-600 dark:text-violet-400" />}
            actief={
              toeslagen
                ? `Gekoppeld: ${toeslagen.meta.fileName} — ${nl.format(toeslagen.aantal)} toeslagregels, € ${nl.format(toeslagen.totaal)}.`
                : null
            }
            disabled={!isProduction}
            parseFile={(file, text) => {
              const parsed = parseToeslagenExport(file.name, text);
              if (!parsed.ok || !parsed.facts) {
                return { error: parsed.error ?? "Bestand kon niet worden gelezen.", preview: null };
              }
              const facts = parsed.facts;
              return {
                error: null,
                preview: {
                  fileName: file.name,
                  samenvatting: [
                    { label: "toeslagregels", waarde: nl.format(facts.totalRows - facts.skippedRows) },
                    {
                      label: "totaal",
                      waarde: `€ ${nl.format(Math.round(facts.cellen.reduce((sum, cel) => sum + cel.omzet, 0)))}`,
                    },
                    { label: "cliënten", waarde: nl.format(facts.clienten) },
                  ],
                  warnings: parsed.warnings,
                  activeer: () => activateToeslagen(facts),
                },
              };
            }}
          />
          <ImportSlot
            titel="Declaratie-totaaloverzicht"
            hint="ZSG-formaat: Regelnummer;…;Factuurnummer;…;Totaal bedrag;Toegekend totaalbedrag;…"
            icoon={<FileCheck2 className="size-4 text-violet-600 dark:text-violet-400" />}
            actief={
              declaraties
                ? `Gekoppeld: ${declaraties.meta.fileName} — ${nl.format(declaraties.facturen)} facturen, ${declaraties.toekenningsPct}% toegekend, € ${nl.format(declaraties.openstaand)} openstaand.`
                : null
            }
            disabled={!isProduction}
            parseFile={(file, text) => {
              const parsed = parseDeclaratiesExport(file.name, text);
              if (!parsed.ok || !parsed.facts) {
                return { error: parsed.error ?? "Bestand kon niet worden gelezen.", preview: null };
              }
              const facts = parsed.facts;
              const gefactureerd = facts.facturen.reduce((sum, factuur) => sum + factuur.bedrag, 0);
              const toegekend = facts.facturen.reduce((sum, factuur) => sum + factuur.toegekend, 0);
              return {
                error: null,
                preview: {
                  fileName: file.name,
                  samenvatting: [
                    { label: "facturen", waarde: nl.format(facts.facturen.length) },
                    { label: "gedeclareerd", waarde: `€ ${nl.format(Math.round(gefactureerd))}` },
                    {
                      label: "toegekend",
                      waarde: `${gefactureerd === 0 ? 0 : Math.round((toegekend / gefactureerd) * 100)}%`,
                    },
                  ],
                  warnings: parsed.warnings,
                  activeer: () => activateDeclaraties(facts),
                },
              };
            }}
          />
        </div>

        <p className="flex items-start gap-2 text-muted-foreground text-xs">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          Privacy: cliëntnamen, memo&apos;s/sessieverslagen, BSN en e-mailadressen worden bij het inlezen genegeerd en
          nooit opgeslagen — alleen geaggregeerde cijfers en cliënt-ID&apos;s blijven bewaard. De toeslagen-export bevat
          namen in plaats van ID&apos;s: die worden uitsluitend geteld.
        </p>
      </CardContent>
    </Card>
  );
}

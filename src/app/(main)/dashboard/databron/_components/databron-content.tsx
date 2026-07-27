"use client";

import { CheckCircle2, CircleDashed, RotateCcw } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import { cn } from "@/lib/utils";

import { AanvullendeExportsCard } from "./aanvullende-exports-card";
import { ApiKoppelingCard } from "./api-koppeling-card";
import { CsvImportCard } from "./csv-import-card";
import { DatakwaliteitCard } from "./datakwaliteit-card";
import { ProductieImportCard } from "./productie-import-card";

const SOURCE_BADGE = {
  demo: { label: "Demo-omgeving", className: "border-amber-600/40 text-amber-700 dark:text-amber-400" },
  csv: { label: "Stap 1 actief", className: "border-blue-600/40 text-blue-700 dark:text-blue-400" },
  // Preview-modus maakt bewust geen externe verbinding — geen "live"-groen.
  api: { label: "Preview actief", className: "border-blue-600/40 text-blue-700 dark:text-blue-400" },
  productie: { label: "Productie actief", className: "border-violet-600/40 text-violet-700 dark:text-violet-400" },
};

export function DatabronContent() {
  const { source, restoreDemo, production, isProduction } = useCareon();
  const badge = SOURCE_BADGE[source.mode];

  // De vijf EPD-exports die de productie-modus voeden: cliëntendata als basis,
  // vier aanvullende exports verrijken planning, netwerk en financieel.
  const productionImports =
    isProduction && production
      ? [
          { label: "Cliëntendata-export (basis)", actief: production.meta.fileName as string | null },
          {
            label: "Agenda / afspraken",
            actief: production.agenda
              ? `${production.agenda.meta.fileName}${production.agenda.vooruitblik ? " · met toekomstvenster" : ""}`
              : null,
          },
          {
            label: "Huisartsen / verwijzers",
            actief: production.verwijzerNetwerk ? production.verwijzerNetwerk.fileName : null,
          },
          { label: "Toeslagen", actief: production.toeslagen ? production.toeslagen.meta.fileName : null },
          {
            label: "Declaratie-totaaloverzicht",
            actief: production.declaraties ? production.declaraties.meta.fileName : null,
          },
        ]
      : null;

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={CAREON_PAGE_META.databron.title}
        sub={
          isProduction
            ? "Productie-modus: vijf EPD-exports voeden het dashboard — cliëntendata als basis, plus agenda, verwijzers, toeslagen en declaraties."
            : "Careon Pulse groeit met u mee: start vandaag met een EPD-export en koppel later live."
        }
        action={
          source.mode !== "demo" && (
            <Button variant="outline" size="sm" onClick={restoreDemo}>
              <RotateCcw className="size-3.5" />
              Herstel demo-data
            </Button>
          )
        }
      />

      <Card className="py-4">
        <CardHeader className="px-4">
          <CardDescription>Actieve bron</CardDescription>
          <CardTitle className="text-xl">{source.label}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground text-sm">Dataset: {source.detail}</span>
            <Badge variant="outline" className={cn(badge.className)}>
              {badge.label}
            </Badge>
          </div>

          {productionImports && (
            <div className="flex flex-col gap-2 border-t pt-3">
              <p className="font-medium text-muted-foreground text-xs">
                Gekoppelde EPD-exports ({productionImports.filter((item) => item.actief).length}/
                {productionImports.length})
              </p>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {productionImports.map((item) => (
                  <li key={item.label} className="flex items-start gap-2 text-xs">
                    {item.actief ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                    ) : (
                      <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span>
                      <span className="font-medium">{item.label}</span>
                      <span className="block text-muted-foreground">{item.actief ?? "nog niet gekoppeld"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <ProductieImportCard />

      {/* Productie-flow: aanvullende exports bouwen voort op de cliëntendata. */}
      <AanvullendeExportsCard />

      {/* Productie-exclusief: rendert null in demo (pixel-identieke demo-pagina). */}
      <DatakwaliteitCard />

      {/* Demo-hulpmiddelen (KPI-CSV en API-preview) horen niet bij de echte
          productie-flow — in productie-modus verborgen, in demo ongewijzigd. */}
      {isProduction ? (
        <p className="text-muted-foreground text-xs">
          De demo-hulpmiddelen (KPI-CSV-import en API-preview) zijn verborgen zolang productie-modus actief is — gebruik
          &ldquo;Herstel demo-data&rdquo; om ze terug te halen.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
          <CsvImportCard />
          <ApiKoppelingCard />
        </div>
      )}
    </div>
  );
}

"use client";

import { RotateCcw } from "lucide-react";

import { CareonPageHeader } from "@/app/(main)/dashboard/_components/careon/careon-page-header";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CAREON_PAGE_META } from "@/data/careon/careon-pages";
import { cn } from "@/lib/utils";

import { ApiKoppelingCard } from "./api-koppeling-card";
import { CsvImportCard } from "./csv-import-card";
import { ProductieImportCard } from "./productie-import-card";

const SOURCE_BADGE = {
  demo: { label: "Demo-omgeving", className: "border-amber-600/40 text-amber-700 dark:text-amber-400" },
  csv: { label: "Stap 1 actief", className: "border-blue-600/40 text-blue-700 dark:text-blue-400" },
  api: { label: "Live verbonden", className: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400" },
  productie: { label: "Productie actief", className: "border-violet-600/40 text-violet-700 dark:text-violet-400" },
};

export function DatabronContent() {
  const { source, restoreDemo } = useCareon();
  const badge = SOURCE_BADGE[source.mode];

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <CareonPageHeader
        title={CAREON_PAGE_META.databron.title}
        sub="Careon Pulse groeit met u mee: start vandaag met een EPD-export en koppel later live."
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
        <CardContent className="flex flex-wrap items-center gap-3 px-4">
          <span className="text-muted-foreground text-sm">Dataset: {source.detail}</span>
          <Badge variant="outline" className={cn(badge.className)}>
            {badge.label}
          </Badge>
        </CardContent>
      </Card>

      <ProductieImportCard />

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        <CsvImportCard />
        <ApiKoppelingCard />
      </div>
    </div>
  );
}

import Link from "next/link";

import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COCKPIT_DOSSIERS_SUMMARY } from "@/data/careon/careon-dossiers-productie";
import { CAREON_ROUTES } from "@/data/careon/careon-pages";
import { cn } from "@/lib/utils";

// Compact cockpit summary of the Dossiers & productie page (handoff 07):
// the full analytics live on their own page; this block only surfaces the
// headline numbers and links through.
export function DossiersProductieSummary({ className }: Readonly<{ className?: string }>) {
  return (
    <Card className={cn("careon-chart-card", className)}>
      <CardHeader>
        <CardTitle className="leading-none">Dossiers & productie</CardTitle>
        <CardDescription>Afsluitingen, productie en populatie — deze maand</CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link prefetch={false} href={CAREON_ROUTES.dossiersProductie}>
              Bekijk
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {COCKPIT_DOSSIERS_SUMMARY.map((item) => (
            <div key={item.label} className="rounded-lg border bg-muted/30 p-3">
              <dt className="truncate text-muted-foreground text-xs">{item.label}</dt>
              <dd className="mt-1 truncate font-medium text-lg tabular-nums leading-none">{item.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

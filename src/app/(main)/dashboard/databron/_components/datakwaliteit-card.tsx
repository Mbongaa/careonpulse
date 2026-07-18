"use client";

import { CareonBar } from "@/app/(main)/dashboard/_components/careon/careon-bar-list";
import { useCareon } from "@/app/(main)/dashboard/_components/careon/careon-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Productie-exclusief: de export zelf als onderwerp. Elke live widget erft de
// registratiediscipline van het EPD; deze kaart maakt die discipline meetbaar
// (vulgraad per veld over álle rijen, ongefilterd). Demo: rendert null.

const nl = new Intl.NumberFormat("nl-NL");

function vulTone(pct: number) {
  if (pct >= 90) return "good" as const;
  if (pct >= 60) return "warn" as const;
  return "bad" as const;
}

export function DatakwaliteitCard() {
  const { production } = useCareon();
  if (!production) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datakwaliteit van de export</CardTitle>
        <CardDescription>
          Vulgraad per veld over alle {nl.format(production.meta.totalRows)} cliëntrijen — lage vulgraad betekent dat de
          bijbehorende dashboards op een deelverzameling rekenen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {production.datakwaliteit.map((rij) => {
          const pct = rij.totaal === 0 ? 0 : Math.round((rij.gevuld / rij.totaal) * 100);
          return (
            <div key={rij.veld} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>{rij.veld}</span>
                <span className="tabular-nums">
                  <b>{pct}%</b>
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    · {nl.format(rij.gevuld)}/{nl.format(rij.totaal)}
                  </span>
                </span>
              </div>
              <CareonBar pct={pct} tone={vulTone(pct)} />
            </div>
          );
        })}
        <p className="pt-1 text-muted-foreground text-xs">
          Verbeteren gebeurt in het EPD (ZSG); een volgende export laat de vooruitgang hier direct zien.
        </p>
      </CardContent>
    </Card>
  );
}

"use client";

import type { FactuurTotalen } from "@/lib/careon-facturatie/totalen";
import { formatEuro, isVolledigVrijgesteld } from "@/lib/careon-facturatie/totalen";
import type { FactuurRegel } from "@/lib/careon-facturatie/types";

// Totalenblok (handoff 15 §4.3): per tarief/vrijstelling; volledig vrijgesteld
// toont géén btw-kolom en géén 0%-regel — vrijgesteld ≠ nultarief.

export function FactuurTotalenBlok({ regels, totalen }: Readonly<{ regels: FactuurRegel[]; totalen: FactuurTotalen }>) {
  if (regels.length === 0) return null;
  if (isVolledigVrijgesteld(regels)) {
    return (
      <div className="ml-auto w-full max-w-72 border-t pt-2">
        <div className="flex items-center justify-between font-semibold text-sm">
          <span>Totaal (vrijgesteld van btw)</span>
          <span className="tabular-nums">{formatEuro(totalen.totaalCent)}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="ml-auto w-full max-w-72 space-y-1 border-t pt-2 text-sm">
      <div className="flex items-center justify-between text-muted-foreground">
        <span>Subtotaal excl. btw</span>
        <span className="tabular-nums">{formatEuro(totalen.subtotaalCent)}</span>
      </div>
      {totalen.btwTotalen
        .filter((totaal) => totaal.tarief !== "vrijgesteld")
        .map((totaal) => (
          <div
            key={`${totaal.tarief}-${totaal.categorie}`}
            className="flex items-center justify-between text-muted-foreground"
          >
            <span>{totaal.categorie === "AE" ? "Btw verlegd" : `Btw ${totaal.tarief}%`}</span>
            <span className="tabular-nums">{formatEuro(totaal.btwCent)}</span>
          </div>
        ))}
      {totalen.btwTotalen.some((totaal) => totaal.tarief === "vrijgesteld") ? (
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Waarvan vrijgesteld van btw</span>
          <span className="tabular-nums">
            {formatEuro(
              totalen.btwTotalen
                .filter((totaal) => totaal.tarief === "vrijgesteld")
                .reduce((som, totaal) => som + totaal.grondslagCent, 0),
            )}
          </span>
        </div>
      ) : null}
      <div className="flex items-center justify-between border-t pt-1 font-semibold">
        <span>Totaal</span>
        <span className="tabular-nums">{formatEuro(totalen.totaalCent)}</span>
      </div>
    </div>
  );
}

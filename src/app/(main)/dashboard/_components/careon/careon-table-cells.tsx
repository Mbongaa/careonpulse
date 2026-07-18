import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { CellTone } from "@/data/careon/careon-behandelaren";
import { getInitials } from "@/lib/utils";

// Gedeelde celbouwstenen voor de productie-tabellen (Behandelaren en
// Medewerker-productie): één plek voor de toon-kleuren en de persoonscel,
// zodat severity-kleuren en avatarlayout niet per tabel kunnen driften.
// De geauditeerde demo-tabellen behouden bewust hun eigen (identieke) markup.

export const CELL_TONE_TEXT: Record<CellTone, string> = {
  bad: "text-red-700 dark:text-red-400 font-semibold",
  warn: "text-amber-700 dark:text-amber-400 font-medium",
  good: "text-emerald-700 dark:text-emerald-400",
  none: "",
};

export function CareonPersonCell({ naam, sub }: Readonly<{ naam: string; sub: string }>) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="size-7">
        <AvatarFallback className="text-foreground text-xs">{getInitials(naam)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium leading-tight">{naam}</p>
        <p className="truncate text-muted-foreground text-xs">{sub}</p>
      </div>
    </div>
  );
}

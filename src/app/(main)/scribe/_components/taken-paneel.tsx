"use client";

import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TAAK_SOORT_LABELS, TAAK_STATUS_LABELS } from "@/data/careon/careon-scribe";
import type { ScribeTaak, TaakStatus } from "@/lib/careon-scribe/types";
import { cn } from "@/lib/utils";

import { BronKnoppen } from "./staat-paneel";

// Vervolgacties (handoff 20 §7.3, paneel C-4). De module STELT ze voor; de
// behandelaar keurt goed of wijst af. Er gaat niets automatisch naar een
// agenda, YAAZ of het EPD — dat is expliciet buiten deze levering (§10).

export function TakenPaneel({
  taken,
  bewerkbaar,
  onStatus,
  onBron,
}: Readonly<{
  taken: ScribeTaak[];
  bewerkbaar: boolean;
  onStatus: (taakId: string, status: TaakStatus) => void;
  onBron: (bron: number[]) => void;
}>) {
  if (taken.length === 0) {
    return <p className="text-muted-foreground text-sm">Nog geen vervolgacties voorgesteld.</p>;
  }
  return (
    <ul className="space-y-2">
      {taken.map((taak) => (
        <li key={taak.id} className="rounded-md border p-2">
          <p className={cn("text-sm", taak.status === "afgewezen" && "text-muted-foreground line-through")}>
            {taak.omschrijving}
            <BronKnoppen bron={taak.bronSegmenten} onBron={onBron} />
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {TAAK_SOORT_LABELS[taak.soort]}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {TAAK_STATUS_LABELS[taak.status]}
            </Badge>
            {bewerkbaar && taak.status === "voorgesteld" ? (
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() => onStatus(taak.id, "goedgekeurd")}
                >
                  <Check className="size-3" />
                  Goedkeuren
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-muted-foreground text-xs"
                  onClick={() => onStatus(taak.id, "afgewezen")}
                >
                  <X className="size-3" />
                  Afwijzen
                </Button>
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useState } from "react";

import { useCareonHr } from "@/app/(main)/dashboard/_components/careon/careon-hr-provider";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CAREON_MONTHS } from "@/data/careon/careon-shared-charts";

// Tussenstanden tijdens het typen ("", "4,", "4.") zijn geen geldig getal.
// Zonder eigen tekststaat werd zo'n toetsaanslag als 0 vastgelegd én centraal
// gepusht, waardoor "4.2" eindigde als 2. Elk veld houdt daarom zijn eigen ruwe
// tekst vast (per invoer, anders wist typen in de ene maand de andere) tot er
// een geldige waarde uit komt; bij verlaten valt de invoer terug op de
// opgeslagen waarde. Zelfde idioom als de HR-KPI-editor hiernaast.
function BenchmarkInput({ waarde }: Readonly<{ waarde: number }>) {
  const { setBenchmark } = useCareonHr();
  const [ruw, setRuw] = useState<string | null>(null);

  return (
    <Input
      id="hr-benchmark"
      type="number"
      min={0}
      max={100}
      step="0.1"
      value={ruw ?? String(waarde)}
      className="h-8 w-28 text-right text-xs tabular-nums"
      onChange={(event) => {
        setRuw(event.target.value);
        const getal = event.target.valueAsNumber;
        if (Number.isFinite(getal)) {
          setBenchmark(getal);
        }
      }}
      onBlur={() => setRuw(null)}
    />
  );
}

function MaandInput({ maand, index, waarde }: Readonly<{ maand: string; index: number; waarde: number }>) {
  const { setTrendPunt } = useCareonHr();
  const [ruw, setRuw] = useState<string | null>(null);

  return (
    <Input
      id={`hr-verzuim-${maand}`}
      type="number"
      min={0}
      max={100}
      step="0.1"
      value={ruw ?? String(waarde)}
      aria-label={`Ziekteverzuim ${maand} (%)`}
      className="h-8 text-right text-xs tabular-nums"
      onChange={(event) => {
        setRuw(event.target.value);
        const getal = event.target.valueAsNumber;
        if (Number.isFinite(getal)) {
          setTrendPunt(index, getal);
        }
      }}
      onBlur={() => setRuw(null)}
    />
  );
}

// Ziekteverzuim-reeks bijwerken: één percentage per maand (voedt de grafiek
// hierboven) plus de GGZ-benchmark-referentielijn.
export function HrVerzuimEditor() {
  const { state } = useCareonHr();

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-medium text-sm">
          Ziekteverzuim-reeks &amp; benchmark
          <CareonHandmatigBadge />
        </h2>
        <p className="text-muted-foreground text-xs">Ziekteverzuim per maand (%); voedt de grafiek hierboven.</p>
      </div>
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="hr-benchmark" className="text-xs">
                GGZ-benchmark (%)
              </Label>
              <BenchmarkInput waarde={state.benchmark} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {CAREON_MONTHS.map((maand, index) => (
              <div key={maand} className="space-y-1">
                <Label htmlFor={`hr-verzuim-${maand}`} className="text-muted-foreground text-xs capitalize">
                  {maand}
                </Label>
                <MaandInput maand={maand} index={index} waarde={state.verzuimTrend[index] ?? 0} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

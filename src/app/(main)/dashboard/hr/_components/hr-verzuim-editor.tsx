"use client";

import { useCareonHr } from "@/app/(main)/dashboard/_components/careon/careon-hr-provider";
import { CareonHandmatigBadge } from "@/app/(main)/dashboard/_components/careon/careon-source-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CAREON_MONTHS } from "@/data/careon/careon-shared-charts";

// Ziekteverzuim-reeks bijwerken: één percentage per maand (voedt de grafiek
// hierboven) plus de GGZ-benchmark-referentielijn.
export function HrVerzuimEditor() {
  const { state, setTrendPunt, setBenchmark } = useCareonHr();

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
              <Input
                id="hr-benchmark"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={state.benchmark}
                className="h-8 w-28 text-right text-xs tabular-nums"
                onChange={(event) => setBenchmark(event.target.valueAsNumber)}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {CAREON_MONTHS.map((maand, index) => (
              <div key={maand} className="space-y-1">
                <Label htmlFor={`hr-verzuim-${maand}`} className="text-muted-foreground text-xs capitalize">
                  {maand}
                </Label>
                <Input
                  id={`hr-verzuim-${maand}`}
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={state.verzuimTrend[index] ?? 0}
                  aria-label={`Ziekteverzuim ${maand} (%)`}
                  className="h-8 text-right text-xs tabular-nums"
                  onChange={(event) => setTrendPunt(index, event.target.valueAsNumber)}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

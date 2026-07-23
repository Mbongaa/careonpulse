"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CAREON_TIMEFRAME_LABELS,
  CAREON_TIMEFRAME_OPTIONS,
  type CareonTimeframe,
} from "@/data/careon/careon-timeframe";
import { cn } from "@/lib/utils";

// Compact tijdvenster-segment voor in de CardAction-slot van een grafiekkaart.
export function CareonTimeframeToggle({
  value,
  onChange,
  className,
}: Readonly<{
  value: CareonTimeframe;
  onChange: (value: CareonTimeframe) => void;
  className?: string;
}>) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={0}
      value={value}
      onValueChange={(next) => {
        // Radix laat een enkelvoudige groep leeg-klikken; een grafiek zonder
        // venster bestaat niet — negeer deselectie.
        if (next) onChange(next as CareonTimeframe);
      }}
      className={cn("h-7", className)}
      aria-label="Tijdvenster"
    >
      {CAREON_TIMEFRAME_OPTIONS.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={CAREON_TIMEFRAME_LABELS[option.value]}
          className="h-7 min-w-9 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

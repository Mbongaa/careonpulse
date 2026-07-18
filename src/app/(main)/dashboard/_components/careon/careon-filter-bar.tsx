"use client";

import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CAREON_LOCATIONS, CAREON_PERIODS, CAREON_TEAMS } from "@/data/careon/careon-filters";
import type { CareonPeriodId } from "@/data/careon/careon-types";

import { useCareon } from "./careon-provider";

// Global filters persist across all dashboard pages via the Careon provider.
// Desktop (lg+) shows all three selects inline, matching the audited layout.
// Below lg, Periode and Team move into a compact filter popover so every
// filter stays reachable on mobile.
export function CareonFilterBar() {
  const { filters, setFilter, isProduction } = useCareon();

  // In productie-modus is het teamfilter verborgen: de EPD-data van deze
  // instelling kent maar één zorgvorm (SGGZ), dus filteren is betekenisloos.
  // Het periodefilter is er ook verborgen: de productie-vensters liggen vast
  // (12 volle maanden; maand-KPI's = laatste volle maand) — een keuze die
  // niets verandert zou live cijfers ten onrechte "gefilterd" doen lijken.
  const showTeamFilter = !isProduction;
  const showPeriodeFilter = !isProduction;
  const hiddenFiltersActive =
    (showPeriodeFilter && filters.periode !== "12m") || (showTeamFilter && filters.team !== "Alle teams");

  return (
    <div className="flex items-center gap-2">
      {showPeriodeFilter && (
        <Select value={filters.periode} onValueChange={(value) => setFilter("periode", value as CareonPeriodId)}>
          <SelectTrigger size="sm" className="hidden w-40 lg:flex" aria-label="Periode">
            <SelectValue placeholder="Periode" />
          </SelectTrigger>
          <SelectContent>
            {CAREON_PERIODS.map((period) => (
              <SelectItem key={period.id} value={period.id}>
                {period.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={filters.locatie} onValueChange={(value) => setFilter("locatie", value)}>
        <SelectTrigger size="sm" className="w-32 sm:w-36" aria-label="Locatie">
          <SelectValue placeholder="Locatie" />
        </SelectTrigger>
        <SelectContent>
          {CAREON_LOCATIONS.map((location) => (
            <SelectItem key={location} value={location}>
              {location}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showTeamFilter && (
        <Select value={filters.team} onValueChange={(value) => setFilter("team", value)}>
          <SelectTrigger size="sm" className="hidden w-32 lg:flex" aria-label="Team">
            <SelectValue placeholder="Team" />
          </SelectTrigger>
          <SelectContent>
            {CAREON_TEAMS.map((team) => (
              <SelectItem key={team} value={team}>
                {team}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="relative size-8 px-0 lg:hidden" aria-label="Alle filters">
            <SlidersHorizontal className="size-4" />
            {hiddenFiltersActive && (
              <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 space-y-3">
          <p className="font-medium text-sm">Filters</p>
          {showPeriodeFilter && (
            <div className="space-y-1.5">
              <Label htmlFor="careon-filter-periode" className="text-muted-foreground text-xs">
                Periode
              </Label>
              <Select value={filters.periode} onValueChange={(value) => setFilter("periode", value as CareonPeriodId)}>
                <SelectTrigger id="careon-filter-periode" size="sm" className="w-full">
                  <SelectValue placeholder="Periode" />
                </SelectTrigger>
                <SelectContent>
                  {CAREON_PERIODS.map((period) => (
                    <SelectItem key={period.id} value={period.id}>
                      {period.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="careon-filter-locatie" className="text-muted-foreground text-xs">
              Locatie
            </Label>
            <Select value={filters.locatie} onValueChange={(value) => setFilter("locatie", value)}>
              <SelectTrigger id="careon-filter-locatie" size="sm" className="w-full">
                <SelectValue placeholder="Locatie" />
              </SelectTrigger>
              <SelectContent>
                {CAREON_LOCATIONS.map((location) => (
                  <SelectItem key={location} value={location}>
                    {location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showTeamFilter && (
            <div className="space-y-1.5">
              <Label htmlFor="careon-filter-team" className="text-muted-foreground text-xs">
                Team
              </Label>
              <Select value={filters.team} onValueChange={(value) => setFilter("team", value)}>
                <SelectTrigger id="careon-filter-team" size="sm" className="w-full">
                  <SelectValue placeholder="Team" />
                </SelectTrigger>
                <SelectContent>
                  {CAREON_TEAMS.map((team) => (
                    <SelectItem key={team} value={team}>
                      {team}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

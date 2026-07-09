"use client";

import { Activity, Moon, Sun } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ThemeMode } from "@/lib/preferences/theme";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

export function ThemeSwitcher() {
  const { themeMode, setPreference } = usePreferencesStore(
    useShallow((state) => ({
      themeMode: state.values.theme_mode,
      setPreference: state.setPreference,
    })),
  );

  const onThemeModeChange = (mode: ThemeMode | "") => {
    if (!mode) return;
    setPreference("theme_mode", mode);
  };

  return (
    <ToggleGroup
      type="single"
      size="sm"
      spacing={0}
      variant="outline"
      value={themeMode}
      onValueChange={onThemeModeChange}
      aria-label="Thema"
      className="careon-theme-switcher hidden bg-background/70 sm:flex"
    >
      <ToggleGroupItem value="light" aria-label="Light theme">
        <Sun className="size-3.5" />
        <span className="sr-only">Light theme</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme">
        <Moon className="size-3.5" />
        <span className="sr-only">Dark theme</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="careon" aria-label="Careon theme">
        <Activity className="size-3.5" />
        <span className="sr-only">Careon theme</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

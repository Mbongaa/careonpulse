"use client";

import { Font } from "@react-pdf/renderer";

// Fontregistratie voor de browser-preview. react-pdf ondersteunt TTF/WOFF
// (géén woff2, géén variable fonts) — de app-fonts zijn woff2, dus de pdf
// gebruikt de statische Geist-TTF's uit public/fonts/pdf/ (gekopieerd uit het
// geist-npm-pakket; nooit een externe fonthost). Alleen Regular + Bold.
// De server-tegenhanger (fonts.server.ts) registreert dezelfde familie met
// absolute bestandspaden — houd beide in sync.

let geregistreerd = false;

export function registreerPdfFonts(): void {
  if (geregistreerd) return;
  geregistreerd = true;
  Font.register({
    family: "Geist",
    fonts: [
      { src: "/fonts/pdf/Geist-Regular.ttf", fontWeight: 400 },
      { src: "/fonts/pdf/Geist-Bold.ttf", fontWeight: 700 },
    ],
  });
  // Nederlandse woorden afbreken oogt rommelig op een factuur — uitzetten.
  Font.registerHyphenationCallback((word) => [word]);
}

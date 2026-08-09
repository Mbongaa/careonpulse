import { Font } from "@react-pdf/renderer";

import path from "node:path";

// Fontregistratie voor renderToBuffer in Node-routes. Zelfde familie als
// fonts.client.ts, maar met absolute bestandspaden; outputFileTracingIncludes
// in next.config.mjs neemt deze TTF's mee in de Vercel-trace.

const FONT_DIR = path.join(process.cwd(), "src", "lib", "careon-facturatie", "pdf", "fonts");

let geregistreerd = false;

export function registreerPdfFontsServer(): void {
  if (geregistreerd) return;
  geregistreerd = true;
  Font.register({
    family: "Geist",
    fonts: [
      { src: path.join(FONT_DIR, "Geist-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Geist-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
}

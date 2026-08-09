import { renderToBuffer } from "@react-pdf/renderer";

import type { Factuur } from "../types";
import { FactuurDocument } from "./factuur-document";
import { registreerPdfFontsServer } from "./fonts.server";
import { createHash } from "node:crypto";

// Server-side pdf-render voor archief en (fase B) e-mailbijlage. Determinisme:
// react-pdf stempelt een CreationDate in de metadata, dus twee renders van
// dezelfde factuur geven verschillende bytes — de sha256 hieronder is een
// integriteitscontrole van het opgeslagen bestand, geen audit-hash van de
// factuurdata.

export async function renderFactuurPdf(
  factuur: Factuur,
  logoDataUrl?: string,
): Promise<{ buffer: Buffer; sha256: string }> {
  registreerPdfFontsServer();
  const buffer = await renderToBuffer(<FactuurDocument factuur={factuur} logoSrc={logoDataUrl} />);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return { buffer, sha256 };
}

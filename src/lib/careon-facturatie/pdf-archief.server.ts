import {
  downloadUitBucket,
  logoPadVoor,
  pdfPadVoor,
  serviceFactuurUpdate,
  storageBeschikbaar,
  uploadNaarBucket,
} from "./facturatie.server";
import { renderFactuurPdf } from "./pdf/render.server";
import type { Factuur, FactuurAfzender } from "./types";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Server-side logobytes per bron: meegeleverd asset of sjabloon-upload. */
export async function logoDataUrlVoor(orgId: string, afzender: FactuurAfzender): Promise<string | undefined> {
  if (!afzender.toonLogo) return undefined;
  if (afzender.logoBron === "careongroup") {
    try {
      const bytes = await readFile(
        path.join(process.cwd(), "src", "lib", "careon-facturatie", "pdf", "assets", "careon-group-logo.png"),
      );
      return `data:image/png;base64,${bytes.toString("base64")}`;
    } catch (error) {
      console.error("Facturatie: ingebouwd logo onleesbaar", error);
      return undefined;
    }
  }
  if (afzender.logoBron === "upload" && afzender.templateId) {
    const bytes = await downloadUitBucket(logoPadVoor(orgId, afzender.templateId));
    if (bytes) return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  }
  return undefined;
}

// Pdf renderen + onveranderlijk archiveren (handoff 15 §5.5 stap 3), gedeeld
// door de definitief-route en de herstelroute (…/pdf). Mislukken is geen
// rollback-reden: de factuur blijft definitief mét nummer.

export async function genereerEnArchiveerPdf(orgId: string, factuur: Factuur): Promise<{ ok: boolean; pad?: string }> {
  if (!storageBeschikbaar() || !factuur.nummer) return { ok: false };
  const pad = pdfPadVoor(orgId, factuur.jaar, factuur.nummer);
  const logoDataUrl = factuur.afzender ? await logoDataUrlVoor(orgId, factuur.afzender) : undefined;
  try {
    const { buffer, sha256 } = await renderFactuurPdf(factuur, logoDataUrl);
    // x-upsert false: een uitgereikte factuur kan nooit worden overschreven.
    const geupload = await uploadNaarBucket(pad, buffer, "application/pdf", false);
    if (!geupload) return { ok: false };
    await serviceFactuurUpdate(orgId, factuur.id, {
      pdf_pad: pad,
      pdf_sha256: sha256,
      pdf_bytes: buffer.byteLength,
      pdf_gegenereerd_op: new Date().toISOString(),
    });
    return { ok: true, pad };
  } catch (error) {
    console.error("Facturatie: pdf-generatie mislukt", error);
    return { ok: false };
  }
}

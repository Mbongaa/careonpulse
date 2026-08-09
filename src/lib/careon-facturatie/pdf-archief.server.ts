import {
  downloadUitBucket,
  logoPadVoor,
  pdfPadVoor,
  serviceFactuurUpdate,
  storageBeschikbaar,
  uploadNaarBucket,
} from "./facturatie.server";
import { renderFactuurPdf } from "./pdf/render.server";
import type { Factuur } from "./types";

// Pdf renderen + onveranderlijk archiveren (handoff 15 §5.5 stap 3), gedeeld
// door de definitief-route en de herstelroute (…/pdf). Mislukken is geen
// rollback-reden: de factuur blijft definitief mét nummer.

export async function genereerEnArchiveerPdf(orgId: string, factuur: Factuur): Promise<{ ok: boolean; pad?: string }> {
  if (!storageBeschikbaar() || !factuur.nummer) return { ok: false };
  const pad = pdfPadVoor(orgId, factuur.jaar, factuur.nummer);
  let logoDataUrl: string | undefined;
  if (factuur.afzender?.toonLogo) {
    const logoBytes = await downloadUitBucket(logoPadVoor(orgId));
    if (logoBytes) logoDataUrl = `data:image/png;base64,${Buffer.from(logoBytes).toString("base64")}`;
  }
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

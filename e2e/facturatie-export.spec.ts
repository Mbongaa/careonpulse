import { expect, type Page, type TestInfo, test } from "@playwright/test";

import { DEMO_CONTACTEN, DEMO_FACTURATIE_INSTELLINGEN, DEMO_FACTUREN } from "../src/data/careon/careon-facturatie";
import type { Factuur } from "../src/lib/careon-facturatie/types";
import { readFile } from "node:fs/promises";

// Explicitly synthetic central API: never contacts a real organization or
// Storage. Distinct bytes prove the download uses the archive, not a rerender.
function synthetischArchief(): Buffer {
  const inhoud = "BT /F1 18 Tf 50 770 Td (Synthetic archive F2026-0042) Tj ET";
  const objecten = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(inhoud)} >>\nstream\n${inhoud}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objecten.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const ARCHIEF = synthetischArchief();

async function bewaarSchermbewijs(page: Page, testInfo: TestInfo, naam: string) {
  for (const beeld of [
    { naam: "desktop-dark", breedte: 1440, hoogte: 1000, thema: "dark" },
    { naam: "mobile-light", breedte: 390, hoogte: 844, thema: "light" },
  ]) {
    await page.setViewportSize({ width: beeld.breedte, height: beeld.hoogte });
    await page.context().addCookies([{ name: "theme_mode", value: beeld.thema, url: new URL(page.url()).origin }]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme-mode", beeld.thema);
    const pdfActie = page.getByRole("button", {
      name: naam === "archief" ? "Pdf downloaden" : "Pdf opnieuw genereren",
      exact: true,
    });
    await expect(pdfActie).toBeEnabled();
    const acties = page.getByRole("region", { name: "Factuuracties" });
    await acties.scrollIntoViewIfNeeded();
    await expect(acties).toHaveCSS("position", "static");
    const actiesVlak = await acties.boundingBox();
    const opmerkingVlak = await page.getByLabel("Opmerking op de factuur").boundingBox();
    if (!actiesVlak || !opmerkingVlak) throw new Error("Factuuracties en opmerking moeten zichtbaar blijven.");
    expect(actiesVlak.y).toBeGreaterThanOrEqual(opmerkingVlak.y + opmerkingVlak.height);
    if (beeld.breedte < 1024) {
      const pdfVlak = await pdfActie.boundingBox();
      const afnemerVlak = await page.getByLabel("Afnemer (contact)").boundingBox();
      if (!pdfVlak || !afnemerVlak) throw new Error("Pdf-acties en afnemer moeten zichtbaar blijven.");
      expect(pdfVlak.y).toBeLessThan(afnemerVlak.y);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    const bestand = testInfo.outputPath(`${naam}-${beeld.naam}.png`);
    await page.screenshot({ path: bestand, fullPage: true, animations: "disabled" });
    await testInfo.attach(`${naam}-${beeld.naam}`, { path: bestand, contentType: "image/png" });
  }
}

async function centraleFactuur(
  page: Page,
  opties: { concept?: boolean; pdfOntbreekt?: boolean; opslagFout?: number; opslagWacht?: Promise<void> } = {},
) {
  let factuur: Factuur = {
    ...structuredClone(DEMO_FACTUREN[0]),
    id: "export-test-factuur",
    status: opties.concept ? "concept" : "definitief",
    nummer: opties.concept ? null : "F2026-0042",
    pdfPad: opties.concept ? null : "test-org/2026/F2026-0042.pdf",
  };
  let ontbreekt = opties.pdfOntbreekt ?? false;
  const writes: { soort: string; factuur?: Factuur; baseUpdatedAt?: string }[] = [];
  await page.addInitScript(() => window.sessionStorage.setItem("careon-auth", "1"));
  await page.route("**/api/careon/facturatie/**", async (route) => {
    const request = route.request();
    const pad = new URL(request.url()).pathname;
    if (pad.endsWith("/instellingen")) {
      return route.fulfill({ json: { instellingen: DEMO_FACTURATIE_INSTELLINGEN, mailBeschikbaar: false } });
    }
    if (pad.endsWith("/contacten")) return route.fulfill({ json: { contacten: DEMO_CONTACTEN } });
    if (pad.endsWith("/mail") && request.method() === "GET") return route.fulfill({ json: { maillog: [] } });
    if (pad.endsWith("/pdf")) {
      if (request.method() === "POST") {
        writes.push({ soort: "pdf-herstel" });
        ontbreekt = false;
        factuur.updatedAt = "2026-09-12T12:00:00.000Z";
        return route.fulfill({ json: { factuur } });
      }
      if (ontbreekt) return route.fulfill({ status: 409, json: { error: "Pdf ontbreekt — genereer opnieuw." } });
      return route.fulfill({ contentType: "application/pdf", body: ARCHIEF });
    }
    if (pad.endsWith("/definitief")) {
      writes.push({ soort: "definitief", factuur: structuredClone(factuur) });
      factuur = { ...factuur, status: "definitief", nummer: "F2026-0042", pdfPad: "test-org/2026/F2026-0042.pdf" };
      return route.fulfill({ json: { factuur } });
    }
    if (pad.endsWith(`/${factuur.id}`)) {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as { factuur: Factuur; baseUpdatedAt: string };
        writes.push({ soort: "concept", ...body });
        await opties.opslagWacht;
        if (opties.opslagFout) {
          return route.fulfill({
            status: opties.opslagFout,
            json: {
              error: "Test: laatste wijziging is niet opgeslagen.",
              factuur: opties.opslagFout === 409 ? factuur : undefined,
            },
          });
        }
        factuur = { ...body.factuur, updatedAt: `2026-09-12T12:00:0${writes.length}.000Z` };
      }
      return route.fulfill({ json: { factuur } });
    }
    throw new Error(`Unexpected synthetic invoice request: ${request.method()} ${pad}`);
  });
  await page.goto(`/facturatie/${factuur.id}`);
  await expect(page.getByRole("heading", { name: opties.concept ? "Nieuwe factuur" : "F2026-0042" })).toBeVisible();
  return writes;
}

async function bevestigUitreiking(page: Page) {
  await page.getByRole("button", { name: "Definitief maken", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Definitief maken", exact: true }).click();
}

test.describe("facturatie export (synthetisch centraal)", () => {
  test("download levert exact de gearchiveerde bytes en blijft in de editor", async ({ page }, testInfo) => {
    await centraleFactuur(page);
    const knop = page.getByRole("button", { name: "Pdf downloaden", exact: true });
    await expect(knop).toBeEnabled();
    await expect(page.locator('iframe[title="Voorbeeld van de factuur"]')).toHaveAttribute("src", /^blob:/);
    const downloadWacht = page.waitForEvent("download");
    await knop.click();
    const download = await downloadWacht;
    expect(download.suggestedFilename()).toBe("F2026-0042.pdf");
    const bestand = await download.path();
    expect(bestand).toBeTruthy();
    expect(await readFile(bestand as string)).toEqual(ARCHIEF);
    await expect(page).toHaveURL(/\/facturatie\/export-test-factuur$/);
    await bewaarSchermbewijs(page, testInfo, "archief");
  });

  test("ontbrekend Storage-object met bestaand pad kan worden hersteld", async ({ page }, testInfo) => {
    const writes = await centraleFactuur(page, { pdfOntbreekt: true });
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Pdf ontbreekt");
    await bewaarSchermbewijs(page, testInfo, "pdf-herstel");
    await page.getByRole("button", { name: "Pdf opnieuw genereren", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pdf downloaden", exact: true })).toBeEnabled();
    expect(writes.map((write) => write.soort)).toEqual(["pdf-herstel"]);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  for (const opslagFout of [502, 409]) {
    test(`mislukte laatste opslag (${opslagFout}) geeft geen factuurnummer uit`, async ({ page }) => {
      const writes = await centraleFactuur(page, { concept: true, opslagFout });
      await page.getByLabel("Uw kenmerk / referentie").fill("Nog niet opgeslagen");
      await bevestigUitreiking(page);
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        opslagFout === 409 ? "intussen door iemand anders gewijzigd" : "laatste wijziging is niet opgeslagen",
      );
      expect(writes.filter((write) => write.soort === "definitief")).toHaveLength(0);
      await expect(page.getByRole("heading", { name: "Nieuwe factuur" })).toBeVisible();
    });
  }

  test("uitreiking wacht op autosave en bewaart daarna de laatste wijziging", async ({ page }) => {
    let hervatOpslag: () => void = () => undefined;
    const opslagWacht = new Promise<void>((resolve) => {
      hervatOpslag = resolve;
    });
    const writes = await centraleFactuur(page, { concept: true, opslagWacht });
    await page.getByLabel("Uw kenmerk / referentie").fill("Eerste wijziging");
    await page.getByLabel("Prestatie van").focus();
    await expect.poll(() => writes.length).toBe(1);
    await page.getByLabel("Uw kenmerk / referentie").fill("Laatste wijziging");
    await bevestigUitreiking(page);
    await expect(page.getByLabel("Uw kenmerk / referentie")).toBeDisabled();
    expect(writes.filter((write) => write.soort === "definitief")).toHaveLength(0);
    hervatOpslag();
    await expect(page.getByRole("heading", { name: "F2026-0042" })).toBeVisible();
    expect(writes.map((write) => write.soort)).toEqual(["concept", "concept", "definitief"]);
    expect(writes[1].baseUpdatedAt).toBe("2026-09-12T12:00:01.000Z");
    expect(writes[2].factuur?.uwKenmerk).toBe("Laatste wijziging");
  });
});

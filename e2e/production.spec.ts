import { expect, type Page, test } from "@playwright/test";

import * as path from "node:path";

// Productie-modus: import van de ZSG-cliëntendata-export via Databron,
// herkomst-badges op de pagina's, en herstel naar demo. Gebruikt de synthetische
// fixture (12 cliëntrijen) — nooit een echte export.

const FIXTURE = path.join(__dirname, "../src/scripts/fixtures/zsg-clienten-fixture.csv");

async function loginViaSession(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("careon-auth", "1");
  });
}

function productieFileInput(page: Page) {
  // Scoped op de productie-kaart: Databron heeft ook een CSV-importkaart met file-input.
  return page.locator('[data-slot="card"]:has-text("Productie-modus: volledige EPD-export") input[type="file"]');
}

async function importFixture(page: Page) {
  await page.goto("/dashboard/databron");
  await productieFileInput(page).setInputFiles(FIXTURE);
  await expect(page.getByText("12 cliëntrijen gelezen", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Activeer productie-modus" }).click();
}

test.describe("productie-modus", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaSession(page);
  });

  test("import toont validatierapport en activeert productie", async ({ page }) => {
    await page.goto("/dashboard/databron");

    await productieFileInput(page).setInputFiles(FIXTURE);

    // Validatierapport: rijen, kerncijfers en leeswaarschuwingen (dubbele id,
    // rij zonder id, onleesbare datum).
    await expect(page.getByText("12 cliëntrijen gelezen", { exact: false })).toBeVisible();
    await expect(page.getByText("2 overgeslagen", { exact: false })).toBeVisible();
    await expect(page.getByText("3 aandachtspunt(en)", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Activeer productie-modus" }).click();

    await expect(page.getByText("Productie-data", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Productie actief")).toBeVisible();
    await expect(page.getByRole("button", { name: "Herstel demo-data" })).toBeVisible();
  });

  test("cockpit toont banner, live data en demo-badges", async ({ page }) => {
    await importFixture(page);

    await page.goto("/dashboard/directiecockpit");
    await expect(page.getByText("Productie-data actief").first()).toBeVisible();

    // Live KPI uit de fixture: 8 actieve cliënten (alle open episodes).
    const actiefCard = page.locator(".careon-kpi-card", { hasText: "Actieve patiënten" });
    await expect(actiefCard.getByText("8", { exact: true })).toBeVisible();
    await expect(actiefCard.getByText("Live")).toBeVisible();

    // KPI zonder EPD-bron behoudt demo-waarde en draagt een demo-badge.
    const noshowCard = page.locator(".careon-kpi-card", { hasText: "No-show" });
    await expect(noshowCard.getByText("Demo")).toBeVisible();

    // Afgeleide KPI (outreach = ZPM-setting S04) toont proxy-badge.
    const outreachCard = page.locator(".careon-kpi-card", { hasText: "Outreachende cliënten" });
    await expect(outreachCard.getByText("Afgeleid")).toBeVisible();
  });

  test("productie filtert echt op vestiging en verbergt team- en periodefilter", async ({ page }) => {
    await importFixture(page);

    await page.goto("/dashboard/directiecockpit");
    await expect(page.getByLabel("Team")).toHaveCount(0);
    // Periode is in productie verborgen: de vensters liggen vast en een dode
    // keuze zou live cijfers ten onrechte "gefilterd" doen lijken.
    await expect(page.getByLabel("Periode")).toHaveCount(0);

    const actiefCard = page.locator(".careon-kpi-card", { hasText: "Actieve patiënten" });
    await expect(actiefCard.getByText("8", { exact: true })).toBeVisible();

    // Tilburg heeft 6 van de 8 actieve cliënten in de fixture.
    await page.getByLabel("Locatie").click();
    await page.getByRole("option", { name: "Tilburg" }).click();
    await expect(actiefCard.getByText("6", { exact: true })).toBeVisible();
  });

  test("productie overleeft herladen en herstel demo-data zet alles terug", async ({ page }) => {
    await importFixture(page);

    await page.reload();
    await expect(page.getByText("Productie actief")).toBeVisible();

    await page.getByRole("button", { name: "Herstel demo-data" }).click();
    await expect(page.getByText("Demo-omgeving")).toBeVisible();

    await page.goto("/dashboard/directiecockpit");
    const actiefCard = page.locator(".careon-kpi-card", { hasText: "Actieve patiënten" });
    await expect(actiefCard.getByText("1.248", { exact: true })).toBeVisible();
  });

  test("signaleringen tonen live regels plus wacht-op-data-sectie", async ({ page }) => {
    await importFixture(page);

    await page.goto("/dashboard/signaleringen");
    await expect(page.getByText("Geen primaire diagnose").first()).toBeVisible();
    await expect(page.getByText("Wacht op data — voorbeeldregels (demo)")).toBeVisible();
  });

  test("productie-exclusieve analyses: zorgvraagtypering, behandelduur, wachtlijstfases, extra controles", async ({
    page,
  }) => {
    await importFixture(page);

    await page.goto("/dashboard/dossiers-productie");
    // Deze panelen bestaan niet in demo (geen demo-constanten) en verschijnen
    // alleen met een actieve EPD-import. Kaarttitels dragen de Live-badge als
    // kind in hetzelfde element (tekstinhoud "ZorgvraagtyperingLive", zonder
    // spatie) — dus substring-match, geen exact.
    await expect(page.getByText("Zorgvraagtypering")).toBeVisible();
    await expect(page.getByText("ZT03 · matige problematiek")).toBeVisible();
    await expect(page.getByText("Behandelduur")).toBeVisible();
    await expect(page.getByText("Per fase")).toBeVisible();
    await expect(page.getByText("secundaire diagnose", { exact: false })).toBeVisible();

    await page.goto("/dashboard/dossiercontrole");
    await expect(page.getByText("Typering wijkt af van HoNOS-advies")).toBeVisible();
    await expect(page.getByText("COV-check ontbreekt of polis verlopen")).toBeVisible();
  });

  test("trends en demo-vervangingen: wachttijd-trend, zorgvorm, hoog-risico, datakwaliteit, kwaliteitsscore", async ({
    page,
  }) => {
    await importFixture(page);

    await page.goto("/dashboard/patienten");
    await expect(page.getByText("Wachttijd-trend")).toBeVisible();
    await expect(page.getByText(">30 dgn geen registratie")).toBeVisible();
    await expect(page.getByText("Hoog-risico (ZT05/ZT08)")).toBeVisible();
    // Zorgvorm toont in productie de setting-verdeling i.p.v. de demo-mix.
    await expect(page.getByText("Ambulant (S03)")).toBeVisible();

    await page.goto("/dashboard/databron");
    await expect(page.getByText("Datakwaliteit van de export")).toBeVisible();

    await page.goto("/dashboard/kwaliteit");
    await expect(page.getByText("Registratie-compleetheid (EPD-export)")).toBeVisible();
  });
});

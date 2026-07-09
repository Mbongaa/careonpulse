import { expect, type Page, test } from "@playwright/test";

const LOGIN_URL = "/auth/v1/login";

async function loginViaSession(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("careon-auth", "1");
  });
}

test.describe("auth", () => {
  test("unauthenticated dashboard visit redirects to login", async ({ page }) => {
    await page.goto("/dashboard/directiecockpit");
    await page.waitForURL(`**${LOGIN_URL}`);
    await expect(page.getByPlaceholder("Gebruikersnaam")).toBeVisible();
  });

  test("login button disabled until both fields filled", async ({ page }) => {
    await page.goto(LOGIN_URL);
    const submit = page.getByRole("button", { name: "Inloggen" });
    await expect(submit).toBeDisabled();
    await page.getByPlaceholder("Gebruikersnaam").fill("user1");
    await expect(submit).toBeDisabled();
    await page.getByPlaceholder("Wachtwoord").fill("x");
    await expect(submit).toBeEnabled();
  });

  test("invalid login shows audited error", async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.getByPlaceholder("Gebruikersnaam").fill("user1");
    await page.getByPlaceholder("Wachtwoord").fill("wrong");
    await page.getByRole("button", { name: "Inloggen" }).click();
    await expect(page.getByText("Onjuiste combinatie — probeer het opnieuw.")).toBeVisible();
  });

  test("valid login lands on Directiecockpit, logout returns to login", async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.getByPlaceholder("Gebruikersnaam").fill("user1");
    await page.getByPlaceholder("Wachtwoord").fill("demo1234");
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.waitForURL("**/dashboard/directiecockpit");
    await expect(page.getByRole("heading", { name: "Directiecockpit" })).toBeVisible();

    await page.getByRole("button", { name: "Peter Verstraten" }).click();
    await page.getByRole("menuitem", { name: "Uitloggen" }).click();
    await page.waitForURL(`**${LOGIN_URL}`);
  });
});

test.describe("cockpit + filters", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/directiecockpit");
    await expect(page.getByRole("heading", { name: "Directiecockpit" })).toBeVisible();
  });

  test("shows audited KPI values and insights carousel", async ({ page }) => {
    await expect(page.getByText("1.248", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Careon Insights").first()).toBeVisible();
    await expect(page.getByText("No-show daalde van 4,1% naar 3,4%", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Insight 2" }).click();
    await expect(page.getByText("Wachtlijst intake Roermond (15,2 wkn)", { exact: false })).toBeVisible();
  });

  test("location filter scales KPIs and persists across pages", async ({ page }) => {
    await page.getByLabel("Locatie").click();
    await page.getByRole("option", { name: "Roermond" }).click();
    await expect(page.getByText("275", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("TGC Groep · Roermond")).toBeVisible();

    await page.getByRole("link", { name: "Patiënten", exact: true }).first().click();
    await page.waitForURL("**/dashboard/patienten");
    await page.getByRole("link", { name: "Directiecockpit", exact: true }).first().click();
    await page.waitForURL("**/dashboard/directiecockpit");
    await expect(page.getByLabel("Locatie")).toContainText("Roermond");
    await expect(page.getByText("275", { exact: true }).first()).toBeVisible();
  });

  test("KPI cards route to their domain pages", async ({ page }) => {
    await page.getByRole("link", { name: "No-show", exact: true }).click();
    await page.waitForURL("**/dashboard/planning");
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
  });

  test("bell and urgent panel route to signaleringen", async ({ page }) => {
    await page.getByRole("link", { name: /Signaleringen \(3 kritiek\)/ }).click();
    await page.waitForURL("**/dashboard/signaleringen");
    await expect(page.getByRole("heading", { name: "Signaleringen" })).toBeVisible();
  });
});

test.describe("signaleringen", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/signaleringen");
  });

  test("shows severity groups and routes Bekijk to domain page", async ({ page }) => {
    await expect(page.getByText("Kritiek — direct actie")).toBeVisible();
    await expect(page.getByText("Hoog — deze week")).toBeVisible();
    await expect(page.getByText("Middel — monitoren")).toBeVisible();
    await expect(page.getByText("Wachtlijst boven Treeknorm")).toBeVisible();
    await page.getByRole("link", { name: "Bekijk" }).first().click();
    await page.waitForURL("**/dashboard/patienten");
  });
});

test.describe("behandelaren", () => {
  test("team filter narrows the clinician table", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/behandelaren");
    await expect(page.getByText("10 behandelaren · Alle locaties · Alle teams")).toBeVisible();
    await page.getByLabel("Team").click();
    await page.getByRole("option", { name: "FACT" }).click();
    await expect(page.getByText("2 behandelaren · Alle locaties · FACT")).toBeVisible();
    // Role query targets the visible table; the hidden mobile card list also carries the name.
    await expect(page.getByRole("cell", { name: /K\. Aydın/ })).toBeVisible();
  });
});

test.describe("dossiers & productie", () => {
  test("page shows reconciled KPIs and population sections", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/dossiers-productie");
    await expect(page.getByRole("heading", { name: "Dossiers & productie" })).toBeVisible();
    // KPI strip reconciles with audited values (afsluitingen 74, wachtlijst 70).
    await expect(page.getByText("1.248", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Afsluitingen", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Wachtlijst totaal")).toBeVisible();
    // Population sections.
    await expect(page.getByText("Diagnoses binnen de instelling")).toBeVisible();
    await expect(page.getByText("Depressieve stoornissen", { exact: true })).toBeVisible();
    await expect(page.getByText("Verzekeringskoepel")).toBeVisible();
    await expect(page.getByText("Regiebehandelaar", { exact: true })).toBeVisible();
    await expect(page.getByText("boven norm")).toBeVisible();
  });

  test("location filter narrows the medewerker table", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/dossiers-productie");
    await expect(page.getByText("10 medewerkers · Alle locaties · Alle teams")).toBeVisible();
    await page.getByLabel("Locatie").click();
    await page.getByRole("option", { name: "Roermond" }).click();
    await expect(page.getByText("3 medewerkers · Roermond · Alle teams")).toBeVisible();
    await expect(page.getByRole("cell", { name: /L\. Vermeer/ })).toBeVisible();
  });

  test("cockpit summary links to the page", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/directiecockpit");
    const summary = page.getByText("Dossiers & productie", { exact: true }).first();
    await expect(summary).toBeVisible();
    await page
      .getByRole("link", { name: /Bekijk/ })
      .first()
      .click();
    await page.waitForURL("**/dashboard/dossiers-productie");
    await expect(page.getByRole("heading", { name: "Dossiers & productie" })).toBeVisible();
  });
});

test.describe("databron", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/databron");
    await expect(page.getByRole("heading", { name: "Databron" })).toBeVisible();
  });

  test("API mock flow: activate, live badge, restore demo", async ({ page }) => {
    const activate = page.getByRole("button", { name: "Test & activeer" });
    await expect(activate).toBeDisabled();
    await page.getByLabel("API-sleutel of client-secret").fill("dummy-secret");
    await expect(activate).toBeEnabled();
    await activate.click();
    await expect(page.getByRole("button", { name: "Verbinden..." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verbonden" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("API live", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Sandbox-koppeling actief", { exact: false })).toBeVisible();
    await expect(page.locator('[data-sidebar="menu-badge"]', { hasText: "LIVE" })).toBeVisible();

    await page.getByRole("button", { name: "Herstel demo-data" }).click();
    await expect(page.getByText("Demo-data", { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-sidebar="menu-badge"]', { hasText: "DEMO" })).toBeVisible();
  });

  test("CSV import updates cockpit KPIs and source; invalid CSV shows audited error", async ({ page }) => {
    const csv = "kpi;huidig;vorige_maand\nactief;1300;1248\nnoshow;2,9;3,4";
    await page.locator('input[type="file"]').setInputFiles({
      name: "maandexport.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });
    await expect(page.getByText("maandexport.csv verwerkt — 2 KPI's bijgewerkt in de cockpit.")).toBeVisible();
    await expect(page.getByText("CSV-import", { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-sidebar="menu-badge"]', { hasText: "CSV" })).toBeVisible();

    await page.getByRole("link", { name: "Directiecockpit", exact: true }).first().click();
    await expect(page.getByText("1.300", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Databron", exact: true }).first().click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "fout.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("foo;1;2", "utf-8"),
    });
    await expect(
      page.getByText("Geen herkenbare KPI's in fout.csv — gebruik het voorbeeldbestand als basis."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Herstel demo-data" }).click();
  });
});

test.describe("chrome & theming", () => {
  test("theme switcher exposes Light, Dark, and Careon modes", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/directiecockpit");
    const html = page.locator("html");

    await expect(html).toHaveAttribute("data-theme-mode", "careon");
    await expect.poll(async () => html.evaluate((el) => el.classList.contains("dark"))).toBe(true);

    await page.getByRole("radio", { name: "Light theme" }).click();
    await expect(html).toHaveAttribute("data-theme-mode", "light");
    await expect.poll(async () => html.evaluate((el) => el.classList.contains("dark"))).toBe(false);

    await page.getByRole("radio", { name: "Dark theme" }).click();
    await expect(html).toHaveAttribute("data-theme-mode", "dark");
    await expect.poll(async () => html.evaluate((el) => el.classList.contains("dark"))).toBe(true);

    await page.getByRole("radio", { name: "Careon theme" }).click();
    await expect(html).toHaveAttribute("data-theme-mode", "careon");
    await expect.poll(async () => html.evaluate((el) => el.classList.contains("dark"))).toBe(true);
  });

  test("unknown dashboard route returns 404 page", async ({ page }) => {
    await loginViaSession(page);
    const response = await page.goto("/dashboard/bestaat-niet");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Pagina niet gevonden")).toBeVisible();
  });

  test("mobile: cockpit renders and sidebar drawer opens @mobile", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/directiecockpit");
    await expect(page.getByRole("heading", { name: "Directiecockpit" })).toBeVisible();
    await expect(page.getByText("1.248", { exact: true }).first()).toBeVisible();
    const mobileNav = page.getByRole("navigation", { name: "Mobiele Careon navigatie" });
    await expect(mobileNav).toBeVisible();
    await mobileNav.getByRole("link", { name: "Patiënten", exact: true }).click();
    await page.waitForURL("**/dashboard/patienten");
    await expect(page.getByRole("heading", { name: "Patiënten" })).toBeVisible();
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(page.getByRole("link", { name: "Signaleringen", exact: true })).toBeVisible();
  });
});

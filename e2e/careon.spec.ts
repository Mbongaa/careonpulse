import { expect, type Page, test } from "@playwright/test";

const LOGIN_URL = "/auth/v1/login";

async function loginViaSession(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("careon-auth", "1");
  });
}

test.describe("auth", () => {
  test("unauthenticated dashboard visit redirects to login", async ({ page }) => {
    const response = await page.goto("/dashboard/directiecockpit");
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
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

  test("username is case-insensitive", async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.getByPlaceholder("Gebruikersnaam").fill("USER1");
    await page.getByPlaceholder("Wachtwoord").fill("demo1234");
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.waitForURL("**/dashboard/directiecockpit");
    await expect(page.getByRole("heading", { name: "Directiecockpit" })).toBeVisible();
  });

  test("valid login lands on Directiecockpit, logout returns to login", async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.getByPlaceholder("Gebruikersnaam").fill("user1");
    await page.getByPlaceholder("Wachtwoord").fill("demo1234");
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.waitForURL("**/dashboard/directiecockpit");
    await expect(page.getByRole("heading", { name: "Directiecockpit" })).toBeVisible();

    await page.evaluate(async () => {
      window.localStorage.setItem("careon-production-v1", '{"sensitive":true}');
      window.localStorage.setItem("careon-middelen-v2", '{"sensitive":true}');
      window.localStorage.setItem("careon-hr-v2", '{"sensitive":true}');
      window.sessionStorage.setItem("careon-assistant-session-v1", "session-test");
      const cache = await window.caches.open("careon-sensitive-test");
      await cache.put("/dashboard/sensitive", new Response("sensitive"));
    });
    await page.getByRole("button", { name: "Peter Verstraten" }).click();
    await page.getByRole("menuitem", { name: "Uitloggen" }).click();
    await page.waitForURL(`**${LOGIN_URL}`);
    const cleared = await page.evaluate(async () => ({
      auth: window.sessionStorage.getItem("careon-auth"),
      session: window.sessionStorage.getItem("careon-assistant-session-v1"),
      production: window.localStorage.getItem("careon-production-v1"),
      middelen: window.localStorage.getItem("careon-middelen-v2"),
      hr: window.localStorage.getItem("careon-hr-v2"),
      sensitiveCache: (await window.caches.keys()).includes("careon-sensitive-test"),
    }));
    expect(cleared).toEqual({
      auth: null,
      session: null,
      production: null,
      middelen: null,
      hr: null,
      sensitiveCache: false,
    });
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

  test("KPI cards open their drill-down; detail page links onward to the domain page", async ({ page }) => {
    await page.getByRole("link", { name: "No-show", exact: true }).click();
    await page.waitForURL("**/dashboard/details/noshow");
    await expect(page.getByRole("heading", { name: "No-show" })).toBeVisible();
    // Kop toont de geauditeerde kaartwaarde; de tabel telt de records erachter.
    await expect(page.getByText("3,4%", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("63 records · Alle locaties")).toBeVisible();
    await page.getByRole("link", { name: "Open Planning" }).click();
    await page.waitForURL("**/dashboard/planning");
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
  });

  test("bell and urgent panel route to signaleringen", async ({ page }) => {
    await page.getByRole("link", { name: /Signaleringen \(3 kritiek\)/ }).click();
    await page.waitForURL("**/dashboard/signaleringen");
    await expect(page.getByRole("heading", { name: "Signaleringen" })).toBeVisible();
  });
});

test.describe("kpi drill-down", () => {
  test("domain KPI card drills down and reconciles with the audited breakdown", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/patienten");
    await page.getByRole("link", { name: "Wachtlijst intake", exact: true }).click();
    await page.waitForURL("**/dashboard/details/wachtlijst-intake");
    await expect(page.getByRole("heading", { name: "Wachtlijst intake" })).toBeVisible();
    await expect(page.getByText("43", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("43 records · Alle locaties")).toBeVisible();
    // Locatiefilter filtert de records; Roermond draagt 19 intake-wachtenden
    // (geauditeerde wachtlijstverdeling, Treeknorm-verhaal).
    await page.getByLabel("Locatie").click();
    await page.getByRole("option", { name: "Roermond" }).click();
    await expect(page.getByText("19 records · Roermond")).toBeVisible();
  });

  test("dossiercontrole summary tiles open their drill-down", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/dossiercontrole");
    await page.getByRole("link", { name: "Niet compleet", exact: true }).click();
    await page.waitForURL("**/dashboard/details/dossiersnc");
    await expect(page.getByRole("heading", { name: "Dossiers niet compleet" })).toBeVisible();
    await expect(page.getByText("18", { exact: true }).first()).toBeVisible();
  });

  test("unknown detail id shows the 404 page", async ({ page }) => {
    await loginViaSession(page);
    // Statuscode is hier 200: de dashboard-layout leest cookies() en streamt,
    // dus de headers zijn al verstuurd vóór notFound() de boundary rendert
    // (zelfde beperking als destijds bij de template-catch-all). Ongematchte
    // routes buiten een segment geven wél een echte 404 — zie de bestaande
    // "unknown dashboard route returns 404 page"-test.
    await page.goto("/dashboard/details/bestaat-niet");
    await expect(page.getByText("Pagina niet gevonden")).toBeVisible();
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
    // Role query targets the visible table; the hidden mobile card list also
    // carries the name. First match = identiteitscel (daarna volgt sinds
    // handoff 09 ook de "Middelen van …"-badgecel).
    await expect(page.getByRole("cell", { name: /K\. Aydın/ }).first()).toBeVisible();
  });
});

test.describe("assistant api", () => {
  test("liveness is healthy and readiness reports missing isolated dependencies", async ({ request }) => {
    const live = await request.get("/api/health/live");
    expect(live.status()).toBe(200);
    expect((await live.json()).status).toBe("ok");

    const ready = await request.get("/api/health/ready");
    expect(ready.status()).toBe(503);
    const payload = await ready.json();
    expect(payload.status).toBe("not_ready");
    expect(payload.checks.database).toBe(false);
  });

  test("health probe reports fallback mode and posts are refused without live AI", async ({ request }) => {
    // The e2e webServer sets CAREON_ASSISTANT_LIVE=0, so live must be false
    // and the POST endpoint must refuse with 503 (client then falls back).
    const health = await request.get("/api/assistant");
    expect(health.status()).toBe(200);
    expect((await health.json()).live).toBe(false);

    const post = await request.post("/api/assistant", {
      headers: { "x-careon-assistant": "1" },
      data: { question: "test" },
    });
    expect(post.status()).toBe(503);
  });
});

test.describe("assistant layout", () => {
  test("page is viewport-contained with the canvas open (no document scroll)", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/assistent");
    await page.getByRole("button", { name: "Samenvatting van vandaag" }).click();
    await expect(page.getByText("Geselecteerd artefact")).toBeVisible({ timeout: 20_000 });

    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
    }));
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.innerW + 1);
    expect(overflow.scrollH).toBeLessThanOrEqual(overflow.innerH + 1);
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
    // Population sections (Claude Design-handoff: 6/3/3 + 4/4/4 grid).
    await expect(page.getByText("Diagnoses binnen de instelling")).toBeVisible();
    await expect(page.getByText("Depressieve stoornissen", { exact: true })).toBeVisible();
    await expect(page.getByText("Verwijzers").first()).toBeVisible();
    await expect(page.getByText("Verzekeringskoepel")).toBeVisible();
    // Regie- en wachtlijstpanelen zijn in demo geschrapt: hun kerncijfers
    // zitten in de KPI-strip en insights; alleen productie toont de panelen.
    await expect(page.getByText("Regiebehandelaar", { exact: true })).toHaveCount(0);
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

test.describe("middelen & inventaris", () => {
  test("page shows counters, registration and inventory (handmatig)", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/middelen");
    await expect(page.getByRole("heading", { name: "Medewerkers & middelen" })).toBeVisible();
    // De negen door de klant gevraagde tellers.
    await expect(page.getByText("Uitgegeven auto's")).toBeVisible();
    await expect(page.getByText("Tankpassen")).toBeVisible();
    await expect(page.getByText("Toegang gebouw")).toBeVisible();
    // Tegel én inventaris-kolomkop dragen dezelfde tekst — first() volstaat.
    await expect(page.getByText("Behandelkamers", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Boeken inventaris")).toBeVisible();
    await expect(page.getByText("Diagnostiekmateriaal", { exact: true }).first()).toBeVisible();
    // Herkomst is expliciet handmatig, met de registratietabellen eronder.
    await expect(page.getByText("Handmatig", { exact: true }).first()).toBeVisible();
    // Role-query mijdt de verborgen mobiele kaartlijst (md:hidden).
    await expect(page.getByRole("cell", { name: /Drs\. E\. van Dijk/ }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /P\. Hendriks/ }).first()).toBeVisible();
    // Functie- en talenregistratie (seedwaarden) — row-scope mijdt de
    // verborgen mobiele kaartlijst die dezelfde labels draagt.
    await expect(
      page.getByRole("row", { name: /Drs\. E\. van Dijk/ }).getByLabel("Functie — Drs. E. van Dijk"),
    ).toHaveValue("GZ-psycholoog");
    await expect(
      page.getByRole("row", { name: /S\. Yılmaz/ }).getByRole("button", { name: "Talen — S. Yılmaz" }),
    ).toContainText("Turks");
    await expect(page.getByRole("button", { name: "Persoon toevoegen" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Locatie toevoegen" })).toBeVisible();
    // Teamstructuur van de klant (teams per Vektis-locatie, beheerbaar).
    await expect(page.getByText("Teams per locatie")).toBeVisible();
    await expect(page.getByText("GGZ in beweging")).toBeVisible();
    await expect(page.getByText("De Zorgpoort")).toBeVisible();
  });

  test("team tagging via the teams picker", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/middelen");
    const kiezer = page.getByRole("row", { name: /T\. Bakker/ }).getByRole("button", { name: "Teams — T. Bakker" });
    await expect(kiezer).toContainText("—");
    await kiezer.click();
    await page.getByRole("button", { name: "SGGZ", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(kiezer).toContainText("SGGZ");
  });

  test("toggling a middel persists across a reload", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/middelen");
    // Seed: T. Bakker heeft geen auto — aanzetten en na herladen nog aan.
    const toggle = page.getByRole("button", { name: "Auto — T. Bakker" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByRole("button", { name: "Auto — T. Bakker" })).toHaveAttribute("aria-pressed", "true");
  });

  test("behandelaren shows functie, talen and team panels from the registration", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/behandelaren");
    // Functie in de identiteitsregel en talen als kolom (seedwaarden).
    await expect(page.getByRole("cell", { name: /GZ-psycholoog · SGGZ · Tilburg/ }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "Nederlands, Turks" }).first()).toBeVisible();
    // Teamprofiel-panelen uit de handmatige registratie.
    await expect(page.getByText("Talen in het team")).toBeVisible();
    await expect(page.getByText("Functiemix")).toBeVisible();
    await expect(page.getByText("Turks", { exact: true }).first()).toBeVisible();
    // Bezetting per team toont ook onbemande teams uit de structuur (0).
    await expect(page.getByText("Bezetting per team")).toBeVisible();
    await expect(page.getByText("GGZ in beweging")).toBeVisible();
    // De middelen-badge linkt door naar de registratiepagina.
    const badge = page.getByRole("link", { name: /Middelen van Drs\. E\. van Dijk/ });
    await expect(badge).toBeVisible();
    await badge.click();
    await page.waitForURL("**/dashboard/middelen");
    await expect(page.getByRole("heading", { name: "Medewerkers & middelen" })).toBeVisible();
  });
});

test.describe("hr (handmatige registratie)", () => {
  test("page shows manual KPIs and the editors (handmatig)", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/hr");
    // Herkomst is expliciet handmatig, geen demo.
    await expect(page.getByText("Handmatig", { exact: true }).first()).toBeVisible();
    // De drie handmatige editors.
    await expect(page.getByRole("heading", { name: "HR-kerncijfers bijwerken" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ziekteverzuim-reeks & benchmark" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "BIG-registraties beheren" })).toBeVisible();
    // KPI-invoer met de geauditeerde seedwaarde.
    await expect(page.getByLabel("Ziekteverzuim — huidige waarde")).toHaveValue("5.8");
    // Seed levert precies drie BIG-registraties in de beheertabel.
    await expect(page.getByRole("textbox", { name: /^Naam — rij \d+$/ })).toHaveCount(3);
  });

  test("editing a KPI value persists across a reload", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/hr");
    const input = page.getByLabel("Ziekteverzuim — huidige waarde");
    await input.fill("4.2");
    await expect(input).toHaveValue("4.2");
    await page.reload();
    await expect(page.getByLabel("Ziekteverzuim — huidige waarde")).toHaveValue("4.2");
  });

  test("adding and removing a BIG registration", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/hr");
    const rows = page.getByRole("textbox", { name: /^Naam — rij \d+$/ });
    await expect(rows).toHaveCount(3);
    // Toevoegen: naam + verloopdatum invullen en opslaan.
    await page.getByLabel("Naam nieuwe BIG-registratie").fill("K. Test");
    await page.getByLabel("Functie nieuwe BIG-registratie").fill("SPV");
    await page.getByLabel("Verloopdatum nieuwe BIG-registratie").fill("2026-12-01");
    await page.getByRole("button", { name: "Registratie toevoegen" }).click();
    // Het formulier maakt zich leeg en er staat nu een vierde rij.
    await expect(page.getByLabel("Naam nieuwe BIG-registratie")).toHaveValue("");
    await expect(rows).toHaveCount(4);
    // Verwijderen brengt het terug naar drie.
    await page.getByRole("button", { name: "Verwijder registratie K. Test" }).click();
    await expect(rows).toHaveCount(3);
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
    // Scoped op de CSV-kaart: Databron heeft ook een productie-importkaart met file-input.
    await page.locator('[data-slot="card"]:has-text("CSV-import uit uw EPD") input[type="file"]').setInputFiles({
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
    await page.locator('[data-slot="card"]:has-text("CSV-import uit uw EPD") input[type="file"]').setInputFiles({
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

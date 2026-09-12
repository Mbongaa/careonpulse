import { expect, type Page, test } from "@playwright/test";

const LOGIN_URL = "/auth/v1/login";

async function loginViaSession(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("careon-auth", "1");
  });
}

test.describe("auth", () => {
  test("browser suite runs only through explicit demo contract", async ({ request }) => {
    const response = await request.post("/api/auth/login", {
      data: { username: "nobody", password: "not-a-real-password" },
    });
    expect(response.status()).toBe(501);
    await expect(response.json()).resolves.toMatchObject({ configured: false, demo: true });
  });

  test("demo keeps Microsoft federation fail-closed", async ({ page, request }) => {
    const response = await request.get("/api/auth/microsoft");
    expect(response.status()).toBe(503);

    await page.goto(LOGIN_URL);
    await expect(page.getByRole("link", { name: "Inloggen met Microsoft" })).toHaveCount(0);
  });

  test("unauthenticated dashboard visit redirects to login", async ({ page }) => {
    const response = await page.goto("/dashboard/directiecockpit");
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    // Facturatie (handoff 15 §5.3): het pdf-voorbeeld is een same-origin blob;
    // elke andere frame-herkomst blijft verboden.
    expect(csp).toContain("frame-src 'self' blob:");
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
    await page.waitForURL("**/modules");
    await expect(page.getByRole("heading", { name: "Kies een module" })).toBeVisible();
  });

  test("unauthenticated module launcher visit redirects to login", async ({ page }) => {
    await page.goto("/modules");
    await page.waitForURL(`**${LOGIN_URL}`);
    await expect(page.getByPlaceholder("Gebruikersnaam")).toBeVisible();
  });

  test("valid login lands on module launcher; Directie-tegel opens dashboard, logout returns to login", async ({
    page,
  }) => {
    await page.goto(LOGIN_URL);
    await page.getByPlaceholder("Gebruikersnaam").fill("user1");
    await page.getByPlaceholder("Wachtwoord").fill("demo1234");
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.waitForURL("**/modules");
    await expect(page.getByRole("heading", { name: "Kies een module" })).toBeVisible();

    // Merk boven de kop (klantverzoek 14-08-2026): het hero-merkteken met de
    // doorlopende hartslag staat precies één keer op het scherm, de kopregel
    // houdt de gewone (eenmalige) lockup en de Directie-tegel draagt het
    // statische merkteken.
    await expect(page.locator('[data-careon-mark="loop"]')).toHaveCount(1);
    await expect(page.locator("header").locator('[data-careon-mark="once"]')).toHaveCount(1);
    await expect(page.getByRole("link", { name: /Careon Dashboard/ }).locator('[data-careon-mark="none"]')).toHaveCount(
      1,
    );
    await expect(page.getByRole("link", { name: /Facturatie/ }).locator("[data-careon-mark]")).toHaveCount(0);

    // YAAZ: met NEXT_PUBLIC_YAAZ_URL in de build is de tegel een externe link
    // naar de comms-plane; zonder die URL blijft het bewust "binnenkort" zonder
    // link. De assertie leest de gebouwde staat (build-time inlined env), zodat
    // de suite in beide omgevingsvormen geldig blijft.
    const yaazLink = page.getByRole("link", { name: /YAAZ/ });
    if ((await yaazLink.count()) > 0) {
      await expect(yaazLink).toBeVisible();
      await expect(yaazLink).toHaveAttribute("href", /^https?:\/\//);
    } else {
      // Gescoped op de YAAZ-kaart: een pagina-brede tekstassertie breekt in
      // strict mode zodra er ooit een tweede coming-soon-tegel bijkomt.
      const yaazKaart = page.locator('[aria-disabled="true"]').filter({ hasText: "YAAZ" });
      await expect(yaazKaart.getByText("Binnenkort beschikbaar")).toBeVisible();
    }

    // Facturatie-tegel (handoff 15): zichtbaar in demo (B12).
    await expect(page.getByRole("link", { name: /Facturatie/ })).toBeVisible();

    for (const name of ["Careon Academie/Academy", "Careon Kwaliteitshandboek"]) {
      const kaart = page.locator('[aria-disabled="true"]').filter({ hasText: name });
      await expect(kaart.getByText(name, { exact: true })).toBeVisible();
      await expect(kaart.getByText("Binnenkort beschikbaar")).toBeVisible();
      await expect(page.getByRole("link", { name, exact: false })).toHaveCount(0);
    }
    // Careon AI is bereikbaar via de tegel; de module bewaakt zelf haar
    // machtigingen en de organisatie-instellingen voor externe verwerking.
    await expect(page.getByRole("link", { name: /Careon AI/ })).toHaveAttribute("href", "/scribe");

    await page.getByRole("link", { name: /Careon Dashboard/ }).click();
    await page.waitForURL("**/dashboard/directiecockpit");
    await expect(page.getByRole("heading", { name: "Directiecockpit" })).toBeVisible();

    await page.evaluate(async () => {
      window.localStorage.setItem("careon-production-v1", '{"sensitive":true}');
      window.localStorage.setItem("careon-middelen-v2", '{"sensitive":true}');
      window.localStorage.setItem("careon-hr-v2", '{"sensitive":true}');
      window.localStorage.setItem("careon-facturatie-v1", '{"sensitive":true}');
      // Careon AI (handoff 20 §7.7): een consulttranscript is
      // bijzondere-categoriedata en mag geen browsersessie overleven.
      window.localStorage.setItem("careon-scribe-v1", '{"sensitive":true}');
      window.sessionStorage.setItem("careon-scribe-concept-synthetic", "synthetic clinical draft");
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
      facturatie: window.localStorage.getItem("careon-facturatie-v1"),
      scribe: window.localStorage.getItem("careon-scribe-v1"),
      scribeDraft: window.sessionStorage.getItem("careon-scribe-concept-synthetic"),
      sensitiveCache: (await window.caches.keys()).includes("careon-sensitive-test"),
    }));
    expect(cleared).toEqual({
      auth: null,
      session: null,
      production: null,
      middelen: null,
      hr: null,
      facturatie: null,
      scribe: null,
      scribeDraft: null,
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
    // Totale omzet-kopkaart (klantverzoek 2026-07-25): € 493K = som van de splitsing.
    await expect(page.getByText("Totale omzet")).toBeVisible();
    await expect(page.getByText("€ 493K", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Careon Insights").first()).toBeVisible();
    await expect(page.getByText("No-show daalde van 4,1% naar 3,4%", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Insight 2" }).click();
    await expect(page.getByText("Wachtlijst intake Roermond (15,2 wkn)", { exact: false })).toBeVisible();
  });

  test("compact desktop header stays inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByText(/TGC Groep · Alle locaties/)).toBeVisible();
    await expect(page.getByLabel("Alle filters")).toBeVisible();
    await expect(page.getByLabel("Periode")).toBeHidden();
    const bounds = await page.evaluate(() => {
      const identity = document.querySelector(".careon-topbar-identity")?.getBoundingClientRect();
      const actions = document.querySelector(".careon-topbar-actions")?.getBoundingClientRect();
      return identity && actions
        ? {
            identityWidth: identity.width,
            identityRight: identity.right,
            actionsLeft: actions.left,
            actionsRight: actions.right,
          }
        : null;
    });
    expect(bounds).not.toBeNull();
    expect(bounds?.identityWidth).toBeGreaterThan(100);
    expect(bounds?.identityRight ?? 0).toBeLessThanOrEqual((bounds?.actionsLeft ?? 0) + 1);
    expect(bounds?.actionsRight ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1024);
  });

  test("charts expose an Alles (full history) timeframe option", async ({ page }) => {
    // Klantverzoek 2026-07-25: naast 12m/6m/3m/1m een "Alles"-venster.
    const alles = page.getByLabel("Alle maanden").first();
    await expect(alles).toBeVisible();
    await alles.click();
    await expect(alles).toHaveAttribute("data-state", "on");
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

  test("Totale omzet card drills down to its detail page", async ({ page }) => {
    await page.getByRole("link", { name: "Totale omzet" }).click();
    await page.waitForURL("**/dashboard/details/omzettotaal");
    await expect(page.getByRole("heading", { name: "Totale omzet" })).toBeVisible();
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
    // De request-proxy valideert dynamische KPI-id's vóór de gestreamde
    // dashboard-layout, zodat ook deze in-segment fout een echte 404 blijft.
    const response = await page.goto("/dashboard/details/bestaat-niet");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Pagina niet gevonden")).toBeVisible();
  });
});

test.describe("signaleringen", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/signaleringen");
  });

  test("shows severity groups; the whole alert card routes to its domain page", async ({ page }) => {
    await expect(page.getByText("Kritiek — direct actie")).toBeVisible();
    await expect(page.getByText("Hoog — deze week")).toBeVisible();
    await expect(page.getByText("Middel — monitoren")).toBeVisible();
    await expect(page.getByText("Wachtlijst boven Treeknorm")).toBeVisible();
    // De hele kaart is nu klikbaar (niet alleen de "Bekijk"-knop).
    await page
      .getByRole("link", { name: /Wachtlijst boven Treeknorm/ })
      .first()
      .click();
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

  test("edited KPI value feeds its drill-down", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/hr");
    await page.getByLabel("Ziekteverzuim — huidige waarde").fill("4.2");
    await page
      .getByRole("link", { name: /Ziekteverzuim/ })
      .first()
      .click();
    await page.waitForURL("**/dashboard/details/verzuim");
    await expect(page.getByRole("heading", { name: "Ziekteverzuim" })).toBeVisible();
    await expect(page.getByText("4,2%", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("dezelfde waarde als op de HR-pagina", { exact: false })).toBeVisible();
    await expect(page.getByText("gewogen naar FTE", { exact: false })).toHaveCount(0);
  });

  test("edited KPI value feeds the deterministic assistant", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/hr");
    await page.getByLabel("Ziekteverzuim — huidige waarde").fill("4.2");
    await page.goto("/dashboard/assistent");
    await page.getByPlaceholder("Stel een vraag over de organisatie...").fill("Hoe staat het ziekteverzuim ervoor?");
    await page.getByRole("button", { name: "Bericht versturen" }).click();
    await expect(page.locator('[data-slot="aui_assistant-message-content"]').getByText(/4,2%/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Bron: actuele handmatige HR-registratie/)).toBeVisible();
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

  test("BIG changes retain expired registrations alongside live remaining days", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/hr");
    const { overDertigDagen, gisteren } = await page.evaluate(() => {
      const nu = new Date();
      const datum = (dagen: number) =>
        new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() + dagen)).toISOString().slice(0, 10);
      return { overDertigDagen: datum(30), gisteren: datum(-1) };
    });
    await page.getByLabel("Verloopdatum — L. Vermeer").fill(overDertigDagen);
    await page.getByLabel("Verloopdatum — T. Bakker").fill(gisteren);
    await page.goto("/dashboard/signaleringen");
    const alert = page.getByRole("link", {
      name: /BIG-registratie verlopen of <90 dgn/,
    });
    await expect(alert).toBeVisible();
    await expect(alert.getByText(/L\. Vermeer \(30 dgn\)/)).toBeVisible();
    await expect(alert.getByText(/T\. Bakker \(1 dgn verlopen\)/)).toBeVisible();
  });
});

test.describe("databron", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/databron");
    await expect(page.getByRole("heading", { name: "Databron" })).toBeVisible();
  });

  test("AI update entry point keeps the manual import workflow", async ({ page }) => {
    const aiUpdate = page.getByRole("button", { name: "Update imports through AI" });
    await expect(aiUpdate).toBeVisible();
    // The isolated suite runs in explicit demo mode; the live authenticated
    // smoke below verifies the enabled/job path. Demo must fail closed.
    await expect(aiUpdate).toBeDisabled();
    await expect(page.getByText("Sleep de cliëntendata-export hierheen of klik om te bladeren")).toBeVisible();
    await expect(page.locator('input[type="file"][accept*=".csv"]').first()).toBeAttached();
    await expect(page.getByText("De handmatige import hieronder blijft altijd beschikbaar.")).toBeVisible();
  });

  test("API preview flow is explicit and restores demo", async ({ page }) => {
    const activate = page.getByRole("button", { name: "Koppeling previewen" });
    await expect(activate).toBeEnabled();
    await activate.click();
    await expect(page.getByRole("button", { name: "Preview laden..." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview actief" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("API-preview", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("geen externe EPD-verbinding", { exact: false }).first()).toBeVisible();
    await expect(page.locator('[data-sidebar="menu-badge"]', { hasText: "PREVIEW" })).toBeVisible();

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

test.describe("facturatie (demo-pad, handoff 15)", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaSession(page);
  });

  test("lijst toont de demo-facturen met statusbadges", async ({ page }) => {
    await page.goto("/facturatie");
    await expect(page.getByRole("heading", { name: "Facturen" })).toBeVisible();
    await expect(page.getByRole("link", { name: "F2026-0001" })).toBeVisible();
    await expect(page.getByRole("link", { name: "F2026-0002" })).toBeVisible();
    await expect(page.getByText("Lokale demo-opslag", { exact: false }).first()).toBeVisible();

    // Statusfilter "Openstaand" (§4.2): uitgereikt maar onbetaald — de
    // verzonden seed blijft staan, de betaalde verdwijnt.
    await page.getByRole("button", { name: "Openstaand" }).click();
    await expect(page.getByRole("link", { name: "F2026-0001" })).toBeVisible();
    await expect(page.getByRole("link", { name: "F2026-0002" })).toHaveCount(0);
  });

  test("moduletegel navigeert daadwerkelijk naar /facturatie", async ({ page }) => {
    // De launcher-tegel zelf doorklikken: een verkeerde of ontbrekende href
    // passeerde de zichtbaarheidsassertie hierboven ongemerkt.
    await page.goto("/modules");
    await page.getByRole("link", { name: /Facturatie/ }).click();
    await page.waitForURL("**/facturatie");
    await expect(page.getByRole("heading", { name: "Facturen" })).toBeVisible();
  });

  test("concept bewerken: regel toevoegen, totalen en blob-pdf-voorbeeld", async ({ page }) => {
    await page.goto("/facturatie/demo-factuur-3");
    await expect(page.getByRole("heading", { name: "Nieuwe factuur" })).toBeVisible();

    await page.getByLabel("Omschrijving nieuwe factuurregel").fill("Extra reiskosten");
    await page.getByRole("button", { name: "Regel toevoegen" }).click();
    // demo-factuur-3 heeft twee seedregels; de toevoeging wordt regel 3.
    await expect(page.getByLabel("Omschrijving — regel 3")).toHaveValue("Extra reiskosten");
    await expect(page.getByText("Subtotaal excl. btw")).toBeVisible();

    // Het live voorbeeld ís de pdf: een same-origin blob in een iframe.
    await expect(page.locator('iframe[title="Voorbeeld van de factuur"]')).toHaveAttribute("src", /^blob:/, {
      timeout: 15_000,
    });
  });

  test("concept verwijderen vanuit de editor keert terug naar de lijst", async ({ page }) => {
    await page.goto("/facturatie/demo-factuur-3");
    await expect(page.getByRole("heading", { name: "Nieuwe factuur" })).toBeVisible();
    await page.getByRole("button", { name: "Concept verwijderen" }).click();
    await page.waitForURL("**/facturatie");
    // Het enige seed-concept is weg; de uitgereikte facturen blijven staan.
    await expect(page.getByRole("link", { name: "F2026-0001" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Concept", exact: true })).toHaveCount(0);
  });

  test("definitief maken kent het volgende demo-nummer toe en wordt read-only", async ({ page }) => {
    await page.goto("/facturatie");
    await page.getByRole("button", { name: "Nieuwe factuur" }).click();
    await page.waitForURL("**/facturatie/lokaal-*");

    await page.getByLabel("Afnemer (contact)").selectOption({ label: "Zorggroep De Linde B.V." });
    await page.getByLabel("Prestatie van").fill("2026-06-01");
    await page.getByLabel("Prestatie t/m").fill("2026-06-30");
    await page.getByLabel("Omschrijving nieuwe factuurregel").fill("Consult op locatie");
    await page.getByRole("button", { name: "Regel toevoegen" }).click();
    await page.getByLabel("Stukprijs — Consult op locatie").fill("120");

    // Totalenwaarden, niet alleen het label: 21% (demo-standaardsjabloon)
    // over € 120,00 ⇒ € 145,20 — de btw-regel benoemt de grondslag (sub h).
    await expect(page.getByText(/Btw 21% over/)).toBeVisible();
    await expect(page.getByText(/145,20/)).toBeVisible();

    await page.getByRole("button", { name: "Definitief maken" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Definitief maken" }).click();

    // Demo-teller staat op 2 (twee uitgereikte seeds) → volgende is 0003.
    await expect(page.getByRole("heading", { name: "F2026-0003" })).toBeVisible();
    await expect(page.getByText("Deze factuur is uitgereikt", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verzonden markeren" })).toBeVisible();
    // Download loopt in demo via de client-blob van het voorbeeld. De native
    // bestandsbrug gebruikt nu één knop voor browserdownload en shell-opslag.
    const pdfDownload = page.getByRole("button", { name: "Pdf downloaden" });
    await expect(pdfDownload).toBeEnabled({ timeout: 15_000 });
    // Headless shell also downloads PDF iframe previews while rendering.
    // Only the named download requested by this button proves this action.
    const downloadPromise = page.waitForEvent("download", {
      predicate: (download) => download.suggestedFilename() === "F2026-0003.pdf",
    });
    await pdfDownload.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("F2026-0003.pdf");
  });

  test("factuur per e-mail versturen (fase B, demo-simulatie)", async ({ page }) => {
    await page.goto("/facturatie/demo-factuur-1");
    // Ontvanger vooringevuld uit de afnemer-snapshot; demo simuleert de
    // verzending (geen provider) en werkt status + maillog lokaal bij.
    await expect(page.getByLabel("Ontvanger (e-mailadres)")).toHaveValue("administratie@zorggroepdelinde.nl");
    await page.getByRole("button", { name: "Versturen per e-mail" }).click();
    await expect(page.getByText(/Per e-mail verzonden op/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Opnieuw versturen" })).toBeVisible();
  });

  test("instellingen: sjabloonbibliotheek opent detailweergave per sjabloon", async ({ page }) => {
    await page.goto("/facturatie/instellingen");
    // Lijstweergave eerst (multi-template): beide demo-sjablonen zichtbaar,
    // careongroup als standaard gemarkeerd.
    await expect(page.getByRole("heading", { name: "Facturatie-instellingen" })).toBeVisible();
    // Gescoped op main: de moduleschil toont de organisatienaam ("TGC Groep")
    // ook in de kopregel.
    const inhoud = page.getByRole("main");
    await expect(inhoud.getByText("Careon Group", { exact: true })).toBeVisible();
    await expect(inhoud.getByText("TGC Groep", { exact: true })).toBeVisible();
    await expect(inhoud.getByText("Standaard", { exact: true })).toBeVisible();

    // Detailweergave van het ingebouwde ontwerp-sjabloon.
    await page.getByRole("button", { name: "Openen" }).first().click();
    await expect(page.getByRole("heading", { name: "Careon Group" })).toBeVisible();
    await expect(page.getByLabel("KvK-nummer (8 cijfers)")).toHaveValue("12345678");
    await expect(page.getByText("Ingebouwd Careon Group-logo")).toBeVisible();

    await page.getByRole("button", { name: "Alle sjablonen" }).click();
    await expect(inhoud.getByText("TGC Groep", { exact: true })).toBeVisible();
  });

  test("editor: factuur wisselt van sjabloon", async ({ page }) => {
    await page.goto("/facturatie/demo-factuur-3");
    const kiezer = page.getByLabel("Factuursjabloon");
    // Zonder keuze geldt het standaardsjabloon (careongroup).
    await expect(kiezer).toHaveValue("careongroup");
    await kiezer.selectOption({ label: "TGC Groep" });
    await expect(kiezer).toHaveValue("tgc-groep");
    // De sjabloonkeuze overleeft de demo-autosave + herladen.
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(page.getByLabel("Factuursjabloon")).toHaveValue("tgc-groep");
  });

  test("contacten: toevoegen, bewerken, verwijderen en medewerker overnemen", async ({ page }) => {
    await page.goto("/facturatie/contacten");
    await expect(page.getByRole("heading", { name: "Contacten" })).toBeVisible();

    await page.getByLabel("Naam nieuw contact").fill("Testcontact E2E");
    await page.getByRole("button", { name: "Contact toevoegen" }).click();
    await expect(page.getByLabel("Naam — Testcontact E2E")).toBeVisible();

    await page.getByLabel("Plaats — Testcontact E2E").fill("Tilburg");
    await page.getByLabel("Plaats — Testcontact E2E").blur();

    // Aanvullende velden (Uzovi, KvK, btw-id, AGB, betaaltermijn, telefoon,
    // tweede adresregel, notitie) zitten achter de "Details"-uitklapregel.
    await expect(page.getByLabel("Uzovi-code — Testcontact E2E")).toHaveCount(0);
    await page.getByLabel("Details — Testcontact E2E").click();

    // Uzovi: 4 cijfers — een te korte code committeert niet en meldt inline.
    await page.getByLabel("Uzovi-code — Testcontact E2E").fill("12");
    await page.getByLabel("Uzovi-code — Testcontact E2E").blur();
    await expect(page.getByText("Uzovi-code bestaat uit 4 cijfers.")).toBeVisible();
    await page.getByLabel("Uzovi-code — Testcontact E2E").fill("7029");
    await page.getByLabel("Uzovi-code — Testcontact E2E").blur();
    await expect(page.getByText("Uzovi-code bestaat uit 4 cijfers.")).toHaveCount(0);

    // Betaaltermijn: geheel getal 0 t/m 180.
    await page.getByLabel("Betaaltermijn (dagen) — Testcontact E2E").fill("200");
    await page.getByLabel("Betaaltermijn (dagen) — Testcontact E2E").blur();
    await expect(page.getByText("Betaaltermijn is een geheel getal van 0 t/m 180 dagen.")).toBeVisible();
    await page.getByLabel("Betaaltermijn (dagen) — Testcontact E2E").fill("45");
    await page.getByLabel("Betaaltermijn (dagen) — Testcontact E2E").blur();
    await expect(page.getByText("Betaaltermijn is een geheel getal van 0 t/m 180 dagen.")).toHaveCount(0);

    // Dicht- en weer openklappen leest opnieuw uit de opslag.
    await page.getByLabel("Details — Testcontact E2E").click();
    await expect(page.getByLabel("Uzovi-code — Testcontact E2E")).toHaveCount(0);
    await page.getByLabel("Details — Testcontact E2E").click();
    await expect(page.getByLabel("Uzovi-code — Testcontact E2E")).toHaveValue("7029");
    await expect(page.getByLabel("Betaaltermijn (dagen) — Testcontact E2E")).toHaveValue("45");

    await page.getByLabel("Verwijder Testcontact E2E uit de contacten").click();
    await expect(page.getByLabel("Naam — Testcontact E2E")).toHaveCount(0);

    // Medewerkers-unie (B11): overnemen maakt een los contact aan.
    await page.getByRole("button", { name: "Overnemen als contact" }).first().click();
    await expect(page.getByText("al contact").first()).toBeVisible();
  });
});

test.describe("scribe (demo-pad, handoff 20)", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaSession(page);
  });

  test("microfoonpolicy geldt uitsluitend onder /scribe", async ({ page }) => {
    // §8/S16: de scribe-headerentry VERVANGT de algemene Permissions-Policy,
    // hij komt er niet naast. Daarom worden de daadwerkelijke responseheaders
    // geteld — één regel per document — en niet alleen de inhoud gelezen.
    const permissionsPolicies = async (route: string) => {
      const response = await page.request.get(route);
      expect(response.status(), route).toBe(200);
      return response
        .headersArray()
        .filter((header) => header.name.toLowerCase() === "permissions-policy")
        .map((header) => header.value);
    };

    const cockpit = await permissionsPolicies("/dashboard/directiecockpit");
    expect(cockpit).toHaveLength(1);
    expect(cockpit[0]).toContain("microphone=()");

    const lijst = await permissionsPolicies("/scribe");
    expect(lijst).toHaveLength(1);
    expect(lijst[0]).toContain("microphone=(self)");
    expect(lijst[0]).toContain("camera=()");

    const werkruimte = await permissionsPolicies("/scribe/demo-consult-1");
    expect(werkruimte).toHaveLength(1);
    expect(werkruimte[0]).toContain("microphone=(self)");
  });

  test("Careon AI-tegel opent consulten met een nieuw document en microfoontoestemming", async ({ page }) => {
    await page.goto("/modules");
    const tegel = page.getByRole("link", { name: /Careon AI/ });
    await expect(tegel).toHaveAttribute("href", "/scribe");
    await expect(tegel.getByText("Binnenkort beschikbaar")).toHaveCount(0);

    // De tegel zelf moet een nieuw document laden: een Next-link behoudt de
    // microfoonblokkade van /modules en breekt de opnamewerkruimte.
    await tegel.click();
    await page.waitForURL("**/scribe");
    await expect(page.getByRole("heading", { name: "Consulten" })).toBeVisible();

    // Bewijs dát het een documentlading was: bij clientnavigatie zou de
    // navigation-entry nog /modules heten (en zou microphone=() blijven gelden).
    const navigatieBron = await page.evaluate(() => performance.getEntriesByType("navigation")[0]?.name ?? null);
    expect(navigatieBron).toContain("/scribe");

    // De toegekende policy is in het document zelf zichtbaar; de API ontbreekt
    // in oudere engines, dan blijft alleen de headerassertie hierboven over.
    const microfoonToegestaan = await page.evaluate(() => {
      const doc = document as Document & {
        permissionsPolicy?: { allowsFeature(feature: string): boolean };
        featurePolicy?: { allowsFeature(feature: string): boolean };
      };
      const policy = doc.permissionsPolicy ?? doc.featurePolicy;
      return policy ? policy.allowsFeature("microphone") : null;
    });
    if (microfoonToegestaan !== null) expect(microfoonToegestaan).toBe(true);

    await expect(page.getByText("Lokale demo-opslag", { exact: false }).first()).toBeVisible();

    // Drie demo-consulten met hun statusbadges (§7.7). Gescoped op de tabel:
    // de mobiele kaartlijst staat op desktop wél in de DOM (md:hidden).
    const tabel = page.getByRole("table");
    const rij = (referentie: string) => tabel.getByRole("row").filter({ hasText: referentie });
    await expect(rij("D-2026-0417")).toContainText("Actief");
    await expect(rij("D-2026-0392")).toContainText("Te beoordelen");
    await expect(rij("D-2026-0355")).toContainText("Overgenomen");

    await page.getByRole("button", { name: "Te beoordelen" }).click();
    await expect(rij("D-2026-0392")).toBeVisible();
    await expect(tabel.getByText("D-2026-0417")).toHaveCount(0);
  });

  test("lijst: zoeken op dossierreferentie, BSN-term geweigerd, 1-gebaseerde paginering", async ({ page }) => {
    await page.goto("/scribe");
    const tabel = page.getByRole("table");
    const rij = (referentie: string) => tabel.getByRole("row").filter({ hasText: referentie });
    await expect(rij("D-2026-0417")).toBeVisible();

    // N16 — zoeken op een deel van de dossierreferentie (debounce van 300 ms).
    const zoek = page.getByLabel("Zoek op dossierreferentie");
    await zoek.fill("0392");
    await expect(rij("D-2026-0392")).toBeVisible();
    await expect(tabel.getByText("D-2026-0417")).toHaveCount(0);

    // S3 — een BSN-vormige term wordt geweigerd en gaat nooit als filter mee:
    // de lijst valt terug op ongefilterd in plaats van op nul treffers.
    await zoek.fill("123456782");
    await expect(
      page.getByText("Gebruik een deel van het dossiernummer; nooit een BSN of geboortedatum."),
    ).toBeVisible();
    await expect(rij("D-2026-0417")).toBeVisible();
    await zoek.fill("");
    await expect(rij("D-2026-0355")).toBeVisible();

    // C31 — de paginering is 1-GEBASEERD; met een 0-gebaseerde teller leverde
    // "Volgende" tweemaal dezelfde eerste pagina. Daarvoor zijn meer dan 25
    // consulten nodig, dus de demo-opslag krijgt er hier extra rijen bij.
    await page.evaluate(() => {
      const raw = window.localStorage.getItem("careon-scribe-v1");
      if (raw === null) throw new Error("demo-opslag ontbreekt");
      const state = JSON.parse(raw) as { sessies: Record<string, unknown>[] };
      const basis = state.sessies[0];
      for (let index = 0; index < 30; index += 1) {
        state.sessies.push({
          ...basis,
          id: `demo-extra-${index}`,
          patientReferentie: `D-2026-9${String(index).padStart(3, "0")}`,
          // Ouder dan de drie demo-consulten, zodat de sortering vastligt.
          createdAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000).toISOString(),
        });
      }
      window.localStorage.setItem("careon-scribe-v1", JSON.stringify(state));
    });
    await page.reload();
    await expect(page.getByText("Pagina 1")).toBeVisible();
    await expect(rij("D-2026-0417")).toBeVisible();

    await page.getByRole("button", { name: "Volgende" }).click();
    await expect(page.getByText("Pagina 2")).toBeVisible();
    await expect(rij("D-2026-9000")).toBeVisible();
    await expect(tabel.getByText("D-2026-0417")).toHaveCount(0);

    await page.getByRole("button", { name: "Vorige" }).click();
    await expect(page.getByText("Pagina 1")).toBeVisible();
    await expect(rij("D-2026-0417")).toBeVisible();
  });

  test("nieuw consult eist toestemming en weigert een BSN-vormige referentie", async ({ page }) => {
    await page.goto("/scribe");
    await page.getByRole("button", { name: "Nieuw consult" }).click();
    await expect(page.getByRole("heading", { name: "Nieuw consult" })).toBeVisible();
    // De instellingen zijn geladen zodra het standaardformaat staat; pas dan
    // draagt het formulier de juiste consentrevisie (S13, anders 409).
    await expect(page.getByLabel("Consulttype")).toHaveValue("psychiatrie");

    // N10 — de plaatshouder is ingevuld met de werkelijke transcripttermijn;
    // de cliënt hoort nooit een `{…}` of een termijn die niet geldt.
    await expect(
      page.getByText("de uitgeschreven transcripttekst 30 dagen bewaard blijft", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("{transcriptRetentieDagen}", { exact: false })).toHaveCount(0);

    const starten = page.getByRole("button", { name: "Consult starten" });
    await expect(starten).toBeDisabled();
    await expect(
      page.getByText("Zonder aangevinkte toestemmingsverklaring kan er geen consult starten."),
    ).toBeVisible();

    // S3: een BSN-vormige reeks wordt geweigerd, met melding.
    await page.getByLabel("Dossierreferentie", { exact: true }).fill("123456782");
    await expect(page.getByText("Deze dossierreferentie is niet toegestaan.", { exact: false })).toBeVisible();
    await expect(starten).toBeDisabled();

    await page.getByLabel("Dossierreferentie", { exact: true }).fill("D-2026-0512");
    await expect(page.getByText("Deze dossierreferentie is niet toegestaan.", { exact: false })).toHaveCount(0);
    // Geldige referentie, nog steeds geen toestemming: blijft geblokkeerd.
    await expect(starten).toBeDisabled();

    await page.getByLabel(/De cliënt is geïnformeerd/).click();
    await expect(starten).toBeEnabled();
    await starten.click();

    await page.waitForURL(/\/scribe\/lokaal-/);
    await expect(page.getByRole("heading", { name: /D-2026-0512/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Transcript" }).getByText("Nog geen transcript.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Volledig afspelen" })).toBeVisible();
  });

  test("werkruimte: getempode demo-opname, volledig afspelen, aanwijzingen en verouderde analyse", async ({ page }) => {
    await page.goto("/scribe/demo-consult-1");
    await expect(page.getByRole("heading", { name: /D-2026-0417/ })).toBeVisible();

    // C20/S14 — "Demo-opname" speelt het gescripte consult getempo af
    // (DEMO_SEGMENT_INTERVAL_MS = 1,5 s). Een paar seconden volstaan als bewijs;
    // de rest gaat via "Volledig afspelen".
    const transcript = page.getByRole("region", { name: "Transcript" });
    await page.getByRole("button", { name: "Demo-opname", exact: true }).click();
    await expect
      .poll(async () => transcript.locator('li[id^="scribe-segment-"]').count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Demo-opname stoppen" }).click();
    await expect(page.getByRole("button", { name: "Demo-opname", exact: true })).toBeVisible();

    // "Volledig afspelen" zet de rest van het consult in één keer neer en
    // analyseert daarna deterministisch.
    await page.getByRole("button", { name: "Volledig afspelen" }).click();
    await expect(transcript.getByText("30 regels")).toBeVisible();
    await expect(page.getByText("Het Nederlandse demo-consult is volledig afgespeeld")).toBeVisible();

    // Paneel B — gestructureerde consultstaat uit de deterministische laag.
    const notities = page.getByRole("region", { name: "AI-notities" });
    await expect(notities.getByText("Hoofdklacht")).toBeVisible();
    await expect(notities.getByText("somberheid", { exact: true }).first()).toBeVisible();
    await expect(notities.getByText("drie maanden", { exact: true })).toBeVisible();
    await expect(notities.getByText("sertraline 50 mg (huidig)")).toBeVisible();
    await expect(notities.getByText("Deterministische analyse").or(notities.getByText("Demo")).first()).toBeVisible();

    // Paneel C — gecontroleerde regel apart van de (hier lege) AI-signalen.
    const aanwijzingen = page.getByRole("region", { name: "Klinische aanwijzingen" });
    await expect(aanwijzingen.getByText("Gecontroleerde medicatieregels")).toBeVisible();
    await expect(
      aanwijzingen.getByText(
        "Mogelijke interactie sertraline × tramadol: verhoogd risico op serotonerge toxiciteit (serotoninesyndroom). Controleer vóór voorschrijven.",
      ),
    ).toBeVisible();
    await expect(aanwijzingen.getByText("Farmacotherapeutisch Kompas", { exact: false })).toBeVisible();
    await expect(aanwijzingen.getByText("Geen AI-signalen.")).toBeVisible();

    // S10: risicocategorie zonder polariteit — het checklist-item schuift naar
    // "besproken" en verdwijnt nooit.
    await expect(aanwijzingen.getByText("Suïcidaliteit uitvragen — besproken")).toBeVisible();
    await expect(aanwijzingen.getByText("Beoordeling door behandelaar vereist")).toBeVisible();
    await expect(
      aanwijzingen.getByText(
        "Dit zou kunnen passen bij een depressieve episode, maar ik wil een schildklierafwijking uitsluiten.",
      ),
    ).toBeVisible();
    await expect(
      aanwijzingen.getByText("De rugpijn en de tramadol beïnvloeden mogelijk ook het slapen."),
    ).toBeVisible();

    // S8: een sprekercorrectie op een geanalyseerd segment veroudert de analyse
    // en dwingt heranalyse af.
    await transcript.getByRole("button", { name: /^Spreker van regel 1: Arts/ }).click();
    await page.getByRole("menuitem", { name: "Bevestig Patiënt voor regel 1" }).click();
    await expect(
      transcript.getByRole("button", { name: "Spreker van regel 1: Patiënt · bevestigd — kiezen en bevestigen" }),
    ).toBeVisible();
    await expect(
      notities.getByText("Analyse verouderd sinds uw correctie — opnieuw analyseren voordat u het verslag opstelt."),
    ).toBeVisible();
    await notities.getByRole("button", { name: "Opnieuw analyseren" }).click();
    await expect(notities.getByRole("button", { name: "Nu analyseren" })).toBeVisible();
    await expect(notities.getByText("Analyse verouderd", { exact: false })).toHaveCount(0);

    // Afronden schakelt over naar de verslagreview van hetzelfde consult.
    await page.getByRole("button", { name: "Consult afronden" }).click();
    const verslag = page.getByRole("region", { name: "Verslag" });
    await expect(verslag.getByRole("heading", { name: "Reden van komst" })).toBeVisible();
    await expect(verslag.getByRole("heading", { name: "Risicotaxatie" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Consult afronden" })).toHaveCount(0);
  });

  test("consultstaat corrigeren: feit intrekken en de EPD-lijst overnemen", async ({ page }) => {
    await page.goto("/scribe/demo-consult-1");
    await page.getByRole("button", { name: "Volledig afspelen" }).click();

    const notities = page.getByRole("region", { name: "AI-notities" }).first();
    await expect(notities.getByText("tramadol (huidig)")).toBeVisible();

    // N6/S7 — intrekken haalt het feit uit het verslag, maar laat de regel
    // doorgehaald staan: een weglating mag nooit stil gebeuren.
    await notities.getByRole("button", { name: "Intrekken: tramadol (huidig)" }).click();
    await expect(notities.getByRole("button", { name: "Intrekken: tramadol (huidig)" })).toHaveCount(0);
    await expect(notities.locator("li").filter({ hasText: "tramadol (huidig)" }).first()).toHaveClass(/line-through/);

    // N6 — de geplakte EPD-lijst gaat door dezelfde deterministische extractie
    // als het transcript; alleen de gevonden feiten belanden in de staat.
    await notities.getByRole("button", { name: "EPD-lijst plakken" }).click();
    await notities
      .getByLabel("Actuele medicatie & allergieën uit het EPD")
      .fill("lorazepam 1 mg zo nodig\nlithium 400 mg dagelijks\nAllergie voor amoxicilline");
    await notities.getByRole("button", { name: "Lijst overnemen" }).click();
    await expect(page.getByText(/2 middel\(en\) en 1 allergie\(ën\) uit het EPD toegevoegd/)).toBeVisible();
    await expect(notities.getByText("lorazepam 1 mg (huidig)")).toBeVisible();
    await expect(notities.getByText("Zelf aangevuld").first()).toBeVisible();
    await expect(notities.getByText("lithium 400 mg (huidig)")).toBeVisible();
    await expect(notities.getByText("Beoordeeld", { exact: true })).toHaveCount(0);
    const epdBeoordeling = notities.getByLabel(
      "Ik heb de actuele medicatie- en allergielijst uit het EPD gecontroleerd, inclusief ontbrekende middelen.",
    );
    await epdBeoordeling.click();
    await expect(epdBeoordeling).toBeChecked();
    await expect(notities.getByText("Beoordeeld", { exact: true })).toBeVisible();
    await expect(page.getByText(/dit is geen volledige medicatiebewaking/)).toBeVisible();
  });

  test("handmatige invoer blijft behouden tijdens verzenden en blokkeert afronden", async ({ page }) => {
    await page.goto("/scribe/demo-consult-1");
    const veld = page.getByLabel("Gesprekstekst handmatig toevoegen", { exact: true });
    let release: () => void = () => undefined;
    let markSeen: () => void = () => undefined;
    const seen = new Promise<void>((resolve) => {
      markSeen = resolve;
    });
    await page.route("**/api/careon/scribe/sessies/demo-consult-1/segmenten", async (route) => {
      markSeen();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ status: 501, contentType: "application/json", body: '{"demo":true}' });
    });
    await veld.fill("Eerste synthetische zin.");
    await expect(page.getByRole("button", { name: "Consult afronden", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Regel toevoegen", exact: true }).click();
    await seen;
    await veld.fill("Tweede synthetische zin tijdens verzenden.");
    release();
    await expect(page.getByRole("region", { name: "Transcriptregels" })).toContainText("Eerste synthetische zin.");
    await expect(veld).toHaveValue("Tweede synthetische zin tijdens verzenden.");
    await expect(page.getByRole("button", { name: "Consult afronden", exact: true })).toBeDisabled();
    await page.unroute("**/api/careon/scribe/sessies/demo-consult-1/segmenten");
    await page.getByRole("button", { name: "Regel toevoegen", exact: true }).click();
    await expect(veld).toHaveValue("");
    await expect(page.getByRole("button", { name: "Consult afronden", exact: true })).toBeEnabled();
  });

  test("annuleren wist handmatige concepten", async ({ page }) => {
    await page.goto("/scribe/demo-consult-1");
    await page
      .getByLabel("Gesprekstekst handmatig toevoegen", { exact: true })
      .fill("Synthetisch concept voor intrekking.");
    await page.getByRole("button", { name: "Annuleren", exact: true }).click();
    await page.getByRole("button", { name: "Consult annuleren", exact: true }).click();
    await expect(page.getByRole("button", { name: "Consult afronden", exact: true })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("careon-scribe-concept-demo-consult-1")))
      .toBeNull();
  });

  test("verslagreview: beoordelingssecties blijven van de behandelaar, daarna overname in het EPD", async ({
    page,
  }) => {
    await page.goto("/scribe/demo-consult-2");
    const verslag = page.getByRole("region", { name: "Verslag" });
    const sectie = (titel: string) =>
      page.getByRole("article").filter({ has: page.getByRole("heading", { name: titel }) });

    // N7 — de deterministische secties dragen lopende zinnen, geen opsomming
    // van trefwoorden.
    await expect(sectie("Reden van komst").getByRole("textbox", { name: "Reden van komst" })).toHaveValue(
      /^Cliënt meldt somberheid sinds drie maanden/,
    );

    await expect(verslag.getByRole("button", { name: "Kopieer sectie" })).toHaveCount(0);

    // S10/N3: ★-secties komen leeg binnen, met citaten uit hún eigen onderwerp —
    // de risicotaxatie citeert het risicosegment (§13), niet de overwegingen.
    const risicotaxatie = sectie("Risicotaxatie");
    await expect(risicotaxatie.getByText("Leeg", { exact: true })).toBeVisible();
    await expect(risicotaxatie.getByText("Uitspraken hierover in dit consult: §13")).toBeVisible();
    await expect(risicotaxatie.getByRole("textbox", { name: "Risicotaxatie" })).toHaveValue("");
    await expect(sectie("Overwegingen").getByText("Uitspraken hierover in dit consult: §23, §24")).toBeVisible();

    // "Alles goedkeuren" slaat ze over en meldt dat. De dialoog sluit zichzelf:
    // de actieknop roept alleen preventDefault aan zolang een bevestiging
    // ontbreekt, en dit demo-consult heeft geen ontbrekende fragmenten.
    await verslag.getByRole("button", { name: "Alles goedkeuren" }).click();
    const goedkeurDialoog = page.getByRole("alertdialog");
    // N22 — het gatenvinkje verschijnt uitsluitend bij ontbrekende fragmenten.
    await expect(goedkeurDialoog.getByLabel("Ik heb de ontbrekende fragmenten aangevuld of beoordeeld.")).toHaveCount(
      0,
    );
    await goedkeurDialoog.getByRole("button", { name: "Goedkeuren" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(
      page.getByText("2 beoordelingssecties zijn overgeslagen: schrijf en keur die zelf goed."),
    ).toBeVisible();
    await expect(sectie("Reden van komst").getByText("Goedgekeurd", { exact: true })).toBeVisible();
    await expect(risicotaxatie.getByText("Leeg", { exact: true })).toBeVisible();

    // Zelf schrijven en per sectie goedkeuren; pas dan is het verslag vast.
    for (const titel of ["Risicotaxatie", "Overwegingen"]) {
      const blok = sectie(titel);
      const veld = blok.getByRole("textbox", { name: titel });
      await veld.fill(`${titel}: beoordeling door de behandelaar, vastgesteld tijdens het consult.`);
      await veld.press("Tab");
      await expect(blok.getByText("Bewerkt", { exact: true })).toBeVisible();
      await blok.getByRole("button", { name: "Goedkeuren" }).click();
      await expect(blok.getByText("Goedgekeurd", { exact: true })).toBeVisible();
      if (titel === "Risicotaxatie") {
        await expect(
          page.getByText("1 beoordelingssectie is overgeslagen: schrijf en keur die zelf goed."),
        ).toBeVisible();
      }
    }

    await expect(page.getByText("Dit verslag is goedgekeurd.", { exact: false })).toBeVisible();
    await expect(
      page.getByText(/beoordelingssecties? (?:is|zijn) overgeslagen: schrijf en keur die zelf goed/),
    ).toHaveCount(0);

    // S2/N14: overname kan pas nadat het verslag ergens anders terecht kán
    // komen. "Verslagtekst tonen" is de derde, altijd werkende weg naast
    // kopiëren en downloaden.
    const overgenomen = page.getByRole("button", { name: "Overgenomen in het EPD" });
    await expect(overgenomen).toBeDisabled();
    await expect(
      page.getByText(
        "Kopieer of download het volledige actuele verslag eerst; pas daarna kunt u de overname bevestigen.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Verslagtekst tonen" }).click();
    await expect(page.getByRole("textbox", { name: "Verslagtekst" })).toBeVisible();
    await expect(overgenomen).toBeDisabled();

    // C28 — de bestandsnaam draagt de consultdatum, niet vandaag.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Downloaden (.txt)" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().startsWith("consult-")).toBe(true);
    expect(download.suggestedFilename().endsWith(".txt")).toBe(true);
    await expect(overgenomen).toBeEnabled();
    const exportChannels = await page.evaluate(() => {
      const state = JSON.parse(window.localStorage.getItem("careon-scribe-v1") ?? "{}");
      return state.logboek
        .filter((row: { handeling: string }) => row.handeling === "scribe.export")
        .map((row: { detail: { kanaal?: string } }) => row.detail.kanaal);
    });
    expect(exportChannels).toContain("bestand");
    expect(exportChannels).not.toContain("klembord");

    await overgenomen.click();
    const dialoog = page.getByRole("alertdialog");
    // Dialoogtekst afgeleid uit berekenRetentie + de organisatie-instellingen.
    await expect(dialoog.getByText("Het transcript wordt direct gewist", { exact: false })).toBeVisible();
    await expect(dialoog.getByText("het verslag blijft zichtbaar tot", { exact: false })).toBeVisible();
    const bevestigen = dialoog.getByRole("button", { name: "Bevestigen" });
    await expect(bevestigen).toBeDisabled();
    await dialoog.getByLabel("Ik heb het verslag in het EPD opgeslagen").click();
    await expect(bevestigen).toBeEnabled();
    await bevestigen.click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // S15: het transcript is direct weg, het goedgekeurde verslag blijft.
    await expect(page.getByRole("region", { name: "Transcript" }).getByText("Nog geen transcript.")).toBeVisible();
    await expect(verslag.getByRole("heading", { name: "Reden van komst" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Overgenomen in het EPD" })).toHaveCount(0);
  });

  test("verslagformaat wisselen genereert het verslag opnieuw in het gekozen formaat", async ({ page }) => {
    await page.goto("/scribe/demo-consult-2");
    const verslag = page.getByRole("region", { name: "Verslag" });
    await expect(verslag.getByRole("heading", { name: "Reden van komst" })).toBeVisible();
    await expect(verslag.getByText("Versie 1")).toBeVisible();

    // N18 — het formaat is tot de goedkeuring te wisselen.
    await page.getByLabel("Verslagformaat").selectOption("verpleegkundig");
    await page.getByRole("button", { name: "Verslag opnieuw genereren" }).click();

    await expect(verslag.getByText("Versie 2")).toBeVisible();
    await expect(verslag.getByRole("heading", { name: "Observaties" })).toBeVisible();
    await expect(verslag.getByRole("heading", { name: "Reden van komst" })).toHaveCount(0);

    // N4 — ook de verpleegkundige rapportage heeft een ★-sectie, dus "Alles
    // goedkeuren" kan haar niet in twee klikken definitief maken.
    const evaluatie = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "Reactie & evaluatie" }) });
    await expect(evaluatie.getByText("Beoordeling door behandelaar")).toBeVisible();
    await expect(evaluatie.getByRole("textbox", { name: "Reactie & evaluatie" })).toHaveValue("");
  });

  test("werkkopie wissen na afronden wist transcript en verslag", async ({ page }) => {
    await page.goto("/scribe/demo-consult-2");
    await expect(page.getByRole("region", { name: "Verslag" }).getByRole("heading", { name: "Beleid" })).toBeVisible();

    // N11 — de cliënt kan de toestemming ná het consult intrekken; de grond
    // gaat metadata-only mee in het logboek.
    await page.getByRole("button", { name: "Toestemming ingetrokken — werkkopie wissen" }).click();
    const dialoog = page.getByRole("alertdialog");
    await dialoog.getByLabel("Grond").selectOption("toestemming_ingetrokken");
    await dialoog.getByRole("button", { name: "Werkkopie wissen" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    await expect(page.getByRole("region", { name: "Transcript" }).getByText("Nog geen transcript.")).toBeVisible();
    await expect(page.getByText("Er is nog geen verslag opgesteld voor dit consult.")).toBeVisible();

    await page.goto("/scribe");
    const tabel = page.getByRole("table");
    await expect(tabel.getByRole("row").filter({ hasText: "D-2026-0392" })).toContainText("Geannuleerd");
  });

  test("vrijgave gaat alleen naar gemachtigde collega's en is intrekbaar", async ({ page }) => {
    await page.goto("/scribe/demo-consult-2");
    const verslag = page.getByRole("region", { name: "Verslag" });
    const sectie = (titel: string) =>
      page.getByRole("article").filter({ has: page.getByRole("heading", { name: titel }) });

    await verslag.getByRole("button", { name: "Alles goedkeuren" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Goedkeuren" }).click();
    for (const titel of ["Risicotaxatie", "Overwegingen"]) {
      const blok = sectie(titel);
      const veld = blok.getByRole("textbox", { name: titel });
      await veld.fill(`${titel}: beoordeling door de behandelaar.`);
      await veld.press("Tab");
      await blok.getByRole("button", { name: "Goedkeuren" }).click();
      await expect(blok.getByText("Goedgekeurd", { exact: true })).toBeVisible();
    }
    await expect(page.getByText("Dit verslag is goedgekeurd.", { exact: false })).toBeVisible();

    await page.goto("/scribe");
    const tabel = page.getByRole("table");
    const rij = tabel.getByRole("row").filter({ hasText: "D-2026-0392" });
    await expect(rij).toContainText("Goedgekeurd");

    // N11/S12 — de keuzelijst toont uitsluitend GEMACHTIGDE collega's, en nooit
    // de handelende gebruiker zelf.
    await rij.getByRole("button", { name: "Verslag vrijgeven" }).click();
    const vrijgave = page.getByRole("alertdialog");
    const collega = vrijgave.getByLabel("Collega");
    await expect(collega.locator("option")).toHaveText([/S\. de Wit/]);
    await expect(collega.getByText("J. Bakker")).toHaveCount(0);
    await expect(collega.getByText("Demo Behandelaar")).toHaveCount(0);

    await vrijgave.getByLabel("Reden").fill("Behandelaar uit dienst per 1 oktober.");
    await vrijgave.getByRole("button", { name: "Vrijgeven" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByText("Het goedgekeurde verslag is vrijgegeven; de vrijgave is geauditeerd.")).toBeVisible();

    // N11 — en die vrijgave is weer in te trekken, met een grond.
    await rij.getByRole("button", { name: "Vrijgave intrekken" }).click();
    const intrekken = page.getByRole("alertdialog");
    await intrekken.getByLabel("Grond").selectOption("overig");
    await intrekken.getByRole("button", { name: "Vrijgave intrekken" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByText("De vrijgave is ingetrokken; de collega ziet het verslag niet meer.")).toBeVisible();
  });

  test("instellingen: activatievoorwaarden bewaken de moduleschakelaar en alles overleeft een herlading", async ({
    page,
  }) => {
    await page.goto("/scribe/instellingen");
    await expect(page.getByRole("heading", { name: "Careon AI-instellingen" })).toBeVisible();

    await page.getByLabel("Standaard consulttype").selectOption("soap");
    await page.getByLabel("Transcript bewaren (dagen)").fill("7");
    const medicatie = page.getByLabel(/Medicatiesignalen tonen/);
    await expect(medicatie).toHaveAttribute("aria-checked", "true");
    await medicatie.click();

    // N19 — externe verwerking staat standaard uit en is een eigen keuze van de
    // organisatie, los van de platformvlag.
    const transcriptie = page.getByLabel(/Audiofragmenten laten transcriberen/);
    const aiAnalyse = page.getByLabel(/AI-analyse van het transcript inschakelen/);
    await expect(transcriptie).toHaveAttribute("aria-checked", "false");
    await expect(aiAnalyse).toHaveAttribute("aria-checked", "false");
    await transcriptie.click();
    await aiAnalyse.click();

    // exact: "Machtigingen opslaan" bevat dezelfde substring (strict mode).
    await page.getByRole("button", { name: "Opslaan", exact: true }).click();
    await expect(page.getByText("De instellingen zijn opgeslagen.")).toBeVisible();

    // S12: machtigen is een aparte handeling met een eigen opslagknop.
    const bakker = page.getByLabel(/J\. Bakker/);
    await expect(bakker).toHaveAttribute("aria-checked", "false");
    await bakker.click();
    await page.getByRole("button", { name: "Machtigingen opslaan" }).click();
    await expect(page.getByText("De machtigingen zijn opgeslagen.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Standaard consulttype")).toHaveValue("soap");
    await expect(page.getByLabel("Transcript bewaren (dagen)")).toHaveValue("7");
    await expect(page.getByLabel(/Medicatiesignalen tonen/)).toHaveAttribute("aria-checked", "false");
    await expect(page.getByLabel(/Audiofragmenten laten transcriberen/)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel(/AI-analyse van het transcript inschakelen/)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel(/J\. Bakker/)).toHaveAttribute("aria-checked", "true");

    // N21 — zonder vastgelegde activatievoorwaarden gaat de module niet aan.
    const moduleSchakelaar = page.getByLabel("Careon AI is ingeschakeld voor deze organisatie");
    await expect(moduleSchakelaar).toHaveAttribute("aria-checked", "true");
    await moduleSchakelaar.click();
    await expect(moduleSchakelaar).toHaveAttribute("aria-checked", "false");
    await page.getByLabel("Eigenaar van de DPIA").fill("");
    await expect(moduleSchakelaar).toBeDisabled();
    await expect(page.getByText("Eerst de activatievoorwaarden vastleggen:")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Eigenaar van de DPIA" })).toBeVisible();

    await page.getByLabel("Eigenaar van de DPIA").fill("Functionaris gegevensbescherming");
    await expect(moduleSchakelaar).toBeEnabled();
    await expect(page.getByText("Alle activatievoorwaarden zijn vastgelegd; de module mag aan.")).toBeVisible();
    await moduleSchakelaar.click();
    await expect(moduleSchakelaar).toHaveAttribute("aria-checked", "true");
  });

  test("logboek toont de handelingen van deze demo als metadata en levert een CSV", async ({ page }) => {
    // Eén consult openen levert de leesregel op die N20 zichtbaar wil maken.
    await page.goto("/scribe/demo-consult-2");
    await expect(page.getByRole("region", { name: "Verslag" }).getByRole("heading", { name: "Beleid" })).toBeVisible();

    await page.goto("/scribe/logboek");
    await expect(page.getByRole("heading", { name: "Careon AI-logboek" })).toBeVisible();
    const tabel = page.getByRole("table");
    await expect(tabel.getByRole("row").filter({ hasText: "Consult geopend" })).toBeVisible();
    await expect(tabel.getByRole("row").filter({ hasText: "Consult gestart" })).toBeVisible();
    await expect(tabel.getByRole("row").filter({ hasText: "Verslag goedgekeurd" })).toBeVisible();

    // N20 — metadata-only: nooit een dossierreferentie of transcripttekst.
    await expect(page.getByText("D-2026-0392")).toHaveCount(0);
    await expect(page.getByText("somberheid", { exact: false })).toHaveCount(0);

    await page.getByLabel("Handeling").selectOption("scribe.transcript.read");
    await expect(tabel.getByRole("row").filter({ hasText: "Consult geopend" })).toBeVisible();
    await expect(tabel.getByRole("row").filter({ hasText: "Consult gestart" })).toHaveCount(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Logboek downloaden (.csv)" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^careon-ai-logboek-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

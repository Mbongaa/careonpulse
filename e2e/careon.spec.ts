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

    // YAAZ: met NEXT_PUBLIC_YAAZ_URL in de build is de tegel een externe link
    // naar de comms-plane; zonder die URL blijft het bewust "binnenkort" zonder
    // link. De assertie leest de gebouwde staat (build-time inlined env), zodat
    // de suite in beide omgevingsvormen geldig blijft.
    await expect(page.getByText("YAAZ", { exact: true })).toBeVisible();
    const yaazLink = page.getByRole("link", { name: /YAAZ/ });
    if ((await yaazLink.count()) > 0) {
      await expect(yaazLink).toHaveAttribute("href", /^https?:\/\//);
    } else {
      // Gescoped op de YAAZ-kaart: een pagina-brede tekstassertie breekt in
      // strict mode zodra er ooit een tweede coming-soon-tegel bijkomt.
      const yaazKaart = page.locator('[aria-disabled="true"]').filter({ hasText: "YAAZ" });
      await expect(yaazKaart.getByText("Binnenkort beschikbaar")).toBeVisible();
    }

    // Facturatie-tegel (handoff 15): zichtbaar in demo (B12).
    await expect(page.getByRole("link", { name: /Facturatie/ })).toBeVisible();

    await page.getByRole("link", { name: /Careon Pulse Directie/ }).click();
    await page.waitForURL("**/dashboard/directiecockpit");
    await expect(page.getByRole("heading", { name: "Directiecockpit" })).toBeVisible();

    await page.evaluate(async () => {
      window.localStorage.setItem("careon-production-v1", '{"sensitive":true}');
      window.localStorage.setItem("careon-middelen-v2", '{"sensitive":true}');
      window.localStorage.setItem("careon-hr-v2", '{"sensitive":true}');
      window.localStorage.setItem("careon-facturatie-v1", '{"sensitive":true}');
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
      sensitiveCache: (await window.caches.keys()).includes("careon-sensitive-test"),
    }));
    expect(cleared).toEqual({
      auth: null,
      session: null,
      production: null,
      middelen: null,
      hr: null,
      facturatie: null,
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

  test("BIG changes feed Signaleringen with live remaining days", async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/hr");
    const overDertigDagen = await page.evaluate(() => {
      const nu = new Date();
      return new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() + 30)).toISOString().slice(0, 10);
    });
    await page.getByLabel("Verloopdatum — L. Vermeer").fill(overDertigDagen);
    await page.goto("/dashboard/signaleringen");
    const alert = page.getByRole("link", {
      name: /BIG-registratie verloopt <90 dgn/,
    });
    await expect(alert).toBeVisible();
    await expect(alert.getByText(/L\. Vermeer \(30 dgn\)/)).toBeVisible();
  });
});

test.describe("databron", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/databron");
    await expect(page.getByRole("heading", { name: "Databron" })).toBeVisible();
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
    // Download loopt in demo via de client-blob van het voorbeeld.
    await expect(page.getByRole("link", { name: "Pdf downloaden" })).toHaveAttribute("href", /^blob:/, {
      timeout: 15_000,
    });
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

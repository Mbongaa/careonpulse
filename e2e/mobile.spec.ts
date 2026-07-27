import { expect, type Page, test } from "@playwright/test";

// Mobile-first gates: every route must fit the phone viewport without
// horizontal scroll, and the mobile-only controls must work. All tests here
// run in the iPhone-13 project via the @mobile grep.

const ROUTES = [
  "/auth/v1/login",
  "/modules",
  "/dashboard/directiecockpit",
  "/dashboard/signaleringen",
  "/dashboard/patienten",
  "/dashboard/planning",
  "/dashboard/behandelaren",
  "/dashboard/dossiercontrole",
  "/dashboard/dossiers-productie",
  "/dashboard/kwaliteit",
  "/dashboard/financieel",
  "/dashboard/hr",
  "/dashboard/middelen",
  "/dashboard/databron",
  "/dashboard/assistent",
  // KPI-drilldown (handoff 08): breedste detailtabel als mobile-gate.
  "/dashboard/details/actief",
];

async function loginViaSession(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("careon-auth", "1");
  });
}

async function applyTheme(page: Page, theme: "light" | "careon") {
  await page.context().addCookies([{ name: "theme_mode", value: theme, url: "http://localhost:3299" }]);
}

for (const theme of ["careon", "light"] as const) {
  test(`mobile: no horizontal overflow on any route (${theme}) @mobile`, async ({ page }) => {
    await applyTheme(page, theme);
    await loginViaSession(page);
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator("h1, h2").first()).toBeVisible();
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scroll: doc.scrollWidth, inner: window.innerWidth };
      });
      expect(
        overflow.scroll,
        `${theme} ${route}: scrollWidth ${overflow.scroll} > ${overflow.inner}`,
      ).toBeLessThanOrEqual(overflow.inner + 1);
    }
  });
}

test("mobile: filter popover exposes Periode/Locatie/Team @mobile", async ({ page }) => {
  await loginViaSession(page);
  await page.goto("/dashboard/behandelaren");
  await expect(page.getByText("10 behandelaren · Alle locaties · Alle teams")).toBeVisible();

  await page.getByRole("button", { name: "Alle filters" }).click();
  const popover = page.locator('[data-slot="popover-content"]');
  await popover.getByLabel("Team").click();
  await page.getByRole("option", { name: "FACT" }).click();
  await expect(page.getByText("2 behandelaren · Alle locaties · FACT")).toBeVisible();

  // Mobile shows the card list, not the wide table.
  await expect(page.getByText("K. Aydın").first()).toBeVisible();
  await expect(page.getByRole("table")).toBeHidden();
});

test("mobile: assistant canvas opens in a full-height drawer @mobile", async ({ page }) => {
  await loginViaSession(page);
  await page.goto("/dashboard/assistent");
  await expect(page.getByRole("heading", { name: "Careon AI-assistent" })).toBeVisible();

  // Ask via a quick prompt; the dock above the composer tracks the turn.
  await page.getByRole("button", { name: "Samenvatting van vandaag" }).click();
  const dock = page.getByRole("button", { name: /Canvas bekijken/ });
  await expect(dock).toBeVisible({ timeout: 20_000 });

  // The chat keeps the full viewport: the inline canvas pane stays hidden on
  // mobile and the page is fully contained (no document scroll in either
  // axis) while a canvas exists — only the thread scrolls.
  await expect(page.locator('section[aria-label="Artefact-canvas"]')).toBeHidden();
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    scrollH: document.documentElement.scrollHeight,
    innerH: window.innerHeight,
  }));
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.innerW + 1);
  expect(overflow.scrollH).toBeLessThanOrEqual(overflow.innerH + 1);

  // Dock opens the drawer with the artifact canvas inside.
  await dock.click();
  const drawer = page.locator('[data-slot="drawer-content"]');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Geselecteerd artefact")).toBeVisible();

  // Close, then reopen via the artifact chip under the assistant message.
  // Scroll the thread to its end first (the user's "scroll to bottom" path)
  // so the chip sits above the sticky composer footer.
  await page.getByRole("button", { name: "Canvas sluiten" }).click();
  await expect(drawer).toBeHidden();
  await page.locator('[data-slot="aui_thread-viewport"]').evaluate((el) => {
    el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  });
  await page.locator('ul[aria-label="Artefacten bij dit antwoord"] button').first().click();
  await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
});

test("mobile: assistant thread sheet opens and closes @mobile", async ({ page }) => {
  await loginViaSession(page);
  await page.goto("/dashboard/assistent");
  await expect(page.getByRole("heading", { name: "Careon AI-assistent" })).toBeVisible();

  await page.getByRole("button", { name: "Chatlijst openen" }).click();
  await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
  await page.getByRole("button", { name: "Nieuwe chat" }).click();
  await expect(page.getByRole("heading", { name: "Chats" })).toBeHidden();
  await expect(page.getByPlaceholder("Stel een vraag over de organisatie...")).toBeVisible();
});

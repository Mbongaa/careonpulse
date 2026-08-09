import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const ROUTES = [
  "/auth/v1/login",
  "/modules",
  "/dashboard/assistent",
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
  // Facturatie (handoff 15): drie statische pagina's + de editor via een
  // vast demo-factuur-id (demo-pad B12).
  "/dashboard/facturatie",
  "/dashboard/facturatie/contacten",
  "/dashboard/facturatie/instellingen",
  "/dashboard/facturatie/demo-factuur-3",
  // KPI-drilldowns (handoff 08): één cliëntrecord-variant en één event-variant.
  "/dashboard/details/actief",
  "/dashboard/details/noshow",
];

async function auditRoute(page: Page, route: string, theme: "light" | "dark" | "careon") {
  // Het logo-merkteken en de tagline faden in over 4,6s, uitsluitend onder
  // `prefers-reduced-motion: no-preference`. Zonder deze emulatie meet axe soms
  // een half doorzichtige tagline en meldt het een contrastfout die op het
  // eindbeeld niet bestaat — een uitkomst die van de timing afhangt, niet van
  // de toegankelijkheid. Met `reduce` staat de animatie uit en toetsen we de
  // bedoelde eindkleuren, precies wat een audit hoort te meten.
  await page.emulateMedia({ reducedMotion: "reduce" });
  // theme_mode is a client cookie read by the theme boot script.
  await page.context().addCookies([{ name: "theme_mode", value: theme, url: "http://localhost:3299" }]);
  await page.addInitScript(() => {
    window.sessionStorage.setItem("careon-auth", "1");
  });
  await page.goto(route);
  await expect
    .poll(async () =>
      page.locator("html").evaluate((el, mode) => el.classList.contains("dark") === (mode !== "light"), theme),
    )
    .toBe(true);
  await expect(page.locator("h1").first()).toBeVisible();

  // Het pdf-voorbeeld is een blob-iframe met de native pdf-viewer — geen DOM
  // die axe kan of hoeft te injecteren.
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .exclude('iframe[title="Voorbeeld van de factuur"]')
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = serious
    .map(
      (v) =>
        `${v.id}: ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(" ")}\n  ${n.failureSummary ?? ""}`).join("\n")}`,
    )
    .join("\n");
  expect(serious, `${theme} ${route}\n${summary}`).toEqual([]);
}

for (const theme of ["light", "dark", "careon"] as const) {
  test.describe(`axe wcag2aa (${theme})`, () => {
    for (const route of ROUTES) {
      test(`${route} has no serious/critical violations in ${theme} mode`, async ({ page }) => {
        await auditRoute(page, route, theme);
      });
    }
  });
}

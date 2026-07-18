import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const ROUTES = [
  "/auth/v1/login",
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
  "/dashboard/databron",
  // KPI-drilldowns (handoff 08): één cliëntrecord-variant en één event-variant.
  "/dashboard/details/actief",
  "/dashboard/details/noshow",
];

async function auditRoute(page: Page, route: string, theme: "light" | "dark" | "careon") {
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

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`).join("\n");
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

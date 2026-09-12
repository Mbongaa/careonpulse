/** Real-provider, synthetic-text review flow. Isolated local UI and memory store.
 * No recording, patient, production auth/database or clinical acceptance.
 */
import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";

import { loadTeachingProviderEnvironment } from "./lib/scribe-recording-harness";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function main(): Promise<void> {
  const baseUrl = option("base-url", "http://127.0.0.1:3311");
  const destination = new URL(baseUrl);
  if (destination.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(destination.hostname)) {
    throw new Error("Synthetic review is restricted to local HTTP origins.");
  }
  const runId = option("run", "synthetic-reviewed-english");
  if (!/^[a-zA-Z0-9_-]{1,70}$/.test(runId)) throw new Error("Invalid run ID.");
  const outputDir = path.join(process.cwd(), ".next-e2e", "scribe-audio-20260911", runId);
  await mkdir(outputDir); // Never overwrite an earlier verification run.
  await loadTeachingProviderEnvironment(process.cwd());
  process.env.CAREON_ASSISTANT_LIVE = "1";
  const { createScribeBrowserTestBackend } = await import("./lib/scribe-browser-test-backend");
  const backend = await createScribeBrowserTestBackend({ outputDir, label: "Synthetic English review control" });
  const sourceFiles = [
    "src/lib/careon-scribe/agent.server.ts",
    "src/lib/careon-scribe/english-evidence.ts",
    "src/lib/careon-scribe/english-report.ts",
    "src/lib/careon-scribe/deterministisch.ts",
    "src/scripts/lib/scribe-browser-test-backend.ts",
    "src/scripts/verify-scribe-browser-review.ts",
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      ]),
    ),
  );
  const browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors: string[] = [];
  const accessibility: { viewport: string; seriousOrCritical: number }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== destination.origin) {
      errors.push(`Blocked external browser origin: ${url.origin}`);
      await route.abort();
    } else if (url.pathname.startsWith("/api/careon/scribe/")) {
      const reply = await backend.handle({
        method: request.method(),
        url: request.url(),
        headers: request.headers(),
        body: request.postDataBuffer() ?? undefined,
      });
      await route.fulfill({
        status: reply.status,
        headers: { "Content-Type": "application/json", ...reply.headers },
        body: reply.body ?? JSON.stringify(reply.json),
      });
    } else await route.continue();
  });
  const checkpoint = async (name: string) => {
    await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
    await writeFile(path.join(outputDir, `${name}.txt`), await page.locator("body").innerText());
    await backend.save();
  };
  const latest = () => {
    const state = backend.snapshot().state;
    const session = state.sessies[0];
    return { session, state: state.staat[session.id], note: state.notities[session.id]?.at(-1) };
  };
  let completed = false;
  try {
    await page.goto(`${baseUrl}/auth/v1/login`, { waitUntil: "networkidle" });
    await page.getByPlaceholder("Gebruikersnaam").fill("user1");
    await page.getByPlaceholder("Wachtwoord").fill("demo1234");
    await page.getByRole("button", { name: "Inloggen", exact: true }).click();
    await page.waitForURL("**/modules");
    await page.goto(`${baseUrl}/scribe`);
    await page.getByRole("button", { name: "Nieuw consult", exact: true }).click();
    await page.getByLabel("Dossierreferentie", { exact: true }).fill(`QA-${runId}`);
    await page.getByLabel("Consulttype", { exact: true }).selectOption("psychiatrie");
    await page.getByLabel("Taal", { exact: true }).selectOption("en");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Consult starten", exact: true }).click();
    await page.getByLabel("Gesprekstekst handmatig toevoegen", { exact: true }).fill("I take sertraline 50 mg.");
    await page.getByLabel("Spreker", { exact: true }).selectOption("patient");
    await page.getByRole("button", { name: "Regel toevoegen", exact: true }).click();
    const transcript = page.getByRole("region", { name: "Transcript", exact: true });
    await transcript.getByText("I take sertraline 50 mg.", { exact: false }).waitFor();
    const uncertainMedicine = "I might take another medicine, but I cannot remember its name.";
    await page.getByLabel("Gesprekstekst handmatig toevoegen", { exact: true }).fill(uncertainMedicine);
    await page.getByRole("button", { name: "Regel toevoegen", exact: true }).click();
    await transcript.getByText(uncertainMedicine, { exact: false }).waitFor();
    // The explicit menu confirmation is the tested trust boundary. Merely having
    // a patient enum after append is not enough to authorize English extraction.
    await transcript.getByRole("button", { name: /^Spreker van regel 1:/ }).click();
    await page.getByRole("menuitem", { name: "Bevestig Patiënt voor regel 1", exact: true }).click();
    await expect(transcript.getByRole("button", { name: /Spreker van regel 1: Patiënt · bevestigd/ })).toBeVisible();
    await page.getByRole("button", { name: "Consult afronden", exact: true }).click();
    await page.getByLabel("Verslagformaat", { exact: true }).waitFor({ timeout: 180_000 });
    const medication = page.getByRole("textbox", { name: "Somatiek & medicatie", exact: true });
    await expect(medication).toHaveValue(/Vastgelegde feiten[\s\S]*I take sertraline 50 mg\./);
    expect(latest().state.staat.medicatie).toHaveLength(1);
    expect(latest().state.staat.medicatie[0].bron).toEqual([1]);
    const initialSection = page.locator("article").filter({ has: medication });
    const remainingSummary = initialSection.getByText(/^Nog te controleren gesprekscitaten \(/);
    if (!(await remainingSummary.evaluate((element) => element.closest("details")?.open))) {
      await remainingSummary.click();
    }
    await expect(
      initialSection
        .getByRole("region", { name: /Nog te controleren gesprekscitaten: Somatiek/ })
        .getByText(uncertainMedicine, { exact: true }),
    ).toBeVisible();
    expect(await medication.inputValue()).not.toContain(uncertainMedicine);
    await checkpoint("first-draft");
    // Source correction remains available after finishing. Regeneration must
    // reanalyze and remove the superseded dose, never merely reformat stale state.
    await transcript
      .locator("#scribe-segment-1")
      .getByRole("button", { name: /corrigeren/i })
      .click();
    await transcript
      .getByRole("textbox", { name: "Tekst van regel 1 corrigeren", exact: true })
      .fill("I take sertraline 100 mg.");
    await transcript.getByRole("button", { name: "Correctie bewaren", exact: true }).click();
    await expect.poll(() => latest().state.verouderd).toBe(true);
    expect(latest().state.staat.gesprekscontext ?? []).toHaveLength(0);
    await expect(page.getByRole("alert").filter({ hasText: /bron|transcript/i })).toBeVisible();
    await expect(initialSection.getByRole("button", { name: "Goedkeuren", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Verslag opnieuw genereren", exact: true }).click();
    await expect(medication).toHaveValue(/I take sertraline 100 mg\./, { timeout: 180_000 });
    expect(await medication.inputValue()).not.toContain("50 mg");
    expect(latest().state.verouderd).toBe(false);
    expect(latest().state.staat.medicatie.filter((row) => !row.ingetrokken)).toHaveLength(1);
    expect(latest().state.staat.medicatie[0].dosering).toBe("100 mg");
    expect(await medication.inputValue()).not.toContain(uncertainMedicine);
    const section = page.locator("article").filter({ has: medication });
    await section.getByRole("button", { name: "Goedkeuren", exact: true }).click();
    await expect
      .poll(() => latest().note?.secties.find((row) => row.id === "somatiek-medicatie")?.status)
      .toBe("goedgekeurd");
    await page.reload();
    await expect(page.getByText("I take sertraline 100 mg.", { exact: false }).first()).toBeVisible();
    expect(latest().note?.secties.find((row) => row.id === "somatiek-medicatie")?.status).toBe("goedgekeurd");
    await checkpoint("reviewed-after-correction");
    const desktopAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const desktopViolations = desktopAxe.violations.filter((row) => ["serious", "critical"].includes(row.impact ?? ""));
    accessibility.push({ viewport: "desktop", seriousOrCritical: desktopViolations.length });
    expect(desktopViolations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await checkpoint("reviewed-phone");
    const phoneAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const phoneViolations = phoneAxe.violations.filter((row) => ["serious", "critical"].includes(row.impact ?? ""));
    accessibility.push({ viewport: "phone", seriousOrCritical: phoneViolations.length });
    expect(phoneViolations).toEqual([]);
    expect(errors).toEqual([]);
    completed = true;
  } finally {
    await checkpoint(completed ? "completed" : "failure").catch(() => undefined);
    await writeFile(
      path.join(outputDir, "result.json"),
      JSON.stringify(
        {
          completed,
          errors,
          accessibility,
          sourceHashes,
          limitations: [
            "Synthetic text and deliberate test role confirmation",
            "Real provider with local in-memory adapter; no production routes/RLS",
            "Not audio or clinical accuracy acceptance",
          ],
        },
        null,
        2,
      ),
    );
    await browser.close();
  }
  console.log(JSON.stringify({ runId, completed }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Synthetic browser review failed");
  process.exitCode = 1;
});

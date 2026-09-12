import { expect, type Page, test } from "@playwright/test";

import { type FacturatieContact, isFacturatieContactInvoer } from "../src/lib/careon-facturatie/types";

/** Browser coverage of the central response branch; the real API routes are
 * exercised separately by verify-facturatie-contacten.mjs. These fixtures
 * never reach the demo server's API or a real database. */
async function centralContacts(page: Page, options: { beforeWrite?: () => Promise<void>; failures?: number } = {}) {
  const rows: FacturatieContact[] = [];
  const submissions: FacturatieContact[] = [];
  const patches: FacturatieContact[] = [];
  await page.addInitScript(() => window.sessionStorage.setItem("careon-auth", "1"));
  await page.route("**/api/careon/facturatie/medewerkers", (route) =>
    route.fulfill({ json: { configured: true, medewerkers: [] } }),
  );
  await page.route("**/api/careon/facturatie/contacten", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { configured: true, contacten: rows } });
      return;
    }
    expect(route.request().method()).toBe("POST");
    const { contact } = route.request().postDataJSON() as { contact: FacturatieContact };
    submissions.push(contact);
    expect(isFacturatieContactInvoer(contact)).toBe(true);
    await options.beforeWrite?.();
    if (submissions.length <= (options.failures ?? 0)) {
      await route.fulfill({ status: 502, json: { error: "Supabase niet bereikbaar." } });
      return;
    }
    const saved = {
      ...contact,
      id: `33333333-3333-4333-8333-${String(rows.length + 1).padStart(12, "0")}`,
      updatedAt: "2026-09-12T12:00:00.000Z",
    };
    rows.push(saved);
    await route.fulfill({ json: { configured: true, contact: saved } });
  });
  await page.route("**/api/careon/facturatie/contacten/*", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    const { contact } = route.request().postDataJSON() as { contact: FacturatieContact };
    expect(route.request().url().endsWith(`/${contact.id}`)).toBe(true);
    const index = rows.findIndex((row) => row.id === contact.id);
    expect(index).toBeGreaterThanOrEqual(0);
    patches.push(contact);
    rows[index] = contact;
    await route.fulfill({ json: { configured: true, contact } });
  });
  await page.goto("/facturatie/contacten");
  await expect(page.getByText("Nog geen contacten. Voeg er hieronder een toe.")).toBeVisible();
  return { rows, submissions, patches };
}

test("central contacts: TGC saves once without email, can be edited, and survives reload", async ({ page }) => {
  let releaseWrite: () => void = () => undefined;
  const pendingWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const { rows, submissions, patches } = await centralContacts(page, { beforeWrite: () => pendingWrite });
  const name = page.getByLabel("Naam nieuw contact");
  const email = page.getByLabel("E-mailadres nieuw contact");
  const form = page.locator("form").filter({ has: name });
  await expect(page.getByRole("button", { name: "Contact toevoegen" })).toBeDisabled();
  await name.fill("TGC");
  await expect(email).toHaveValue("");
  await page.getByRole("button", { name: "Contact toevoegen" }).click();
  await expect.poll(() => submissions.length).toBe(1);
  await expect(page.getByRole("button", { name: "Opslaan…" })).toBeDisabled();
  await expect(name).toBeDisabled();
  await expect(email).toBeDisabled();
  // Repeated submit events while the response is held must not create extra rows.
  await form.dispatchEvent("submit");
  await form.dispatchEvent("submit");
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ id: "", naam: "TGC", soort: "organisatie", bron: "handmatig" });
  expect(submissions[0].email).toBeUndefined();
  releaseWrite();
  await expect(page.getByLabel("Naam — TGC", { exact: true })).toHaveValue("TGC");
  await expect(name).toHaveValue("");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Lokale demo-opslag", { exact: false })).toHaveCount(0);
  expect(rows).toHaveLength(1);

  const place = page.getByLabel("Plaats — TGC", { exact: true });
  await place.fill("Tilburg");
  await place.blur();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0].id).toBe(rows[0].id);
  expect(patches[0].plaats).toBe("Tilburg");
  await page.reload();
  await expect(page.getByLabel("Naam — TGC", { exact: true })).toHaveValue("TGC");
  await expect(page.getByLabel("Plaats — TGC", { exact: true })).toHaveValue("Tilburg");
  expect(submissions).toHaveLength(1);
  expect(await page.evaluate(() => window.localStorage.getItem("careon-facturatie-v1"))).toBeNull();
});

test("central contacts: save failure keeps TGC available for retry", async ({ page }) => {
  const { rows, submissions } = await centralContacts(page, { failures: 1 });
  const name = page.getByLabel("Naam nieuw contact");
  const email = page.getByLabel("E-mailadres nieuw contact");
  await name.fill("TGC");
  await email.fill("administratie@example.invalid");
  await page.getByRole("button", { name: "Contact toevoegen" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Supabase niet bereikbaar.");
  await expect(name).toHaveValue("TGC");
  await expect(email).toHaveValue("administratie@example.invalid");
  await expect(name).toBeEnabled();
  await expect(page.getByRole("button", { name: "Contact toevoegen" })).toBeEnabled();
  expect(rows).toHaveLength(0);
  await page.getByRole("button", { name: "Contact toevoegen" }).click();
  await expect(page.getByLabel("Naam — TGC", { exact: true })).toHaveValue("TGC");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(rows).toHaveLength(1);
  expect(submissions).toHaveLength(2);
});

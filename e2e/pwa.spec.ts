import { expect, type Page, test } from "@playwright/test";

// PWA gates: manifest, icons, service worker, and the offline fallback.
// These run against the production build (webServer), where the service
// worker is registered.

async function loginViaSession(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("careon-auth", "1");
  });
}

test.describe("pwa", () => {
  test("manifest is served with install-ready fields", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest.name).toContain("Careon Pulse");
    expect(manifest.short_name).toBe("Careon Pulse");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/dashboard/directiecockpit");
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
  });

  test("service worker, icons and offline page are served", async ({ request }) => {
    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["cache-control"]).toContain("must-revalidate");

    for (const path of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"]) {
      const icon = await request.get(path);
      expect(icon.status(), path).toBe(200);
    }

    const offline = await request.get("/offline.html");
    expect(offline.status()).toBe(200);
    expect(await offline.text()).toContain("U bent offline");
  });

  test("service worker activates and serves the offline fallback", async ({ page, context }) => {
    await loginViaSession(page);
    await page.goto("/dashboard/directiecockpit");
    await expect(page.getByRole("heading", { name: "Directiecockpit" })).toBeVisible();

    const activated = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return Boolean(registration.active);
    });
    expect(activated).toBe(true);

    await context.setOffline(true);
    await page.goto("/dashboard/hr").catch(() => {
      // Navigation may reject if the fallback races; the assertion below decides.
    });
    await expect(page.getByText("U bent offline")).toBeVisible();
    await context.setOffline(false);
  });
});

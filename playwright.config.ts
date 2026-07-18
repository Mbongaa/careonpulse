import { defineConfig, devices } from "@playwright/test";

const PORT = 3299;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/auth/v1/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Force the assistant onto its deterministic fallback so e2e runs are
    // reproducible and never call the live AI provider. De Supabase-variabelen
    // worden geleegd zodat de sync-route 501 geeft: e2e mag NOOIT naar de
    // centrale productie-opslag schrijven (fixture-pushes zouden de echte
    // import verdringen) of eruit hydrateren (demo-tests zouden productie-data
    // zien). Next laat al-gezette env-waarden voorgaan op .env.local.
    env: {
      CAREON_ASSISTANT_LIVE: "0",
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      NEXT_PUBLIC_CAREON_SYNC_TOKEN: "",
    },
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@mobile/,
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
      grep: /@mobile/,
    },
  ],
});

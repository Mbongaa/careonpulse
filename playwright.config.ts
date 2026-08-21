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
    launchOptions: {
      // Chromium headless shell can crash its Windows SwiftShader mailbox
      // between contexts; E2E charts do not require GPU acceleration.
      args: ["--disable-gpu"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/auth/v1/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Force the assistant onto its deterministic fallback so e2e runs are
    // reproducible and never call the live AI provider. De expliciete
    // demo-vlag en niet-routeerbare lokale Supabase-waarden zorgen dat e2e
    // NOOIT naar de
    // centrale productie-opslag schrijven (fixture-pushes zouden de echte
    // import verdringen) of eruit hydrateren (demo-tests zouden productie-data
    // zien). Next laat al-gezette env-waarden voorgaan op .env.local.
    env: {
      CAREON_ASSISTANT_LIVE: "0",
      CAREON_DEMO_MODE: "1",
      CAREON_MICROSOFT_LOGIN_ENABLED: "0",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-inert-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
  },
  projects: [
    {
      name: "desktop-a11y",
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop",
      testIgnore: /a11y\.spec\.ts/,
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

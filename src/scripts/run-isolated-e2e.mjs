import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("Run the isolated browser suite through `npm run test:e2e`.");
}
const playwrightCli = fileURLToPath(new URL("../../node_modules/@playwright/test/cli.js", import.meta.url));
const isolatedEnvironment = {
  ...process.env,
  CAREON_ASSISTANT_LIVE: "0",
  CAREON_DEMO_MODE: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-inert-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "",
};

function run(command, args) {
  const result = spawnSync(command, args, {
    env: isolatedEnvironment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [npmCli, "run", "build"]);
run(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)]);

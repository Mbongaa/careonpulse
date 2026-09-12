import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("Run the isolated browser suite through `npm run test:e2e`.");
}
const playwrightCli = fileURLToPath(new URL("../../node_modules/@playwright/test/cli.js", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const isolatedBuildRoot = path.join(projectRoot, ".next-e2e");
mkdirSync(isolatedBuildRoot, { recursive: true });
const isolatedBuild = mkdtempSync(path.join(isolatedBuildRoot, "run-"));
const distDir = path.relative(projectRoot, isolatedBuild).replaceAll(path.sep, "/");
const tsconfigPath = path.join(projectRoot, "tsconfig.json");
const tsconfigBefore = readFileSync(tsconfigPath, "utf8");
const isolatedEnvironment = {
  ...process.env,
  NEXT_DIST_DIR: distDir,
  CAREON_ASSISTANT_LIVE: "0",
  CAREON_SCRIBE_LIVE: "0",
  CAREON_DEMO_MODE: "1",
  CAREON_MICROSOFT_LOGIN_ENABLED: "0",
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
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    throw new Error(`Isolated verification command failed with exit ${process.exitCode}.`);
  }
}

// Each verification run owns a fresh output directory. This also avoids
// unlinking another dev server's .next tree or Windows Turbopack reparse links.
try {
  run(process.execPath, [npmCli, "run", "build"]);
  run(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)]);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Isolated verification failed.");
  process.exitCode ||= 1;
} finally {
  // Next adds this run's generated type paths to tsconfig. Remove only those
  // paths; preserve independent edits if the file changed during verification.
  const current = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  current.include = current.include?.filter((entry) => !entry.startsWith(`${distDir}/`));
  const original = JSON.parse(tsconfigBefore);
  writeFileSync(
    tsconfigPath,
    JSON.stringify(current) === JSON.stringify(original) ? tsconfigBefore : `${JSON.stringify(current, null, 2)}\n`,
  );
}

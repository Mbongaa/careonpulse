/** Serve an existing immutable, isolated demo build for teaching-audio replay. */
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

const option = (name, fallback = "") => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
};
const root = realpathSync(process.cwd());
const isolatedRoot = realpathSync(path.join(root, ".next-e2e"));
const requested = option("dist-dir");
if (!requested) throw new Error("Provide --dist-dir for an existing isolated demo build.");
const build = realpathSync(path.resolve(root, requested));
if (!build.startsWith(`${isolatedRoot}${path.sep}`) || !existsSync(path.join(build, "BUILD_ID"))) {
  throw new Error("The build must be complete and contained in this repository's .next-e2e directory.");
}
const port = Number(option("port", "3311"));
if (!Number.isInteger(port) || port < 3300 || port > 3399) throw new Error("Use a local test port from 3300 to 3399.");

const server = spawn(
  process.execPath,
  [
    path.join(root, "node_modules", "next", "dist", "bin", "next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: root,
    shell: false,
    windowsHide: true,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_DIST_DIR: path.relative(root, build).replaceAll(path.sep, "/"),
      CAREON_ASSISTANT_LIVE: "0",
      CAREON_SCRIBE_LIVE: "0",
      CAREON_DEMO_MODE: "1",
      CAREON_MICROSOFT_LOGIN_ENABLED: "0",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-inert-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_ACCESS_TOKEN: "",
      OPENAI_API_KEY: "",
    },
  },
);
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));

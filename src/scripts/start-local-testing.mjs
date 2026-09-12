import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { port: { type: "string", default: "3000" } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Choose a local port between 1024 and 65535.");
}
if (process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error("Local testing must run on your own computer.");
}

const root = fileURLToPath(new URL("../../", import.meta.url));
const nextCli = fileURLToPath(new URL("../../node_modules/next/dist/bin/next", import.meta.url));
const server = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  shell: false,
  windowsHide: true,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "development",
    CAREON_DEMO_MODE: "1",
    CAREON_ASSISTANT_LIVE: "0",
    CAREON_SCRIBE_LIVE: "0",
    CAREON_MICROSOFT_LOGIN_ENABLED: "0",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-inert-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "",
    SUPABASE_ACCESS_TOKEN: "",
    OPENAI_API_KEY: "",
  },
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));

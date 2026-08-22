/**
 * Trusted local queue worker for AI-triggered TGC imports.
 *
 * The Supabase table carries operational metadata only. TGC credentials stay
 * in ignored `.env.tgc.local`; raw exports stay in ignored `Exports EPD/`.
 *
 * Usage:
 *   npm run worker:tgc
 *   npm run worker:tgc -- --once
 *   npm run worker:tgc -- --enqueue-scheduled --once
 */

import type { TgcSyncEvent, TgcSyncJobStatus, TgcSyncResult } from "../lib/careon-production/tgc-sync-jobs";
import { sanitizeTgcWorkerError, tgcProgressFromLog } from "../lib/careon-production/tgc-sync-progress";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";

const ROOT = path.join(__dirname, "../..");
const SCRIPT_ENV = {
  ...readEnvFile(path.join(ROOT, ".env.local")),
  ...readEnvFile(path.join(ROOT, ".env.tgc.local")),
  ...process.env,
};
const SUPABASE_URL = SCRIPT_ENV.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_KEY = SCRIPT_ENV.SUPABASE_SERVICE_ROLE_KEY;
const ORG_SLUG = SCRIPT_ENV.CAREON_TGC_ORG_SLUG?.trim() || "tgc";
const WORKER_ID = `${os.hostname()}:${process.pid}`.slice(0, 120);
const WORKER_VERSION = "1.1.0";
const WORKER_HEARTBEAT_MS = 30_000;
const POLL_MS = Math.max(2_000, Number(SCRIPT_ENV.TGC_QUEUE_POLL_SECONDS ?? "5") * 1_000);
const ONCE = process.argv.includes("--once");
const ENQUEUE_SCHEDULED = process.argv.includes("--enqueue-scheduled");
const LOCK_PATH = path.join(ROOT, "Exports EPD", ".tgc-sync.lock");
const JOB_SELECT = [
  "id",
  "org_id",
  "status",
  "stage",
  "message",
  "progress",
  "events",
  "attempts",
  "created_at",
  "heartbeat_at",
].join(",");

interface LocalEnv {
  [key: string]: string;
}

interface WorkerJob {
  id: string;
  org_id: string;
  status: TgcSyncJobStatus;
  stage: string;
  message: string;
  progress: number;
  events: TgcSyncEvent[];
  attempts: number;
  created_at: string;
  heartbeat_at: string | null;
}

function readEnvFile(filePath: string): LocalEnv {
  if (!fs.existsSync(filePath)) return {};
  const result: LocalEnv = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(rawLine.trim());
    if (!match) continue;
    result[match[1]] = match[2].trim().replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");
  }
  return result;
}

function assertConfiguration(): void {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt in .env.local.");
  }
  if (!SCRIPT_ENV.TGC_USERNAME || !SCRIPT_ENV.TGC_PASSWORD) {
    throw new Error("TGC_USERNAME of TGC_PASSWORD ontbreekt in .env.tgc.local.");
  }
}

function headers(extra?: HeadersInit): HeadersInit {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function rest(pathname: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...init,
    headers: headers(init?.headers),
    signal: AbortSignal.timeout(15_000),
  });
  return response;
}

async function readJson<T>(response: Response, operation: string): Promise<T> {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 600);
    throw new Error(`${operation} faalde (${response.status}): ${detail}`);
  }
  return (await response.json()) as T;
}

async function organizationId(): Promise<string> {
  const params = new URLSearchParams({ slug: `eq.${ORG_SLUG}`, select: "id", limit: "1" });
  const rows = await readJson<{ id: string }[]>(await rest(`organizations?${params}`), "TGC-organisatie opvragen");
  if (!rows[0]?.id) throw new Error(`Organisatie '${ORG_SLUG}' bestaat niet.`);
  return rows[0].id;
}

async function publishWorkerHeartbeat(orgId: string): Promise<void> {
  await readJson<string>(
    await rest("rpc/careon_tgc_worker_heartbeat", {
      method: "POST",
      body: JSON.stringify({ p_org_id: orgId, p_worker_version: WORKER_VERSION }),
    }),
    "Workerbeschikbaarheid publiceren",
  );
}

function appendEvent(job: WorkerJob, stage: string, progress: number, message: string): TgcSyncEvent[] {
  const previous = job.events[job.events.length - 1];
  if (previous?.stage === stage && previous.message === message) return job.events;
  const event = { at: new Date().toISOString(), stage, progress, message };
  job.events = [...job.events, event].slice(-24);
  return job.events;
}

async function patchJob(
  job: WorkerJob,
  patch: Partial<{
    status: TgcSyncJobStatus;
    stage: string;
    message: string;
    progress: number;
    events: TgcSyncEvent[];
    result: TgcSyncResult;
    error: string | null;
    worker_id: string | null;
    attempts: number;
    started_at: string;
    heartbeat_at: string;
    finished_at: string;
    updated_at: string;
  }>,
  expectedStatus?: TgcSyncJobStatus,
): Promise<WorkerJob | null> {
  const params = new URLSearchParams({ id: `eq.${job.id}`, select: JOB_SELECT });
  if (expectedStatus) params.set("status", `eq.${expectedStatus}`);
  const now = new Date().toISOString();
  const response = await rest(`careon_tgc_sync_jobs?${params}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, updated_at: patch.updated_at ?? now }),
  });
  const rows = await readJson<WorkerJob[]>(response, "Importjob bijwerken");
  if (!rows[0]) return null;
  Object.assign(job, rows[0]);
  return job;
}

async function activeJob(orgId: string): Promise<WorkerJob | null> {
  const params = new URLSearchParams({
    select: JOB_SELECT,
    org_id: `eq.${orgId}`,
    status: "in.(queued,running)",
    order: "created_at.asc",
    limit: "1",
  });
  const rows = await readJson<WorkerJob[]>(await rest(`careon_tgc_sync_jobs?${params}`), "Actieve importjob lezen");
  return rows[0] ?? null;
}

async function enqueueScheduled(orgId: string): Promise<WorkerJob> {
  const current = await activeJob(orgId);
  if (current) return current;
  const now = new Date().toISOString();
  const event: TgcSyncEvent = {
    at: now,
    stage: "queued",
    progress: 0,
    message: "Geplande volledige TGC-update staat in de wachtrij.",
  };
  const response = await rest(`careon_tgc_sync_jobs?select=${JOB_SELECT}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ org_id: orgId, requested_via: "scheduled", events: [event] }),
  });
  const rows = await readJson<WorkerJob[]>(response, "Geplande importjob aanmaken");
  if (!rows[0]) throw new Error("Geplande importjob is niet aangemaakt.");
  return rows[0];
}

async function recoverStaleJob(orgId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const params = new URLSearchParams({
    select: JOB_SELECT,
    org_id: `eq.${orgId}`,
    status: "eq.running",
    heartbeat_at: `lt.${staleBefore}`,
    order: "created_at.asc",
    limit: "1",
  });
  const rows = await readJson<WorkerJob[]>(await rest(`careon_tgc_sync_jobs?${params}`), "Vastgelopen importjob lezen");
  const job = rows[0];
  if (!job) return;
  if (job.attempts >= 3) {
    const message = "De lokale worker werd herhaaldelijk onderbroken; de automatische update is gestopt.";
    await patchJob(job, {
      status: "failed",
      stage: "failed",
      message,
      error: message,
      progress: job.progress,
      worker_id: null,
      finished_at: new Date().toISOString(),
      events: appendEvent(job, "failed", job.progress, message),
    });
    return;
  }
  const message = "Onderbroken worker hersteld; de update wordt automatisch opnieuw gestart.";
  await patchJob(job, {
    status: "queued",
    stage: "queued",
    message,
    progress: 0,
    worker_id: null,
    heartbeat_at: new Date().toISOString(),
    events: appendEvent(job, "queued", 0, message),
  });
}

function runnerLocked(): boolean {
  if (!fs.existsSync(LOCK_PATH)) return false;
  const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
  return age < 4 * 60 * 60_000;
}

async function claimNext(orgId: string): Promise<WorkerJob | null> {
  const current = await activeJob(orgId);
  if (current?.status !== "queued") return null;
  if (runnerLocked()) return null;
  const now = new Date().toISOString();
  const message = "Lokale TGC-worker gestart; beveiligde browsersessie wordt geopend.";
  return patchJob(
    current,
    {
      status: "running",
      stage: "login",
      message,
      progress: 3,
      worker_id: WORKER_ID,
      attempts: current.attempts + 1,
      started_at: current.attempts === 0 ? now : undefined,
      heartbeat_at: now,
      error: null,
      events: appendEvent(current, "login", 3, message),
    },
    "queued",
  );
}

interface ChildResult {
  code: number;
  output: string;
}

function runScript(scriptName: string, args: string[], onLine?: (line: string) => void): Promise<ChildResult> {
  const tsNodeBin = path.join(ROOT, "node_modules", "ts-node", "dist", "bin.js");
  const child = childProcess.spawn(
    process.execPath,
    [tsNodeBin, "-P", path.join(ROOT, "tsconfig.scripts.json"), path.join(ROOT, "src", "scripts", scriptName), ...args],
    { cwd: ROOT, env: SCRIPT_ENV, shell: false, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  const consume = (stream: NodeJS.ReadableStream) => {
    const lines = readline.createInterface({ input: stream });
    lines.on("line", (line) => {
      output = `${output}${line}\n`.slice(-30_000);
      console.log(line);
      onLine?.(line);
    });
  };
  if (child.stdout) consume(child.stdout);
  if (child.stderr) consume(child.stderr);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

function summaryFromVerification(output: string): TgcSyncResult {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      return {
        importedAt: typeof value.importedAt === "string" ? value.importedAt : undefined,
        clients: typeof value.clients === "number" ? value.clients : undefined,
        agendaRows: typeof value.agendaRows === "number" ? value.agendaRows : undefined,
        referrerRows: typeof value.referrerRows === "number" ? value.referrerRows : undefined,
        surchargeRows: typeof value.surchargeRows === "number" ? value.surchargeRows : undefined,
        declarationRows: typeof value.declarationRows === "number" ? value.declarationRows : undefined,
      };
    } catch {
      // Zoek verder naar de laatste JSON-regel.
    }
  }
  return {};
}

async function processJob(job: WorkerJob): Promise<void> {
  let updateChain = Promise.resolve();
  let lastStage = job.stage;
  const queueProgress = (line: string) => {
    const update = tgcProgressFromLog(line);
    if (!update || update.stage === lastStage) return;
    lastStage = update.stage;
    updateChain = updateChain.then(async () => {
      const now = new Date().toISOString();
      await patchJob(job, {
        stage: update.stage,
        message: update.message,
        progress: update.progress,
        heartbeat_at: now,
        events: appendEvent(job, update.stage, update.progress, update.message),
      });
    });
  };

  const heartbeat = setInterval(() => {
    updateChain = updateChain.then(async () => {
      await patchJob(job, { heartbeat_at: new Date().toISOString() });
    });
  }, 30_000);

  try {
    const sync = await runScript("sync-tgc-production.ts", ["--declaration-feed"], queueProgress);
    await updateChain;
    if (sync.code !== 0) throw new Error(sync.output.trim().split(/\r?\n/).slice(-3).join(" "));

    const verificationMessage = "Centrale snapshots worden onafhankelijk teruggelezen en gecontroleerd.";
    await patchJob(job, {
      stage: "verification",
      message: verificationMessage,
      progress: 97,
      heartbeat_at: new Date().toISOString(),
      events: appendEvent(job, "verification", 97, verificationMessage),
    });
    const verification = await runScript("verify-tgc-live.ts", []);
    if (verification.code !== 0) throw new Error(verification.output.trim().split(/\r?\n/).slice(-3).join(" "));

    const message = "Alle vijf exports zijn gevalideerd, centraal bijgewerkt en succesvol teruggelezen.";
    const now = new Date().toISOString();
    await patchJob(job, {
      status: "succeeded",
      stage: "completed",
      message,
      progress: 100,
      result: summaryFromVerification(verification.output),
      error: null,
      worker_id: null,
      heartbeat_at: now,
      finished_at: now,
      events: appendEvent(job, "completed", 100, message),
    });
  } catch (error) {
    const message = sanitizeTgcWorkerError(error instanceof Error ? error.message : String(error), [
      SCRIPT_ENV.TGC_USERNAME ?? "",
      SCRIPT_ENV.TGC_PASSWORD ?? "",
      ROOT,
    ]);
    const now = new Date().toISOString();
    await patchJob(job, {
      status: "failed",
      stage: "failed",
      message: "De automatische TGC-import is gestopt; bekijk de fout en probeer opnieuw.",
      error: message,
      worker_id: null,
      heartbeat_at: now,
      finished_at: now,
      events: appendEvent(job, "failed", job.progress, "De automatische TGC-import is mislukt."),
    });
  } finally {
    clearInterval(heartbeat);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  assertConfiguration();
  const orgId = await organizationId();
  await publishWorkerHeartbeat(orgId);
  let heartbeatChain = Promise.resolve();
  const heartbeatTimer = setInterval(() => {
    heartbeatChain = heartbeatChain
      .then(() => publishWorkerHeartbeat(orgId))
      .catch((error: unknown) => {
        console.error(
          `[TGC worker] Beschikbaarheidsheartbeat mislukt: ${sanitizeTgcWorkerError(
            error instanceof Error ? error.message : String(error),
          )}`,
        );
      });
  }, WORKER_HEARTBEAT_MS);

  try {
    await recoverStaleJob(orgId);
    if (ENQUEUE_SCHEDULED) await enqueueScheduled(orgId);

    let keepRunning = true;
    while (keepRunning) {
      const job = await claimNext(orgId);
      if (job) await processJob(job);
      if (ONCE) keepRunning = false;
      else await delay(POLL_MS);
    }
  } finally {
    clearInterval(heartbeatTimer);
    await heartbeatChain;
  }
}

main().catch((error: unknown) => {
  console.error(`[TGC worker] ${sanitizeTgcWorkerError(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});

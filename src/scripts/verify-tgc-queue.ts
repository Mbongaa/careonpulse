/** Deterministic release gate for the AI-triggered TGC import queue. */

import {
  isTgcImportUpdateRequest,
  resolveTgcWorkerAgeBucket,
  resolveTgcWorkerAvailability,
  tgcWorkerMonitorAction,
  tgcWorkerStateChanged,
  tgcWorkerStateFromMonitorAction,
} from "../lib/careon-production/tgc-sync-jobs";
import { sanitizeTgcWorkerError, tgcProgressFromLog } from "../lib/careon-production/tgc-sync-progress";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "../..");
let passes = 0;
let failures = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    passes += 1;
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}`);
}

for (const request of [
  "Update de TGC exports",
  "Werk de EPD-imports bij",
  "Ververs de dashboarddata",
  "Refresh de TGC databron",
  "Synchroniseer de productiegegevens",
]) {
  check(`actie herkend: ${request}`, isTgcImportUpdateRequest(request));
}
for (const request of [
  "Hoe actueel zijn de exports?",
  "Wat is de omzet?",
  "Update de taal van een medewerker",
  "Toon de dashboarddata",
]) {
  check(`geen fout-positief: ${request}`, !isTgcImportUpdateRequest(request));
}

const progressCases = [
  ["[TGC sync] Aanmelden bij TGC.", "login", 5],
  ["[TGC sync] Volledige cliëntendata-export aanvragen.", "clients", 12],
  ["[TGC sync] Volledige agenda-export aanvragen t/m 20-02-2028.", "agenda", 28],
  ["[TGC sync] Volledige huisarts/verwijzer-snapshot downloaden.", "referrers", 43],
  ["[TGC sync] Volledige gedeclareerde-toeslagenexport downloaden.", "surcharges", 54],
  ["[TGC sync] Declaratie finance-feedfallback expliciet geselecteerd.", "declarations", 64],
  ["[TGC sync] Alle vijf downloads valideren met de productieparsers.", "validation", 76],
  ["[TGC sync] Gevalideerde snapshots naar de centrale Supabase-productiestand pushen.", "upload", 91],
  ["[TGC sync] Volledige TGC-synchronisatie geslaagd.", "verification", 96],
] as const;
for (const [line, stage, progress] of progressCases) {
  const update = tgcProgressFromLog(line);
  check(`${stage}: statusregel`, update?.stage === stage && update.progress === progress);
}
check("onbekende logregel wordt genegeerd", tgcProgressFromLog("gewone uitvoer") === null);
check(
  "workerfout schermt credentials af",
  sanitizeTgcWorkerError("login hassan met geheim", ["hassan", "geheim"]) === "login [afgeschermd] met [afgeschermd]",
);

const now = Date.parse("2026-08-22T12:00:00.000Z");
check(
  "recente workerheartbeat is beschikbaar",
  resolveTgcWorkerAvailability("2026-08-22T11:59:00.000Z", now).state === "available",
);
check(
  "oude workerheartbeat is offline",
  resolveTgcWorkerAvailability("2026-08-22T11:55:00.000Z", now).state === "offline",
);
check("ontbrekende workerheartbeat is onbekend", resolveTgcWorkerAvailability(null, now).state === "unknown");
check(
  "onbetrouwbare toekomstige heartbeat is onbekend",
  resolveTgcWorkerAvailability("2026-08-22T12:01:00.000Z", now).state === "unknown",
);
check(
  "recente heartbeat valt in veilige leeftijdsbucket",
  resolveTgcWorkerAgeBucket("2026-08-22T11:59:00Z", now) === "under_2m",
);
check("oude heartbeat valt in kwartierbucket", resolveTgcWorkerAgeBucket("2026-08-22T11:50:00Z", now) === "2m_15m");
check(
  "zeer oude heartbeat lekt alleen een grove bucket",
  resolveTgcWorkerAgeBucket("2026-08-22T10:00:00Z", now) === "1h_plus",
);
check("ongeldige heartbeat heeft onbekende leeftijd", resolveTgcWorkerAgeBucket("niet-een-datum", now) === "unknown");
check("workerstatus krijgt een vaste auditactie", tgcWorkerMonitorAction("offline") === "tgc_worker.offline");
check(
  "auditactie wordt teruggelezen als workerstatus",
  tgcWorkerStateFromMonitorAction("tgc_worker.available") === "available",
);
check("onbekende auditactie wordt niet vertrouwd", tgcWorkerStateFromMonitorAction("auth.login") === null);
check("eerste monitorrun schrijft een overgang", tgcWorkerStateChanged(null, "unknown"));
check("gelijke monitorstatus schrijft geen herhaling", !tgcWorkerStateChanged("tgc_worker.offline", "offline"));
check("gewijzigde monitorstatus schrijft een overgang", tgcWorkerStateChanged("tgc_worker.offline", "available"));

const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260820141215_careon_tgc_sync_jobs.sql"),
  "utf8",
);
check("queue heeft RLS", migration.includes("alter table public.careon_tgc_sync_jobs enable row level security"));
check("queue heeft expliciete grants", migration.includes("grant select, insert on table public.careon_tgc_sync_jobs"));
check("queue is tenant-scoped", migration.includes("app.is_org_member(org_id)"));
check("één actieve job per organisatie", migration.includes("careon_tgc_sync_jobs_one_active_per_org_uidx"));
check(
  "browsergebruikers kunnen jobs niet muteren",
  !migration.includes("grant select, insert, update on table public.careon_tgc_sync_jobs to authenticated"),
);

const heartbeatMigration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260822233000_tgc_worker_heartbeat.sql"),
  "utf8",
);
check("workerheartbeat heeft geforceerde RLS", heartbeatMigration.includes("force row level security"));
check("leden mogen alleen heartbeatmetadata lezen", heartbeatMigration.includes("grant select on table"));
check(
  "heartbeatmutatie is alleen service-role RPC",
  heartbeatMigration.includes(
    "grant execute on function public.careon_tgc_worker_heartbeat(uuid, text) to service_role",
  ) && heartbeatMigration.includes("coalesce(auth.role(), '') <> 'service_role'"),
);
check("heartbeat gebruikt de databaseklok", heartbeatMigration.includes("statement_timestamp()"));

const route = fs.readFileSync(path.join(ROOT, "src/app/api/careon/tgc-sync/route.ts"), "utf8");
const assistant = fs.readFileSync(
  path.join(ROOT, "src/app/(main)/dashboard/assistent/_components/assistent-content.tsx"),
  "utf8",
);
const importCard = fs.readFileSync(
  path.join(ROOT, "src/app/(main)/dashboard/databron/_components/tgc-ai-import.tsx"),
  "utf8",
);
const worker = fs.readFileSync(path.join(ROOT, "src/scripts/process-tgc-sync-queue.ts"), "utf8");
const monitorRoute = fs.readFileSync(path.join(ROOT, "src/app/api/internal/tgc-worker-monitor/route.ts"), "utf8");
const monitorService = fs.readFileSync(
  path.join(ROOT, "src/lib/careon-production/tgc-worker-monitor.server.ts"),
  "utf8",
);
const adminService = fs.readFileSync(path.join(ROOT, "src/lib/careon-admin/admin.server.ts"), "utf8");
const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
  crons?: { path?: string; schedule?: string }[];
};
check("jobroute vereist een Careon-sessie", route.includes("requireCareonSession()"));
check(
  "jobroute is privé, no-store en nosniff",
  route.includes('"Cache-Control": "private, no-store, max-age=0"') &&
    route.includes('"X-Content-Type-Options": "nosniff"') &&
    route.includes("privateResponse(auth.denied)"),
);
check("AI-chat start deterministisch een job", assistant.includes("isTgcImportUpdateRequest(text)"));
check("AI-chat vraagt geen extra bevestiging", assistant.includes("u hoeft niets meer in te voeren"));
check("Databron-knop aanwezig", importCard.includes("Update imports through AI"));
check(
  "handmatige importtekst blijft zichtbaar",
  importCard.includes("handmatige import hieronder blijft altijd beschikbaar"),
);
check("statuspaneel pollt de job", importCard.includes("readJob(job.id)"));
check("Databron toont workerbeschikbaarheid", importCard.includes("TGC-worker beschikbaar"));
check("offline aanvraag blijft expliciet veilig in wachtrij", importCard.includes("blijft veilig in de wachtrij"));
check("worker gebruikt lokale credentialomgeving", worker.includes(".env.tgc.local"));
check("idle worker publiceert metadataheartbeat", worker.includes('rest("rpc/careon_tgc_worker_heartbeat"'));
check("worker verifieert centrale data", worker.includes('runScript("verify-tgc-live.ts"'));
check("wachtwoord staat niet in workerbron", !/TGC2025/i.test(worker));
check(
  "centrale workermonitor vereist het cronsecret met constante-tijdvergelijking",
  monitorRoute.includes("process.env.CRON_SECRET") && monitorRoute.includes("timingSafeEqual"),
);
check(
  "workermonitor is no-store en nosniff",
  monitorRoute.includes('"Cache-Control": "no-store, max-age=0"') &&
    monitorRoute.includes('"X-Content-Type-Options": "nosniff"'),
);
check(
  "offline of onbekende worker faalt de cron zichtbaar",
  monitorRoute.includes('result.state !== "available"') && monitorRoute.includes("}, 503)"),
);
check(
  "workermonitor leest alleen organisatie-, heartbeat- en auditmetadata",
  monitorService.includes("organizations?") &&
    monitorService.includes("careon_tgc_sync_workers?") &&
    monitorService.includes("audit_events?") &&
    !monitorService.includes("careon_production_") &&
    !monitorService.includes("careon_tgc_sync_jobs") &&
    !monitorService.includes("TGC_PASSWORD"),
);
check(
  "statusovergang wordt synchroon geaudit",
  monitorService.includes("await writeAuditEvent") &&
    monitorService.includes('resource: "careon_tgc_sync_workers"') &&
    !monitorService.includes("scheduleAuditEvent"),
);
check(
  "beheerfilter kent alle drie workerstatussen",
  ["tgc_worker.available", "tgc_worker.offline", "tgc_worker.unknown"].every((action) =>
    adminService.includes(`"${action}"`),
  ),
);
check(
  "Vercel controleert worker elke vijf minuten",
  vercelConfig.crons?.some(
    (cron) => cron.path === "/api/internal/tgc-worker-monitor" && cron.schedule === "*/5 * * * *",
  ) === true,
);

console.log(`\nTGC queue verification: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);

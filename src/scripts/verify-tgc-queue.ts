/** Deterministic release gate for the AI-triggered TGC import queue. */

import {
  operationsAlertPayload,
  operationsAlertWebhookDigest,
  parseOperationsAlert,
  resolveOperationsAlertConfiguration,
  serializedOperationsAlertPayload,
} from "../lib/careon-operations/operations-alerts";
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

const workflowUrl =
  "https://default.b5.environment.api.powerplatform.com/powerautomate/automations/direct/cu/20/workflows/11111111111111111111111111111111/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=synthetic-secret";
function workflowConfig(url: string, host = "default.b5.environment.api.powerplatform.com") {
  return {
    CAREON_OPERATIONS_ALERT_TEAMS_ENABLED: "1",
    CAREON_OPERATIONS_ALERT_TEAMS_REQUIRED: "1",
    CAREON_OPERATIONS_ALERT_TEAMS_WEBHOOK_URL: url,
    CAREON_OPERATIONS_ALERT_TEAMS_WEBHOOK_HOST: host,
    CAREON_OPERATIONS_ALERT_TEAMS_WEBHOOK_SHA256: operationsAlertWebhookDigest(url),
  };
}
const workflowEnvironment = workflowConfig(workflowUrl);
check(
  "complete Teams Workflows-configuratie wordt geaccepteerd",
  resolveOperationsAlertConfiguration(workflowEnvironment).status === "ready",
);
check("alarmering is standaard bewust uitgeschakeld", resolveOperationsAlertConfiguration({}).status === "disabled");
check(
  "volledig voorbereide maar uitgeschakelde configuratie verstuurt niets",
  resolveOperationsAlertConfiguration({
    ...workflowEnvironment,
    CAREON_OPERATIONS_ALERT_TEAMS_ENABLED: "0",
    CAREON_OPERATIONS_ALERT_TEAMS_REQUIRED: "0",
  }).status === "disabled",
);
for (const [name, environment] of [
  ["verplicht maar uitgeschakeld", { ...workflowEnvironment, CAREON_OPERATIONS_ALERT_TEAMS_ENABLED: "0" }],
  [
    "gedeeltelijke configuratie",
    { CAREON_OPERATIONS_ALERT_TEAMS_ENABLED: "1", CAREON_OPERATIONS_ALERT_TEAMS_WEBHOOK_URL: workflowUrl },
  ],
  ["ongeldige vlag", { ...workflowEnvironment, CAREON_OPERATIONS_ALERT_TEAMS_ENABLED: "ja" }],
  ["afwijkende URL-digest", { ...workflowEnvironment, CAREON_OPERATIONS_ALERT_TEAMS_WEBHOOK_SHA256: "0".repeat(64) }],
  ["onveilig protocol", workflowConfig(workflowUrl.replace("https://", "http://"))],
  ["afwijkende host", { ...workflowEnvironment, CAREON_OPERATIONS_ALERT_TEAMS_WEBHOOK_HOST: "evil.example.com" }],
  [
    "verouderd Logic Apps-domein",
    workflowConfig(
      workflowUrl.replace("default.b5.environment.api.powerplatform.com", "prod-1.westeurope.logic.azure.com"),
      "prod-1.westeurope.logic.azure.com",
    ),
  ],
  ["ontbrekende SAS-signatuur", workflowConfig(workflowUrl.replace("&sig=synthetic-secret", ""))],
  ["dubbele SAS-signatuur", workflowConfig(`${workflowUrl}&sig=tweede`)],
  ["fragment in secret-URL", workflowConfig(`${workflowUrl}#fragment`)],
] as const) {
  check(`Teams Workflows weigert ${name}`, resolveOperationsAlertConfiguration(environment).status === "invalid");
}

const incidentAlert = parseOperationsAlert({
  id: "33333333-3333-4333-8333-333333333333",
  eventType: "incident",
  workerState: "offline",
  previousState: "available",
  ageBucket: "2m_15m",
  observedAt: "2026-08-22T12:00:00.000Z",
  attempt: 1,
});
check("geldige metadata-only incidentclaim wordt geparseerd", incidentAlert !== null);
if (!incidentAlert) throw new Error("Ongeldige operations-alertfixture.");
const incidentPayload = operationsAlertPayload(incidentAlert);
const incidentWire = serializedOperationsAlertPayload(incidentAlert);
check(
  "incidentpayload is begrensd Nederlands en bevat alleen operationele metadata",
  incidentPayload.text.includes("niet bereikbaar") &&
    incidentPayload.text.includes("2–15 minuten") &&
    incidentPayload.text.includes("https://www.careonpulse.com/dashboard/databron") &&
    Buffer.byteLength(incidentWire, "utf8") <= 2_048 &&
    !/patient|client|queue|email|orgId|export/i.test(incidentWire),
);
const recoveryAlert = parseOperationsAlert({
  ...incidentAlert,
  id: "44444444-4444-4444-8444-444444444444",
  eventType: "recovery",
  workerState: "available",
  previousState: "offline",
});
check(
  "herstelpayload noemt de vorige operationele status",
  recoveryAlert !== null && operationsAlertPayload(recoveryAlert).text.includes("vorige status: offline"),
);
for (const [name, alert] of [
  ["niet-v4 incident-id", { ...incidentAlert, id: "11111111-1111-1111-8111-111111111111" }],
  ["incident in beschikbare staat", { ...incidentAlert, workerState: "available" }],
  [
    "herstel zonder storing",
    { ...incidentAlert, eventType: "recovery", workerState: "available", previousState: "available" },
  ],
  ["onbekende leeftijdsbucket", { ...incidentAlert, ageBucket: "exact_123_seconds" }],
  ["poging nul", { ...incidentAlert, attempt: 0 }],
  ["ongeldig tijdstip", { ...incidentAlert, observedAt: "geen-datum" }],
] as const) {
  check(`alertclaim weigert ${name}`, parseOperationsAlert(alert) === null);
}

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
const alertMigration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260823000000_operations_alert_outbox.sql"),
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
check(
  "operations-outbox heeft geforceerde RLS en geen clienttoegang",
  alertMigration.includes("alter table public.careon_operations_alert_outbox force row level security") &&
    alertMigration.includes(
      "revoke all on table public.careon_operations_alert_outbox from public, anon, authenticated",
    ) &&
    !alertMigration.includes("to authenticated"),
);
check(
  "outbox geeft service-role geen deletebevoegdheid",
  alertMigration.includes(
    "grant select, insert, update on table public.careon_operations_alert_outbox to service_role",
  ) && !alertMigration.includes("grant select, insert, update, delete on table public.careon_operations_alert_outbox"),
);
check(
  "één auditovergang kan exact één alert opleveren",
  alertMigration.includes("unique (source_event_id)") &&
    alertMigration.includes("on conflict (source_event_id) do nothing"),
);
check(
  "dubbele croninvocaties worden transactioneel geserialiseerd",
  alertMigration.includes("pg_catalog.pg_advisory_xact_lock") &&
    alertMigration.includes("v_previous is distinct from p_state"),
);
check(
  "queueclaim gebruikt korte SKIP LOCKED-transactie en herstelbare lease",
  alertMigration.includes("for update skip locked") &&
    alertMigration.includes("interval '10 minutes'") &&
    alertMigration.includes("p_lock_token"),
);
check(
  "pending en sending wachtrijen hebben passende partiële indexen",
  alertMigration.includes("careon_operations_alert_outbox_pending_idx") &&
    alertMigration.includes("where status = 'pending'") &&
    alertMigration.includes("careon_operations_alert_outbox_sending_idx") &&
    alertMigration.includes("where status = 'sending'"),
);
check(
  "outbox-RPC's blijven invoker-only en service-role-only",
  !alertMigration.includes("security definer") &&
    alertMigration.includes("security invoker") &&
    alertMigration.includes("revoke all on function public.careon_record_tgc_worker_transition") &&
    alertMigration.includes("grant execute on function public.careon_record_tgc_worker_transition"),
);
check(
  "HTTP-fouten krijgen begrensde exponentiële herplanning",
  alertMigration.includes("when item.attempts <= 1 then interval '1 minute'") &&
    alertMigration.includes("when item.attempts = 4 then interval '1 hour'") &&
    alertMigration.includes("else interval '6 hours'"),
);
check(
  "geslaagde levering wordt metadata-only geaudit",
  alertMigration.includes("'operations.alert.delivered'") &&
    alertMigration.includes("'source', 'tgc_worker'") &&
    !alertMigration.includes("payload jsonb") &&
    !alertMigration.includes("detail jsonb") &&
    !alertMigration.includes("careon_tgc_sync_jobs"),
);

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
const alertService = fs.readFileSync(path.join(ROOT, "src/lib/careon-operations/operations-alerts.server.ts"), "utf8");
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
  "workermonitor leest alleen organisatie- en heartbeatmetadata",
  monitorService.includes("organizations?") &&
    monitorService.includes("careon_tgc_sync_workers?") &&
    !monitorService.includes("audit_events?") &&
    !monitorService.includes("careon_production_") &&
    !monitorService.includes("careon_tgc_sync_jobs") &&
    !monitorService.includes("TGC_PASSWORD"),
);
check(
  "statusovergang en alert-outbox worden synchroon door één RPC vastgelegd",
  monitorService.includes("await recordTgcWorkerTransition") &&
    !monitorService.includes("writeAuditEvent") &&
    !monitorService.includes("scheduleAuditEvent"),
);
const webhookFetchStart = alertService.indexOf("response = await fetch(configuration.webhookUrl");
const webhookFetchEnd = alertService.indexOf("    });", webhookFetchStart);
const webhookFetch = alertService.slice(webhookFetchStart, webhookFetchEnd);
check(
  "Teams-call heeft geen Microsoft- of servicecredentialheader",
  webhookFetchStart >= 0 &&
    !webhookFetch.includes("Authorization") &&
    !webhookFetch.includes("SERVICE_KEY") &&
    webhookFetch.includes('redirect: "error"') &&
    webhookFetch.includes("AbortSignal.timeout(5_000)"),
);
check(
  "webhookrespons wordt niet ingelezen of gelogd",
  !webhookFetch.includes("response.text()") &&
    !webhookFetch.includes("response.json()") &&
    !alertService.includes("console."),
);
check(
  "monitorroute behandelt een onbezorgde operations-alert als centrale fout",
  monitorRoute.includes("await dispatchOperationsAlert()") &&
    monitorRoute.includes('alert.status === "pending"') &&
    monitorRoute.includes("}, 502)"),
);
check(
  "beheerfilter kent alle drie workerstatussen",
  ["tgc_worker.available", "tgc_worker.offline", "tgc_worker.unknown"].every((action) =>
    adminService.includes(`"${action}"`),
  ) && adminService.includes('"operations.alert.delivered"'),
);
check(
  "Vercel controleert worker elke vijf minuten",
  vercelConfig.crons?.some(
    (cron) => cron.path === "/api/internal/tgc-worker-monitor" && cron.schedule === "*/5 * * * *",
  ) === true,
);

console.log(`\nTGC queue verification: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);

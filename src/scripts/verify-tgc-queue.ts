/** Deterministic release gate for the AI-triggered TGC import queue. */

import { isTgcImportUpdateRequest } from "../lib/careon-production/tgc-sync-jobs";
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
check("jobroute vereist een Careon-sessie", route.includes("requireCareonSession()"));
check("AI-chat start deterministisch een job", assistant.includes("isTgcImportUpdateRequest(text)"));
check("AI-chat vraagt geen extra bevestiging", assistant.includes("u hoeft niets meer in te voeren"));
check("Databron-knop aanwezig", importCard.includes("Update imports through AI"));
check(
  "handmatige importtekst blijft zichtbaar",
  importCard.includes("handmatige import hieronder blijft altijd beschikbaar"),
);
check("statuspaneel pollt de job", importCard.includes("readJob(job.id)"));
check("worker gebruikt lokale credentialomgeving", worker.includes(".env.tgc.local"));
check("worker verifieert centrale data", worker.includes('runScript("verify-tgc-live.ts"'));
check("wachtwoord staat niet in workerbron", !/TGC2025/i.test(worker));

console.log(`\nTGC queue verification: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "../..");

function readEnvLocal(): Record<string, string> {
  const envPath = path.join(ROOT, ".env.local");
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const env = readEnvLocal();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  assert(supabaseUrl && serviceKey, "Supabase-configuratie ontbreekt.");
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  const orgResponse = await fetch(`${supabaseUrl}/rest/v1/organizations?slug=eq.tgc&select=id&limit=1`, { headers });
  assert(orgResponse.ok, `Organisatie-opvraag faalde (${orgResponse.status}).`);
  const organizations = (await orgResponse.json()) as { id: string }[];
  const orgId = organizations[0]?.id;
  assert(orgId, "TGC-organisatie ontbreekt.");

  const runResponse = await fetch(
    `${supabaseUrl}/rest/v1/careon_import_runs?org_id=eq.${orgId}&select=id,file_name,imported_at,total_rows&order=imported_at.desc&limit=1`,
    { headers },
  );
  assert(runResponse.ok, `Import-runopvraag faalde (${runResponse.status}).`);
  const runs = (await runResponse.json()) as {
    id: string;
    file_name: string;
    imported_at: string;
    total_rows: number;
  }[];
  const run = runs[0];
  assert(
    run && /^cli_ntendata_export.*\.csv$/i.test(run.file_name),
    "Nieuwste cliëntimport ontbreekt of heeft het verkeerde bestand.",
  );

  async function latestState(table: string): Promise<{ saved_at: string; state: Record<string, unknown> }> {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/${table}?org_id=eq.${orgId}&select=saved_at,state&order=saved_at.desc&limit=1`,
      { headers },
    );
    assert(response.ok, `${table}-opvraag faalde (${response.status}).`);
    const rows = (await response.json()) as { saved_at: string; state: Record<string, unknown> }[];
    assert(rows[0], `${table} bevat geen centrale stand.`);
    return rows[0];
  }

  const agenda = await latestState("careon_agenda_state");
  const referrers = await latestState("careon_verwijzers_state");
  const declarations = await latestState("careon_declaraties_state");
  const surcharges = await latestState("careon_toeslagen_state");
  const timestamps = [run.imported_at, agenda.saved_at, referrers.saved_at, declarations.saved_at, surcharges.saved_at];
  const oldest = Math.min(...timestamps.map((value) => Date.parse(value)));
  assert(
    Date.now() - oldest < 2 * 60 * 60 * 1_000,
    "Niet alle vijf centrale snapshots zijn in de laatste twee uur vernieuwd.",
  );

  const agendaState = agenda.state as { totalRows?: number; sessieRows?: number; toekomst?: { sessies?: number } };
  const referrerState = referrers.state as { totalRows?: number; contacten?: unknown[] };
  const declarationState = declarations.state as {
    totalRows?: number;
    facturen?: unknown[];
    bronVan?: string;
    bronTot?: string;
  };
  const surchargeState = surcharges.state as { totalRows?: number };
  assert(
    (agendaState.totalRows ?? 0) > 0 && (agendaState.toekomst?.sessies ?? 0) > 0,
    "Agenda of toekomstvenster ontbreekt.",
  );
  assert((referrerState.totalRows ?? 0) > 0, "Verwijzerstand is leeg.");
  assert(
    (declarationState.totalRows ?? 0) > 0 && declarationState.bronVan,
    "Declaratiestand is leeg of mist historie.",
  );
  assert((surchargeState.totalRows ?? 0) > 0, "Toeslagenstand is leeg.");

  console.log(
    JSON.stringify({
      importedAt: run.imported_at,
      clients: run.total_rows,
      agendaRows: agendaState.totalRows,
      historicalSessions: agendaState.sessieRows,
      plannedSessions: agendaState.toekomst?.sessies,
      referrerRows: referrerState.totalRows,
      referrers: referrerState.contacten?.length,
      declarationRows: declarationState.totalRows,
      invoices: declarationState.facturen?.length,
      declarationRange: `${declarationState.bronVan}..${declarationState.bronTot}`,
      surchargeRows: surchargeState.totalRows,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

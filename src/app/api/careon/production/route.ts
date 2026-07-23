import { NextResponse } from "next/server";

import { type ClientRecord, isClientRecord, type ProductionState } from "@/lib/careon-production/types";

// Optionele Supabase-persistentie voor productie-modus. Zonder geconfigureerde
// omgeving (zie .env.example) antwoordt deze route met 501 en valt de client
// terug op localStorage — de app blijft volledig werken.
//
// Bewust via PostgREST-fetch in plaats van @supabase/supabase-js: geen extra
// npm-dependency (voorkomt ook het WSL/Windows-dubbelinstallatieprobleem).
// De service-role key blijft server-side; RLS houdt anon-clients buiten.
//
// Toegangsdrempel: het sync-token is verplicht onderdeel van de configuratie.
// Het staat óók in de client-bundle (NEXT_PUBLIC_) en is dus een drempel tegen
// scanners en toevallige bezoekers, géén authenticatie — echte auth is een
// harde voorwaarde vóór publieke hosting (zie PRODUCTION_MODE.md).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNC_TOKEN = process.env.NEXT_PUBLIC_CAREON_SYNC_TOKEN;

const MAX_RECORDS = 20_000;

function restHeaders(): HeadersInit {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

function notConfigured() {
  return NextResponse.json({ configured: false }, { status: 501 });
}

function guard(request: Request): NextResponse | null {
  if (!SUPABASE_URL || !SERVICE_KEY || !SYNC_TOKEN) {
    return notConfigured();
  }
  if (request.headers.get("x-careon-sync") !== SYNC_TOKEN) {
    return NextResponse.json({ error: "Niet geautoriseerd." }, { status: 401 });
  }
  return null;
}

interface RunRow {
  id: string;
  file_name: string;
  imported_at: string;
  total_rows: number;
}

// PostgREST kapt élk antwoord af op de `max-rows`-instelling van het project
// (Supabase-standaard 1000) — óók de records van een embedded resource. Eén
// round-trip leverde daardoor stilzwijgend een onvolledige run zodra de export
// boven die grens groeide (juli 2026: 959 → 1267 cliënten). De
// volledigheidscontrole verwierp dan élke run en de route antwoordde met
// `state: null`: browsers zonder eigen import bleven op demo staan en browsers
// mét een oude import hielden die vast. Records worden nu per pagina opgehaald,
// zodat de route onafhankelijk is van die serverinstelling.
const PAGE_SIZE = 1000;

type RecordsResult =
  | { status: "ok"; records: ClientRecord[] }
  /** Run is onbruikbaar (insert destijds halverwege gefaald) — probeer de vorige. */
  | { status: "incomplete" }
  /** Supabase onbereikbaar — geen stille terugval op een oudere run. */
  | { status: "error" };

async function fetchRunRecords(runId: string, totalRows: number): Promise<RecordsResult> {
  const records: ClientRecord[] = [];
  while (records.length < totalRows && records.length < MAX_RECORDS) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/careon_import_records?select=record&run_id=eq.${runId}&order=id.asc&limit=${PAGE_SIZE}&offset=${records.length}`,
      { headers: restHeaders(), cache: "no-store" },
    );
    if (!response.ok) {
      return { status: "error" };
    }
    const rows = (await response.json()) as { record: ClientRecord }[];
    // Lege pagina vóór `total_rows`: er staan minder records dan de run belooft.
    if (rows.length === 0) {
      return { status: "incomplete" };
    }
    records.push(...rows.map((row) => row.record));
  }
  return records.length === totalRows ? { status: "ok", records } : { status: "incomplete" };
}

export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  // Drie runs i.p.v. één, plus een volledigheidscontrole: een run waarvan de
  // records-insert halverwege faalde mag niet als "laatste stand" doorgaan en
  // de vorige goede run verduisteren.
  const runResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/careon_import_runs?select=id,file_name,imported_at,total_rows&order=imported_at.desc&limit=3`,
    { headers: restHeaders(), cache: "no-store" },
  );
  if (!runResponse.ok) {
    return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
  }
  const runs = (await runResponse.json()) as RunRow[];

  for (const run of runs) {
    // total_rows 0 = run van vóór die kolom (zie migratie 0001): overslaan.
    if (run.total_rows <= 0) continue;
    const result = await fetchRunRecords(run.id, run.total_rows);
    if (result.status === "error") {
      return NextResponse.json({ error: "Supabase niet bereikbaar." }, { status: 502 });
    }
    if (result.status === "incomplete") continue;

    const state: ProductionState = {
      fileName: run.file_name,
      importedAt: run.imported_at,
      records: result.records,
    };
    return NextResponse.json({ configured: true, state });
  }

  return NextResponse.json({ configured: true, state: null });
}

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  let body: Partial<ProductionState>;
  try {
    body = (await request.json()) as Partial<ProductionState>;
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON." }, { status: 400 });
  }

  if (
    typeof body.fileName !== "string" ||
    typeof body.importedAt !== "string" ||
    !Array.isArray(body.records) ||
    body.records.length === 0 ||
    body.records.length > MAX_RECORDS ||
    !body.records.every(isClientRecord)
  ) {
    return NextResponse.json({ error: "Ongeldige productie-state." }, { status: 400 });
  }

  const runResponse = await fetch(`${SUPABASE_URL}/rest/v1/careon_import_runs`, {
    method: "POST",
    headers: { ...restHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({
      file_name: body.fileName,
      imported_at: body.importedAt,
      total_rows: body.records.length,
    }),
  });
  if (!runResponse.ok) {
    return NextResponse.json({ error: "Import-run kon niet worden opgeslagen." }, { status: 502 });
  }
  const [run] = (await runResponse.json()) as { id: string }[];

  const recordsResponse = await fetch(`${SUPABASE_URL}/rest/v1/careon_import_records`, {
    method: "POST",
    headers: restHeaders(),
    body: JSON.stringify(body.records.map((record) => ({ run_id: run.id, record }))),
  });
  if (!recordsResponse.ok) {
    // Compenserende delete: zonder deze opruiming blijft een lege run als
    // "nieuwste" staan (de GET-volledigheidscontrole vangt dat ook, maar een
    // wees-run hoort niet in de historie).
    await fetch(`${SUPABASE_URL}/rest/v1/careon_import_runs?id=eq.${run.id}`, {
      method: "DELETE",
      headers: restHeaders(),
    }).catch(() => undefined);
    return NextResponse.json({ error: "Records konden niet worden opgeslagen." }, { status: 502 });
  }

  return NextResponse.json({ configured: true, runId: run.id });
}

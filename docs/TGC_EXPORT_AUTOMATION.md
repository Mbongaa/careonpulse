# TGC export automation

Portal routes were last verified against TGC/ZSG version 3.11.0 on 20 August
2026. Worker availability was production-accepted on 22 August 2026.

## Outcome

`npm run sync:tgc` performs the complete production refresh:

1. signs in to `https://tgc.zsg.nl` in a headless Chromium session;
2. requests full snapshots for all five production sources;
3. waits for the asynchronous reports and downloads their CSV files;
4. validates all files with the dashboard's production parsers;
5. promotes the five files together to the ignored `Exports EPD/` directory;
6. invokes `npm run push:production` to replace the central TGC snapshot in Supabase.

If any report or validation fails, the push is not started. The four
configurable reports use full-history filters. Client and agenda exports also
use per-run field allowlists so unnecessary direct identifiers are omitted at
the source.

The Databron page and Careon AI use the same runner through
`careon_tgc_sync_jobs`. A click on **Update imports through AI**, or an explicit
chat request such as “werk de TGC-exports bij”, creates one organization-scoped
job and requires no follow-up input. The web app never receives the portal
credential: the local Windows worker claims the job with its server-side
Supabase key, reads the ignored `.env.tgc.local`, reports progress, runs the
five-export refresh, and marks the job successful only after central read-back
verification. The existing drag-and-drop/manual import controls remain in
place.

## Worker availability

The queue worker publishes a metadata-only heartbeat when it starts and every
30 seconds thereafter. The heartbeat contains only the Careon organization,
worker version and Supabase server timestamp; it never contains the Windows
hostname, process ID, portal credential, patient data or export contents.

Databron converts that server-side heartbeat into three explicit states:

- **TGC-worker beschikbaar** — the latest valid heartbeat is at most 90 seconds
  old;
- **TGC-worker niet bereikbaar** — a previously known worker has not reported
  within 90 seconds;
- **Workerstatus onbekend** — no trustworthy heartbeat exists yet or the
  timestamp is invalid.

The page reads this state under the signed-in employee's organization-scoped
Supabase access. Only the local service-role worker can call the heartbeat RPC;
authenticated employees and even direct service-role table writes are denied.
An unavailable worker never causes a queued refresh to disappear: the request
remains safely queued and starts after the exact Windows task/workstation is
available again.

## Portal inventory

| # | Production source | Exact portal location | Route | Required settings | Result behavior |
|---|---|---|---|---|---|
| 1 | Cliëntendata-export | Management Suite → Tools → Zorgtraject management → Export → Cliëntendata export | `/management-suite-tool/care-process-management-export-patients-data` | Instelling, locatie, behandelaar, zorgsoort, status and role: Alle; include clients without episode: Alle cliënten; start: `01-01-2023` | Asynchronous report; download link is `/export/{reportId}`. The page also exposes native Automatiseringen and per-user default fields. |
| 2 | Agenda-/afsprakenexport | Management Suite → Tools → Zorgtraject management → Export → Exporteer agenda afspraken | `/management-suite-tool/care-process-management-export-appointments` | Instelling, zorgsoort and type: Alle; start: `01-01-2023`; end: dynamically 18 months ahead | Asynchronous report; download link is `/export/{reportId}`. The future range is mandatory for follow-up and forecast metrics. |
| 3 | Huisarts/verwijzer-export | Management Suite → Tools → Zorgtraject management → Export → Export huisarts / verwijzer | `/management-suite-tool/care-process-management-export-referrer` | No form; the menu action is the full snapshot | The route is a direct CSV download. |
| 4 | Gedeclareerde toeslagen | Financieel → ZPM → Overzichten & Tools → Overzicht → Declaratiemanagement → Gedeclareerde toeslagen | `/financial-zpm-overview/overview/declared-surcharges` | Instelling/praktijk: TGC B.V.; Verzekeringskoepels empty (all); start `01-10-2025`; end today | Synchronous results page at `?showResults=yes`, followed by `/download`. |
| 5 | Declaratie export totaal | Financieel → Algemeen → Declaratie export totaal | `/financial-general-declaration-total` | Instelling: TGC B.V.; start `01-04-2025`; end today | Asynchronous report; download link is `/download/{reportId}`. Includes debit, credit, open and paid invoice rows. |

If the fifth report worker does not finish within its short grace period, the
runner reads TGC's own four invoice-status feeds under Financieel → ZPM →
Financiën (`open`, `reply`, `resolved`, `archived`). It builds the same
invoice-level CSV locally from invoice number/date, insurer, debit or credit
amount, awarded amount and the credit target shown in parentheses. Empty
insurer names are emitted directly as `Particulier`; the client-name column is
never read. This fallback was verified on 20 August 2026 against 302 current
invoice rows, including nine credits. The live feeds currently begin on
1 August 2025. The runner therefore carries forward only the earlier immutable
invoice segment from the newest validated full declaration CSV and marks rows
that no longer occur in any live status feed as resolved. It fails closed if
that historical basis is unavailable, so the May–July 2025 history can never
silently disappear.

Portal report history is injected about 1–2 seconds after the main page load.
The runner deliberately waits for this late content and identifies a new
report by its unique download URL, not by its row position or display date.

## Privacy boundary

The client field allowlist excludes names, BSN, date of birth, street address,
postcode, phone numbers, email addresses, insurance number and authorization
number. The agenda allowlist excludes BSN, client name, postcode, debtor number
and free-text memo. The runner rejects these headers if TGC returns them despite
the allowlist.

The fixed referrer, surcharge and declaration reports cannot be field-reduced
in the portal. Their production parsers aggregate immediately: email and raw
appointment rows are discarded, client names in surcharge data are used only
for unique counts, and private debtor names become `Particulier`. Raw CSV files
stay only in the gitignored local export directory and are never committed.

## Configuration

Create `.env.tgc.local` in the project root (it is ignored by `.gitignore`):

```dotenv
TGC_BASE_URL=https://tgc.zsg.nl
TGC_USERNAME=...
TGC_PASSWORD=...
TGC_REPORT_TIMEOUT_MINUTES=30
TGC_REPORT_POLL_SECONDS=10
TGC_DECLARATION_GRACE_MINUTES=3
TGC_QUEUE_POLL_SECONDS=5
```

Supabase values continue to come from `.env.local`. The service-role key is
used only by the server-side push script and must never be exposed to browser
or client code.

`CAREON_TGC_ORG_SLUG` optionally selects the organization that owns this
connector and defaults to `tgc`. This keeps a future organization from
accidentally using TGC's worker credentials.

## Commands

```powershell
npm run verify:tgc-sync
npm run verify:tgc-queue
npm run sync:tgc -- --no-push
npm run sync:tgc -- --no-push --declaration-feed
npm run sync:tgc
npm run sync:tgc -- --push-only
```

`--no-push` still generates, validates and publishes local snapshots; it only
skips the Supabase step. `--declaration-feed` skips the primary background job
and uses the verified finance feeds immediately. `--headed` opens Chromium for
portal troubleshooting. `--push-only` reruns only the central push against the
newest already validated local exports; normal stale-state protection remains
active.

## Scheduling and operations

The recommended cadence is weekly on Monday at 06:00 local time. A weekly full
snapshot closes normal appointment changes quickly and catches the early-month
invoice run without depending on a single monthly execution. TGC exports are
snapshots, never deltas, so all configured start dates remain fixed.

On Windows, install that schedule from an ordinary PowerShell session:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-tgc-sync-task.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-tgc-sync-worker-task.ps1
```

The task runs only in the current user's interactive session, starts at the
next available opportunity if 06:00 was missed, retries failures, and ignores a
second trigger while a sync is already running. Its local log is
`logs/tgc-sync.log` and is gitignored.

The second task is the continuously available queue worker used by the page
button and Careon AI. It starts at Windows sign-in, restarts after failure,
polls only metadata, publishes the heartbeat described above, and writes
`logs/tgc-sync-worker.log`. If the workstation is off, requests safely remain
queued and start automatically at the next sign-in. The runner lock prevents a
weekly and AI-triggered refresh from overlapping. The exact interactive task is
`Careon TGC AI Import Worker`; check that it is `Running` before treating the
workstation as an available ingestion host.

Operational safeguards:

- only one runner should execute at a time;
- all five files must pass before any central write;
- `push:production` refuses files older than the central Supabase state;
- report polling fails closed after the configured timeout;
- logs contain workflow and aggregate counts, not credentials or patient rows;
- a portal field/route change fails validation instead of silently reducing the dashboard.

The scheduled host must have Node.js dependencies and the Playwright Chromium
runtime installed (`npx playwright install chromium`). Run the no-push command
after any TGC upgrade before allowing the next production refresh.

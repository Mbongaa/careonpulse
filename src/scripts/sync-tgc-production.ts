/**
 * Authenticated TGC export runner.
 *
 * Generates all five full-snapshot EPD reports in the TGC browser UI,
 * downloads them into the ignored `Exports EPD/` directory, validates them
 * through the production parsers and then invokes the existing Supabase push.
 *
 * Usage:
 *   npm run sync:tgc
 *   npm run sync:tgc -- --no-push
 *   npm run sync:tgc -- --headed
 *   npm run sync:tgc -- --declaration-feed
 *   npm run sync:tgc -- --push-only
 */

import { chromium, type Download, type Page } from "playwright";

import { parseAgendaExport } from "../lib/careon-production/parse-agenda";
import { parseDeclaratiesExport } from "../lib/careon-production/parse-declaraties";
import { parseClientExport, splitLine } from "../lib/careon-production/parse-export";
import { parseToeslagenExport } from "../lib/careon-production/parse-toeslagen";
import { parseVerwijzersExport } from "../lib/careon-production/parse-verwijzers";
import {
  AGENDA_FORBIDDEN_HEADERS,
  AGENDA_RESULT_FIELDS,
  addMonths,
  CLIENT_FORBIDDEN_HEADERS,
  CLIENT_RESULT_FIELDS,
  formatDutchDate,
  TGC_BASE_URL,
  TGC_DATE_RANGES,
  TGC_ROUTES,
  timestampForFile,
} from "../lib/careon-production/tgc-export-automation";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "../..");
const EXPORTS_DIR = path.join(ROOT, "Exports EPD");
const RUN_STARTED = new Date();
const RUN_STAMP = timestampForFile(RUN_STARTED);
const STAGE_DIR = path.join(EXPORTS_DIR, `.tgc-sync-${RUN_STAMP}`);
const LOCK_PATH = path.join(EXPORTS_DIR, ".tgc-sync.lock");
const SCRIPT_ENV = {
  ...readEnvFile(path.join(ROOT, ".env.local")),
  ...readEnvFile(path.join(ROOT, ".env.tgc.local")),
  ...process.env,
};
const MAX_REPORT_WAIT_MS = Number(SCRIPT_ENV.TGC_REPORT_TIMEOUT_MINUTES ?? "30") * 60_000;
const POLL_INTERVAL_MS = Number(SCRIPT_ENV.TGC_REPORT_POLL_SECONDS ?? "10") * 1_000;
const DECLARATION_GRACE_MS = Number(SCRIPT_ENV.TGC_DECLARATION_GRACE_MINUTES ?? "3") * 60_000;
const NO_PUSH = process.argv.includes("--no-push");
const HEADED = process.argv.includes("--headed");
const FORCE_DECLARATION_FEED = process.argv.includes("--declaration-feed");
const PUSH_ONLY = process.argv.includes("--push-only");

interface LocalEnv {
  [key: string]: string;
}

interface DownloadedExports {
  client: string;
  agenda: string;
  referrers: string;
  surcharges: string;
  declarations: string;
}

interface FinanceDeclarationRow {
  invoiceNumber: string;
  invoiceDate: string;
  debtor: string;
  amount: string;
  awarded: string;
  debitCredit: "D" | "C";
  creditFor: string;
}

function readEnvFile(filePath: string): LocalEnv {
  if (!fs.existsSync(filePath)) return {};
  const result: LocalEnv = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(rawLine.trim());
    if (!match) continue;
    result[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return result;
}

function loadConfiguration(): { baseUrl: string; username: string; password: string } {
  const username = SCRIPT_ENV.TGC_USERNAME;
  const password = SCRIPT_ENV.TGC_PASSWORD;
  if (!username || !password) {
    throw new Error("TGC_USERNAME en TGC_PASSWORD ontbreken in .env.tgc.local of de procesomgeving.");
  }
  return {
    baseUrl: (SCRIPT_ENV.TGC_BASE_URL ?? TGC_BASE_URL).replace(/\/$/, ""),
    username,
    password,
  };
}

function logStep(message: string): void {
  console.log(`[TGC sync] ${message}`);
}

function acquireRunLock(): number {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  if (fs.existsSync(LOCK_PATH)) {
    const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
    if (age >= 4 * 60 * 60_000) fs.rmSync(LOCK_PATH, { force: true });
  }
  try {
    const descriptor = fs.openSync(LOCK_PATH, "wx");
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: RUN_STARTED.toISOString() }), "utf8");
    return descriptor;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Er draait al een TGC-synchronisatie; een tweede run is overgeslagen.");
    }
    throw error;
  }
}

function releaseRunLock(descriptor: number): void {
  try {
    fs.closeSync(descriptor);
  } finally {
    fs.rmSync(LOCK_PATH, { force: true });
  }
}

function reportFileName(prefix: string): string {
  return `${prefix}_${RUN_STAMP}.csv`;
}

async function login(page: Page, baseUrl: string, username: string, password: string): Promise<void> {
  logStep("Aanmelden bij TGC.");
  await page.goto(`${baseUrl}${TGC_ROUTES.login}`, { waitUntil: "domcontentloaded" });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith(TGC_ROUTES.login), { timeout: 30_000 }),
    page.locator("#btnSignIn").click(),
  ]);
  if (page.url().includes(TGC_ROUTES.login)) {
    throw new Error("TGC-aanmelding is niet gelukt.");
  }
}

async function setResultFieldAllowlist(page: Page, allowed: readonly string[]): Promise<void> {
  const inputs = page.locator('input[type="checkbox"][name^="resultFields["]');
  const found = await inputs.evaluateAll(
    (elements, fieldNames) => {
      const allowedNames = new Set(fieldNames as string[]);
      const seen: string[] = [];
      for (const element of elements) {
        const input = element as HTMLInputElement;
        const match = /^resultFields\[([^\]]+)\]$/.exec(input.name);
        if (!match) continue;
        input.checked = allowedNames.has(match[1]);
        seen.push(match[1]);
      }
      return seen;
    },
    [...allowed],
  );
  const missing = allowed.filter((field) => !found.includes(field));
  if (missing.length > 0) {
    throw new Error(`TGC-exportveld(en) niet meer gevonden: ${missing.join(", ")}.`);
  }
}

async function currentDownloadLinks(page: Page, hrefPrefix: string): Promise<Set<string>> {
  // TGC injects report history asynchronously after DOMContentLoaded.
  await page.waitForTimeout(1_600);
  const hrefs = await page
    .locator(`a[href^="${hrefPrefix}"]`)
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute("href"))
        .filter((href): href is string => typeof href === "string" && href !== ""),
    );
  return new Set(hrefs);
}

async function submitAndWaitForNewReport(
  page: Page,
  baseUrl: string,
  route: string,
  priorLinks: Set<string>,
): Promise<string> {
  const hrefPrefix = `${route}/export/`;
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => undefined),
    page.locator("#btnSubmit").click(),
  ]);

  const deadline = Date.now() + MAX_REPORT_WAIT_MS;
  while (Date.now() < deadline) {
    const links = await currentDownloadLinks(page, hrefPrefix);
    const newLink = [...links].find((href) => !priorLinks.has(href));
    if (newLink) return newLink;

    await page.waitForTimeout(POLL_INTERVAL_MS);
    await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  }
  throw new Error(`TGC-rapport op ${route} was niet binnen de ingestelde wachttijd gereed.`);
}

async function saveDownload(download: Download, fileName: string): Promise<string> {
  const failure = await download.failure();
  if (failure) throw new Error(`TGC-download mislukt: ${failure}`);
  const filePath = path.join(STAGE_DIR, fileName);
  await download.saveAs(filePath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 100) {
    throw new Error(`${fileName} is leeg of onvolledig.`);
  }
  return filePath;
}

async function downloadReportLink(page: Page, baseUrl: string, href: string, fileName: string): Promise<string> {
  const targetUrl = new URL(href, baseUrl).toString();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.goto(targetUrl).catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes("Download is starting")) throw error;
      return null;
    }),
  ]);
  return saveDownload(download, fileName);
}

async function exportClientData(page: Page, baseUrl: string): Promise<string> {
  logStep("Volledige cliëntendata-export aanvragen (zonder directe patiëntidentificatoren).");
  const route = TGC_ROUTES.client;
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  const priorLinks = await currentDownloadLinks(page, `${route}/export/`);
  await page.locator('select[name="clinics[]"]').selectOption([]);
  await page.locator('select[name="locations[]"]').selectOption([]);
  await page.locator('select[name="practitioners[]"]').selectOption([]);
  await page.locator('select[name="careTypes[]"]').selectOption([]);
  await page.locator('select[name="status"]').selectOption("all");
  await page.locator('select[name="includePatientsWithoutEpisode"]').selectOption("all");
  await page.locator("#startDate").fill(TGC_DATE_RANGES.clientStart);
  await setResultFieldAllowlist(page, CLIENT_RESULT_FIELDS);
  const href = await submitAndWaitForNewReport(page, baseUrl, route, priorLinks);
  return downloadReportLink(page, baseUrl, href, reportFileName("cli_ntendata_export"));
}

async function exportAgenda(page: Page, baseUrl: string, today: Date): Promise<string> {
  const agendaEnd = formatDutchDate(addMonths(today, TGC_DATE_RANGES.agendaMonthsAhead));
  logStep(`Volledige agenda-export aanvragen t/m ${agendaEnd}.`);
  const route = TGC_ROUTES.agenda;
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  const priorLinks = await currentDownloadLinks(page, `${route}/export/`);
  await page.locator("#idClinic").selectOption("all");
  await page.locator('select[name="careTypes[]"]').selectOption([]);
  await page.locator("#type").selectOption("both");
  await page.locator("#startDate").fill(TGC_DATE_RANGES.agendaStart);
  await page.locator("#endDate").fill(agendaEnd);
  await setResultFieldAllowlist(page, AGENDA_RESULT_FIELDS);
  const href = await submitAndWaitForNewReport(page, baseUrl, route, priorLinks);
  return downloadReportLink(page, baseUrl, href, reportFileName("exporteer_agenda_afspraken"));
}

async function exportReferrers(page: Page, baseUrl: string): Promise<string> {
  logStep("Volledige huisarts/verwijzer-snapshot downloaden.");
  await page.goto(`${baseUrl}${TGC_ROUTES.tools}`, { waitUntil: "domcontentloaded" });
  await page.locator('a[href="#accountability"]').click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.locator(`a[href="${TGC_ROUTES.referrers}"]`).click(),
  ]);
  return saveDownload(download, reportFileName("huisarts_verwijzer"));
}

async function exportSurcharges(page: Page, baseUrl: string, today: Date): Promise<string> {
  logStep("Volledige gedeclareerde-toeslagenexport downloaden.");
  const route = TGC_ROUTES.surcharges;
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  await page.locator("#clinics").selectOption(["2"]);
  await page.locator("#insuranceGroups").selectOption([]);
  await page.locator("#startDate").fill(TGC_DATE_RANGES.surchargesStart);
  await page.locator("#endDate").fill(formatDutchDate(today));
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get("showResults") === "yes", { timeout: 120_000 }),
    page.locator("#btnSubmit").click(),
  ]);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.locator(`a[href="${route}/download"]`).click(),
  ]);
  return saveDownload(download, reportFileName("declared_surcharges"));
}

async function exportDeclarations(page: Page, baseUrl: string, today: Date): Promise<string> {
  if (FORCE_DECLARATION_FEED) {
    logStep("Declaratie finance-feedfallback expliciet geselecteerd.");
    return exportDeclarationsFromFinanceFeeds(page, baseUrl, today);
  }
  logStep("Volledige declaratie-totaalexport aanvragen.");
  const route = TGC_ROUTES.declarations;
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  const priorLinks = await currentDownloadLinks(page, `${route}/download/`);
  await page.locator("#idClinic").selectOption("2");
  await page.locator("#startDate").fill(TGC_DATE_RANGES.declarationsStart);
  await page.locator("#endDate").fill(formatDutchDate(today));

  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => undefined),
    page.locator("#btnSubmit").click(),
  ]);

  const deadline = Date.now() + Math.min(MAX_REPORT_WAIT_MS, DECLARATION_GRACE_MS);
  let href: string | null = null;
  while (Date.now() < deadline && !href) {
    const links = await currentDownloadLinks(page, `${route}/download/`);
    href = [...links].find((link) => !priorLinks.has(link)) ?? null;
    if (href) break;
    await page.waitForTimeout(POLL_INTERVAL_MS);
    await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  }
  if (href) return downloadReportLink(page, baseUrl, href, reportFileName("declaration_total"));

  logStep("TGC declaration-total worker niet tijdig gereed; gevalideerde finance-feedfallback gebruiken.");
  return exportDeclarationsFromFinanceFeeds(page, baseUrl, today);
}

function isoFromDutch(value: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function csvCell(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function dutchFromIso(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

function dutchMoney(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function historicalDeclarationRows(
  currentRows: FinanceDeclarationRow[],
  currentStart: string,
): FinanceDeclarationRow[] {
  const candidates = fs
    .readdirSync(EXPORTS_DIR)
    .filter((name) => /^declaration_total.*\.csv$/i.test(name))
    .sort((left, right) => {
      return fs.statSync(path.join(EXPORTS_DIR, right)).mtimeMs - fs.statSync(path.join(EXPORTS_DIR, left)).mtimeMs;
    });

  const parsedCandidates = candidates
    .map((candidate) => {
      const candidatePath = path.join(EXPORTS_DIR, candidate);
      const parsed = parseDeclaratiesExport(
        candidate,
        fs.readFileSync(candidatePath, "utf8"),
        RUN_STARTED.toISOString(),
      );
      return parsed.ok && parsed.facts
        ? { candidate, facts: parsed.facts, mtime: fs.statSync(candidatePath).mtimeMs }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => left.facts.bronVan.localeCompare(right.facts.bronVan) || right.mtime - left.mtime);

  const currentInvoiceKeys = new Set(
    currentRows
      .filter((row) => row.debitCredit === "D")
      .map((row) => `${row.invoiceNumber}|${row.debtor.toLowerCase()}`),
  );
  for (const { candidate, facts } of parsedCandidates) {
    if (facts.bronVan >= currentStart) continue;
    const rows: FinanceDeclarationRow[] = [];
    for (const invoice of facts.facturen) {
      if (currentInvoiceKeys.has(`${invoice.nummer}|${invoice.koepel.toLowerCase()}`)) continue;
      // If a previous invoice is absent from every current finance status
      // feed, TGC considers it resolved. Carry its immutable invoice and
      // credit history forward with no outstanding balance.
      rows.push({
        invoiceNumber: invoice.nummer,
        invoiceDate: dutchFromIso(invoice.datum),
        debtor: invoice.koepel,
        amount: dutchMoney(invoice.bedrag),
        awarded: dutchMoney(Math.max(0, invoice.bedrag - invoice.gecrediteerd)),
        debitCredit: "D",
        creditFor: "",
      });
      if (invoice.gecrediteerd > 0) {
        rows.push({
          invoiceNumber: `CARRY-${invoice.nummer}`,
          invoiceDate: dutchFromIso(invoice.datum),
          debtor: invoice.koepel,
          amount: dutchMoney(invoice.gecrediteerd),
          awarded: "0,00",
          debitCredit: "C",
          creditFor: invoice.nummer,
        });
      }
    }
    logStep(`Historische declaratiebasis '${candidate}' vult ${rows.length} opgeloste/historische regels aan.`);
    return rows;
  }
  throw new Error(`Geen gevalideerde declaratiebasis gevonden voor de periode vóór ${currentStart}.`);
}

async function readFinanceDeclarationFeed(
  page: Page,
  baseUrl: string,
  feed: "open" | "reply" | "resolved" | "archived",
  minDate: string,
  maxDate: string,
): Promise<FinanceDeclarationRow[]> {
  await page.goto(`${baseUrl}${TGC_ROUTES.zpmFinance}/result-${feed}`, { waitUntil: "domcontentloaded" });
  const headers = (await page.locator("table thead th").allTextContents()).map((header) =>
    header.trim().replace(/\s+/g, " "),
  );
  if (!headers.includes("Factuurnummer") || !headers.includes("Totaal verzonden") || !headers.includes("Soort")) {
    throw new Error(`Finance-feed '${feed}' heeft onverwachte kolommen.`);
  }

  const rawRows = await page.locator("table tbody tr").evaluateAll(
    (rows, headerNames) =>
      rows.map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        const values: Record<string, string> = {};
        for (let index = 0; index < headerNames.length; index += 1) {
          const header = headerNames[index];
          if (!header) continue;
          values[header] = cells[index]?.textContent?.trim().replace(/\s+/g, " ") ?? "";
        }
        return values;
      }),
    headers,
  );

  const result: FinanceDeclarationRow[] = [];
  for (const raw of rawRows) {
    const dateIso = isoFromDutch(raw.Datum ?? "");
    if (!dateIso || dateIso < minDate || dateIso > maxDate) continue;
    const numberMatch = /^(\d+)/.exec(raw.Factuurnummer ?? "");
    const kind = (raw.Soort ?? "").toLowerCase();
    if (!numberMatch || (kind !== "debet" && kind !== "credit")) continue;
    const creditFor = kind === "credit" ? (/\((\d+)\)/.exec(raw.Factuurnummer ?? "")?.[1] ?? "") : "";
    result.push({
      invoiceNumber: numberMatch[1],
      invoiceDate: raw.Datum,
      debtor: raw.Verzekeringskoepel || "Particulier",
      amount: raw["Totaal verzonden"] || "0,00",
      awarded: raw["Toegekend totaalbedrag"] || "0,00",
      debitCredit: kind === "credit" ? "C" : "D",
      creditFor,
    });
  }
  return result;
}

async function exportDeclarationsFromFinanceFeeds(page: Page, baseUrl: string, today: Date): Promise<string> {
  const minDate = "2025-04-01";
  const maxDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const feeds: FinanceDeclarationRow[][] = [];
  for (const feed of ["open", "reply", "resolved", "archived"] as const) {
    feeds.push(await readFinanceDeclarationFeed(page, baseUrl, feed, minDate, maxDate));
  }
  const currentRows = feeds.flat();
  const currentDates = currentRows.map((row) => isoFromDutch(row.invoiceDate)).filter((date): date is string => !!date);
  if (currentDates.length === 0) throw new Error("Finance-feedfallback bevat geen leesbare factuurdatums.");
  const currentStart = currentDates.sort()[0];
  const carriedRows = currentStart > minDate ? historicalDeclarationRows(currentRows, currentStart) : [];
  const unique = new Map<string, FinanceDeclarationRow>();
  for (const row of [...carriedRows, ...currentRows]) {
    const key = [row.invoiceNumber, row.debtor, row.debitCredit, row.amount, row.invoiceDate].join("|");
    unique.set(key, row);
  }
  const rows = [...unique.values()];
  if (rows.length === 0) throw new Error("Finance-feedfallback bevat geen declaraties.");

  const header = [
    "Factuurnummer",
    "Factuurdatum",
    "Debiteurennaam",
    "Totaal bedrag",
    "Toegekend totaalbedrag",
    "Debet / credit",
    "Credit voor",
  ];
  const csvRows = rows.map((row) =>
    [row.invoiceNumber, row.invoiceDate, row.debtor, row.amount, row.awarded, row.debitCredit, row.creditFor]
      .map(csvCell)
      .join(";"),
  );
  const filePath = path.join(STAGE_DIR, reportFileName("declaration_total"));
  fs.writeFileSync(filePath, `${header.join(";")}\r\n${csvRows.join("\r\n")}\r\n`, "utf8");
  logStep(`Finance-feedfallback opgebouwd uit ${rows.length} unieke factuurregels.`);
  return filePath;
}

function headerCells(text: string): string[] {
  const line = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .find((candidate) => candidate.trim() !== "");
  if (!line) return [];
  const delimiter = (line.match(/;/g) ?? []).length >= (line.match(/,/g) ?? []).length ? ";" : ",";
  return splitLine(line, delimiter).map((cell) => cell.replace(/^﻿/, "").trim());
}

function assertForbiddenHeadersAbsent(fileName: string, text: string, forbidden: readonly string[]): void {
  const headers = new Set(headerCells(text).map((header) => header.toLowerCase()));
  const present = forbidden.filter((header) => headers.has(header.toLowerCase()));
  if (present.length > 0) {
    throw new Error(`${fileName} bevat verboden directe identificatiekolommen: ${present.join(", ")}.`);
  }
}

function validateExports(files: DownloadedExports): void {
  logStep("Alle vijf downloads valideren met de productieparsers.");
  const importedAt = RUN_STARTED.toISOString();
  const clientText = fs.readFileSync(files.client, "utf8");
  const agendaText = fs.readFileSync(files.agenda, "utf8");
  const referrerText = fs.readFileSync(files.referrers, "utf8");
  const surchargeText = fs.readFileSync(files.surcharges, "utf8");
  const declarationText = fs.readFileSync(files.declarations, "utf8");

  assertForbiddenHeadersAbsent(path.basename(files.client), clientText, CLIENT_FORBIDDEN_HEADERS);
  assertForbiddenHeadersAbsent(path.basename(files.agenda), agendaText, AGENDA_FORBIDDEN_HEADERS);

  const clients = parseClientExport(path.basename(files.client), clientText);
  if (!clients.ok || clients.records.length === 0) {
    throw new Error(`Cliëntendata validatie mislukt: ${clients.error ?? "geen cliënten"}.`);
  }
  const agenda = parseAgendaExport(path.basename(files.agenda), agendaText, importedAt);
  if (!agenda.ok || !agenda.facts || agenda.facts.sessieRows === 0 || !agenda.facts.toekomst) {
    throw new Error(`Agenda-validatie mislukt: ${agenda.error ?? "toekomstvenster ontbreekt"}.`);
  }
  const referrers = parseVerwijzersExport(path.basename(files.referrers), referrerText, importedAt);
  if (!referrers.ok || !referrers.facts || referrers.facts.totalRows === 0) {
    throw new Error(`Verwijzervalidatie mislukt: ${referrers.error ?? "geen regels"}.`);
  }
  const surcharges = parseToeslagenExport(path.basename(files.surcharges), surchargeText, importedAt);
  if (!surcharges.ok || !surcharges.facts || surcharges.facts.totalRows === 0) {
    throw new Error(`Toeslagenvalidatie mislukt: ${surcharges.error ?? "geen regels"}.`);
  }
  const declarations = parseDeclaratiesExport(path.basename(files.declarations), declarationText, importedAt);
  if (!declarations.ok || !declarations.facts || declarations.facts.totalRows === 0) {
    throw new Error(`Declaratievalidatie mislukt: ${declarations.error ?? "geen regels"}.`);
  }

  logStep(
    `Validatie geslaagd: ${clients.records.length} cliënten, ${agenda.facts.totalRows} agendaregels, ` +
      `${referrers.facts.totalRows} verwijzerregels, ${surcharges.facts.totalRows} toeslagregels en ` +
      `${declarations.facts.totalRows} declaratieregels.`,
  );
}

function publishStagedFiles(files: DownloadedExports): DownloadedExports {
  const published = {} as DownloadedExports;
  for (const [key, stagedPath] of Object.entries(files) as [keyof DownloadedExports, string][]) {
    const destination = path.join(EXPORTS_DIR, path.basename(stagedPath));
    fs.renameSync(stagedPath, destination);
    published[key] = destination;
  }
  fs.rmdirSync(STAGE_DIR);
  return published;
}

function pushProduction(): void {
  logStep("Gevalideerde snapshots naar de centrale Supabase-productiestand pushen.");
  const tsNodeBin = path.join(ROOT, "node_modules", "ts-node", "dist", "bin.js");
  const result = childProcess.spawnSync(
    process.execPath,
    [
      tsNodeBin,
      "-P",
      path.join(ROOT, "tsconfig.scripts.json"),
      path.join(ROOT, "src", "scripts", "push-production.ts"),
    ],
    {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
      shell: false,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `push:production stopte met exitcode ${result.status ?? "onbekend"}${result.error ? ` (${result.error.message})` : ""}.`,
    );
  }
}

async function runSync(): Promise<void> {
  if (PUSH_ONLY) {
    pushProduction();
    logStep("Push-only controle geslaagd.");
    return;
  }
  const config = loadConfiguration();
  fs.mkdirSync(STAGE_DIR, { recursive: false });
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  try {
    await login(page, config.baseUrl, config.username, config.password);
    const client = await exportClientData(page, config.baseUrl);
    const agenda = await exportAgenda(page, config.baseUrl, RUN_STARTED);
    const referrers = await exportReferrers(page, config.baseUrl);
    const surcharges = await exportSurcharges(page, config.baseUrl, RUN_STARTED);
    const declarations = await exportDeclarations(page, config.baseUrl, RUN_STARTED);
    const staged = { client, agenda, referrers, surcharges, declarations };
    validateExports(staged);
    const published = publishStagedFiles(staged);
    logStep(`Exports gepubliceerd in ${path.dirname(published.client)}.`);
    if (NO_PUSH) {
      logStep("--no-push actief: Supabase-push overgeslagen.");
    } else {
      pushProduction();
    }
    logStep("Volledige TGC-synchronisatie geslaagd.");
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main(): Promise<void> {
  const lock = acquireRunLock();
  try {
    await runSync();
  } finally {
    releaseRunLock(lock);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[TGC sync] MISLUKT: ${message}`);
  if (fs.existsSync(STAGE_DIR) && path.dirname(STAGE_DIR) === EXPORTS_DIR) {
    fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  }
  process.exitCode = 1;
});

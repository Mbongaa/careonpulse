/** Publish one validated five-export generation in one database transaction.
 * The stable manifest UUID makes retries safe after a lost HTTP response. */
import { readEpdGeneration } from "../lib/careon-production/epd-generation";
import { parseAgendaExport } from "../lib/careon-production/parse-agenda";
import { parseDeclaratiesExport } from "../lib/careon-production/parse-declaraties";
import { parseClientExport } from "../lib/careon-production/parse-export";
import { parseToeslagenExport } from "../lib/careon-production/parse-toeslagen";
import { parseVerwijzersExport } from "../lib/careon-production/parse-verwijzers";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(__dirname, "../..");
const EXPORTS_DIR = path.join(ROOT, "Exports EPD");

async function main() {
  const { manifest, texts } = readEpdGeneration(EXPORTS_DIR);
  const clients = parseClientExport(manifest.files.client.name, texts.client);
  const agenda = parseAgendaExport(manifest.files.agenda.name, texts.agenda, manifest.sourceTime);
  const verwijzers = parseVerwijzersExport(manifest.files.referrers.name, texts.referrers, manifest.sourceTime);
  const toeslagen = parseToeslagenExport(manifest.files.surcharges.name, texts.surcharges, manifest.sourceTime);
  const declaraties = parseDeclaratiesExport(manifest.files.declarations.name, texts.declarations, manifest.sourceTime);
  if (
    !clients.ok ||
    clients.records.length === 0 ||
    !agenda.ok ||
    !agenda.facts ||
    !verwijzers.ok ||
    !verwijzers.facts ||
    !toeslagen.ok ||
    !toeslagen.facts ||
    !declaraties.ok ||
    !declaraties.facts
  ) {
    throw new Error("Een export in de EPD-generatie is niet leesbaar; niets gepubliceerd.");
  }
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].trim();
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase-omgeving ontbreekt; niets gepubliceerd.");
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const orgResponse = await fetch(`${url}/rest/v1/organizations?slug=eq.tgc&select=id&limit=1`, { headers });
  if (!orgResponse.ok) throw new Error("Organisatiecontrole mislukt; niets gepubliceerd.");
  const organizations: unknown = await orgResponse.json();
  const org: unknown = Array.isArray(organizations) ? organizations.at(0) : null;
  if (!org || typeof org !== "object" || !("id" in org) || typeof org.id !== "string" || !org.id) {
    throw new Error("Organisatie tgc ontbreekt; niets gepubliceerd.");
  }
  const priorResponse = await fetch(
    `${url}/rest/v1/careon_epd_generations?org_id=eq.${org.id}&select=id&order=published_at.desc&limit=1`,
    { headers },
  );
  if (!priorResponse.ok) throw new Error("Generatiecontrole mislukt; niets gepubliceerd (migratie vereist).");
  const generations: unknown = await priorResponse.json();
  if (!Array.isArray(generations) || generations.length > 1)
    throw new Error("Ongeldige generatiecontrole; niets gepubliceerd.");
  const prior: unknown = generations.at(0);
  if (
    prior !== undefined &&
    (!prior || typeof prior !== "object" || !("id" in prior) || typeof prior.id !== "string")
  ) {
    throw new Error("Ongeldige generatiecontrole; niets gepubliceerd.");
  }
  const response = await fetch(`${url}/rest/v1/rpc/careon_publish_epd_generation`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_org: org.id,
      p_generation: manifest.id,
      p_expected_generation: prior && typeof prior === "object" && "id" in prior ? prior.id : null,
      p_source_time: manifest.sourceTime,
      p_payload: {
        fileName: manifest.files.client.name,
        records: clients.records,
        agenda: agenda.facts,
        verwijzers: verwijzers.facts,
        toeslagen: toeslagen.facts,
        declaraties: declaraties.facts,
      },
    }),
  });
  if (!response.ok)
    throw new Error(`Atomaire EPD-publicatie geweigerd (${response.status}); vorige generatie blijft actief.`);
  console.log(
    `EPD-generatie ${manifest.id} volledig gepubliceerd (${clients.records.length} cliënten, alle vijf exports).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "EPD-publicatie mislukt.");
  process.exitCode = 1;
});

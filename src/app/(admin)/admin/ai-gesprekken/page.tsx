import Link from "next/link";

import {
  ADMIN_BERICHT_LIMIET,
  type AdminResult,
  type AdminThread,
  adminConfigured,
  adminFailureStatus,
  adminReadFailed,
  isAdminUuid,
  listAllThreads,
  listAuthUsers,
  listOrganizations,
  threadById,
  threadFacets,
  threadMessages,
} from "@/lib/careon-admin/admin.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { requireSuperadminPage } from "@/lib/supabase/session.server";
import { cn } from "@/lib/utils";

import { AdminCard, AdminEmpty, AdminError, AdminPager, adminHref, formatMoment } from "../_components/admin-ui";
import { MarkdownLite } from "./_components/markdown-lite";

export const dynamic = "force-dynamic";

const PER_PAGINA = 50;

interface MessagePayload {
  message?: { id?: string; role?: string; content?: unknown };
}

const ROLE_LABELS: Record<string, string> = { user: "Gebruiker", assistant: "Assistent" };

type Bericht = {
  key: string | null;
  role: string;
  tekst: string;
  redenering: string;
  tools: { id: string; naam: string; invoer: string | null; resultaat: string | null; fout: boolean }[];
};

function alsTekst(waarde: unknown): string | null {
  if (waarde === undefined || waarde === null) return null;
  if (typeof waarde === "string") return waarde;
  try {
    return JSON.stringify(waarde, null, 2);
  } catch {
    return null;
  }
}

/**
 * Leest een opgeslagen repository-item uit. Naast tekst worden ook de
 * tool-invoer en -uitkomst bewaard: zonder die twee toont het transcript wél
 * dat de assistent iets deed, maar niet wat hij antwoordde — precies het stuk
 * waarop de gebruiker handelde.
 */
function leesBericht(payload: unknown): Bericht {
  const message = payload && typeof payload === "object" ? (payload as MessagePayload).message : undefined;
  const role = ROLE_LABELS[message?.role ?? ""] ?? "Systeem";
  const key = typeof message?.id === "string" ? message.id : null;
  const tools: Bericht["tools"] = [];
  let tekst = "";
  let redenering = "";
  const content = message?.content;
  if (typeof content === "string") {
    tekst = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const typed = part as {
        type?: string;
        text?: unknown;
        toolName?: unknown;
        toolCallId?: unknown;
        args?: unknown;
        argsText?: unknown;
        result?: unknown;
        isError?: unknown;
      };
      if (typed.type === "text" && typeof typed.text === "string") tekst += typed.text;
      else if (typed.type === "reasoning" && typeof typed.text === "string") redenering += typed.text;
      else if (typed.type === "tool-call" && typeof typed.toolName === "string") {
        tools.push({
          id: typeof typed.toolCallId === "string" ? typed.toolCallId : `${typed.toolName}-${tools.length}`,
          naam: typed.toolName,
          invoer: alsTekst(typed.args ?? typed.argsText),
          resultaat: alsTekst(typed.result),
          fout: typed.isError === true,
        });
      }
    }
  }
  return { key, role, tekst, redenering, tools };
}

export default async function AdminChatsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ org?: string; gebruiker?: string; gesprek?: string; pagina?: string }> }>) {
  // Superadmin-check vóór de cross-org service-role-reads: de layout-redirect
  // alleen volstaat niet (layout en pagina renderen parallel) en de
  // admin.chat.view-audit hieronder mag alleen voor échte superadmins vuren.
  const session = await requireSuperadminPage();
  if (!adminConfigured()) {
    return <AdminEmpty>Supabase is niet geconfigureerd.</AdminEmpty>;
  }
  const { org, gebruiker, gesprek, pagina } = await searchParams;
  const orgFilter = isAdminUuid(org) ? org : undefined;
  const gebruikerFilter = isAdminUuid(gebruiker) ? gebruiker : undefined;
  const paginaNummer = Math.max(1, Number.parseInt(pagina ?? "1", 10) || 1);
  const offset = (paginaNummer - 1) * PER_PAGINA;

  const [threads, users, organizations, facets] = await Promise.all([
    listAllThreads({ orgId: orgFilter, userId: gebruikerFilter, limit: PER_PAGINA, offset }),
    listAuthUsers(),
    listOrganizations(),
    threadFacets(),
  ]);
  const userEmail = new Map((users.ok ? users.data : []).map((entry) => [entry.id, entry.email ?? entry.id]));
  const orgName = new Map((organizations.ok ? organizations.data : []).map((entry) => [entry.id, entry.name]));
  const zichtbaar = threads.ok ? threads.data : [];

  // Filterniveaus komen uit de volledige verzameling, niet uit de zichtbare
  // pagina — anders verdwijnt een gebruiker uit het filter zodra zijn
  // gesprekken buiten pagina 1 vallen.
  const facetRijen = facets.ok ? facets.data : [];
  const orgIds = [...new Set(facetRijen.map((rij) => rij.org_id))];
  const gebruikerIds = [
    ...new Set(facetRijen.filter((rij) => !orgFilter || rij.org_id === orgFilter).map((rij) => rij.user_id)),
  ];

  // Alleen het daadwerkelijk openen van een gesprek is auditwaardig; filteren
  // en bladeren zetten geen `gesprek`-parameter en schrijven dus geen rij.
  let thread: AdminThread | undefined;
  let gesprekFout: number | undefined;
  let messages: AdminResult<{ payload: unknown }[]> = { ok: true, data: [] };
  if (isAdminUuid(gebruiker) && gesprek) {
    const gevonden = await threadById(gebruiker, gesprek);
    if (!gevonden.ok) gesprekFout = gevonden.status;
    thread = gevonden.ok ? gevonden.data[0] : undefined;
    if (thread) {
      messages = await threadMessages(thread.user_id, thread.id);
      // Inzage in een gesprek is zélf auditwaardig — zo blijft superadmin-toegang
      // controleerbaar (AVG-verantwoording).
      scheduleAuditEvent({
        action: "admin.chat.view",
        resource: "assistant_threads",
        resourceId: thread.id,
        orgId: thread.org_id,
        userId: session.userId,
        detail: { owner: userEmail.get(thread.user_id) ?? thread.user_id },
      });
    }
  }
  const basisFilters = { org: orgFilter, gebruiker: gebruikerFilter };

  return (
    <>
      <AdminCard title="AI-gesprekken">
        <p className="mb-3 text-muted-foreground text-xs">
          Inzage is beperkt tot platformbeheer en wordt zelf geauditeerd. Gesprekken verdwijnen automatisch na de
          retentietermijn (30 dagen).
        </p>
        {/* Boven de chips, want die degraderen als eerste: mislukken de
            referentie-reads, dan blijven de filters leeg en tonen de kolommen
            kale UUID's — zonder melding niet te onderscheiden van een platform
            zonder organisaties of gesprekken. */}
        {adminReadFailed(users, organizations, facets) && (
          <div className="mb-3">
            <AdminError status={adminFailureStatus(users, organizations, facets)}>
              Namen en filters konden niet volledig worden geladen; gebruikers en organisaties tonen als UUID.
            </AdminError>
          </div>
        )}
        <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
          <Link
            href="/admin/ai-gesprekken"
            className={cn(
              "rounded-full border px-2.5 py-1",
              !orgFilter && !gebruikerFilter ? "border-primary text-primary" : "text-muted-foreground",
            )}
          >
            Alle organisaties
          </Link>
          {orgIds.map((id) => (
            <Link
              key={id}
              href={adminHref("/admin/ai-gesprekken", { org: id })}
              className={cn(
                "rounded-full border px-2.5 py-1",
                orgFilter === id ? "border-primary text-primary" : "text-muted-foreground",
              )}
            >
              {orgName.get(id) ?? id}
            </Link>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          <Link
            href={adminHref("/admin/ai-gesprekken", { org: orgFilter })}
            className={cn(
              "rounded-full border px-2.5 py-1",
              !gebruikerFilter ? "border-primary text-primary" : "text-muted-foreground",
            )}
          >
            Alle gebruikers
          </Link>
          {gebruikerIds.map((id) => (
            <Link
              key={id}
              href={adminHref("/admin/ai-gesprekken", { org: orgFilter, gebruiker: id })}
              className={cn(
                "rounded-full border px-2.5 py-1",
                gebruikerFilter === id ? "border-primary text-primary" : "text-muted-foreground",
              )}
            >
              {userEmail.get(id) ?? id}
            </Link>
          ))}
        </div>
        {!threads.ok && <AdminError status={threads.status} />}
        {threads.ok && zichtbaar.length === 0 && <AdminEmpty>Geen gesprekken gevonden.</AdminEmpty>}
        {zichtbaar.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 pr-3 font-medium">Titel</th>
                  <th className="py-2 pr-3 font-medium">Gebruiker</th>
                  <th className="py-2 pr-3 font-medium">Organisatie</th>
                  <th className="py-2 pr-3 font-medium">Bijgewerkt</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {zichtbaar.map((rij) => (
                  <tr key={`${rij.user_id}:${rij.id}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{rij.title}</td>
                    <td className="py-2 pr-3 text-xs">{userEmail.get(rij.user_id) ?? rij.user_id}</td>
                    <td className="py-2 pr-3 text-xs">{orgName.get(rij.org_id) ?? "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground text-xs">{formatMoment(rij.updated_at)}</td>
                    <td className="py-2 text-right">
                      <Link
                        className="text-primary text-xs underline-offset-4 hover:underline"
                        href={adminHref("/admin/ai-gesprekken", {
                          org: orgFilter,
                          gebruiker: rij.user_id,
                          gesprek: rij.id,
                        })}
                      >
                        Bekijk
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {threads.ok && (paginaNummer > 1 || zichtbaar.length === PER_PAGINA) && (
          <AdminPager
            bereik={`${offset + 1}–${offset + zichtbaar.length}`}
            vorigeHref={
              paginaNummer > 1 ? adminHref("/admin/ai-gesprekken", { ...basisFilters, pagina: paginaNummer - 1 }) : null
            }
            volgendeHref={
              zichtbaar.length === PER_PAGINA
                ? adminHref("/admin/ai-gesprekken", { ...basisFilters, pagina: paginaNummer + 1 })
                : null
            }
          />
        )}
      </AdminCard>
      {gesprekFout !== undefined && (
        <AdminCard title="Gesprek">
          <AdminError status={gesprekFout} />
        </AdminCard>
      )}
      {thread && (
        <AdminCard title={`Gesprek: ${thread.title}`}>
          <p className="mb-3 text-muted-foreground text-xs">
            {userEmail.get(thread.user_id) ?? thread.user_id} · {orgName.get(thread.org_id) ?? thread.org_id} ·{" "}
            {formatMoment(thread.updated_at)}
          </p>
          {!messages.ok && <AdminError status={messages.status} />}
          {messages.ok && messages.data.length === 0 && <AdminEmpty>Geen berichten in dit gesprek.</AdminEmpty>}
          {messages.ok && messages.data.length === ADMIN_BERICHT_LIMIET && (
            <p className="mb-2 text-muted-foreground text-xs">
              Alleen de laatste {ADMIN_BERICHT_LIMIET} berichten van dit gesprek worden getoond.
            </p>
          )}
          {messages.ok && messages.data.length > 0 && (
            <ol className="flex flex-col gap-3">
              {messages.data.map((row, index) => {
                const bericht = leesBericht(row.payload);
                return (
                  <li
                    key={bericht.key ?? `bericht-${index}`}
                    className={cn(
                      "max-w-[85%] rounded-xl border px-3 py-2 text-sm",
                      bericht.role === "Gebruiker" ? "self-end bg-muted" : "self-start",
                    )}
                  >
                    <p className="mb-1 font-medium text-muted-foreground text-xs">{bericht.role}</p>
                    {bericht.tekst ? <MarkdownLite bron={bericht.tekst} /> : null}
                    {bericht.redenering ? (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Redenering</summary>
                        <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{bericht.redenering}</p>
                      </details>
                    ) : null}
                    {bericht.tools.map((tool) => (
                      <details key={tool.id} className="mt-2 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          Actie: {tool.naam}
                          {tool.fout ? " (fout)" : ""}
                        </summary>
                        {tool.invoer ? (
                          <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2">
                            <code>{tool.invoer}</code>
                          </pre>
                        ) : null}
                        {tool.resultaat ? (
                          <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2">
                            <code>{tool.resultaat}</code>
                          </pre>
                        ) : null}
                      </details>
                    ))}
                  </li>
                );
              })}
            </ol>
          )}
        </AdminCard>
      )}
    </>
  );
}

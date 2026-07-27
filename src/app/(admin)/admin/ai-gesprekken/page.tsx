import Link from "next/link";

import {
  adminConfigured,
  listAllThreads,
  listAuthUsers,
  listOrganizations,
  threadMessages,
} from "@/lib/careon-admin/admin.server";
import { scheduleAuditEvent } from "@/lib/careon-audit/audit.server";
import { requireSuperadminPage } from "@/lib/supabase/session.server";
import { cn } from "@/lib/utils";

import { AdminCard, AdminEmpty, formatMoment } from "../_components/admin-ui";

export const dynamic = "force-dynamic";

interface MessagePayload {
  message?: { id?: string; role?: string; content?: unknown };
}

const ROLE_LABELS: Record<string, string> = { user: "Gebruiker", assistant: "Assistent" };

function renderableParts(payload: unknown): { key: string | null; role: string; text: string; tools: string[] } {
  const message = payload && typeof payload === "object" ? (payload as MessagePayload).message : undefined;
  const role = ROLE_LABELS[message?.role ?? ""] ?? "Systeem";
  const key = typeof message?.id === "string" ? message.id : null;
  const tools: string[] = [];
  let text = "";
  const content = message?.content;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const typed = part as { type?: string; text?: unknown; toolName?: unknown };
      if (typed.type === "text" && typeof typed.text === "string") text += typed.text;
      else if (typed.type === "tool-call" && typeof typed.toolName === "string") tools.push(typed.toolName);
    }
  }
  return { key, role, text, tools };
}

export default async function AdminChatsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ gebruiker?: string; gesprek?: string }> }>) {
  // Superadmin-check vóór de cross-org service-role-reads: de layout-redirect
  // alleen volstaat niet (layout en pagina renderen parallel) en de
  // admin.chat.view-audit hieronder mag alleen voor échte superadmins vuren.
  const session = await requireSuperadminPage();
  if (!adminConfigured()) {
    return <AdminEmpty>Supabase is niet geconfigureerd.</AdminEmpty>;
  }
  const { gebruiker, gesprek } = await searchParams;

  const [threads, users, organizations] = await Promise.all([listAllThreads(), listAuthUsers(), listOrganizations()]);
  const userEmail = new Map((users ?? []).map((entry) => [entry.id, entry.email ?? entry.id]));
  const orgName = new Map((organizations ?? []).map((entry) => [entry.id, entry.name]));
  const visibleThreads = (threads ?? []).filter((thread) => !gebruiker || thread.user_id === gebruiker);
  const activeThread =
    gebruiker && gesprek ? visibleThreads.find((t) => t.user_id === gebruiker && t.id === gesprek) : undefined;

  let messages: { payload: unknown }[] | null = null;
  if (activeThread) {
    messages = await threadMessages(activeThread.user_id, activeThread.id);
    // Inzage in een gesprek is zélf auditwaardig — zo blijft superadmin-toegang
    // controleerbaar (AVG-verantwoording).
    scheduleAuditEvent({
      action: "admin.chat.view",
      resource: "assistant_threads",
      resourceId: activeThread.id,
      orgId: activeThread.org_id,
      userId: session.userId,
      detail: { owner: userEmail.get(activeThread.user_id) ?? activeThread.user_id },
    });
  }

  const chatUsers = [...new Set((threads ?? []).map((thread) => thread.user_id))];

  return (
    <>
      <AdminCard title="AI-gesprekken">
        <p className="mb-3 text-muted-foreground text-xs">
          Inzage is beperkt tot platformbeheer en wordt zelf geauditeerd. Gesprekken verdwijnen automatisch na de
          retentietermijn (30 dagen).
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          <Link
            href="/admin/ai-gesprekken"
            className={cn(
              "rounded-full border px-2.5 py-1",
              !gebruiker ? "border-primary text-primary" : "text-muted-foreground",
            )}
          >
            Alle gebruikers
          </Link>
          {chatUsers.map((id) => (
            <Link
              key={id}
              href={`/admin/ai-gesprekken?gebruiker=${id}`}
              className={cn(
                "rounded-full border px-2.5 py-1",
                gebruiker === id ? "border-primary text-primary" : "text-muted-foreground",
              )}
            >
              {userEmail.get(id) ?? id}
            </Link>
          ))}
        </div>
        {visibleThreads.length > 0 ? (
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
                {visibleThreads.map((thread) => (
                  <tr key={`${thread.user_id}:${thread.id}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{thread.title}</td>
                    <td className="py-2 pr-3 text-xs">{userEmail.get(thread.user_id) ?? thread.user_id}</td>
                    <td className="py-2 pr-3 text-xs">{orgName.get(thread.org_id) ?? "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground text-xs">{formatMoment(thread.updated_at)}</td>
                    <td className="py-2 text-right">
                      <Link
                        className="text-primary text-xs underline-offset-4 hover:underline"
                        href={`/admin/ai-gesprekken?gebruiker=${thread.user_id}&gesprek=${encodeURIComponent(thread.id)}`}
                      >
                        Bekijk
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <AdminEmpty>Geen gesprekken gevonden.</AdminEmpty>
        )}
      </AdminCard>
      {activeThread && (
        <AdminCard title={`Gesprek: ${activeThread.title}`}>
          <p className="mb-3 text-muted-foreground text-xs">
            {userEmail.get(activeThread.user_id) ?? activeThread.user_id} · {formatMoment(activeThread.updated_at)}
          </p>
          {messages && messages.length > 0 ? (
            <ol className="flex flex-col gap-3">
              {messages.map((row, index) => {
                const { key, role, text, tools } = renderableParts(row.payload);
                return (
                  <li
                    key={key ?? `bericht-${index}`}
                    className={cn(
                      "max-w-[85%] rounded-xl border px-3 py-2 text-sm",
                      role === "Gebruiker" ? "self-end bg-muted" : "self-start",
                    )}
                  >
                    <p className="mb-1 font-medium text-muted-foreground text-xs">{role}</p>
                    {text ? <p className="whitespace-pre-wrap">{text}</p> : null}
                    {tools.length > 0 && (
                      <p className="mt-1 text-muted-foreground text-xs">Acties: {tools.join(", ")}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <AdminEmpty>Geen berichten in dit gesprek.</AdminEmpty>
          )}
        </AdminCard>
      )}
    </>
  );
}

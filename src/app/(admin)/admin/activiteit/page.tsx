import Link from "next/link";

import {
  adminConfigured,
  listAuthUsers,
  listOrganizations,
  recentAssistantEvents,
  recentAuditEvents,
} from "@/lib/careon-admin/admin.server";
import { cn } from "@/lib/utils";

import { AdminCard, AdminEmpty, formatMoment } from "../_components/admin-ui";

export const dynamic = "force-dynamic";

export default async function AdminActivityPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ org?: string; actie?: string }> }>) {
  if (!adminConfigured()) {
    return <AdminEmpty>Supabase is niet geconfigureerd.</AdminEmpty>;
  }
  const { org, actie } = await searchParams;

  const [organizations, users, events, assistantEvents] = await Promise.all([
    listOrganizations(),
    listAuthUsers(),
    recentAuditEvents({ orgId: org, action: actie, limit: 100 }),
    recentAssistantEvents(50),
  ]);
  const orgName = new Map((organizations ?? []).map((entry) => [entry.id, entry.name]));
  const userEmail = new Map((users ?? []).map((entry) => [entry.id, entry.email ?? entry.id]));
  const actions = [...new Set((events ?? []).map((event) => event.action))].sort();

  return (
    <>
      <AdminCard title="Audit-logboek">
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          <Link
            href="/admin/activiteit"
            className={cn(
              "rounded-full border px-2.5 py-1",
              !org && !actie ? "border-primary text-primary" : "text-muted-foreground",
            )}
          >
            Alles
          </Link>
          {(organizations ?? []).map((entry) => (
            <Link
              key={entry.id}
              href={`/admin/activiteit?org=${entry.id}`}
              className={cn(
                "rounded-full border px-2.5 py-1",
                org === entry.id ? "border-primary text-primary" : "text-muted-foreground",
              )}
            >
              {entry.name}
            </Link>
          ))}
          {actions.map((action) => (
            <Link
              key={action}
              href={`/admin/activiteit?actie=${encodeURIComponent(action)}`}
              className={cn(
                "rounded-full border px-2.5 py-1",
                actie === action ? "border-primary text-primary" : "text-muted-foreground",
              )}
            >
              {action}
            </Link>
          ))}
        </div>
        {events && events.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 pr-3 font-medium">Moment</th>
                  <th className="py-2 pr-3 font-medium">Actie</th>
                  <th className="py-2 pr-3 font-medium">Wie</th>
                  <th className="py-2 pr-3 font-medium">Organisatie</th>
                  <th className="py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3 text-muted-foreground text-xs tabular-nums">
                      {formatMoment(event.created_at)}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-medium">{event.action}</span>
                      {event.resource ? (
                        <span className="text-muted-foreground text-xs"> · {event.resource}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-xs">{event.user_id ? (userEmail.get(event.user_id) ?? "—") : "—"}</td>
                    <td className="py-2 pr-3 text-xs">{event.org_id ? (orgName.get(event.org_id) ?? "—") : "—"}</td>
                    <td className="py-2 text-muted-foreground text-xs">
                      {Object.keys(event.detail ?? {}).length > 0 ? JSON.stringify(event.detail) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <AdminEmpty>Geen audit-events voor deze selectie.</AdminEmpty>
        )}
      </AdminCard>
      <AdminCard title="Assistent-telemetrie (careon_assistant_events)">
        {assistantEvents && assistantEvents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 pr-3 font-medium">Moment</th>
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Tools</th>
                  <th className="py-2 font-medium">Wie</th>
                </tr>
              </thead>
              <tbody>
                {assistantEvents.map((event) => (
                  <tr key={event.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 text-muted-foreground text-xs tabular-nums">
                      {formatMoment(event.created_at)}
                    </td>
                    <td className="py-2 pr-3">{event.event_type}</td>
                    <td className="py-2 pr-3 text-muted-foreground text-xs">{event.status_code ?? "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground text-xs">
                      {event.tool_names.length > 0 ? event.tool_names.join(", ") : "—"}
                    </td>
                    <td className="py-2 text-xs">{event.user_id ? (userEmail.get(event.user_id) ?? "—") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <AdminEmpty>Geen assistent-telemetrie.</AdminEmpty>
        )}
      </AdminCard>
    </>
  );
}

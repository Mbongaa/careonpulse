import {
  adminConfigured,
  countRows,
  listOrganizations,
  listProfiles,
  recentAuditEvents,
} from "@/lib/careon-admin/admin.server";
import { requireSuperadminPage } from "@/lib/supabase/session.server";

import { AdminCard, AdminEmpty, AdminStat, formatMoment } from "./_components/admin-ui";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  // Layout en pagina renderen parallel — de superadmin-check moet vóór de
  // service-role-reads van deze pagina zelf staan.
  await requireSuperadminPage();
  if (!adminConfigured()) {
    return <AdminEmpty>Supabase is niet geconfigureerd; beheer is alleen beschikbaar in Supabase-modus.</AdminEmpty>;
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [organizations, profiles, logins7d, threads, events] = await Promise.all([
    listOrganizations(),
    listProfiles(),
    countRows(`audit_events?select=id&action=eq.auth.login&created_at=gte.${encodeURIComponent(weekAgo)}`),
    countRows("assistant_threads?select=id"),
    recentAuditEvents({ limit: 10 }),
  ]);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStat label="Organisaties" value={organizations?.length ?? "—"} />
        <AdminStat label="Gebruikers" value={profiles?.length ?? "—"} />
        <AdminStat label="Logins (7 dagen)" value={logins7d ?? "—"} />
        <AdminStat label="AI-gesprekken" value={threads ?? "—"} />
      </div>
      <AdminCard title="Recente activiteit">
        {events && events.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {events.map((event) => (
              <li key={event.id} className="flex items-baseline justify-between gap-3">
                <span>
                  <span className="font-medium">{event.action}</span>
                  {event.resource ? <span className="text-muted-foreground"> · {event.resource}</span> : null}
                </span>
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  {formatMoment(event.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <AdminEmpty>Nog geen audit-activiteit.</AdminEmpty>
        )}
      </AdminCard>
    </>
  );
}

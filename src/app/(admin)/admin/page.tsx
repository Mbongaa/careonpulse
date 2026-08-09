import {
  type AdminResult,
  adminConfigured,
  adminFailureStatus,
  adminReadFailed,
  countRows,
  laatsteOnderhoud,
  listOrganizations,
  recentAuditEvents,
} from "@/lib/careon-admin/admin.server";
import { requireSuperadminPage } from "@/lib/supabase/session.server";

import { AdminCard, AdminEmpty, AdminError, AdminStat, formatMoment } from "./_components/admin-ui";

export const dynamic = "force-dynamic";

function statWaarde(result: AdminResult<number | null>): string | number {
  return result.ok ? (result.data ?? "—") : "—";
}

export default async function AdminOverviewPage() {
  // Layout en pagina renderen parallel — de superadmin-check moet vóór de
  // service-role-reads van deze pagina zelf staan.
  await requireSuperadminPage();
  if (!adminConfigured()) {
    return <AdminEmpty>Supabase is niet geconfigureerd; beheer is alleen beschikbaar in Supabase-modus.</AdminEmpty>;
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [organizations, gebruikers, logins7d, threads, events, onderhoud] = await Promise.all([
    listOrganizations(),
    // Tellen i.p.v. een profielenlijst meten: die lijst kapt af op max-rows en
    // bevriest de teller dan stilzwijgend.
    countRows("profiles?select=id"),
    countRows(`audit_events?select=id&action=eq.auth.login&created_at=gte.${encodeURIComponent(weekAgo)}`),
    countRows("assistant_threads?select=id"),
    recentAuditEvents({ limit: 10 }),
    laatsteOnderhoud(),
  ]);
  const statsMislukt = adminReadFailed(organizations, gebruikers, logins7d, threads);
  // Welke build draait hier? Zonder deze regel is "zit de fix van gisteren er
  // al in?" alleen in het hostingconsole te beantwoorden.
  const buildSha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);

  return (
    <>
      {statsMislukt && <AdminError status={adminFailureStatus(organizations, gebruikers, logins7d, threads)} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStat label="Organisaties" value={organizations.ok ? organizations.data.length : "—"} />
        <AdminStat label="Gebruikers" value={statWaarde(gebruikers)} />
        <AdminStat label="Logins (7 dagen)" value={statWaarde(logins7d)} />
        <AdminStat label="AI-gesprekken" value={statWaarde(threads)} />
      </div>
      <AdminCard title="Platformstatus">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">Laatste onderhoud (retentie-cron)</dt>
            <dd className="tabular-nums">
              {!onderhoud.ok && <span className="text-destructive">kon niet worden gelezen</span>}
              {onderhoud.ok && !onderhoud.data && (
                <span className="text-destructive">nog nooit gedraaid sinds deze release</span>
              )}
              {onderhoud.ok && onderhoud.data && (
                <>
                  {formatMoment(onderhoud.data.created_at)}
                  {onderhoud.data.action === "maintenance.prune_failed" && (
                    <span className="ml-2 text-destructive text-xs">laatste run mislukt</span>
                  )}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Draaiende build</dt>
            <dd className="tabular-nums">{buildSha === "" ? "onbekend (lokaal of geen Vercel-build)" : buildSha}</dd>
          </div>
        </dl>
      </AdminCard>
      <AdminCard title="Recente activiteit">
        {!events.ok && <AdminError status={events.status} />}
        {events.ok && events.data.length === 0 && <AdminEmpty>Nog geen audit-activiteit.</AdminEmpty>}
        {events.ok && events.data.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {events.data.map((event) => (
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
        )}
      </AdminCard>
    </>
  );
}

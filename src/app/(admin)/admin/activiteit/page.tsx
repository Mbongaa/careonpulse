import {
  type AdminAuditEvent,
  type AdminAuthUser,
  type AdminOrganization,
  type AdminResult,
  actieveQuota,
  adminConfigured,
  adminDateFilter,
  auditActions,
  isAdminUuid,
  listAuthUsers,
  listOrganizations,
  recentAssistantEvents,
  recentAuditEvents,
} from "@/lib/careon-admin/admin.server";
import { requireSuperadminPage } from "@/lib/supabase/session.server";

import { AdminCard, AdminEmpty, AdminError, AdminPager, adminHref, formatMoment } from "../_components/admin-ui";
import { QuotaClearButton } from "./_components/quota-clear-button";

export const dynamic = "force-dynamic";

const PER_PAGINA = 100;
const VELD_CLASS = "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs";

/** Toont waar een mutatie op sloeg: gebruiker, organisatie of het kale id. */
function doelLabel(event: AdminAuditEvent, userEmail: Map<string, string>, orgName: Map<string, string>): string {
  if (!event.resource_id) return "—";
  const bekend = userEmail.get(event.resource_id) ?? orgName.get(event.resource_id);
  if (bekend) return bekend;
  // Verwijderacties leggen hun doel vast in `detail`: het id wijst naar een
  // account of organisatie die niet meer bestaat en dus nooit meer oplost.
  const uitDetail = event.detail.email ?? event.detail.name;
  return typeof uitDetail === "string" ? uitDetail : event.resource_id;
}

export default async function AdminActivityPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    org?: string;
    gebruiker?: string;
    actie?: string;
    van?: string;
    tot?: string;
    pagina?: string;
  }>;
}>) {
  // Superadmin-check op de databoundary zelf (layout rendert parallel).
  await requireSuperadminPage();
  if (!adminConfigured()) {
    return <AdminEmpty>Supabase is niet geconfigureerd.</AdminEmpty>;
  }
  const { org, gebruiker, actie, van, tot, pagina } = await searchParams;

  // Eerst de referentiedata: de gebruiker mag als e-mailadres worden ingevuld,
  // dus die moet vertaald zijn vóór de audit-query draait. De actielijst krijgt
  // de al toegepaste actie mee, zodat het formulier haar altijd als gekozen
  // toont — anders las een gefilterde tabel als "Alle acties" en liet de
  // volgende submit het filter stilzwijgend vallen.
  const [organizations, users, acties, assistantEvents, quota] = await Promise.all([
    listOrganizations(),
    listAuthUsers(),
    auditActions(actie),
    recentAssistantEvents(50),
    actieveQuota(50),
  ]);
  // Vaste arraytypes: een ternary over AdminResult levert een unie van array-
  // types op, waardoor .find() zijn callbackparameter tot never versmalt.
  const authUsers: AdminAuthUser[] = users.ok ? users.data : [];
  const orgs: AdminOrganization[] = organizations.ok ? organizations.data : [];
  const orgName = new Map(orgs.map((entry) => [entry.id, entry.name]));
  const userEmail = new Map(authUsers.map((entry) => [entry.id, entry.email ?? entry.id]));

  // De e-mailzoekopdracht staat bewust buiten de isAdminUuid-tak: die guard is
  // een typepredicaat, dat een reeds-string in zijn else-tak tot never versmalt.
  const gezochteGebruiker = (gebruiker ?? "").trim();
  const gebruikerViaEmail = authUsers.find(
    (entry) => entry.email?.toLowerCase() === gezochteGebruiker.toLowerCase(),
  )?.id;
  const gebruikerId = isAdminUuid(gezochteGebruiker) ? gezochteGebruiker : gebruikerViaEmail;
  const gebruikerOnbekend = gezochteGebruiker !== "" && !gebruikerId;

  const orgFilter = isAdminUuid(org) ? org : undefined;
  const vanaf = adminDateFilter(van);
  const totEnMet = adminDateFilter(tot);
  const paginaNummer = Math.max(1, Number.parseInt(pagina ?? "1", 10) || 1);
  const offset = (paginaNummer - 1) * PER_PAGINA;

  // Een onbekend e-mailadres levert geen query op: filteren op een niet-
  // bestaande gebruiker zou anders het volledige logboek tonen.
  const events: AdminResult<AdminAuditEvent[]> = gebruikerOnbekend
    ? { ok: true, data: [] }
    : await recentAuditEvents({
        orgId: orgFilter,
        userId: gebruikerId,
        action: actie,
        vanaf,
        tot: totEnMet,
        limit: PER_PAGINA,
        offset,
      });
  const rijen = events.ok ? events.data : [];
  const filters = { org: orgFilter, gebruiker: gezochteGebruiker, actie, van: vanaf, tot: totEnMet };

  return (
    <>
      <AdminCard title="Audit-logboek">
        <form method="get" action="/admin/activiteit" className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs" htmlFor="filter-org">
            <span className="text-muted-foreground">Organisatie</span>
            <select id="filter-org" name="org" defaultValue={orgFilter ?? ""} className={VELD_CLASS}>
              <option value="">Alle organisaties</option>
              {orgs.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" htmlFor="filter-gebruiker">
            <span className="text-muted-foreground">Gebruiker (e-mail)</span>
            <input
              id="filter-gebruiker"
              name="gebruiker"
              defaultValue={gezochteGebruiker}
              placeholder="naam@organisatie.nl"
              className={`${VELD_CLASS} w-56`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" htmlFor="filter-actie">
            <span className="text-muted-foreground">Actie</span>
            <select id="filter-actie" name="actie" defaultValue={actie ?? ""} className={VELD_CLASS}>
              <option value="">Alle acties</option>
              {(acties.ok ? acties.data : []).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" htmlFor="filter-van">
            <span className="text-muted-foreground">Van</span>
            <input id="filter-van" type="date" name="van" defaultValue={vanaf ?? ""} className={VELD_CLASS} />
          </label>
          <label className="flex flex-col gap-1 text-xs" htmlFor="filter-tot">
            <span className="text-muted-foreground">Tot en met</span>
            <input id="filter-tot" type="date" name="tot" defaultValue={totEnMet ?? ""} className={VELD_CLASS} />
          </label>
          <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">
            Filter
          </button>
          <a href="/admin/activiteit" className="text-muted-foreground text-xs underline-offset-4 hover:underline">
            Wis filters
          </a>
        </form>
        {!organizations.ok && (
          <div className="mb-3">
            <AdminError status={organizations.status}>
              Organisatielijst kon niet worden geladen; het organisatiefilter werkt nu niet en organisatienamen tonen
              als &quot;—&quot;.
            </AdminError>
          </div>
        )}
        {orgFilter && (
          <p className="mb-3 text-muted-foreground text-xs">
            {/* Gewone in- en uitlogrijen dragen sinds 29-07 wél een organisatie; de lijst hieronder is indicatief, niet uitputtend. */}
            Let op: niet elke rij draagt een organisatie — onder andere mislukte en geblokkeerde inlogpogingen,
            wachtwoord-instellingen via link en beheeracties op accounts zonder (of met meerdere) lidmaatschappen vallen
            buiten dit filter. Filter op actie of gebruiker om die te zien.
          </p>
        )}
        {gebruikerOnbekend && <AdminEmpty>Geen account gevonden voor &quot;{gezochteGebruiker}&quot;.</AdminEmpty>}
        {!events.ok && <AdminError status={events.status} />}
        {events.ok && !gebruikerOnbekend && rijen.length === 0 && (
          <AdminEmpty>Geen audit-events voor deze selectie.</AdminEmpty>
        )}
        {rijen.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 pr-3 font-medium">Moment</th>
                  <th className="py-2 pr-3 font-medium">Actie</th>
                  <th className="py-2 pr-3 font-medium">Wie</th>
                  <th className="py-2 pr-3 font-medium">Doel</th>
                  <th className="py-2 pr-3 font-medium">Organisatie</th>
                  <th className="py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rijen.map((event) => (
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
                    <td className="py-2 pr-3 text-xs">{doelLabel(event, userEmail, orgName)}</td>
                    <td className="py-2 pr-3 text-xs">{event.org_id ? (orgName.get(event.org_id) ?? "—") : "—"}</td>
                    <td className="py-2 text-muted-foreground text-xs">
                      {Object.keys(event.detail ?? {}).length > 0 ? JSON.stringify(event.detail) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {events.ok && (paginaNummer > 1 || rijen.length === PER_PAGINA) && (
          <AdminPager
            bereik={`${offset + 1}–${offset + rijen.length}`}
            vorigeHref={
              paginaNummer > 1 ? adminHref("/admin/activiteit", { ...filters, pagina: paginaNummer - 1 }) : null
            }
            volgendeHref={
              rijen.length === PER_PAGINA
                ? adminHref("/admin/activiteit", { ...filters, pagina: paginaNummer + 1 })
                : null
            }
          />
        )}
        {!users.ok && (
          <div className="mt-2">
            <AdminError status={users.status}>
              Gebruikerslijst kon niet worden geladen; e-mailadressen tonen als UUID.
            </AdminError>
          </div>
        )}
      </AdminCard>
      <AdminCard title="Actieve limieten (inloggen & assistent)">
        <p className="mb-3 text-muted-foreground text-xs">
          Emmers per gehashte actor. <span className="font-medium">login</span> = per bezoekers-IP (een praktijk achter
          één NAT deelt er één), <span className="font-medium">login_account</span> = per e-mailadres,{" "}
          <span className="font-medium">assistant</span> = per gebruiker. De dagteller loopt tot middernacht UTC door;
          opheffen laat de betrokkene meteen weer inloggen.
        </p>
        {!quota.ok && <AdminError status={quota.status} />}
        {quota.ok && quota.data.length === 0 && <AdminEmpty>Geen actieve limieten.</AdminEmpty>}
        {quota.ok && quota.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 pr-3 font-medium">Scope</th>
                  <th className="py-2 pr-3 font-medium">Actor (gehasht)</th>
                  <th className="py-2 pr-3 font-medium">Deze minuut</th>
                  <th className="py-2 pr-3 font-medium">Vandaag (UTC)</th>
                  <th className="py-2 pr-3 font-medium">Laatst gezien</th>
                  <th className="py-2 font-medium">Actie</th>
                </tr>
              </thead>
              <tbody>
                {quota.data.map((rij) => {
                  // De tellers rollen pas bij de vólgende aanvraag door: een rij
                  // houdt de stand van gisteren vast tot iemand hem opnieuw
                  // raakt. Alleen tonen als de emmer van nu is — een oude stand
                  // leest anders als een actuele blokkade.
                  const nu = Date.now();
                  const huidigeMinuut = new Date(rij.minute_bucket).getTime() === Math.floor(nu / 60_000) * 60_000;
                  const vandaag = rij.day_bucket === new Date(nu).toISOString().slice(0, 10);
                  return (
                    <tr key={`${rij.scope}:${rij.actor_hash}`} className="border-b align-top last:border-0">
                      <td className="py-2 pr-3 font-medium">{rij.scope}</td>
                      <td className="py-2 pr-3 font-mono text-muted-foreground text-xs">
                        {rij.actor_hash.slice(0, 12)}…
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{huidigeMinuut ? rij.minute_count : "—"}</td>
                      <td className="py-2 pr-3 tabular-nums">{vandaag ? rij.day_count : "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground text-xs tabular-nums">
                        {formatMoment(rij.updated_at)}
                      </td>
                      <td className="py-2">
                        <QuotaClearButton
                          scope={rij.scope}
                          actorHash={rij.actor_hash}
                          label={`${rij.scope} · ${rij.actor_hash.slice(0, 12)}…`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
      <AdminCard title="Assistent-telemetrie (careon_assistant_events)">
        {!assistantEvents.ok && <AdminError status={assistantEvents.status} />}
        {assistantEvents.ok && assistantEvents.data.length === 0 && <AdminEmpty>Geen assistent-telemetrie.</AdminEmpty>}
        {assistantEvents.ok && assistantEvents.data.length > 0 && (
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
                {assistantEvents.data.map((event) => (
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
        )}
      </AdminCard>
    </>
  );
}

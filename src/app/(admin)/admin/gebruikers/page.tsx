import {
  type AdminMembership,
  adminConfigured,
  listAuthUsers,
  listMemberships,
  listOrganizations,
  listPlatformAdmins,
  listProfiles,
} from "@/lib/careon-admin/admin.server";
import { requireSuperadminPage } from "@/lib/supabase/session.server";

import {
  AdminBadge,
  AdminCard,
  AdminEmpty,
  AdminError,
  AdminPager,
  adminHref,
  formatMoment,
  rolLabel,
} from "../_components/admin-ui";
import { UserActions } from "./_components/user-actions";
import { UserCreateForm } from "./_components/user-create-form";

export const dynamic = "force-dynamic";

const PER_PAGINA = 50;

export default async function AdminUsersPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ q?: string; pagina?: string }> }>) {
  // Superadmin-check op de databoundary zelf (layout rendert parallel).
  const session = await requireSuperadminPage();
  if (!adminConfigured()) {
    return <AdminEmpty>Supabase is niet geconfigureerd.</AdminEmpty>;
  }
  const { q, pagina } = await searchParams;
  const zoek = (q ?? "").trim().toLowerCase();
  const paginaNummer = Math.max(1, Number.parseInt(pagina ?? "1", 10) || 1);

  const [authUsers, profiles, memberships, organizations, platformAdmins] = await Promise.all([
    listAuthUsers(),
    listProfiles(),
    listMemberships(),
    listOrganizations(),
    listPlatformAdmins(),
  ]);
  const profileById = new Map((profiles.ok ? profiles.data : []).map((profile) => [profile.id, profile]));
  const orgs = organizations.ok ? organizations.data : [];
  const orgById = new Map(orgs.map((org) => [org.id, org]));
  // Eén gebruiker kan in meerdere organisaties zitten (de sleutel is
  // org+gebruiker); een Map op user_id liet die extra lidmaatschappen vallen.
  const membershipsByUser = new Map<string, AdminMembership[]>();
  for (const membership of memberships.ok ? memberships.data : []) {
    const bestaand = membershipsByUser.get(membership.user_id);
    if (bestaand) bestaand.push(membership);
    else membershipsByUser.set(membership.user_id, [membership]);
  }
  const adminIds = new Set((platformAdmins.ok ? platformAdmins.data : []).map((admin) => admin.user_id));

  const alleGebruikers = authUsers.ok ? authUsers.data : [];
  const gefilterd = alleGebruikers.filter((user) => {
    if (zoek === "") return true;
    const naam = profileById.get(user.id)?.full_name ?? "";
    return `${user.email ?? ""} ${naam}`.toLowerCase().includes(zoek);
  });
  const laatstePagina = Math.max(1, Math.ceil(gefilterd.length / PER_PAGINA));
  const huidigePagina = Math.min(paginaNummer, laatstePagina);
  const start = (huidigePagina - 1) * PER_PAGINA;
  const zichtbaar = gefilterd.slice(start, start + PER_PAGINA);

  return (
    <>
      <AdminCard title="Gebruikers">
        <form method="get" action="/admin/gebruikers" className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs" htmlFor="gebruiker-zoek">
            <span className="text-muted-foreground">Zoek op e-mail of naam</span>
            <input
              id="gebruiker-zoek"
              name="q"
              defaultValue={q ?? ""}
              placeholder="naam@organisatie.nl"
              className="h-9 w-64 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">
            Zoek
          </button>
          {zoek !== "" && (
            <a href="/admin/gebruikers" className="text-muted-foreground text-xs underline-offset-4 hover:underline">
              Wis zoekopdracht
            </a>
          )}
        </form>
        {!authUsers.ok && <AdminError status={authUsers.status} />}
        {authUsers.ok && gefilterd.length === 0 && <AdminEmpty>Geen gebruikers gevonden.</AdminEmpty>}
        {zichtbaar.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 pr-3 font-medium">E-mail</th>
                  <th className="py-2 pr-3 font-medium">Naam</th>
                  <th className="py-2 pr-3 font-medium">Organisaties</th>
                  <th className="py-2 pr-3 font-medium">Laatste login</th>
                  <th className="py-2 font-medium">Acties</th>
                </tr>
              </thead>
              <tbody>
                {zichtbaar.map((user) => {
                  const lidmaatschappen = membershipsByUser.get(user.id) ?? [];
                  const banned = Boolean(user.banned_until && new Date(user.banned_until) > new Date());
                  return (
                    <tr key={user.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-3 font-medium">
                        {user.email}
                        {adminIds.has(user.id) && (
                          <span className="ml-2">
                            <AdminBadge tone="primair">superadmin</AdminBadge>
                          </span>
                        )}
                        {banned && (
                          <span className="ml-2">
                            <AdminBadge tone="waarschuwing">geblokkeerd</AdminBadge>
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{profileById.get(user.id)?.full_name || "—"}</td>
                      <td className="py-2 pr-3 text-xs">
                        {lidmaatschappen.length === 0
                          ? "—"
                          : lidmaatschappen.map((lidmaatschap) => (
                              <span key={lidmaatschap.org_id} className="block">
                                {orgById.get(lidmaatschap.org_id)?.name ?? lidmaatschap.org_id}
                                <span className="text-muted-foreground"> · {rolLabel(lidmaatschap.role)}</span>
                              </span>
                            ))}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground text-xs">{formatMoment(user.last_sign_in_at)}</td>
                      <td className="py-2">
                        <UserActions
                          userId={user.id}
                          email={user.email ?? ""}
                          fullName={profileById.get(user.id)?.full_name ?? ""}
                          banned={banned}
                          isSelf={user.id === session.userId}
                          isPlatformAdmin={adminIds.has(user.id)}
                          platformRolBekend={platformAdmins.ok}
                          memberships={lidmaatschappen.map((lidmaatschap) => ({
                            orgId: lidmaatschap.org_id,
                            orgName: orgById.get(lidmaatschap.org_id)?.name ?? lidmaatschap.org_id,
                            role: lidmaatschap.role,
                          }))}
                          organizations={orgs.map((org) => ({ id: org.id, name: org.name }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {gefilterd.length > PER_PAGINA && (
          <AdminPager
            bereik={`${start + 1}–${start + zichtbaar.length} van ${gefilterd.length}`}
            vorigeHref={huidigePagina > 1 ? adminHref("/admin/gebruikers", { q, pagina: huidigePagina - 1 }) : null}
            volgendeHref={
              huidigePagina < laatstePagina ? adminHref("/admin/gebruikers", { q, pagina: huidigePagina + 1 }) : null
            }
          />
        )}
        {authUsers.ok && !memberships.ok && (
          <div className="mt-2">
            <AdminError status={memberships.status}>Lidmaatschappen konden niet worden opgehaald.</AdminError>
          </div>
        )}
        {/* Ook de secundaire reads melden zich: stil falen las hier als "geen
            naam", "geen superadmin" of — bij een naamzoekopdracht — als "geen
            gebruikers gevonden" voor een bestaande collega. */}
        {authUsers.ok && !profiles.ok && (
          <div className="mt-2">
            <AdminError status={profiles.status}>
              Namen konden niet worden opgehaald; zoeken op naam werkt nu niet en de kolom Naam toont &quot;—&quot;.
            </AdminError>
          </div>
        )}
        {authUsers.ok && !platformAdmins.ok && (
          <div className="mt-2">
            <AdminError status={platformAdmins.status}>
              Platformrollen konden niet worden gelezen; superadmin-markeringen ontbreken en de platformrol-knop is
              uitgeschakeld.
            </AdminError>
          </div>
        )}
        {authUsers.ok && !organizations.ok && (
          <div className="mt-2">
            <AdminError status={organizations.status}>
              Organisatienamen konden niet worden opgehaald; de kolom Organisaties toont UUID&apos;s en organisaties
              koppelen is nu niet mogelijk.
            </AdminError>
          </div>
        )}
      </AdminCard>
      <AdminCard title="Nieuwe gebruiker">
        {!organizations.ok && (
          <AdminError status={organizations.status}>
            Organisatielijst kon niet worden geladen; een gebruiker aanmaken is nu niet mogelijk.
          </AdminError>
        )}
        <UserCreateForm organizations={orgs.map((org) => ({ id: org.id, name: org.name }))} />
      </AdminCard>
    </>
  );
}

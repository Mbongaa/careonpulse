import {
  adminConfigured,
  listAuthUsers,
  listMemberships,
  listOrganizations,
  listPlatformAdmins,
  listProfiles,
} from "@/lib/careon-admin/admin.server";
import { requireSuperadminPage } from "@/lib/supabase/session.server";

import { AdminCard, AdminEmpty, formatMoment } from "../_components/admin-ui";
import { UserActions } from "./_components/user-actions";
import { UserCreateForm } from "./_components/user-create-form";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  // Superadmin-check op de databoundary zelf (layout rendert parallel).
  await requireSuperadminPage();
  if (!adminConfigured()) {
    return <AdminEmpty>Supabase is niet geconfigureerd.</AdminEmpty>;
  }

  const [authUsers, profiles, memberships, organizations, platformAdmins] = await Promise.all([
    listAuthUsers(),
    listProfiles(),
    listMemberships(),
    listOrganizations(),
    listPlatformAdmins(),
  ]);
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const orgById = new Map((organizations ?? []).map((org) => [org.id, org]));
  const membershipByUser = new Map((memberships ?? []).map((membership) => [membership.user_id, membership]));
  const adminIds = new Set((platformAdmins ?? []).map((admin) => admin.user_id));

  return (
    <>
      <AdminCard title="Gebruikers">
        {authUsers && authUsers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 pr-3 font-medium">E-mail</th>
                  <th className="py-2 pr-3 font-medium">Naam</th>
                  <th className="py-2 pr-3 font-medium">Organisatie</th>
                  <th className="py-2 pr-3 font-medium">Rol</th>
                  <th className="py-2 pr-3 font-medium">Laatste login</th>
                  <th className="py-2 font-medium">Acties</th>
                </tr>
              </thead>
              <tbody>
                {authUsers.map((user) => {
                  const membership = membershipByUser.get(user.id);
                  const banned = Boolean(user.banned_until && new Date(user.banned_until) > new Date());
                  return (
                    <tr key={user.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">
                        {user.email}
                        {adminIds.has(user.id) && (
                          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                            superadmin
                          </span>
                        )}
                        {banned && (
                          <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive text-xs">
                            geblokkeerd
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{profileById.get(user.id)?.full_name || "—"}</td>
                      <td className="py-2 pr-3">
                        {membership ? (orgById.get(membership.org_id)?.name ?? membership.org_id) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{membership?.role ?? "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground text-xs">{formatMoment(user.last_sign_in_at)}</td>
                      <td className="py-2">
                        <UserActions userId={user.id} email={user.email ?? ""} banned={banned} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <AdminEmpty>Geen gebruikers gevonden.</AdminEmpty>
        )}
      </AdminCard>
      <AdminCard title="Nieuwe gebruiker">
        <UserCreateForm organizations={(organizations ?? []).map((org) => ({ id: org.id, name: org.name }))} />
      </AdminCard>
    </>
  );
}

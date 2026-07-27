import {
  adminConfigured,
  latestStatePerOrg,
  listMemberships,
  listOrganizations,
} from "@/lib/careon-admin/admin.server";
import { requireSuperadminPage } from "@/lib/supabase/session.server";

import { AdminCard, AdminEmpty, formatMoment } from "../_components/admin-ui";
import { OrgCreateForm } from "./_components/org-create-form";

export const dynamic = "force-dynamic";

const REGISTRATIES: { table: string; label: string }[] = [
  { table: "careon_import_runs", label: "EPD-import" },
  { table: "careon_middelen_state", label: "Middelen" },
  { table: "careon_hr_state", label: "HR" },
  { table: "careon_agenda_state", label: "Agenda" },
  { table: "careon_declaraties_state", label: "Declaraties" },
];

export default async function AdminOrganizationsPage() {
  // Superadmin-check op de databoundary zelf (layout rendert parallel).
  await requireSuperadminPage();
  if (!adminConfigured()) {
    return <AdminEmpty>Supabase is niet geconfigureerd.</AdminEmpty>;
  }

  const [organizations, memberships, ...states] = await Promise.all([
    listOrganizations(),
    listMemberships(),
    // careon_import_runs heeft imported_at i.p.v. saved_at; aparte kolomkeuze
    // is de moeite niet — de nieuwste rij per org volstaat via saved_at-tabellen
    // en voor runs tonen we alleen aanwezigheid.
    ...REGISTRATIES.slice(1).map((registratie) => latestStatePerOrg(registratie.table)),
  ]);
  const memberCount = new Map<string, number>();
  for (const membership of memberships ?? []) {
    memberCount.set(membership.org_id, (memberCount.get(membership.org_id) ?? 0) + 1);
  }

  return (
    <>
      <AdminCard title="Organisaties">
        {organizations && organizations.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 pr-3 font-medium">Naam</th>
                  <th className="py-2 pr-3 font-medium">Slug</th>
                  <th className="py-2 pr-3 font-medium">Leden</th>
                  {REGISTRATIES.slice(1).map((registratie) => (
                    <th key={registratie.table} className="py-2 pr-3 font-medium">
                      {registratie.label}
                    </th>
                  ))}
                  <th className="py-2 font-medium">Aangemaakt</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((org) => (
                  <tr key={org.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{org.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{org.slug}</td>
                    <td className="py-2 pr-3 tabular-nums">{memberCount.get(org.id) ?? 0}</td>
                    {states.map((state, index) => {
                      const latest = state.get(org.id);
                      return (
                        <td key={REGISTRATIES[index + 1].table} className="py-2 pr-3 text-muted-foreground text-xs">
                          {latest
                            ? `${latest.revision ? `rev ${latest.revision} · ` : ""}${formatMoment(latest.savedAt)}`
                            : "—"}
                        </td>
                      );
                    })}
                    <td className="py-2 text-muted-foreground text-xs">{formatMoment(org.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <AdminEmpty>Geen organisaties gevonden.</AdminEmpty>
        )}
      </AdminCard>
      <AdminCard title="Nieuwe organisatie">
        <OrgCreateForm />
      </AdminCard>
    </>
  );
}

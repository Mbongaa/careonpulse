import Link from "next/link";

import {
  ADMIN_IMPORT_RUNS,
  ADMIN_REGISTRATIES,
  type AdminResult,
  type AdminStand,
  adminConfigured,
  latestStatePerOrg,
  listMemberships,
  listOrganizations,
} from "@/lib/careon-admin/admin.server";
import { requireSuperadminPage } from "@/lib/supabase/session.server";

import { AdminCard, AdminEmpty, AdminError, formatMoment } from "../_components/admin-ui";
import { OrgCreateForm } from "./_components/org-create-form";
import { OrgRenameForm } from "./_components/org-rename-form";

export const dynamic = "force-dynamic";

// De zes registraties uit spec §8 plus de EPD-import; die laatste heeft een
// eigen tijdkolom (created_at, servertijd sinds 0017) en werd voorheen
// weggesneden, waardoor imports nergens in beheer zichtbaar waren.
const BRONNEN = [...ADMIN_REGISTRATIES, ADMIN_IMPORT_RUNS];

function standTekst(stand: AdminStand | undefined): string {
  if (!stand) return "—";
  return `${stand.revision ? `rev ${stand.revision} · ` : ""}${formatMoment(stand.savedAt)}`;
}

export default async function AdminOrganizationsPage() {
  // Superadmin-check op de databoundary zelf (layout rendert parallel).
  await requireSuperadminPage();
  if (!adminConfigured()) {
    return <AdminEmpty>Supabase is niet geconfigureerd.</AdminEmpty>;
  }

  // Eerst de organisaties: de versheid wordt per organisatie opgevraagd
  // (limit-1 per tabel), zodat een drukke tenant een rustige niet meer uit een
  // gedeeld venster kan drukken.
  const [organizations, memberships] = await Promise.all([listOrganizations(), listMemberships()]);
  const orgs = organizations.ok ? organizations.data : [];
  const orgIds = orgs.map((org) => org.id);
  const standen = await Promise.all(BRONNEN.map((bron) => latestStatePerOrg(bron, orgIds)));
  const memberCount = new Map<string, number>();
  for (const membership of memberships.ok ? memberships.data : []) {
    memberCount.set(membership.org_id, (memberCount.get(membership.org_id) ?? 0) + 1);
  }

  return (
    <>
      <AdminCard title="Organisaties">
        {!organizations.ok && <AdminError status={organizations.status} />}
        {organizations.ok && orgs.length === 0 && <AdminEmpty>Geen organisaties gevonden.</AdminEmpty>}
        {orgs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 pr-3 font-medium">Naam</th>
                  <th className="py-2 pr-3 font-medium">Slug</th>
                  <th className="py-2 pr-3 font-medium">Leden</th>
                  {BRONNEN.map((bron) => (
                    <th key={bron.table} className="py-2 pr-3 font-medium">
                      {bron.label}
                    </th>
                  ))}
                  <th className="py-2 pr-3 font-medium">Aangemaakt</th>
                  <th className="py-2 font-medium">Naam wijzigen</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => (
                  <tr key={org.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3 font-medium">
                      <Link className="underline-offset-4 hover:underline" href={`/admin/organisaties/${org.id}`}>
                        {org.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{org.slug}</td>
                    <td className="py-2 pr-3 tabular-nums">{memberships.ok ? (memberCount.get(org.id) ?? 0) : "—"}</td>
                    {standen.map((stand: AdminResult<Map<string, AdminStand>>, index) => (
                      <td key={BRONNEN[index].table} className="py-2 pr-3 text-muted-foreground text-xs">
                        {stand.ok ? standTekst(stand.data.get(org.id)) : <span className="text-destructive">fout</span>}
                      </td>
                    ))}
                    <td className="py-2 pr-3 text-muted-foreground text-xs">{formatMoment(org.created_at)}</td>
                    <td className="py-2">
                      <OrgRenameForm id={org.id} name={org.name} slug={org.slug} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {organizations.ok && !memberships.ok && (
          <div className="mt-2">
            <AdminError status={memberships.status}>Ledenaantallen konden niet worden opgehaald.</AdminError>
          </div>
        )}
      </AdminCard>
      <AdminCard title="Nieuwe organisatie">
        <OrgCreateForm />
      </AdminCard>
    </>
  );
}

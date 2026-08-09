import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ADMIN_HERSTELBAAR,
  ADMIN_IMPORT_RUNS,
  ADMIN_REGISTRATIES,
  type AdminResult,
  type AdminStand,
  adminConfigured,
  importRunRecordCounts,
  importRunsForOrg,
  isAdminUuid,
  latestStateForOrg,
  listAuthUsers,
  listMemberships,
  listProfiles,
  organizationById,
  revisiesVoorOrg,
} from "@/lib/careon-admin/admin.server";
import { requireSuperadminPage } from "@/lib/supabase/session.server";

import { AdminBadge, AdminCard, AdminEmpty, AdminError, formatMoment, rolLabel } from "../../_components/admin-ui";
import { OrgDeleteButton } from "../_components/org-delete-button";
import { OrgRenameForm } from "../_components/org-rename-form";
import { RevisieHerstelButton } from "./_components/revisie-herstel-button";

export const dynamic = "force-dynamic";

// Detailweergave per organisatie (spec §8): leden, de laatste stand van alle
// zes registraties en de recentste EPD-imports — de drie vragen die support in
// maand 1 stelt en die anders alleen met SQL tegen productie te beantwoorden
// waren.
const BRONNEN = [...ADMIN_REGISTRATIES, ADMIN_IMPORT_RUNS];

function standTekst(result: AdminResult<AdminStand | null>): string {
  if (!result.ok) return "fout";
  if (!result.data) return "—";
  return `${result.data.revision ? `rev ${result.data.revision} · ` : ""}${formatMoment(result.data.savedAt)}`;
}

export default async function AdminOrganizationDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  // Superadmin-check op de databoundary zelf (layout rendert parallel).
  await requireSuperadminPage();
  if (!adminConfigured()) {
    return <AdminEmpty>Supabase is niet geconfigureerd.</AdminEmpty>;
  }
  const { id } = await params;
  if (!isAdminUuid(id)) notFound();

  const [organisaties, memberships, profiles, authUsers, importRuns, ...standen] = await Promise.all([
    organizationById(id),
    listMemberships(id),
    listProfiles(),
    listAuthUsers(),
    importRunsForOrg(id, 10),
    ...BRONNEN.map((bron) => latestStateForOrg(bron, id)),
  ]);
  if (!organisaties.ok) {
    return <AdminError status={organisaties.status} />;
  }
  const organisatie = organisaties.data[0];
  if (!organisatie) notFound();

  // Werkelijke rijtellingen per run: een afgebroken upload staat wél in de
  // runtabel maar wordt door het dashboard genegeerd — dat verschil moet hier
  // zichtbaar zijn, anders leest een mislukte import als de nieuwste geslaagde.
  const recordCounts = importRuns.ok ? await importRunRecordCounts(importRuns.data.map((run) => run.id)) : null;
  // Revisiehistorie van de handmatige registraties: de enige weg terug nadat
  // iemand binnen de organisatie een stand heeft leeggemaakt of overschreven.
  const revisies = await Promise.all(ADMIN_HERSTELBAAR.map((bron) => revisiesVoorOrg(bron, id, 8)));

  const profileById = new Map((profiles.ok ? profiles.data : []).map((profile) => [profile.id, profile]));
  const authById = new Map((authUsers.ok ? authUsers.data : []).map((user) => [user.id, user]));
  const leden = memberships.ok ? memberships.data : [];

  return (
    <>
      <AdminCard title={organisatie.name}>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-xs">Slug</dt>
            <dd>{organisatie.slug}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Aangemaakt</dt>
            <dd className="tabular-nums">{formatMoment(organisatie.created_at)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Leden</dt>
            <dd className="tabular-nums">{memberships.ok ? leden.length : "—"}</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <OrgRenameForm id={organisatie.id} name={organisatie.name} slug={organisatie.slug} />
          <OrgDeleteButton id={organisatie.id} name={organisatie.name} />
        </div>
        <p className="mt-3 text-xs">
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/organisaties">
            Terug naar organisaties
          </Link>
        </p>
      </AdminCard>

      <AdminCard title="Leden">
        {!memberships.ok && <AdminError status={memberships.status} />}
        {memberships.ok && leden.length === 0 && <AdminEmpty>Deze organisatie heeft nog geen leden.</AdminEmpty>}
        {leden.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 pr-3 font-medium">E-mail</th>
                  <th className="py-2 pr-3 font-medium">Naam</th>
                  <th className="py-2 pr-3 font-medium">Rol</th>
                  <th className="py-2 pr-3 font-medium">Lid sinds</th>
                  <th className="py-2 font-medium">Laatste login</th>
                </tr>
              </thead>
              <tbody>
                {leden.map((lid) => {
                  const authUser = authById.get(lid.user_id);
                  const geblokkeerd = Boolean(authUser?.banned_until && new Date(authUser.banned_until) > new Date());
                  return (
                    <tr key={lid.user_id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">
                        {authUser?.email ?? lid.user_id}
                        {geblokkeerd && (
                          <span className="ml-2">
                            <AdminBadge tone="waarschuwing">geblokkeerd</AdminBadge>
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{profileById.get(lid.user_id)?.full_name || "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{rolLabel(lid.role)}</td>
                      <td className="py-2 pr-3 text-muted-foreground text-xs">{formatMoment(lid.created_at)}</td>
                      <td className="py-2 text-muted-foreground text-xs">{formatMoment(authUser?.last_sign_in_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {memberships.ok && !authUsers.ok && (
          <div className="mt-2">
            <AdminError status={authUsers.status}>
              E-mailadressen konden niet worden opgehaald; de lijst toont dan UUID&apos;s.
            </AdminError>
          </div>
        )}
        {memberships.ok && !profiles.ok && (
          <div className="mt-2">
            <AdminError status={profiles.status}>
              Namen konden niet worden opgehaald; de kolom Naam toont daarom &quot;—&quot;.
            </AdminError>
          </div>
        )}
        <p className="mt-3 text-xs">
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/gebruikers">
            Rollen en accounts beheren
          </Link>
        </p>
      </AdminCard>

      <AdminCard title="Laatste stand per registratie">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="py-2 pr-3 font-medium">Registratie</th>
                <th className="py-2 font-medium">Laatst opgeslagen</th>
              </tr>
            </thead>
            <tbody>
              {BRONNEN.map((bron, index) => (
                <tr key={bron.table} className="border-b last:border-0">
                  <td className="py-2 pr-3">{bron.label}</td>
                  <td className="py-2 text-muted-foreground text-xs">{standTekst(standen[index])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminCard>

      <AdminCard title="Revisies van handmatige registraties">
        <p className="mb-3 text-muted-foreground text-xs">
          Elke opslag is een aparte revisie; er wordt nooit iets overschreven. Herstellen zet een eerdere stand terug
          als nieuwe revisie — de tussenliggende standen blijven bewaard.
        </p>
        {ADMIN_HERSTELBAAR.map((bron, index) => {
          const historie = revisies[index];
          return (
            <div key={bron.table} className="mb-4 last:mb-0">
              <h3 className="mb-2 font-medium text-sm">{bron.label}</h3>
              {!historie.ok && <AdminError status={historie.status} />}
              {historie.ok && historie.data.length === 0 && (
                <AdminEmpty>Nog geen centrale opslag voor deze registratie.</AdminEmpty>
              )}
              {historie.ok && historie.data.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="py-2 pr-3 font-medium">Revisie</th>
                        <th className="py-2 pr-3 font-medium">Opgeslagen</th>
                        <th className="py-2 pr-3 font-medium">Bron</th>
                        <th className="py-2 font-medium">Actie</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historie.data.map((revisie, rij) => {
                        // change_summary.destructive wordt door de dataroutes
                        // gezet wanneer een opslag rijen weghaalt — precies de
                        // gebeurtenis waarvoor deze kaart bestaat.
                        const destructief = revisie.change_summary?.destructive === true;
                        return (
                          <tr key={revisie.id} className="border-b align-top last:border-0">
                            <td className="py-2 pr-3 tabular-nums">
                              {revisie.revision}
                              {rij === 0 && <span className="ml-2 text-muted-foreground text-xs">huidige stand</span>}
                              {destructief && (
                                <span className="ml-2">
                                  <AdminBadge tone="waarschuwing">verwijderde rijen</AdminBadge>
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-muted-foreground text-xs tabular-nums">
                              {formatMoment(revisie.saved_at)}
                            </td>
                            <td className="py-2 pr-3 text-muted-foreground text-xs">{revisie.change_source ?? "—"}</td>
                            <td className="py-2">
                              {rij > 0 && (
                                <RevisieHerstelButton
                                  table={bron.table}
                                  orgId={organisatie.id}
                                  revisieId={revisie.id}
                                  revisie={revisie.revision}
                                  label={bron.label}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </AdminCard>

      <AdminCard title="Recente EPD-imports">
        {!importRuns.ok && <AdminError status={importRuns.status} />}
        {importRuns.ok && importRuns.data.length === 0 && (
          <AdminEmpty>Nog geen import-runs voor deze organisatie.</AdminEmpty>
        )}
        {importRuns.ok && importRuns.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="py-2 pr-3 font-medium">Bestand</th>
                  <th className="py-2 pr-3 font-medium">Rijen</th>
                  <th className="py-2 pr-3 font-medium">Exportmoment (werkstation)</th>
                  <th className="py-2 font-medium">Ontvangen (server)</th>
                </tr>
              </thead>
              <tbody>
                {importRuns.data.map((run) => {
                  const werkelijk = recordCounts?.ok ? (recordCounts.data.get(run.id) ?? null) : null;
                  // Dezelfde volledigheidsregels als de productie-GET: een run
                  // zonder rijtelling (van vóór de total_rows-kolom) en een run
                  // waarvan niet alle rijen aankwamen worden daar overgeslagen.
                  // Een onbekende telling (null) krijgt géén label — dat zou
                  // als vals "onvolledig" lezen.
                  const geenTelling = run.total_rows <= 0;
                  const onvolledig = !geenTelling && werkelijk !== null && werkelijk !== run.total_rows;
                  return (
                    <tr key={run.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{run.file_name}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {run.total_rows}
                        {geenTelling && (
                          <span className="ml-2">
                            <AdminBadge tone="waarschuwing">
                              geen rijtelling (oude run) — genegeerd door het dashboard
                            </AdminBadge>
                          </span>
                        )}
                        {onvolledig && (
                          <span className="ml-2">
                            <AdminBadge tone="waarschuwing">
                              onvolledig ({werkelijk} aangekomen) — genegeerd door het dashboard
                            </AdminBadge>
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground text-xs">{formatMoment(run.imported_at)}</td>
                      <td className="py-2 text-muted-foreground text-xs">{formatMoment(run.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {importRuns.ok && recordCounts && !recordCounts.ok && (
          <div className="mt-2">
            <AdminError status={recordCounts.status}>
              Rijtellingen konden niet worden gecontroleerd; onvolledige imports zijn nu niet gemarkeerd.
            </AdminError>
          </div>
        )}
      </AdminCard>
    </>
  );
}

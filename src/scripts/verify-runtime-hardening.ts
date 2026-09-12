/**
 * Fault-injection gate for the production execution boundary. All provider
 * calls are mocked; no network, API key, or database is used.
 */

import { amsterdamDagGrens } from "../lib/careon-admin/admin.server";
import { authenticatedActorHash, loginActorHash } from "../lib/careon-assistant/runtime.server";
import { CAREON_HOSTED_DEMO_EMAIL, isCareonHostedDemoEmail } from "../lib/careon-demo-account";
import { evaluateEntraJitEligibility, resolveEntraJitConfig } from "../lib/careon-entra/jit-claims";
import { RequestPayloadTooLargeError, readJsonBodyLimited } from "../lib/http/read-json.server";
import * as fs from "node:fs";
import * as path from "node:path";

let passes = 0;
let failures = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

function assistantRequest(question: string): Request {
  return new Request("http://careon.test/api/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-careon-assistant": "1",
      "x-careon-session": "careon-runtime-hardening-test",
    },
    body: JSON.stringify({
      question,
      context: "{}",
      events: true,
      tools: true,
      allowedTools: ["wijzig_taal"],
    }),
  });
}

function sse(...events: unknown[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\n`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function main() {
  const proxySource = fs.readFileSync(path.resolve(process.cwd(), "src/proxy.ts"), "utf8");
  check("proxy matcher slaat prefetch niet over", !proxySource.includes("missing:"));
  check("proxy gebruikt expliciete demo-vlag", proxySource.includes("isCareonDemoMode()"));
  check("vast demoaccount wordt hoofdletterongevoelig herkend", isCareonHostedDemoEmail(" USER1@CAREON-DEMO.NL "));
  check("gewone accounts zijn niet beschermd", !isCareonHostedDemoEmail("user1@example.nl"));
  const adminUsersSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/admin/users/route.ts"), "utf8");
  check(
    "admin-API beschermt vaste demoaccount tegen lock-out",
    adminUsersSource.includes("isCareonHostedDemoEmail(target.email)") &&
      adminUsersSource.includes('action !== "unban"'),
  );
  const logoutSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/auth/logout/route.ts"), "utf8");
  const loginSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/auth/login/route.ts"), "utf8");
  check(
    "logout beëindigt alleen huidige sessie",
    logoutSource.includes('signOut({ scope: "local" })') && loginSource.includes('signOut({ scope: "local" })'),
  );
  const microsoftLoginSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/api/auth/microsoft/route.ts"),
    "utf8",
  );
  const microsoftCallbackSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/api/auth/callback/route.ts"),
    "utf8",
  );
  const oauthConfigSource = fs.readFileSync(path.resolve(process.cwd(), "src/lib/supabase/oauth.server.ts"), "utf8");
  check(
    "Microsoft-login is featureflagged en demo-gesloten",
    oauthConfigSource.includes('process.env.CAREON_MICROSOFT_LOGIN_ENABLED === "1"') &&
      oauthConfigSource.includes("!isCareonDemoMode()") &&
      microsoftLoginSource.includes("if (!isMicrosoftLoginEnabled())"),
  );
  check(
    "Microsoft-loginregistratie blijft identity-only",
    microsoftLoginSource.includes('provider: "azure"') &&
      microsoftLoginSource.includes('scopes: "openid profile email"') &&
      !/Mail\.|Calendars\.|Files\.|Sites\.|Team\.|Channel\.|offline_access/.test(microsoftLoginSource),
  );
  check(
    "Microsoft-callback laat JIT alleen vóór het bestaande fail-closed weigerpad proberen",
    microsoftCallbackSource.includes('.eq("user_id", user.id)') &&
      microsoftCallbackSource.includes("provisionEntraJitMembership(user)") &&
      microsoftCallbackSource.indexOf("provisionEntraJitMembership(user)") <
        microsoftCallbackSource.indexOf("microsoft_no_access_assignment") &&
      microsoftCallbackSource.includes('signOut({ scope: "local" })'),
  );
  const jitMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260821131342_entra_jit_membership.sql"),
    "utf8",
  );
  const currentJwtRoleGuardMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260821155300_current_postgrest_jwt_role_guard.sql"),
    "utf8",
  );
  check(
    "Entra JIT-RPC is service-role-only en kent uitsluitend de memberrol toe",
    currentJwtRoleGuardMigration.includes("coalesce(auth.jwt() ->> ''role'', '''')") &&
      currentJwtRoleGuardMigration.includes("careon_provision_entra_member(uuid,text,text,text)") &&
      jitMigration.includes("revoke all on function public.careon_provision_entra_member") &&
      jitMigration.includes("grant execute on function public.careon_provision_entra_member") &&
      jitMigration.includes("to service_role") &&
      jitMigration.includes("values (v_org_id, p_user_id, 'member')") &&
      !jitMigration.includes("values (v_org_id, p_user_id, 'org_admin')"),
  );
  check(
    "Entra JIT blijft uit bij een ontbrekende of gedeeltelijke configuratie",
    resolveEntraJitConfig({ CAREON_ENTRA_JIT_ENABLED: "0" }).status === "disabled" &&
      resolveEntraJitConfig({ CAREON_ENTRA_JIT_ENABLED: "1" }).status === "invalid",
  );
  const jitConfig = {
    status: "ready",
    config: {
      orgSlug: "tgc",
      tenantId: "11111111-1111-4111-8111-111111111111",
      requiredAppRole: "Careon.User",
    },
  } as const;
  const entraUser = (overrides: Record<string, unknown> = {}) =>
    ({
      email: "medewerker@tgc.test",
      identities: [
        {
          provider: "azure",
          identity_data: {
            email: "medewerker@tgc.test",
            custom_claims: {
              tid: "11111111-1111-4111-8111-111111111111",
              acct: "0",
              xms_edov: true,
              roles: ["Careon.User"],
            },
            ...overrides,
          },
        },
      ],
    }) as unknown as Parameters<typeof evaluateEntraJitEligibility>[0];
  check(
    "Entra JIT accepteert exact de goedgekeurde tenant/e-mail/app-rol",
    evaluateEntraJitEligibility(entraUser(), jitConfig).status === "eligible",
  );
  check(
    "Entra JIT weigert een verkeerde tenant",
    evaluateEntraJitEligibility(
      entraUser({
        custom_claims: {
          tid: "22222222-2222-4222-8222-222222222222",
          acct: "0",
          xms_edov: true,
          roles: ["Careon.User"],
        },
      }),
      jitConfig,
    ).status === "tenant_mismatch",
  );
  check(
    "Entra JIT weigert gasten en een ontbrekend accounttype",
    evaluateEntraJitEligibility(
      entraUser({
        custom_claims: {
          tid: "11111111-1111-4111-8111-111111111111",
          acct: "1",
          xms_edov: true,
          roles: ["Careon.User"],
        },
      }),
      jitConfig,
    ).status === "guest_or_account_type_unverified" &&
      evaluateEntraJitEligibility(
        entraUser({
          custom_claims: {
            tid: "11111111-1111-4111-8111-111111111111",
            xms_edov: true,
            roles: ["Careon.User"],
          },
        }),
        jitConfig,
      ).status === "guest_or_account_type_unverified",
  );
  check(
    "Entra JIT weigert een niet-geverifieerd adres",
    evaluateEntraJitEligibility(
      entraUser({
        custom_claims: { tid: "11111111-1111-4111-8111-111111111111", acct: "0", roles: ["Careon.User"] },
      }),
      jitConfig,
    ).status === "email_not_verified",
  );
  check(
    "Entra JIT weigert een e-mailmismatch",
    evaluateEntraJitEligibility(entraUser({ email: "ander@tgc.test" }), jitConfig).status === "email_mismatch",
  );
  check(
    "Entra JIT weigert een ontbrekende app-rol",
    evaluateEntraJitEligibility(
      entraUser({
        custom_claims: { tid: "11111111-1111-4111-8111-111111111111", acct: "0", xms_edov: true, roles: [] },
      }),
      jitConfig,
    ).status === "required_app_role_missing",
  );
  const directorySource = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/careon-entra/directory.server.ts"),
    "utf8",
  );
  const directoryRouteSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/api/org/entra-members/route.ts"),
    "utf8",
  );
  const environmentExample = fs.readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8");
  check(
    "Entra-directoryconnector blijft uit zonder volledige serverconfiguratie",
    directorySource.includes('CAREON_ENTRA_DIRECTORY_ENABLED !== "1"') &&
      directorySource.includes("CAREON_ENTRA_DIRECTORY_SOURCE") &&
      directorySource.includes('status: "invalid_configuration"') &&
      !directorySource.includes("NEXT_PUBLIC_CAREON_ENTRA_DIRECTORY"),
  );
  check(
    "Entra-directoryconnector leest volledige inventaris plus ingestelde eligibility-bron via vaste Graph-origin",
    directorySource.includes('const GRAPH_ORIGIN = "https://graph.microsoft.com"') &&
      directorySource.includes('const inventoryPath = "/v1.0/users"') &&
      directorySource.includes("assignedLicenses") &&
      directorySource.includes("/appRoleAssignedTo") &&
      directorySource.includes("/members") &&
      directorySource.includes('config.source === "group"') &&
      directorySource.includes("url.origin === GRAPH_ORIGIN") &&
      directorySource.includes("url.pathname === expectedPath") &&
      directorySource.includes('redirect: "error"') &&
      !directorySource.includes('method: "PATCH"') &&
      !directorySource.includes('method: "DELETE"'),
  );
  check(
    "Entra-medewerkersroute eist org-admin en controleert organisatiebinding",
    directoryRouteSource.includes("requireOrgAdmin()") &&
      directoryRouteSource.includes("organization.slug !== directory.config.orgSlug") &&
      directoryRouteSource.includes('"Cache-Control": "no-store"'),
  );
  check(
    "Entra-directoryconnector documenteert alleen minimale read-permissions",
    environmentExample.includes("GroupMember.Read.All") &&
      environmentExample.includes("Application.Read.All") &&
      environmentExample.includes("User.Read.All") &&
      environmentExample.includes("nooit write-permissions") &&
      !environmentExample.includes("GroupMember.ReadWrite.All"),
  );
  const yaazDirectorySource = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/careon-yaaz/directory.server.ts"),
    "utf8",
  );
  check(
    "YAAZ-directorykoppeling is apart, server-only en fail-closed",
    yaazDirectorySource.includes('import "server-only"') &&
      yaazDirectorySource.includes('CAREON_YAAZ_DIRECTORY_ENABLED !== "1"') &&
      yaazDirectorySource.includes("CAREON_YAAZ_DIRECTORY_KEY") &&
      !yaazDirectorySource.includes("NEXT_PUBLIC_CAREON_YAAZ_DIRECTORY_KEY"),
  );
  check(
    "YAAZ-directorybearer volgt geen redirects en accepteert alleen de vaste statusroute",
    yaazDirectorySource.includes('redirect: "error"') &&
      yaazDirectorySource.includes("/microsoft-365/internal-directory") &&
      yaazDirectorySource.includes("MAX_RESPONSE_BYTES") &&
      yaazDirectorySource.includes("Authorization: `Bearer "),
  );
  const yaazCallDirectoryRoute = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/api/internal/yaaz-call-directory/route.ts"),
    "utf8",
  );
  check(
    "YAAZ-beladresboek is een begrensde read-only serverbrug met exact bearer",
    yaazCallDirectoryRoute.includes("timingSafeEqual") &&
      yaazCallDirectoryRoute.includes("CAREON_YAAZ_DIRECTORY_KEY") &&
      yaazCallDirectoryRoute.includes('"Cache-Control": "private, no-store, max-age=0"') &&
      yaazCallDirectoryRoute.includes("listEntraDirectoryMembers()") &&
      yaazCallDirectoryRoute.includes("listMemberships()") &&
      yaazCallDirectoryRoute.includes("careonSubject: careonUser.id") &&
      yaazCallDirectoryRoute.includes("microsoftUserId: entra.entraObjectId") &&
      !yaazCallDirectoryRoute.includes("clientSecret") &&
      !yaazCallDirectoryRoute.includes("access_token") &&
      !yaazCallDirectoryRoute.includes("refresh_token"),
  );
  const lifecycleMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260821141805_entra_lifecycle_reconciliation.sql"),
    "utf8",
  );
  const lifecycleSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/careon-entra/lifecycle.server.ts"),
    "utf8",
  );
  const yaazLifecycleSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/careon-yaaz/lifecycle.server.ts"),
    "utf8",
  );
  const lifecycleRouteSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/api/internal/entra-reconciliation/route.ts"),
    "utf8",
  );
  check(
    "Entra-lifecycle bewaart service-only observaties en beschermt beheerders",
    lifecycleMigration.includes("alter table public.careon_entra_lifecycle force row level security") &&
      currentJwtRoleGuardMigration.includes("careon_reconcile_entra_snapshot(text,jsonb,integer)") &&
      currentJwtRoleGuardMigration.includes(
        "careon_finalize_entra_lifecycle_action(text,uuid,text,boolean,text,text)",
      ) &&
      lifecycleMigration.includes("v_org_role = 'org_admin'") &&
      lifecycleMigration.includes("public.platform_admins") &&
      lifecycleMigration.includes("p_missing_threshold not between 2 and 24") &&
      lifecycleMigration.includes("pg_advisory_xact_lock") &&
      lifecycleMigration.includes("grant execute on function public.careon_reconcile_entra_snapshot") &&
      lifecycleMigration.includes("to service_role"),
  );
  check(
    "Reconciliatie blokkeert alleen na volledige Graph-snapshot en begrenst mutaties",
    lifecycleSource.includes("listEntraDirectoryMembers()") &&
      lifecycleSource.includes("MAX_ACTIONS_PER_RUN = 10") &&
      lifecycleSource.includes('return { status: "guarded" }') &&
      lifecycleSource.includes("careon_reconcile_entra_snapshot") &&
      lifecycleSource.includes("careon_finalize_entra_lifecycle_action") &&
      lifecycleSource.includes("BAN_FOREVER") &&
      lifecycleSource.includes("applyYaazLifecycle"),
  );
  check(
    "YAAZ-lifecycle gebruikt eigen server-only fail-closed write-boundary",
    yaazLifecycleSource.includes('import "server-only"') &&
      yaazLifecycleSource.includes('CAREON_YAAZ_LIFECYCLE_ENABLED !== "1"') &&
      yaazLifecycleSource.includes("CAREON_YAAZ_LIFECYCLE_KEY") &&
      yaazLifecycleSource.includes("/microsoft-365/internal-lifecycle") &&
      yaazLifecycleSource.includes('redirect: "error"') &&
      !yaazLifecycleSource.includes("CAREON_YAAZ_DIRECTORY_KEY"),
  );
  check(
    "Uurlijkse lifecycle-route eist exact CRON_SECRET en blijft standaard uit",
    lifecycleRouteSource.includes("timingSafeEqual") &&
      lifecycleRouteSource.includes("reconcileEntraLifecycle()") &&
      lifecycleRouteSource.includes('result.status === "disabled"') &&
      environmentExample.includes("CAREON_ENTRA_LIFECYCLE_ENABLED=0") &&
      environmentExample.includes("CAREON_YAAZ_LIFECYCLE_KEY="),
  );
  check(
    "OAuth-redirect vertrouwt in productie alleen de canonieke app-URL",
    oauthConfigSource.includes('process.env.NODE_ENV === "production"') &&
      oauthConfigSource.includes("return null") &&
      !/headers\.get\(["'](?:host|x-forwarded-host)/.test(oauthConfigSource),
  );
  const chatMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260726175252_auth_security_hardening.sql"),
    "utf8",
  );
  check(
    "chat-updatepolicy controleert organisatie in USING en WITH CHECK",
    (chatMigration.match(/app\.is_org_member\(org_id\)/g) ?? []).length >= 4,
  );

  // Financiële rolregel in de database (0015): de anon-key staat in de
  // clientbundle, dus deze regel moet in RLS staan en niet alleen in route-code.
  const financieelMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/0015_financieel_rls.sql"),
    "utf8",
  );
  const securityInvokerMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260822235000_security_invoker_boundaries.sql"),
    "utf8",
  );
  const financieleTabellen = ["careon_agenda_state", "careon_toeslagen_state", "careon_declaraties_state"];
  check(
    "financiële aggregaten verliezen de rolblinde policies uit 0010",
    financieleTabellen.every((table) => financieelMigration.includes(`'${table}'`)) &&
      financieelMigration.includes("t || '_member_select'") &&
      financieelMigration.includes("t || '_member_insert'"),
  );
  check(
    "select én insert op financiële aggregaten eisen de rolregel",
    (financieelMigration.match(/app\.mag_financieel_zien\(org_id\)/g) ?? []).length >= 2,
  );
  check(
    "financiële aggregaten blijven append-only voor clients",
    financieelMigration.includes("revoke update, delete, truncate on table public.%I from anon, authenticated") &&
      !/grant[^;]*\b(update|delete)\b[^;]*to authenticated/i.test(financieelMigration),
  );
  check(
    "SQL-rolregel spiegelt magFinancieelZien (org_admin, platformbeheer, demoaccount)",
    financieelMigration.includes("app.is_superadmin()") &&
      financieelMigration.includes("m.role = 'org_admin'") &&
      financieelMigration.includes(`lower(btrim(u.email)) = '${CAREON_HOSTED_DEMO_EMAIL}'`),
  );
  // De interne functie mag de strengere RLS van de basistabel overslaan, maar
  // filtert zelf op lidmaatschap. PostgREST exposeert uitsluitend de invoker-
  // view; daardoor is er geen publieke SECURITY DEFINER-view meer.
  check(
    "agenda-redactie gebruikt een invoker-view met intern zelf-filterend privilege",
    securityInvokerMigration.includes("function app.careon_agenda_state_public_rows()") &&
      securityInvokerMigration.includes("security definer") &&
      securityInvokerMigration.includes("security_barrier = true, security_invoker = true") &&
      /from public\.careon_agenda_state s\s+where app\.is_org_member\(s\.org_id\) or app\.is_superadmin\(\)/.test(
        securityInvokerMigration,
      ) &&
      securityInvokerMigration.includes(
        "revoke all on function app.careon_agenda_state_public_rows() from public, anon",
      ) &&
      !/grant insert[^;]*careon_agenda_state_public/i.test(securityInvokerMigration),
  );
  // Sleutelpariteit: de view nult exact wat redactie.ts nult. Loopt dit uiteen,
  // dan lekt de databank meer dan de route — of breekt de typeguard.
  const redactieSource = fs.readFileSync(path.resolve(process.cwd(), "src/lib/careon-production/redactie.ts"), "utf8");
  const genuldeSleutels = [...redactieSource.matchAll(/(\w+): 0\b/g)].map((match) => match[1]);
  const sqlSleutels = [
    ...(financieelMigration.match(/jsonb_build_object\(([^)]*)\)/)?.[1].matchAll(/'(\w+)', 0/g) ?? []),
  ].map((match) => match[1]);
  check(
    "view nult dezelfde omzetsleutels als redactie.ts",
    genuldeSleutels.length === 3 &&
      sqlSleutels.length === genuldeSleutels.length &&
      genuldeSleutels.every((key) => sqlSleutels.includes(key)),
  );
  check(
    "view leegt de facturatie net als redactie.ts",
    /facturatie: \[\]/.test(redactieSource) && financieelMigration.includes("'{facturatie}', '[]'::jsonb"),
  );

  // Beheer-tijdweergave: de (admin)-pagina's renderen op de server (UTC op
  // Vercel). Zonder expliciete zone las de beheerder elk tijdstip 1–2 uur
  // naast de Nederlandse klok en sneden de datumfilters op UTC-dagen — dit
  // was een bevestigde bevinding van de functionele audit van 29-07 en mag
  // niet stil terugkeren.
  const adminUiSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/(admin)/admin/_components/admin-ui.tsx"),
    "utf8",
  );
  const adminServerSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/careon-admin/admin.server.ts"),
    "utf8",
  );
  // Aangehecht aan formatMoment zélf, niet ergens verderop in het bestand.
  const formatMomentBron = adminUiSource.slice(adminUiSource.indexOf("export function formatMoment"));
  const formatMomentBody = formatMomentBron.slice(0, formatMomentBron.indexOf("\n}"));
  check("beheer-tijdstempels renderen in Europe/Amsterdam", formatMomentBody.includes('timeZone: "Europe/Amsterdam"'));
  check(
    "audit-datumfilters gebruiken de Amsterdamse daggrens",
    /gte\.\$\{amsterdamDagGrens\(filters\.vanaf\)\}/.test(adminServerSource) &&
      /lt\.\$\{amsterdamDagGrens\(filters\.tot, 1\)\}/.test(adminServerSource),
  );
  // Uitgevoerd, niet alleen als brontekst gecontroleerd: de eerste versie van
  // deze functie zat er op beide DST-overgangsdagen precies één uur naast en
  // een tekstuele check had dat groen laten passeren.
  check(
    "amsterdamDagGrens: zomer- en winterdag",
    amsterdamDagGrens("2026-07-29") === "2026-07-28T22:00:00.000Z" &&
      amsterdamDagGrens("2026-01-15") === "2026-01-14T23:00:00.000Z",
  );
  check(
    "amsterdamDagGrens: DST-overgangsdagen (voorjaar en najaar)",
    amsterdamDagGrens("2026-03-29") === "2026-03-28T23:00:00.000Z" &&
      amsterdamDagGrens("2026-10-25") === "2026-10-24T22:00:00.000Z",
  );
  check(
    "amsterdamDagGrens: tot-grens (dag erbij) over de DST-overgang heen",
    amsterdamDagGrens("2026-03-28", 1) === "2026-03-28T23:00:00.000Z" &&
      amsterdamDagGrens("2026-10-24", 1) === "2026-10-24T22:00:00.000Z",
  );
  // Zelf-uitsluitingsmatrix en de 409-vertaling van de org-DELETE: bewuste
  // keuzes uit de fixronde van 29-07 die stil kunnen wegregresseren.
  check(
    "zelf-guard: ban/delete/platformrol geblokkeerd, ontkoppelen van jezelf toegestaan",
    adminUsersSource.includes("ban: ") &&
      adminUsersSource.includes("delete_user: ") &&
      adminUsersSource.includes("revoke_platform_admin: ") &&
      !/remove_membership: "/.test(adminUsersSource) &&
      adminUsersSource.includes('action === "set_role" && userId === auth.session.userId && rol === "member"'),
  );
  // Autonomieronde 30-07: guards en grenzen die stil kunnen wegregresseren.
  check(
    "platformbeheerders zijn beschermd tegen blokkeren én verwijderen",
    /action === "ban" \|\| action === "delete_user"/.test(adminUsersSource),
  );
  check(
    "naamwijziging schrijft account én profiel",
    adminUsersSource.includes("user_metadata: { full_name: naam }") &&
      /profiles\?id=eq\.\$\{userId\}/.test(adminUsersSource),
  );
  check(
    "e-mailwijziging weigert het gereserveerde demodomein",
    adminUsersSource.includes("CAREON_HOSTED_DEMO_EMAIL_DOMAIN") &&
      adminUsersSource.includes("Dit e-maildomein is gereserveerd."),
  );
  check(
    "sessie leest uitsluitend het eigen lidmaatschap",
    /organization_members[\s\S]{0,200}?\.eq\("user_id", user\.id\)/.test(
      fs.readFileSync(path.resolve(process.cwd(), "src/lib/supabase/session.server.ts"), "utf8"),
    ),
  );
  check(
    "revisieherstel valideert de teruggezette stand",
    adminServerSource.includes("if (!bron.geldig(bron_rij.state)) return { ok: false, status: 422 }"),
  );
  const middelenData = fs.readFileSync(path.resolve(process.cwd(), "src/data/careon/careon-middelen.ts"), "utf8");
  check(
    "lege middelenstand draagt geen teamstructuur van een andere klant",
    /EMPTY_MIDDELEN_STATE[\s\S]{0,200}?teams: \[\]/.test(middelenData),
  );

  // ── Facturatie (handoff 15): vier lagen afscherming + CSP-wijziging ──────
  check(
    "CSP: frame-src laat uitsluitend self + blob toe (pdf-voorbeeld)",
    proxySource.includes(`"frame-src 'self' blob:"`) && !/frame-src[^"]*https?:/.test(proxySource),
  );
  check(
    "CSP: object-src en frame-ancestors blijven dicht",
    proxySource.includes(`"object-src 'none'"`) && proxySource.includes(`"frame-ancestors 'none'"`),
  );
  // 'wasm-unsafe-eval' (§0.1-delta) expliciet gepind: verwijderen brak de
  // pdf-preview eerder stil, en verbreden ('unsafe-eval' buiten de
  // dev-ternary) mag nooit ongemerkt passeren.
  check(
    "CSP: wasm-unsafe-eval aanwezig; unsafe-eval alleen in de dev-ternary",
    proxySource.includes("'wasm-unsafe-eval'") &&
      (proxySource.match(/'unsafe-eval'/g) ?? []).length === 1 &&
      proxySource.includes(`isDevelopment ? " 'unsafe-eval'" : ""`),
  );
  const launcherSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/(main)/modules/_components/module-launcher.tsx"),
    "utf8",
  );
  check(
    "launcher importeert het register niet meer zelf (server-side gefilterde props)",
    !launcherSource.includes("CAREON_MODULES } from") && launcherSource.includes("modules: readonly CareonModule[]"),
  );
  const modulesPageSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/(main)/modules/page.tsx"), "utf8");
  const mobileRegistrySource = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/careon-mobile/module-registry.ts"),
    "utf8",
  );
  check(
    "weblauncher en mobiele shell delen de server-side rolfilter",
    modulesPageSource.includes("filterCareonModulesForSession(CAREON_MODULES, result.session)") &&
      mobileRegistrySource.includes('module.zichtbaarVoor !== "org_admin" || magFacturatieZien(session)'),
  );
  const facturatieMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/0020_careon_facturatie.sql"),
    "utf8",
  );
  const legacyRpcRevocationMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260822235500_revoke_legacy_facturatie_rpc.sql"),
    "utf8",
  );
  const atomicInvoiceMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260905135739_invoice_atomic_issuance.sql"),
    "utf8",
  );
  check(
    "facturatie-RLS: elke policy eist het rolpredicaat (geen kale is_org_member-select)",
    (facturatieMigration.match(/app\.mag_facturatie_zien\(org_id\)/g) ?? []).length >= 10 &&
      !/for select to authenticated\s+using \(app\.is_org_member\(org_id\)\)/.test(facturatieMigration),
  );
  // Per tabel en verb benoemd — een globale telling liet het schrappen van
  // een losse policy (bijv. contacten_update) stil passeren.
  for (const policy of [
    "instellingen_select",
    "instellingen_insert",
    "contacten_select",
    "contacten_insert",
    "contacten_update",
    "contacten_delete",
    "facturen_select",
    "facturen_insert",
    "facturen_update",
    "facturen_delete",
    "nummers_select",
  ]) {
    check(
      `facturatie-RLS: policy careon_facturatie_${policy} bestaat`,
      facturatieMigration.includes(`create policy careon_facturatie_${policy} on`),
    );
  }
  check(
    "facturatie-RLS: clients schrijven uitsluitend concepten zonder nummer",
    (facturatieMigration.match(/status = 'concept' and nummer is null/g) ?? []).length >= 2,
  );
  check(
    "facturatie: instellingen blijven append-only voor clients",
    facturatieMigration.includes(
      "revoke update, delete, truncate on table public.careon_facturatie_instellingen from authenticated",
    ),
  );
  check(
    "facturatie: bevries- en verwijdertriggers bestaan",
    facturatieMigration.includes("create trigger careon_facturatie_facturen_bevries") &&
      facturatieMigration.includes("create trigger careon_facturatie_facturen_geen_delete"),
  );
  check(
    // The separate real-PostgreSQL suite proves lock/rollback/concurrency behavior.
    "facturatie: service-only RPC heeft revisie-, actor- en volledige-creditgrenzen",
    atomicInvoiceMigration.includes("careon_factuur_uitreiken_atomic") &&
      atomicInvoiceMigration.includes("p_expected_revision is distinct from v_source.revision") &&
      atomicInvoiceMigration.includes("u.deleted_at is null") &&
      atomicInvoiceMigration.includes("m.role = 'org_admin'") &&
      atomicInvoiceMigration.includes("for update") &&
      atomicInvoiceMigration.includes("careon_facturatie_one_issued_full_credit") &&
      atomicInvoiceMigration.includes("from public, anon, authenticated, service_role") &&
      atomicInvoiceMigration.includes("to service_role"),
  );
  const definitiefRouteSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/api/careon/facturatie/facturen/[factuurId]/definitief/route.ts"),
    "utf8",
  );
  const creditRouteSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/api/careon/facturatie/facturen/[factuurId]/credit/route.ts"),
    "utf8",
  );
  const issuanceHelperSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/careon-facturatie/uitreiking.server.ts"),
    "utf8",
  );
  check(
    "facturatie: alleen gevalideerde serverroutes roepen de service-RPC aan",
    issuanceHelperSource.includes("careon_factuur_uitreiken_atomic") &&
      issuanceHelperSource.includes("headers: serviceRestHeaders()") &&
      issuanceHelperSource.includes("p_actor: session.userId") &&
      [definitiefRouteSource, creditRouteSource].every(
        (source) =>
          source.includes("requireOrgAdmin()") &&
          source.includes("reikFactuurAtomairUit(") &&
          !source.includes("headers: userRestHeaders(") &&
          !source.includes("careon_factuur_definitief_maken_service"),
      ),
  );
  check(
    "facturatie: legacy authenticated SECURITY DEFINER-RPC wordt verwijderd",
    legacyRpcRevocationMigration.includes("from public, anon, authenticated, service_role") &&
      legacyRpcRevocationMigration.includes("drop function public.careon_factuur_definitief_maken("),
  );
  check(
    "facturatie: teller is niet door clients beschrijfbaar",
    facturatieMigration.includes(
      "revoke insert, update, delete, truncate on table public.careon_facturatie_nummers from authenticated",
    ),
  );
  check(
    "facturatie: Storage-bucket is privaat en zonder client-policies",
    facturatieMigration.includes("values ('facturen', 'facturen', false)") &&
      !/create policy[^;]*on storage\.objects/i.test(facturatieMigration),
  );
  check(
    "SQL-rolpredicaat spiegelt magFacturatieZien (org_admin, platformbeheer, demoaccount)",
    facturatieMigration.includes("app.mag_facturatie_zien(check_org uuid)") &&
      facturatieMigration.includes("m.role = 'org_admin'") &&
      facturatieMigration.includes("app.is_superadmin()") &&
      facturatieMigration.includes(`lower(btrim(u.email)) = '${CAREON_HOSTED_DEMO_EMAIL}'`),
  );
  check(
    "facturatie: concept-prune bestaat en is service-role-only",
    facturatieMigration.includes("careon_prune_facturatie_concepten") &&
      facturatieMigration.includes(
        "revoke all on function public.careon_prune_facturatie_concepten(integer) from public, anon, authenticated",
      ),
  );
  const herstelSource = adminServerSource;
  check(
    "revisieherstel valideert facturatie-instellingen met de eigen guard",
    herstelSource.includes("careon_facturatie_instellingen: isFacturatieInstellingen"),
  );

  // ── Facturatie fase B (0021): maillog + quota-scope 'mail' + fail-closed ──
  const mailMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/0021_careon_facturatie_mail.sql"),
    "utf8",
  );
  const facturatieFkMigration = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260821213000_facturatie_fk_indexes.sql"),
    "utf8",
  );
  check(
    "facturatie: foreign keys hebben een eigen leidende index",
    facturatieFkMigration.includes("careon_facturatie_facturen (contact_id)") &&
      facturatieFkMigration.includes("careon_facturatie_maillog (factuur_id)"),
  );
  check(
    "maillog: alleen een select-policy — schrijven is service-role-only",
    mailMigration.includes("create policy careon_facturatie_maillog_select on") &&
      !/create policy careon_facturatie_maillog_(insert|update|delete)/.test(mailMigration) &&
      mailMigration.includes(
        "revoke insert, update, delete, truncate on table public.careon_facturatie_maillog from authenticated",
      ) &&
      mailMigration.includes("revoke all on table public.careon_facturatie_maillog from anon"),
  );
  check(
    "maillog: select-policy eist het facturatie-rolpredicaat",
    /careon_facturatie_maillog_select[\s\S]{0,120}app\.mag_facturatie_zien\(org_id\)/.test(mailMigration),
  );
  check(
    "maillog: logregels overleven zolang de factuur bestaat (on delete restrict)",
    mailMigration.includes("references public.careon_facturatie_facturen (id) on delete restrict"),
  );
  check(
    "quota-scope 'mail' in constraint ÉN functie (0016-valkuil)",
    (mailMigration.match(/'mail'/g) ?? []).length >= 2 &&
      /check \(scope in \('assistant', 'audit', 'login', 'login_account', 'mail'\)\)/.test(mailMigration) &&
      /p_scope not in \('assistant', 'audit', 'login', 'login_account', 'mail'\)/.test(mailMigration),
  );
  const mailRouteSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/api/careon/facturatie/facturen/[factuurId]/mail/route.ts"),
    "utf8",
  );
  check(
    "mailroute: fail-closed zolang de provider niet is geconfigureerd (DPA-poort)",
    /if \(!mailBeschikbaar\(\)\) \{[\s\S]{0,250}E-mailverzending is nog niet geconfigureerd[\s\S]{0,120}status: 503/.test(
      mailRouteSource,
    ),
  );
  check(
    "mailroute: audit-event draagt geen e-mailadres (AVG)",
    /scheduleAuditEvent\(\{[\s\S]{0,400}facturatie\.factuur\.send[\s\S]{0,400}\}\)/.test(mailRouteSource) &&
      !/detail: \{[^}]*ontvanger/.test(mailRouteSource),
  );
  const mailServerSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/careon-facturatie/mail.server.ts"),
    "utf8",
  );
  const envExample = fs.readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8");
  check(
    "mailconfiguratie is server-side-only (nooit NEXT_PUBLIC_)",
    mailServerSource.includes("CAREON_MAIL_RESEND_API_KEY") &&
      !mailServerSource.includes("NEXT_PUBLIC_CAREON_MAIL") &&
      envExample.includes("CAREON_MAIL_RESEND_API_KEY") &&
      !envExample.includes("NEXT_PUBLIC_CAREON_MAIL"),
  );
  check(
    "org-verwijdering telt ook het maillog mee",
    adminServerSource.includes('{ table: "careon_facturatie_maillog"'),
  );

  const adminOrgsSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/api/admin/organizations/route.ts"),
    "utf8",
  );
  check(
    "org-DELETE vertaalt een sleutelconflict naar een blokkademelding",
    adminOrgsSource.includes("response?.status === 409") &&
      adminOrgsSource.includes("Er hangt nog data aan deze organisatie"),
  );

  const loginRequestA = new Request("http://careon.test/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.8", "x-careon-session": "aaaaaaaaaaaaaaaa" },
  });
  const loginRequestB = new Request("http://careon.test/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.8", "x-careon-session": "bbbbbbbbbbbbbbbb" },
  });
  const loginRequestC = new Request("http://careon.test/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.9", "x-careon-session": "aaaaaaaaaaaaaaaa" },
  });
  check("login-identiteit negeert client-session-id", loginActorHash(loginRequestA) === loginActorHash(loginRequestB));
  check("login-identiteit onderscheidt bezoekers-IP", loginActorHash(loginRequestA) !== loginActorHash(loginRequestC));
  const authenticatedHashA = authenticatedActorHash("user-a");
  const authenticatedHashARepeat = authenticatedActorHash("user-a");
  const authenticatedHashB = authenticatedActorHash("user-b");
  check(
    "accountidentiteit is stabiel en per gebruiker",
    authenticatedHashA === authenticatedHashARepeat && authenticatedHashA !== authenticatedHashB,
  );

  const parsed = await readJsonBodyLimited<{ ok: boolean }>(
    new Request("http://careon.test/body", { method: "POST", body: '{"ok":true}' }),
    32,
  );
  check("begrensde JSON-reader parseert geldige body", parsed.ok === true);

  let tooLarge = false;
  try {
    await readJsonBodyLimited(
      new Request("http://careon.test/body", { method: "POST", body: JSON.stringify({ value: "x".repeat(80) }) }),
      32,
    );
  } catch (error) {
    tooLarge = error instanceof RequestPayloadTooLargeError;
  }
  check("begrensde JSON-reader stopt body zonder content-length", tooLarge);

  // Sessie-auth (handoff 13): buiten een Next-request-context bestaat er geen
  // cookie-store, dus de routes moeten gecontroleerd 501 antwoorden in plaats
  // van crashen. (De DNS-tak zelf blijft ongewijzigd achter storageFetch-
  // try/catch; die is alleen bereikbaar mét een geldige sessie.)
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database-unreachable.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  globalThis.fetch = async () => {
    throw new TypeError("simulated DNS failure");
  };
  const productionRoute = await import("../app/api/careon/production/route");
  const productionUnavailable = await productionRoute.GET();
  check("productie-route zonder request-context faalt gesloten met 503", productionUnavailable.status === 503);
  const { createAuxStateHandlers } = await import("../lib/careon-production/aux-route");
  const auxHandlers = createAuxStateHandlers("careon_test_state", (_value): _value is object => true, "teststaat");
  const auxUnavailable = await auxHandlers.GET();
  check("aanvullende route zonder request-context faalt gesloten met 503", auxUnavailable.status === 503);
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;

  process.env.OPENAI_API_KEY = "test-only-key";
  process.env.CAREON_ASSISTANT_LIVE = "1";
  process.env.CAREON_DEMO_MODE = "1";
  process.env.CAREON_ASSISTANT_MAX_RETRIES = "0";
  process.env.OPENAI_MODERATION_ENABLED = "1";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  let providerMode: "complete" | "failed" | "incomplete" | "malformed" | "moderation-down" = "complete";
  let providerCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/moderations")) {
      if (providerMode === "moderation-down") return new Response("down", { status: 503 });
      return Response.json({ results: [{ flagged: false }] });
    }
    providerCalls += 1;
    if (providerMode === "failed") {
      return sse(
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "function_call", call_id: "call-failed", name: "wijzig_taal", arguments: "{}" },
        },
        { type: "response.failed", response: { error: { code: "provider_failed" } } },
      );
    }
    if (providerMode === "incomplete") {
      return sse({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } });
    }
    if (providerMode === "malformed") {
      return new Response('data: {"type":"response.output_text.delta","delta":"x"}\n\ndata: {broken}\n\n');
    }
    return sse(
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "function_call", call_id: "call-ok", name: "wijzig_taal", arguments: "{}" },
      },
      { type: "response.completed", response: { status: "completed", usage: { total_tokens: 3 } } },
    );
  };

  try {
    const { POST } = await import("../app/api/assistant/route");

    providerMode = "complete";
    const completed = await (await POST(assistantRequest("Voeg de geregistreerde taal Turks toe."))).text();
    check("complete stream eindigt met done", completed.includes('"t":"done"'));
    check("complete stream levert tool", completed.includes('"t":"tool"'));
    check("complete stream bevat geen fout", !completed.includes('"t":"error"'));

    providerMode = "failed";
    const failed = await (await POST(assistantRequest("Voeg de geregistreerde taal Turks toe."))).text();
    check("provider failure levert wire-error", failed.includes('"t":"error"'));
    check("provider failure levert geen tool", !failed.includes('"t":"tool"'));
    check("provider failure levert geen done", !failed.includes('"t":"done"'));

    providerMode = "incomplete";
    const incomplete = await (await POST(assistantRequest("Voeg de geregistreerde taal Turks toe."))).text();
    check(
      "incomplete response faalt gesloten",
      incomplete.includes('"t":"error"') && !incomplete.includes('"t":"tool"'),
    );

    providerMode = "malformed";
    const malformed = await (await POST(assistantRequest("Voeg de geregistreerde taal Turks toe."))).text();
    check("misvormd SSE-frame faalt gesloten", malformed.includes('"t":"error"') && !malformed.includes('"t":"done"'));

    providerMode = "moderation-down";
    const callsBeforeModerationFailure = providerCalls;
    const moderationDown = await POST(assistantRequest("Voeg de geregistreerde taal Turks toe."));
    check("moderation-uitval antwoordt 503", moderationDown.status === 503);
    check("moderation-uitval bereikt modelprovider niet", providerCalls === callsBeforeModerationFailure);

    providerMode = "complete";
    const callsBeforeConceptRequest = providerCalls;
    const conceptResponse = await POST(assistantRequest("Voeg een taal toe op basis van zijn naam."));
    const conceptBody = await conceptResponse.text();
    check("aanname-opdracht bereikt de modelprovider", providerCalls === callsBeforeConceptRequest + 1);
    check("aanname-opdracht kan een concepttool opleveren", conceptBody.includes('"t":"tool"'));
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ── Careon Scribe (handoff 20 §9) ─────────────────────────────────────────
  // Bronchecks: de dingen die pas in productie zichtbaar worden — een policy
  // zonder eigenaarspredicaat, een audioroute die bytes bewaart of logt, een
  // microfoonpolicy die te breed staat, of een quota-scope die maar op twee
  // van de drie plekken is geregistreerd.
  const leesBron = (relatief: string): string => {
    const volledig = path.resolve(process.cwd(), relatief);
    return fs.existsSync(volledig) ? fs.readFileSync(volledig, "utf8") : "";
  };

  const scribeMigratie = leesBron("supabase/migrations/20260907120000_careon_scribe.sql");
  const scribeTabellen = [
    "careon_scribe_sessies",
    "careon_scribe_segmenten",
    "careon_scribe_staat",
    "careon_scribe_notities",
    "careon_scribe_taken",
    "careon_scribe_instellingen",
    "careon_scribe_gemachtigden",
    "careon_scribe_vrijgaven",
  ];
  check("scribe-migratie aanwezig", scribeMigratie.length > 0);
  check(
    "scribe: RLS aan op alle acht tabellen",
    scribeTabellen.every((tabel) => scribeMigratie.includes(`alter table public.${tabel} enable row level security`)),
  );
  check(
    "scribe: anon heeft nergens rechten",
    scribeTabellen.every((tabel) => scribeMigratie.includes(`revoke all on table public.${tabel} from anon`)),
  );
  check(
    "scribe: careon_active_account restrictief op alle acht tabellen",
    scribeTabellen.every((tabel) => scribeMigratie.includes(`create policy careon_active_account on public.${tabel}`)),
  );
  // De inhoudstabellen mogen uitsluitend via het eigen ouderconsult te bereiken
  // zijn: zonder scribe_eigen_sessie zou een gemachtigde collega andermans
  // transcript kunnen lezen zolang de org klopt.
  const inhoudsTabellen = ["careon_scribe_segmenten", "careon_scribe_staat", "careon_scribe_taken"];
  const inhoudsPolicies = inhoudsTabellen.flatMap((tabel) =>
    ["select", "insert", "update", "delete"].map((verb) => {
      const start = scribeMigratie.indexOf(`create policy ${tabel}_${verb} on public.${tabel}`);
      if (start < 0) return "";
      return scribeMigratie.slice(start, start + 900);
    }),
  );
  check(
    "scribe: alle inhoudspolicies bestaan",
    inhoudsPolicies.every((blok) => blok.length > 0),
  );
  check(
    "scribe: elke inhoudspolicy eist het eigen ouderconsult",
    inhoudsPolicies.every((blok) => blok.includes("app.scribe_eigen_sessie(")),
  );
  check(
    "scribe: elke inhoudspolicy eist de eigen behandelaar",
    inhoudsPolicies.every((blok) => blok.includes("behandelaar_id = (select auth.uid())")),
  );
  // is_org_member is rolblind; alleen de instellingen-select mag hem gebruiken.
  const orgMemberPosities = [...scribeMigratie.matchAll(/app\.is_org_member\(/g)].map((treffer) => treffer.index ?? 0);
  check(
    "scribe: is_org_member alleen in de instellingen-select",
    orgMemberPosities.length === 1 &&
      scribeMigratie
        .slice(Math.max(0, orgMemberPosities[0] - 300), orgMemberPosities[0])
        .includes("careon_scribe_instellingen_select"),
  );
  // De vorige vorm matchte twee toevallige spellingen ("select app.is_superadmin() or"
  // en een regeleinde erachter). Elke andere lay-out — haakjes, een regelafbreking
  // vóór `or`, of de tak in een policy in plaats van in het predicaat — glipte
  // erdoor. Nu telbaar en body-scoped: mag_scribe_gebruiken kent het predicaat
  // helemaal niet, mag_scribe_beheren precies één keer en dan BINNEN de
  // organization_members-EXISTS (C57).
  const scribeFunctieBodies = [
    ...scribeMigratie.matchAll(
      /create or replace function (app\.mag_scribe_\w+)\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/g,
    ),
  ];
  check("scribe: beide rolpredicaten gevonden", scribeFunctieBodies.length === 2);
  check(
    "scribe: geen kale superadmin-tak in de predicaten",
    scribeFunctieBodies.length === 2 &&
      scribeFunctieBodies.every(([, naam, body]) => {
        const totaal = (body.match(/app\.is_superadmin\(\)/g) ?? []).length;
        if (naam === "app.mag_scribe_gebruiken") return totaal === 0;
        if (totaal !== 1) return false;
        const exists = body.slice(body.indexOf("exists ("));
        const lidmaatschap = exists.slice(0, exists.indexOf("\n  );") + 1);
        return lidmaatschap.includes("public.organization_members") && lidmaatschap.includes("app.is_superadmin()");
      }),
  );
  // Een superadmin-tak in een POLICY zou net zo goed een bypass zijn en werd
  // tot nu toe helemaal niet getoetst.
  const scribePolicyDeel = scribeMigratie.slice(scribeMigratie.indexOf("-- ── 10. RLS"));
  check("scribe: geen superadmin-tak in de policies", !scribePolicyDeel.includes("app.is_superadmin()"));
  check(
    "scribe: toestemmingsvenster staat in de sessie-insert-policy",
    scribeMigratie.includes("consent_bevestigd_op between now() - interval '10 minutes'"),
  );
  check(
    "scribe: instellingen-insert eist beheer",
    scribeMigratie.includes("create policy careon_scribe_instellingen_insert") &&
      scribeMigratie.includes("with check (app.mag_scribe_beheren(org_id))"),
  );
  check(
    "scribe: bevriestriggers aanwezig",
    ["careon_scribe_sessie_bevries", "careon_scribe_segment_bevries", "careon_scribe_notitie_bevries"].every((naam) =>
      scribeMigratie.includes(naam),
    ),
  );
  check(
    "scribe: goedgekeurd verslag is niet te verwijderen",
    scribeMigratie.includes("careon_scribe_notitie_geen_delete"),
  );
  check(
    "scribe: statuskolommen alleen via de RPC-GUC of de service-role",
    scribeMigratie.includes("current_setting('careon.scribe_rpc', true)") &&
      scribeMigratie.includes("auth.jwt() ->> 'role', '') = 'service_role'"),
  );
  check(
    "scribe: de drie RPC's bestaan",
    ["careon_scribe_voeg_segmenten_toe", "careon_scribe_status_zetten", "careon_scribe_notitie_goedkeuren"].every(
      (naam) => scribeMigratie.includes(`create or replace function public.${naam}`),
    ),
  );
  check(
    "scribe: opschoning is voorbehouden aan de service-role",
    scribeMigratie.includes("create or replace function public.careon_prune_scribe") &&
      scribeMigratie.includes("scribe: opschonen is voorbehouden aan de service-role"),
  );
  check(
    "scribe: quota-scope op alle drie de plekken",
    scribeMigratie.includes("careon_assistant_rate_limits_scope_valid") &&
      /check \(scope in \([^)]*'scribe'\)\)/.test(scribeMigratie) &&
      /p_scope not in \([^)]*'scribe'\)/.test(scribeMigratie),
  );
  check("scribe: geen Storage-bucket", !scribeMigratie.includes("storage.buckets"));

  // Routes.
  const scribeRouteMap = path.resolve(process.cwd(), "src/app/api/careon/scribe");
  const scribeRoutes: string[] = [];
  const loopRoutes = (map: string) => {
    if (!fs.existsSync(map)) return;
    for (const item of fs.readdirSync(map, { withFileTypes: true })) {
      const volledig = path.join(map, item.name);
      if (item.isDirectory()) loopRoutes(volledig);
      else if (item.name === "route.ts") scribeRoutes.push(volledig);
    }
  };
  loopRoutes(scribeRouteMap);
  const routeBronnen = new Map(scribeRoutes.map((bestand) => [bestand, fs.readFileSync(bestand, "utf8")]));
  check(`scribe: alle vijftien routebestanden bestaan (gevonden ${scribeRoutes.length})`, scribeRoutes.length === 15);
  check(
    "scribe: elke route draait op node",
    [...routeBronnen.values()].every((bron) => bron.includes('export const runtime = "nodejs"')),
  );
  check(
    "scribe: elke route gaat door de machtigingscontrole",
    [...routeBronnen.values()].every((bron) => bron.includes("eisScribeMachtiging(")),
  );
  check(
    "scribe: geen kale request.json() in een route",
    [...routeBronnen.values()].every((bron) => !bron.includes("request.json()")),
  );
  // audio (binair, eigen begrensde lezer), export, logboek en analyse (GET/POST
  // zonder lichaam) lezen geen JSON; al het andere moet begrensd lezen.
  const zonderJsonLichaam = ["/audio/route.ts", "/export/route.ts", "/analyse/route.ts", "/logboek/route.ts"];
  check(
    "scribe: JSON-routes lezen begrensd",
    [...routeBronnen.entries()].every(
      ([bestand, bron]) =>
        zonderJsonLichaam.some((staart) => bestand.replace(/\\/g, "/").endsWith(staart)) ||
        bron.includes("readJsonBodyLimited"),
    ),
  );
  check(
    "scribe: geen rechtstreekse quota-fetch",
    [...routeBronnen.values()].every((bron) => !bron.includes("careon_consume_assistant_quota")),
  );

  const audioRoute = leesBron("src/app/api/careon/scribe/sessies/[sessieId]/audio/route.ts");
  check("scribe-audioroute bestaat", audioRoute.length > 0);
  check("scribe-audioroute heeft een eigen tijdslimiet", audioRoute.includes("export const maxDuration = 60"));
  check("scribe-audioroute bewaart geen audio in Storage", !audioRoute.includes("storage/v1"));
  check(
    "scribe-audioroute schrijft geen bytes naar de database",
    !audioRoute.includes("audio_bytes") && !audioRoute.includes("base64"),
  );
  check("scribe-audioroute logt geen inhoud", !/console\.[a-z]+\([^)]*(audio|tekst|segmenten)/.test(audioRoute));
  check(
    "scribe-audioroute weigert zonder provider met 503",
    audioRoute.includes("Transcriptie is nog niet geactiveerd voor dit platform.") &&
      audioRoute.includes("status: 503"),
  );
  check("scribe-audioroute kent een MIME-allowlist met 415", audioRoute.includes("status: 415"));
  check(
    "scribe-audioroute rekent quota af vóór het lichaam",
    audioRoute.indexOf("eisScribeQuota(") > 0 &&
      audioRoute.indexOf("eisScribeQuota(") < audioRoute.indexOf("await leesAudioBegrensd(request"),
  );
  check(
    "scribe-audioroute legt een plaatshouder vast bij providerfouten",
    audioRoute.includes('bron: "systeem"') && audioRoute.includes("p_ontbrekend: true"),
  );

  const scribeDetailRoute = leesBron("src/app/api/careon/scribe/sessies/[sessieId]/route.ts");
  check("scribe: transcript lezen wordt geauditeerd", scribeDetailRoute.includes('action: "scribe.transcript.read"'));
  check(
    "scribe: verwijderen wordt geauditeerd met rol",
    scribeDetailRoute.includes('action: "scribe.sessie.verwijderd"') &&
      scribeDetailRoute.includes("rol: verwijderd.rol") &&
      scribeDetailRoute.includes("verwijderd.id !== sessieId"),
  );
  const scribeInstellingenRoute = leesBron("src/app/api/careon/scribe/instellingen/route.ts");
  check(
    "scribe: instellingen wijzigen wordt geauditeerd",
    scribeInstellingenRoute.includes('action: "scribe.instellingen.gewijzigd"'),
  );
  check(
    "scribe: providerstatus lekt geen sleutels",
    !scribeInstellingenRoute.includes("OPENAI_API_KEY") && !scribeInstellingenRoute.includes("SERVICE_ACCOUNT"),
  );

  const scribeAgent = leesBron("src/lib/careon-scribe/agent.server.ts");
  const analyseBlok = scribeAgent.slice(
    scribeAgent.indexOf("export async function analyseerSegmenten"),
    scribeAgent.indexOf("// ── Verslag"),
  );
  const verslagBlok = scribeAgent.slice(scribeAgent.indexOf("export async function genereerVerslag"));
  check(
    "scribe-agent roept geen provider aan zonder scribeLive()",
    scribeAgent.includes("return scribeLive() && isAssistantLive();") &&
      analyseBlok.indexOf("scribeAgentToegestaan(") > 0 &&
      analyseBlok.indexOf("scribeAgentToegestaan(") < analyseBlok.indexOf("roepModelAan(") &&
      verslagBlok.indexOf("scribeAgentToegestaan(") > 0 &&
      verslagBlok.indexOf("scribeAgentToegestaan(") < verslagBlok.indexOf("roepModelAan("),
  );
  // N19 — de organisatiepoort is een CONJUNCT naast de platformvlag: zonder
  // `instellingen.aiAnalyseAan` verlaat er geen fragment het platform, ook niet
  // wanneer CAREON_SCRIBE_LIVE aan staat.
  check(
    "scribe-agent eist ook de organisatiekeuze (N19)",
    scribeAgent.includes("return scribeAgentLive() && context.aiToegestaan;") &&
      scribeAgent.includes("aiToegestaan: boolean"),
  );
  const scribeServer = leesBron("src/lib/careon-scribe/scribe.server.ts");
  check(
    "scribe: de analyseronde geeft de organisatiekeuze door",
    scribeServer.includes("aiToegestaan: instellingen.aiAnalyseAan"),
  );
  check(
    "scribe: de verslagroute geeft de organisatiekeuze door",
    leesBron("src/app/api/careon/scribe/sessies/[sessieId]/notitie/route.ts").includes(
      "aiToegestaan: instellingen.aiAnalyseAan",
    ),
  );
  check(
    "scribe: de audioroute eist de organisatiekeuze vóór de provider",
    audioRoute.indexOf("instellingen.transcriptieAan") > 0 &&
      audioRoute.indexOf("instellingen.transcriptieAan") <
        audioRoute.indexOf("const provider = transcriptieProvider()"),
  );
  // C6/C8/C30 — `not.eq` matcht geen NULL en elk vers segment heeft
  // correctie_bron IS NULL; die vorm mag nergens in de scribe-code terugkomen.
  check(
    "scribe: AI-correcties gebruiken een NULL-veilig filter",
    scribeServer.includes('params.set("or", "(correctie_bron.is.null,correctie_bron.eq.ai)")'),
  );
  // Commentaar eerst weg: de uitleg bij bouwCorrectieFilter noemt de foute vorm
  // met opzet, en die zin mag de assertie niet laten struikelen.
  const zonderCommentaar = (bron: string) => bron.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check(
    "scribe: nergens een not.eq-filter in de scribe-code",
    [scribeServer, ...routeBronnen.values()].every((bron) => !zonderCommentaar(bron).includes("not.eq.")),
  );
  // C7 — de zwaarste route van de module draait tot zes analyserondes; zonder
  // eigen tijdslimiet en zonder klokbudget wordt zij midden in de reeks afgekapt.
  check(
    "scribe: de afrondroute draagt een eigen tijdslimiet en klokbudget",
    scribeDetailRoute.includes("export const maxDuration = 60") &&
      scribeDetailRoute.includes("ANALYSE_BUDGET_MS") &&
      scribeDetailRoute.includes("Date.now() < uiterlijk"),
  );
  check(
    "scribe: elke route die de agent aanroept rekent quota af",
    [...routeBronnen.values()].every(
      (bron) =>
        !(bron.includes("voerScribeAnalyseUit(") || bron.includes("genereerVerslag(")) ||
        (bron.includes("eisScribeQuota(") && bron.includes("export const maxDuration =")),
    ),
  );
  // C12/C34 — de beheerdersverwijdering telt de goedgekeurde verslagen zelf,
  // metadata-only, en faalt gesloten.
  check(
    "scribe: de beheerdersverwijdering telt verslagen metadata-only",
    scribeDetailRoute.includes("telGoedgekeurdeNotities(") && scribeDetailRoute.includes("onbekend"),
  );
  check(
    "scribe: de verslagtelling leest nooit sectie-inhoud",
    scribeServer.includes("export async function telGoedgekeurdeNotities") &&
      /telGoedgekeurdeNotities[\s\S]{0,600}select: "id"/.test(scribeServer),
  );
  // C3/C10 — de beheerderslezing draagt een kolomlijst zonder de twee velden
  // die S12/V3 belooft weg te laten, en de policy geeft hem niets meer.
  check(
    "scribe: de beheerderslezing laat referentie en consulttype weg",
    scribeServer.includes("export const SESSIE_METADATA_SELECT") &&
      !/SESSIE_METADATA_SELECT =[\s\S]{0,600}patient_referentie/.test(scribeServer) &&
      !/SESSIE_METADATA_SELECT =[\s\S]{0,600}consult_type/.test(scribeServer),
  );
  check(
    "scribe: de sessie-selectpolicy kent geen beheerderstak meer",
    /create policy careon_scribe_sessies_select[\s\S]{0,600}?\);/.test(scribeMigratie) &&
      !/create policy careon_scribe_sessies_select[\s\S]{0,600}?app\.mag_scribe_beheren/.test(scribeMigratie),
  );
  // N21 — de activatievoorwaarden staan in de database, niet alleen in de route.
  check(
    "scribe: scribe_ingeschakeld eist de activatievoorwaarden",
    /scribe_ingeschakeld[\s\S]{0,900}dpiaVastgesteldOp[\s\S]{0,300}verwerkersovereenkomstBevestigd/.test(
      scribeMigratie,
    ),
  );
  check(
    "scribe: PUT /instellingen weigert activatie zonder bewijs",
    scribeInstellingenRoute.includes("activatieVoorwaardenOntbrekend(body.state)"),
  );
  // N20 — het logboek is metadata en blijft binnen de eigen organisatie.
  const logboekRoute = leesBron("src/app/api/careon/scribe/logboek/route.ts");
  check("scribe-logboek bestaat", logboekRoute.length > 0);
  check(
    "scribe-logboek staat achter requireOrgAdmin en filtert op de eigen org",
    logboekRoute.includes("requireOrgAdmin()") &&
      /org_id: `eq\.\$\{orgId\}`/.test(logboekRoute) &&
      logboekRoute.includes('"like.scribe.*"'),
  );
  check("scribe-logboek geeft alleen scalaire details terug", logboekRoute.includes("function scalaireDetails"));
  check("scribe-agent slaat niets op bij de provider", scribeAgent.includes("store: false"));
  check("scribe-agent draagt zijn eigen promptversie", scribeAgent.includes('SCRIBE_PROMPT_VERSION = "careon-scribe-'));
  check(
    "scribe-telemetrie draagt geen inhoud",
    scribeAgent.includes('feature: "scribe"') && !/metadata: \{[^}]*tekst/.test(scribeAgent),
  );
  const assistantRuntime = leesBron("src/lib/careon-assistant/runtime.server.ts");
  check("AssistantEvent draagt promptVersion", assistantRuntime.includes("promptVersion?: string"));
  check(
    "writeAssistantEvent schrijft de modulepromptversie",
    assistantRuntime.includes("prompt_version: event.promptVersion ?? ASSISTANT_PROMPT_VERSION"),
  );
  check(
    "scribe-quota lopen via het fail-closed assistentpad",
    assistantRuntime.includes("export function enforceScribeRateLimit") &&
      assistantRuntime.includes("export function enforceScribeOrgRateLimit"),
  );

  // Schil, headers en caches (bestanden van de UI-kant; blijft een harde eis).
  const nextConfig = leesBron("next.config.mjs");
  check("scribe: microfoon uitsluitend onder /scribe", nextConfig.includes('source: "/scribe/:path*"'));
  check(
    "scribe: microfoonpolicy staat alleen in de scribe-entry",
    (nextConfig.match(/microphone=\(self\)/g) ?? []).length === 1,
  );
  // De vorige vorm plakte een NIET-BESTAAND bestand (src/lib/security-headers.ts,
  // leesBron geeft daar "" terug) voor de config en matchte daarna élk
  // voorkomen van `microphone=()` — ook het woord in het commentaar erboven.
  // Nu: commentaar eruit, en de algemene entry op zijn EXACTE waarde pinnen (C53).
  const nextConfigCode = nextConfig.replace(/\/\/.*$/gm, "");
  check(
    "scribe: de algemene headers houden microphone=()",
    /\{\s*key:\s*"Permissions-Policy",\s*value:\s*"camera=\(\), microphone=\(\), geolocation=\(\)"\s*\}/.test(
      nextConfigCode,
    ),
  );
  const proxyBron = leesBron("src/proxy.ts");
  check("scribe: /scribe vereist authenticatie in de proxy", proxyBron.includes('path.startsWith("/scribe")'));
  const scribeLayout = leesBron("src/app/(main)/scribe/layout.tsx");
  check(
    "scribe-schil gaat door CareonAuthGuard én requireScribePage",
    scribeLayout.includes("<CareonAuthGuard>") && scribeLayout.includes("requireScribePage()"),
  );
  check(
    "scribe-paginagate leidt niet-gemachtigden terug naar de launcher",
    leesBron("src/lib/supabase/session.server.ts").includes("/modules?scribe=niet-gemachtigd"),
  );
  check(
    "scribe: lokale consultstaat wordt bij eigenaarswissel gewist",
    leesBron("src/lib/careon-tenant/cache-owner.client.ts").includes("clearScribeState()"),
  );
  check(
    "scribe: uitloggen wist de lokale consultstaat",
    leesBron("src/lib/careon-auth.ts").includes("clearScribeState()"),
  );
  const launcher = leesBron("src/app/(main)/modules/_components/module-launcher.tsx");
  check(
    "scribe-tegel is een documentlading",
    launcher.includes("hardeNavigatie === true") && launcher.includes("<a href={mod.href}"),
  );

  console.log(`Runtime hardening verification: ${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

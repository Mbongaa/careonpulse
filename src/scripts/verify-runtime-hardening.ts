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
  // De ledenview mag de RLS van de basistabel overslaan (die is nu financieel
  // dicht), maar moet dan zélf op lidmaatschap filteren.
  check(
    "ledenview op de agenda scheidt organisaties zelf",
    financieelMigration.includes("create view public.careon_agenda_state_public") &&
      !/with \(\s*security_invoker/i.test(financieelMigration) &&
      /from public\.careon_agenda_state s\s+where app\.is_org_member\(s\.org_id\) or app\.is_superadmin\(\)/.test(
        financieelMigration,
      ) &&
      !/grant insert[^;]*careon_agenda_state_public/i.test(financieelMigration),
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
    "facturatie: nummer + statusovergang zijn één transactie (RPC met rijvergrendeling)",
    facturatieMigration.includes("careon_factuur_definitief_maken") &&
      facturatieMigration.includes("for update") &&
      facturatieMigration.includes("on conflict (org_id, reeks, jaar)"),
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

  console.log(`Runtime hardening verification: ${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

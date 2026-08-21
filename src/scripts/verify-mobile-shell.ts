import type { CareonModule } from "../data/careon/careon-modules";
import {
  buildCareonShellRegistry,
  filterCareonModulesForSession,
  resolveCareonShellTarget,
} from "../lib/careon-mobile/module-registry";
import {
  parseMobilePushDeviceInput,
  parseMobilePushUnregisterInput,
  protectMobilePushToken,
  revealMobilePushToken,
} from "../lib/careon-mobile/push-device";
import type { CareonSession } from "../lib/supabase/session.server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let checks = 0;
let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (Object.is(actual, expected)) {
    console.log(`  ✓ ${name}`);
    return;
  }
  failures += 1;
  console.error(`  ✗ ${name}\n    verwacht: ${JSON.stringify(expected)}\n    ontvangen: ${JSON.stringify(actual)}`);
}

const modules: CareonModule[] = [
  {
    id: "careon-pulse-directie",
    name: "Careon Pulse Directie",
    description: "Directiedashboard",
    status: "live",
    href: "/dashboard/directiecockpit",
  },
  {
    id: "yaaz",
    name: "YAAZ",
    description: "Communicatie",
    status: "live",
    href: "https://yaaz.example.test/user/auth/external?authclient=careon",
  },
  {
    id: "careon-facturatie",
    name: "Facturatie",
    description: "Facturen",
    status: "live",
    href: "/facturatie",
    zichtbaarVoor: "org_admin",
  },
];

const memberSession: CareonSession = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "medewerker@example.test",
  fullName: "Test Medewerker",
  orgId: "22222222-2222-4222-8222-222222222222",
  orgName: "Testorganisatie",
  orgRole: "member",
  isSuperadmin: false,
  accessToken: "mag-nooit-in-het-register",
};
const adminSession: CareonSession = { ...memberSession, orgRole: "org_admin" };
const now = new Date("2026-08-21T20:00:00.000Z");

console.log("\nCareon Pulse mobile-shell contract\n");

check("member krijgt twee algemene modules", filterCareonModulesForSession(modules, memberSession).length, 2);
check(
  "member krijgt facturatie niet",
  filterCareonModulesForSession(modules, memberSession).some((m) => m.id === "careon-facturatie"),
  false,
);
check("org_admin krijgt facturatie wel", filterCareonModulesForSession(modules, adminSession).length, 3);

const memberRegistry = buildCareonShellRegistry(modules, memberSession, "https://www.careonpulse.com", now);
check("registerschema is v1", memberRegistry.schemaVersion, 1);
check("minimum shellversie is vastgelegd", memberRegistry.minimumSupportedShellVersion, "0.1.0");
check("tijdstip is deterministisch ISO", memberRegistry.generatedAt, now.toISOString());
check(
  "interne route wordt absolute HTTPS-URL",
  memberRegistry.modules[0]?.launchUrl,
  "https://www.careonpulse.com/dashboard/directiecockpit",
);
check(
  "Careon deeplink volgt D4-contract",
  memberRegistry.modules[0]?.deepLink,
  "careonpulse://careon-pulse-directie/dashboard/directiecockpit",
);
check(
  "YAAZ-query blijft behouden",
  memberRegistry.modules[1]?.launchUrl,
  "https://yaaz.example.test/user/auth/external?authclient=careon",
);
check("launcher lekt geen access token", JSON.stringify(memberRegistry).includes(memberSession.accessToken), false);
check(
  "handoffdoel blijft op de module-origin",
  resolveCareonShellTarget(memberRegistry.modules[0], "/dashboard/details/test?k=1"),
  "https://www.careonpulse.com/dashboard/details/test?k=1",
);
check(
  "protocol-relative handoffdoel wordt geweigerd",
  resolveCareonShellTarget(memberRegistry.modules[0], "//evil.test"),
  null,
);
check(
  "backslash handoffdoel wordt geweigerd",
  resolveCareonShellTarget(memberRegistry.modules[0], "/\\evil.test"),
  null,
);
check(
  "YAAZ-deeplink loopt via de OIDC-return-entry",
  resolveCareonShellTarget(memberRegistry.modules[1], "/space/42?tab=about#team"),
  "https://yaaz.example.test/careon-sso/mobile/entry?target=%2Fspace%2F42%3Ftab%3Dabout%23team",
);
check(
  "YAAZ-basisstart blijft de normale OIDC-launch",
  resolveCareonShellTarget(memberRegistry.modules[1]),
  "https://yaaz.example.test/user/auth/external?authclient=careon",
);

const onveilig = buildCareonShellRegistry(
  [{ ...modules[0], href: "http://public.example.test/dashboard" }],
  memberSession,
  "https://www.careonpulse.com",
  now,
);
check("publieke HTTP-module staat uit", onveilig.modules[0]?.enabled, false);
check("publieke HTTP-URL wordt niet uitgeleverd", onveilig.modules[0]?.launchUrl, null);

let noOrgRejected = false;
try {
  buildCareonShellRegistry(
    modules,
    { ...memberSession, orgId: null, orgRole: null },
    "https://www.careonpulse.com",
    now,
  );
} catch {
  noOrgRejected = true;
}
check("register weigert organisatie-loze sessie", noOrgRejected, true);

const repo = resolve(__dirname, "../..");
const routeSource = readFileSync(resolve(repo, "src/app/api/mobile/v1/modules/route.ts"), "utf8");
const mintRouteSource = readFileSync(resolve(repo, "src/app/api/mobile/v1/handoffs/route.ts"), "utf8");
const sessionRouteSource = readFileSync(resolve(repo, "src/app/api/mobile/v1/session/route.ts"), "utf8");
const handoffSource = readFileSync(resolve(repo, "src/lib/careon-mobile/handoff.server.ts"), "utf8");
const bearerSource = readFileSync(resolve(repo, "src/lib/supabase/bearer-session.server.ts"), "utf8");
const pageSource = readFileSync(resolve(repo, "src/app/(main)/modules/page.tsx"), "utf8");
const envExample = readFileSync(resolve(repo, ".env.example"), "utf8");
const handoffMigration = readFileSync(
  resolve(repo, "supabase/migrations/20260822210000_mobile_session_handoffs.sql"),
  "utf8",
);
const handoffRoleGuardMigration = readFileSync(
  resolve(repo, "supabase/migrations/20260822213000_mobile_handoff_current_jwt_role_guard.sql"),
  "utf8",
);

check("mobiele route is expliciet dynamisch", routeSource.includes('dynamic = "force-dynamic"'), true);
check("mobiele route is no-store", routeSource.includes('"Cache-Control": "private, no-store, max-age=0"'), true);
check("mobiele route varieert op Authorization", routeSource.includes('Vary: "Authorization"'), true);
check("mobiele route gebruikt geen service-role", routeSource.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
check("mobiele route vangt identiteitsuitval gecontroleerd af", routeSource.includes("session lookup failed"), true);
check("bearerlaag valideert JWT-claims", bearerSource.includes("supabase.auth.getClaims(accessToken)"), true);
check("bearerlaag bevestigt actuele gebruiker", bearerSource.includes("supabase.auth.getUser(accessToken)"), true);
check("bearerlaag bindt token aan shell-client", bearerSource.includes("claims.client_id !== expectedClientId"), true);
check("bearerlaag bewaart geen sessie", bearerSource.includes("persistSession: false"), true);
check("bearerlaag filtert eigen lidmaatschap", bearerSource.includes('.eq("user_id", user.id)'), true);
check("web en shell delen zichtbaarheidspoort", pageSource.includes("filterCareonModulesForSession"), true);
check("shell-client-id is gedocumenteerd", envExample.includes("CAREON_SHELL_OAUTH_CLIENT_ID"), true);
check(
  "handoff mint gebruikt dezelfde client-gebonden bearerlaag",
  mintRouteSource.includes("getCareonShellSession(request)"),
  true,
);
check("handoffcode staat alleen in POST-body", sessionRouteSource.includes("application/x-www-form-urlencoded"), true);
check("handoffroute stuurt geen code in redirect-URL", sessionRouteSource.includes("searchParams.set"), false);
check(
  "WebViewsessie gebruikt server-side OTP-verificatie",
  handoffSource.includes("browserClient.auth.verifyOtp"),
  true,
);
check("handoff bewaart alleen SHA-256-digest", handoffSource.includes('createHash("sha256")'), true);
check("handofftabel heeft geen ruwe tokencolom", handoffMigration.includes("  token text"), false);
check("handofftabel forceert RLS", handoffMigration.includes("force row level security"), true);
check("handofffuncties zijn service-role-only", handoffMigration.includes("service_role required"), true);
check("handoff is zestig seconden geldig", handoffMigration.includes("interval '60 seconds'"), true);
check(
  "handoffconsumptie is één atomische update",
  handoffMigration.includes("update public.careon_mobile_handoffs h"),
  true,
);
check("handoffhergebruik faalt op consumed_at", handoffMigration.includes("h.consumed_at is null"), true);
check("handoff gebruikt actuele PostgREST-claims", handoffRoleGuardMigration.includes("auth.jwt() ->> ''role''"), true);
check(
  "actuele handoff-rolguard herstelt service-only grants",
  handoffRoleGuardMigration.includes("grant execute on function public.careon_consume_mobile_handoff"),
  true,
);

const pushToken = "dGVzdC1tb2JpZWxlLXRva2VuLWZvci1jYXJlb24:APA91b_example-1234567890";
const pushKey = Buffer.alloc(32, 7).toString("base64");
const pushInput = parseMobilePushDeviceInput({
  installationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  platform: "android",
  token: pushToken,
  appVersion: "0.1.0",
  locale: "nl-NL",
});
check("geldige pushregistratie wordt strikt geparseerd", pushInput?.platform, "android");
check(
  "onverwachte pushvelden worden geweigerd",
  parseMobilePushDeviceInput({
    installationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    platform: "android",
    token: pushToken,
    appVersion: "0.1.0",
    locale: null,
    body: "mag niet mee",
  }),
  null,
);
check(
  "uitschrijven vereist een v4-installatie-id",
  parseMobilePushUnregisterInput({ installationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })?.installationId,
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const protectedPushA = protectMobilePushToken(pushToken, pushKey);
const protectedPushB = protectMobilePushToken(pushToken, pushKey);
if (!protectedPushA || !protectedPushB) throw new Error("push-testfixture kon niet worden beschermd");
check("push-token wordt AES-GCM-versleuteld", protectedPushA.tokenCiphertext.startsWith("v1."), true);
check("push-token-digest is stabiel voor deduplicatie", protectedPushA.tokenHash, protectedPushB.tokenHash);
check(
  "push-token-ciphertext gebruikt een unieke nonce",
  protectedPushA.tokenCiphertext === protectedPushB.tokenCiphertext,
  false,
);
check(
  "versleutelde push-token kan server-side worden hersteld",
  revealMobilePushToken(protectedPushA.tokenCiphertext, pushKey),
  pushToken,
);
check(
  "gemanipuleerde push-token faalt gesloten",
  revealMobilePushToken(`${protectedPushA.tokenCiphertext}A`, pushKey),
  null,
);

const pushRouteSource = readFileSync(resolve(repo, "src/app/api/mobile/v1/devices/route.ts"), "utf8");
const pushServerSource = readFileSync(resolve(repo, "src/lib/careon-mobile/push-device.server.ts"), "utf8");
const pushMigration = readFileSync(resolve(repo, "supabase/migrations/20260822230000_mobile_push_devices.sql"), "utf8");
check(
  "pushroute gebruikt dezelfde client-gebonden bearerlaag",
  pushRouteSource.includes("getCareonShellSession(request)"),
  true,
);
check("pushroute begrenst de request-body", pushRouteSource.includes("readJsonBodyLimited"), true);
check("pushroute is no-store", pushRouteSource.includes('"Cache-Control": "private, no-store, max-age=0"'), true);
check("push-audit bevat geen registratietoken", pushRouteSource.includes("detail: { platform: input.platform"), true);
check(
  "push-token wordt vóór Supabase beschermd",
  pushServerSource.includes("protectMobilePushToken(input.token"),
  true,
);
check("push-server logt geen ruwe token", pushServerSource.includes("console."), false);
check("push-tabel forceert RLS", pushMigration.includes("force row level security"), true);
check("push-tabel heeft geen ruwe tokencolom", pushMigration.includes("  token text"), false);
check("pushfuncties zijn service-role-only", pushMigration.includes("auth.jwt() ->> 'role'"), true);
check("pushregistratie trekt oude accountbinding in", pushMigration.includes("cross-account notification drift"), true);
check("push-encryptiesleutel is gedocumenteerd", envExample.includes("CAREON_MOBILE_PUSH_TOKEN_ENCRYPTION_KEY"), true);

const nativeFileSource = readFileSync(resolve(repo, "src/lib/careon-mobile/native-file.client.ts"), "utf8");
const factuurPreviewSource = readFileSync(
  resolve(repo, "src/app/(main)/facturatie/_components/factuur-pdf-preview.tsx"),
  "utf8",
);
const csvImportSource = readFileSync(
  resolve(repo, "src/app/(main)/dashboard/databron/_components/csv-import-card.tsx"),
  "utf8",
);
const factuurPdfRouteSource = readFileSync(
  resolve(repo, "src/app/api/careon/facturatie/facturen/[factuurId]/pdf/route.ts"),
  "utf8",
);
check(
  "native bestandsbrug vereist de exacte shell user-agent",
  nativeFileSource.includes('userAgent.startsWith("CareonPulseShell/")'),
  true,
);
check(
  "native bestandsbrug vereist het geïnjecteerde kanaal",
  nativeFileSource.includes("CareonNativeFile?: unknown"),
  true,
);
check(
  "normale browsers behouden de lokale downloadfallback",
  nativeFileSource.includes("downloadInBrowser(blob, fileName)"),
  true,
);
check("native bestandsoverdracht is begrensd op twaalf MiB", nativeFileSource.includes("12 * 1024 * 1024"), true);
check("native bestandsbericht bevat geen access token", nativeFileSource.includes("accessToken"), false);
check(
  "Facturatie gebruikt de gedeelde native bestandsbrug",
  factuurPreviewSource.includes("saveBlobThroughCareon"),
  true,
);
check("Databron gebruikt de gedeelde native bestandsbrug", csvImportSource.includes("saveBlobThroughCareon"), true);
check(
  "Facturatie-pdf is op elk antwoord private no-store",
  factuurPdfRouteSource.includes("privateNoStore(auth.denied)") &&
    factuurPdfRouteSource.includes('"private, no-store, max-age=0"'),
  true,
);

console.log(`\n${checks - failures}/${checks} checks geslaagd.`);
if (failures > 0) process.exit(1);

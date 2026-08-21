import type { CareonModule } from "@/data/careon/careon-modules";
import { magFacturatieZien } from "@/lib/careon-facturatie-rol";
import type { CareonSession } from "@/lib/supabase/session.server";

export const CAREON_SHELL_REGISTRY_VERSION = 1;
export const CAREON_SHELL_MINIMUM_VERSION = "0.1.0";

export type CareonShellModuleType = "webview" | "native";
export type CareonShellEntitlement = "employee" | "org_admin";

export interface CareonShellModule {
  id: string;
  displayName: string;
  description: string;
  icon: "careon-pulse" | "yaaz" | "facturatie";
  type: CareonShellModuleType;
  launchUrl: string | null;
  deepLink: string;
  requiredEntitlement: CareonShellEntitlement;
  minimumShellVersion: string;
  enabled: boolean;
}

export interface CareonShellRegistry {
  schemaVersion: typeof CAREON_SHELL_REGISTRY_VERSION;
  minimumSupportedShellVersion: string;
  generatedAt: string;
  account: {
    userId: string;
    email: string;
    fullName: string;
    organizationId: string;
    organizationName: string | null;
    organizationRole: "org_admin" | "member";
  };
  modules: CareonShellModule[];
}

export function resolveCareonShellTarget(
  module: Pick<CareonShellModule, "id" | "launchUrl" | "enabled">,
  requestedTarget?: string | null,
): string | null {
  if (!module.enabled || !module.launchUrl) return null;
  let base: URL;
  try {
    base = new URL(module.launchUrl);
  } catch {
    return null;
  }
  if (!requestedTarget || requestedTarget === "/") return base.toString();
  if (
    requestedTarget.length > 2_048 ||
    !requestedTarget.startsWith("/") ||
    requestedTarget.startsWith("//") ||
    requestedTarget.includes("\\")
  ) {
    return null;
  }
  let target: URL;
  try {
    target = new URL(requestedTarget, base);
  } catch {
    return null;
  }
  if (
    target.protocol !== "https:" ||
    target.origin !== base.origin ||
    target.username ||
    target.password ||
    target.toString().length > 2_048
  ) {
    return null;
  }
  if (module.id === "yaaz") {
    const entry = new URL("/careon-sso/mobile/entry", base);
    entry.searchParams.set("target", `${target.pathname}${target.search}${target.hash}`);
    return entry.toString().length <= 2_048 ? entry.toString() : null;
  }
  return target.toString();
}

const MODULE_PRESENTATION: Record<
  string,
  { icon: CareonShellModule["icon"]; deepLinkPath: string; type: CareonShellModuleType }
> = {
  "careon-pulse-directie": {
    icon: "careon-pulse",
    deepLinkPath: "/dashboard/directiecockpit",
    type: "webview",
  },
  yaaz: { icon: "yaaz", deepLinkPath: "/", type: "webview" },
  "careon-facturatie": { icon: "facturatie", deepLinkPath: "/facturatie", type: "webview" },
};

/**
 * De web-launcher en native shell delen exact dezelfde zichtbaarheidspoort.
 * Dit is alleen launcher-filtering; elke module blijft zijn eigen server-side
 * autorisatie afdwingen zoals D13 voorschrijft.
 */
export function filterCareonModulesForSession(
  modules: readonly CareonModule[],
  session: Pick<CareonSession, "orgId" | "orgRole" | "isSuperadmin" | "email">,
): CareonModule[] {
  return modules.filter((module) => module.zichtbaarVoor !== "org_admin" || magFacturatieZien(session));
}

function safeLaunchUrl(href: string | undefined, publicAppUrl: string | undefined): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = href.startsWith("/") ? new URL(href, publicAppUrl) : new URL(href);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  if (url.protocol !== "https:" && !localDevelopment) return null;
  return url.toString();
}

function shellModule(module: CareonModule, publicAppUrl: string | undefined): CareonShellModule {
  const presentation = MODULE_PRESENTATION[module.id] ?? {
    icon: "careon-pulse" as const,
    deepLinkPath: "/",
    type: "webview" as const,
  };
  const launchUrl = safeLaunchUrl(module.href, publicAppUrl);
  const deepPath = presentation.deepLinkPath.replace(/^\/+/, "");
  return {
    id: module.id,
    displayName: module.name,
    description: module.description,
    icon: presentation.icon,
    type: presentation.type,
    launchUrl,
    deepLink: `careonpulse://${module.id}/${deepPath}`,
    requiredEntitlement: module.zichtbaarVoor === "org_admin" ? "org_admin" : "employee",
    minimumShellVersion: CAREON_SHELL_MINIMUM_VERSION,
    enabled: module.status === "live" && launchUrl !== null,
  };
}

export function buildCareonShellRegistry(
  modules: readonly CareonModule[],
  session: CareonSession,
  publicAppUrl: string | undefined,
  generatedAt = new Date(),
): CareonShellRegistry {
  if (!session.orgId || !session.orgRole) {
    throw new Error("Een shell-register vereist een organisatiegebonden sessie.");
  }
  return {
    schemaVersion: CAREON_SHELL_REGISTRY_VERSION,
    minimumSupportedShellVersion: CAREON_SHELL_MINIMUM_VERSION,
    generatedAt: generatedAt.toISOString(),
    account: {
      userId: session.userId,
      email: session.email,
      fullName: session.fullName,
      organizationId: session.orgId,
      organizationName: session.orgName,
      organizationRole: session.orgRole,
    },
    modules: filterCareonModulesForSession(modules, session).map((module) => shellModule(module, publicAppUrl)),
  };
}

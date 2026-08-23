import {
  adminDataOr,
  adminReadFailed,
  listAuthUsers,
  listMemberships,
  listOrganizations,
} from "@/lib/careon-admin/admin.server";
import { listEntraDirectoryMembers } from "@/lib/careon-entra/directory.server";

import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}

function authorized(request: Request): boolean {
  const secret = process.env.CAREON_YAAZ_DIRECTORY_KEY?.trim();
  const supplied = request.headers.get("authorization");
  if (!secret || secret.length < 32 || secret.length > 256 || !supplied) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizedEmail(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isBanned(value: string | null | undefined): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) || timestamp > Date.now();
}

/**
 * Read-only server bridge used by YAAZ to address eligible employees as Teams
 * users. It deliberately returns no names, e-mail addresses, roles or tokens:
 * only the already-shared Careon subject and its matching Entra object id.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return json({ status: "unauthorized" }, 401);

  const orgSlug = process.env.CAREON_YAAZ_DIRECTORY_ORG_SLUG?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(orgSlug)) {
    return json({ status: "invalid_configuration" }, 503);
  }

  const directory = await listEntraDirectoryMembers();
  if (directory.status !== "ready" || directory.config.orgSlug !== orgSlug) {
    return json({ status: "directory_unavailable" }, 503);
  }

  const [organizationsResult, membershipsResult, authUsersResult] = await Promise.all([
    listOrganizations(),
    listMemberships(),
    listAuthUsers(),
  ]);
  if (adminReadFailed(organizationsResult, membershipsResult, authUsersResult)) {
    return json({ status: "identity_unavailable" }, 502);
  }

  const organization = adminDataOr(organizationsResult, []).find((item) => item.slug === orgSlug);
  if (!organization) return json({ status: "organization_unavailable" }, 503);

  const activeMemberIds = new Set(
    adminDataOr(membershipsResult, [])
      .filter((membership) => membership.org_id === organization.id)
      .map((membership) => membership.user_id),
  );
  const authByEmail = new Map(
    adminDataOr(authUsersResult, [])
      .filter((user) => activeMemberIds.has(user.id) && !isBanned(user.banned_until) && normalizedEmail(user.email))
      .map((user) => [normalizedEmail(user.email), user]),
  );

  const users = directory.members.flatMap((entra) => {
    if (!entra.eligible || entra.userType !== "Member" || entra.accountEnabled === false || entra.licensed === false) {
      return [];
    }
    const email = entra.email || entra.userPrincipalName;
    const careonUser = authByEmail.get(email);
    if (!careonUser) return [];
    return [{ careonSubject: careonUser.id, microsoftUserId: entra.entraObjectId }];
  });

  return json({ version: 1, orgSlug, users }, 200);
}

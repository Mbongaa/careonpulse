import { NextResponse } from "next/server";

import {
  adminDataOr,
  adminReadFailed,
  listAuthUsers,
  listMemberships,
  listProfiles,
  organizationById,
} from "@/lib/careon-admin/admin.server";
import { listEntraDirectoryMembers } from "@/lib/careon-entra/directory.server";
import { listYaazDirectoryUsers, type YaazDirectoryUser } from "@/lib/careon-yaaz/directory.server";
import { requireOrgAdmin } from "@/lib/supabase/session.server";

export const runtime = "nodejs";

function normalizedEmail(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isBanned(value: string | null | undefined): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) || timestamp > Date.now();
}

function careonStatus(
  hasCareonUser: boolean,
  hasMembership: boolean,
  blocked: boolean,
): "not_started" | "identity_only" | "active" | "blocked" {
  if (blocked) return "blocked";
  if (!hasCareonUser) return "not_started";
  if (!hasMembership) return "identity_only";
  return "active";
}

function yaazStatus(
  available: boolean,
  user: YaazDirectoryUser | undefined,
): "unknown" | "not_started" | "active" | "blocked" {
  if (!available) return "unknown";
  if (!user) return "not_started";
  return user.status === "active" ? "active" : "blocked";
}

function microsoft365Status(
  yaazAvailable: boolean,
  user: YaazDirectoryUser | undefined,
): "unknown" | "connected" | "not_connected" {
  if (!yaazAvailable) return "unknown";
  return user?.microsoftConnected ? "connected" : "not_connected";
}

export async function GET() {
  const auth = await requireOrgAdmin();
  if ("denied" in auth) return auth.denied;
  const orgId = auth.session.orgId as string;

  const directory = await listEntraDirectoryMembers();
  if (directory.status === "disabled") {
    return NextResponse.json({ configured: false, reason: "disabled" }, { headers: { "Cache-Control": "no-store" } });
  }
  if (directory.status === "invalid_configuration") {
    return NextResponse.json(
      { configured: false, reason: "invalid_configuration" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (directory.status !== "ready") {
    return NextResponse.json(
      { configured: true, error: "Microsoft-medewerkers konden niet worden opgehaald." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const [organizationResult, membershipsResult, authUsersResult, profilesResult, yaazDirectory] = await Promise.all([
    organizationById(orgId),
    listMemberships(orgId),
    listAuthUsers(),
    listProfiles(),
    listYaazDirectoryUsers(),
  ]);
  if (adminReadFailed(organizationResult, membershipsResult, authUsersResult, profilesResult)) {
    return NextResponse.json(
      { configured: true, error: "Careon-accountstatus kon niet worden opgehaald." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const organization = adminDataOr(organizationResult, [])[0];
  if (!organization || organization.slug !== directory.config.orgSlug) {
    return NextResponse.json({ error: "Deze Entra-koppeling hoort niet bij uw organisatie." }, { status: 403 });
  }

  const memberships = adminDataOr(membershipsResult, []);
  const authUsers = adminDataOr(authUsersResult, []);
  const profiles = adminDataOr(profilesResult, []);
  const membershipByUserId = new Map(memberships.map((membership) => [membership.user_id, membership]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const authByEmail = new Map(
    authUsers.filter((user) => normalizedEmail(user.email)).map((user) => [normalizedEmail(user.email), user]),
  );
  const yaazAvailable = yaazDirectory.status === "ready" && yaazDirectory.orgSlug === organization.slug;
  const yaazBySubject = new Map(
    yaazAvailable
      ? yaazDirectory.users.filter((user) => user.careonSubject).map((user) => [user.careonSubject as string, user])
      : [],
  );
  const yaazByEmail = new Map(yaazAvailable ? yaazDirectory.users.map((user) => [user.email, user]) : []);

  const members = directory.members.map((entra) => {
    const matchEmail = entra.email || entra.userPrincipalName;
    const careonUser = authByEmail.get(matchEmail);
    const membership = careonUser ? membershipByUserId.get(careonUser.id) : undefined;
    const banned = isBanned(careonUser?.banned_until);
    const yaazUser = careonUser
      ? (yaazBySubject.get(careonUser.id) ?? yaazByEmail.get(matchEmail))
      : yaazByEmail.get(matchEmail);
    return {
      ...entra,
      matchEmail,
      careonStatus: careonStatus(Boolean(careonUser), Boolean(membership), banned),
      careonUserId: careonUser?.id ?? null,
      careonName: careonUser ? (profileById.get(careonUser.id)?.full_name ?? "") : "",
      careonRole: membership?.role ?? null,
      careonLastSignIn: careonUser?.last_sign_in_at ?? null,
      isSelf: careonUser?.id === auth.session.userId,
      yaazStatus: yaazStatus(yaazAvailable, yaazUser),
      yaazLastLogin: yaazUser?.lastLogin ?? null,
      microsoft365Status: microsoft365Status(yaazAvailable, yaazUser),
      microsoft365UpdatedAt: yaazUser?.microsoftUpdatedAt ?? null,
    };
  });

  const summary = {
    eligible: members.length,
    active: members.filter((member) => member.careonStatus === "active").length,
    pendingFirstLogin: members.filter(
      (member) => member.careonStatus === "not_started" || member.careonStatus === "identity_only",
    ).length,
    blocked: members.filter((member) => member.careonStatus === "blocked").length,
    guests: members.filter((member) => member.userType === "Guest").length,
  };
  return NextResponse.json(
    { configured: true, eligibilitySource: directory.config.source, yaazAvailable, members, summary },
    { headers: { "Cache-Control": "no-store" } },
  );
}

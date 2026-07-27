// Datalaag voor het beheerdashboard (handoff 13, fase 4). Uitsluitend
// aangeroepen vanuit (admin)-servercomponenten en /api/admin-routes NADAT de
// superadmin-check is gedaan — hier wordt met de service-role gelezen (RLS
// geldt niet), want beheer is per definitie cross-org.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function adminConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

function headers(extra?: HeadersInit): HeadersInit {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function restGet<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface AdminMembership {
  org_id: string;
  user_id: string;
  role: "org_admin" | "member";
}

export interface AdminProfile {
  id: string;
  full_name: string;
  created_at: string;
}

export interface AdminAuthUser {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
}

export interface AdminAuditEvent {
  id: number;
  org_id: string | null;
  user_id: string | null;
  action: string;
  resource: string | null;
  resource_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface AdminAssistantEvent {
  id: number;
  event_type: string;
  status_code: number | null;
  tool_names: string[];
  org_id: string | null;
  user_id: string | null;
  created_at: string;
}

export interface AdminThread {
  user_id: string;
  id: string;
  org_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function listOrganizations(): Promise<AdminOrganization[] | null> {
  return restGet<AdminOrganization[]>("organizations?select=id,name,slug,created_at&order=created_at.asc");
}

export function listMemberships(): Promise<AdminMembership[] | null> {
  return restGet<AdminMembership[]>("organization_members?select=org_id,user_id,role");
}

export function listProfiles(): Promise<AdminProfile[] | null> {
  return restGet<AdminProfile[]>("profiles?select=id,full_name,created_at&order=created_at.asc");
}

export function listPlatformAdmins(): Promise<{ user_id: string }[] | null> {
  return restGet<{ user_id: string }[]>("platform_admins?select=user_id");
}

export async function listAuthUsers(): Promise<AdminAuthUser[] | null> {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, {
      headers: headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { users?: AdminAuthUser[] };
    return payload.users ?? [];
  } catch {
    return null;
  }
}

export function recentAuditEvents(filters?: {
  orgId?: string;
  userId?: string;
  action?: string;
  limit?: number;
}): Promise<AdminAuditEvent[] | null> {
  const params = new URLSearchParams({
    select: "id,org_id,user_id,action,resource,resource_id,detail,created_at",
    order: "created_at.desc",
    limit: String(Math.min(200, filters?.limit ?? 100)),
  });
  if (filters?.orgId) params.set("org_id", `eq.${filters.orgId}`);
  if (filters?.userId) params.set("user_id", `eq.${filters.userId}`);
  if (filters?.action) params.set("action", `eq.${filters.action}`);
  return restGet<AdminAuditEvent[]>(`audit_events?${params}`);
}

export function recentAssistantEvents(limit = 50): Promise<AdminAssistantEvent[] | null> {
  return restGet<AdminAssistantEvent[]>(
    `careon_assistant_events?select=id,event_type,status_code,tool_names,org_id,user_id,created_at&order=created_at.desc&limit=${Math.min(200, limit)}`,
  );
}

export function listAllThreads(): Promise<AdminThread[] | null> {
  return restGet<AdminThread[]>(
    "assistant_threads?select=user_id,id,org_id,title,status,created_at,updated_at&order=updated_at.desc&limit=200",
  );
}

export function threadMessages(userId: string, threadId: string): Promise<{ payload: unknown }[] | null> {
  const params = new URLSearchParams({
    select: "payload,created_at",
    user_id: `eq.${userId}`,
    thread_id: `eq.${threadId}`,
    order: "id.asc",
    limit: "500",
  });
  return restGet<{ payload: unknown }[]>(`assistant_messages?${params}`);
}

/** Nieuwste revisie + tijdstip per registratietabel, per organisatie. */
export async function latestStatePerOrg(
  table: string,
): Promise<Map<string, { savedAt: string; revision: number | null }>> {
  const rows = await restGet<{ org_id: string; saved_at: string; revision?: number }[]>(
    `${table}?select=org_id,saved_at,revision&order=saved_at.desc&limit=200`,
  );
  const map = new Map<string, { savedAt: string; revision: number | null }>();
  for (const row of rows ?? []) {
    if (!map.has(row.org_id)) {
      map.set(row.org_id, { savedAt: row.saved_at, revision: row.revision ?? null });
    }
  }
  return map;
}

export async function countRows(path: string): Promise<number | null> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: "HEAD",
      headers: headers({ Prefer: "count=exact" }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const range = response.headers.get("content-range");
    const total = range?.split("/")[1];
    return total && total !== "*" ? Number(total) : null;
  } catch {
    return null;
  }
}

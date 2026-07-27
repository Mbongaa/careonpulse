import { after } from "next/server";

// Algemeen audit-logboek (handoff 13, fase 4). Server-side, best-effort:
// schrijven mag een gebruikersaanvraag nooit breken of vertragen. Inserts
// lopen via de service-role (audit_events heeft bewust geen client-policies).
// Metadata-only: geef in `detail` nooit chat- of registratie-INHOUD mee.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface AuditEvent {
  action: string;
  orgId?: string | null;
  userId?: string | null;
  resource?: string;
  resourceId?: string;
  detail?: Record<string, string | number | boolean | null>;
}

export async function writeAuditEvent(event: AuditEvent): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/audit_events`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        action: event.action,
        org_id: event.orgId ?? null,
        user_id: event.userId ?? null,
        resource: event.resource ?? null,
        resource_id: event.resourceId ?? null,
        detail: event.detail ?? {},
      }),
      signal: AbortSignal.timeout(2_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Next houdt de request-lifecycle open tot deze metadata-write klaar is.
 * De gebruikersmutatie blijft beschikbaar, maar een mislukte audit verdwijnt
 * niet meer stil door een onafgewachte Promise.
 */
export function scheduleAuditEvent(event: AuditEvent): void {
  after(async () => {
    const recorded = await writeAuditEvent(event);
    if (!recorded) {
      console.error("Audit event could not be recorded", { action: event.action, resource: event.resource });
    }
  });
}

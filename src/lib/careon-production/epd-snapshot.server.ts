import { POSTGREST_URL, userRestHeaders } from "@/lib/supabase/postgrest.server";
import type { CareonSession } from "@/lib/supabase/session.server";

/** Authenticated invoker RPC: one MVCC snapshot, existing tenant/finance RLS. */
export async function readEpdSnapshot(session: CareonSession): Promise<Record<string, unknown>> {
  const response = await fetch(`${POSTGREST_URL}/rpc/careon_read_epd_snapshot`, {
    method: "POST",
    headers: userRestHeaders(session),
    cache: "no-store",
    body: JSON.stringify({ p_org: session.orgId }),
  });
  if (!response.ok) throw new Error("EPD-generatie kon niet worden gelezen.");
  const snapshot: unknown = await response.json();
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Ongeldige EPD-generatie.");
  return snapshot as Record<string, unknown>;
}

export async function isGenerationManaged(session: CareonSession): Promise<boolean> {
  const response = await fetch(`${POSTGREST_URL}/careon_epd_generations?select=id&org_id=eq.${session.orgId}&limit=1`, {
    headers: userRestHeaders(session),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("EPD-generatie kon niet worden gecontroleerd.");
  return ((await response.json()) as unknown[]).length > 0;
}

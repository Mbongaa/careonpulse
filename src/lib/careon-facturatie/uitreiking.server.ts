import { POSTGREST_URL } from "@/lib/supabase/postgrest.server";
import type { CareonSession } from "@/lib/supabase/session.server";

import { conceptRijVanFactuur, serviceRestHeaders } from "./facturatie.server";
import type { Factuur, FactuurTemplate } from "./types";

export class FactuurConflictError extends Error {}

/** The database locks and checks the revision before storing this entire
 * validated snapshot and issuing its number in the same transaction. For a
 * full credit it locks the original and returns the existing credit on retry.
 * The user JWT never performs an intermediate write. */
export async function reikFactuurAtomairUit(
  session: CareonSession,
  factuurId: string,
  revision: number,
  factuur: Factuur | null,
  template: FactuurTemplate | null,
  credit = false,
): Promise<{ factuurId: string; alreadyIssued: boolean }> {
  const reeks = credit ? template?.nummering.reeksCredit : template?.nummering.reeksFactuur;
  const response = await fetch(`${POSTGREST_URL}/rpc/careon_factuur_uitreiken_atomic`, {
    method: "POST",
    headers: serviceRestHeaders(),
    body: JSON.stringify({
      p_actor: session.userId,
      p_org: session.orgId,
      p_factuur: factuurId,
      p_expected_revision: revision,
      p_snapshot: factuur ? conceptRijVanFactuur(factuur) : null,
      p_reeks: reeks ?? null,
      p_jaar: factuur?.factuurdatum ? Number.parseInt(factuur.factuurdatum.slice(0, 4), 10) : null,
      p_start: template?.nummering.startVolgnummer ?? null,
      p_formaat: template?.nummering.formaat ?? null,
      p_credit: credit,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { code?: string } | null;
    if (error?.code === "40001" || error?.code === "23505") {
      throw new FactuurConflictError("Deze factuur is intussen gewijzigd. Ververs de pagina en probeer opnieuw.");
    }
    throw new Error("storage-unavailable");
  }
  const result = (await response.json()) as { factuur_id?: unknown; already_issued?: unknown };
  if (typeof result.factuur_id !== "string" || typeof result.already_issued !== "boolean") {
    throw new Error("storage-unavailable");
  }
  return { factuurId: result.factuur_id, alreadyIssued: result.already_issued };
}

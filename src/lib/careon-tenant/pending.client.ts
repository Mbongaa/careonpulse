"use client";

import { pushRemoteHrState } from "@/lib/careon-hr/remote.client";
import { loadHrCache, saveHrState } from "@/lib/careon-hr/storage.client";
import { pushRemoteMiddelenState } from "@/lib/careon-middelen/remote.client";
import { loadMiddelenCache, saveMiddelenState } from "@/lib/careon-middelen/storage.client";

// HR en middelen zijn handmatig bijgehouden registraties: zolang `dirty` in de
// cache staat is de browser de ENIGE plek waar die wijziging bestaat (de push
// faalde of er ligt een conflict). Uitloggen mag dat werk dus niet wissen —
// eerst nog één keer proberen te bewaren, en wat blijft staan blijft staan.

export interface OnbewaardeRegistraties {
  hr: boolean;
  middelen: boolean;
}

export function heeftOnbewaardeRegistraties(status: OnbewaardeRegistraties): boolean {
  return status.hr || status.middelen;
}

/** Synchrone voorcontrole (bijv. voor een bevestiging vóór uitloggen). */
export function onbewaardeRegistraties(): OnbewaardeRegistraties {
  return { hr: loadHrCache()?.dirty === true, middelen: loadMiddelenCache()?.dirty === true };
}

async function flushHr(): Promise<boolean> {
  const cache = loadHrCache();
  if (!cache?.dirty) return false;
  const result = await pushRemoteHrState(cache.state, {
    baseRevision: cache.revision,
    operationId: cache.operationId ?? crypto.randomUUID(),
    audit: cache.audit ?? { source: "manual" },
  });
  if (result.status === "ok") {
    saveHrState(cache.state, { revision: result.revision, dirty: false });
    return false;
  }
  // 501 = geen centrale opslag geconfigureerd; de lokale kopie is daar geen
  // achterstand maar de bedoelde bewaarplaats van de demo-/lokale modus.
  return result.status !== "unconfigured";
}

async function flushMiddelen(): Promise<boolean> {
  const cache = loadMiddelenCache();
  if (!cache?.dirty) return false;
  const result = await pushRemoteMiddelenState(cache.state, {
    baseRevision: cache.revision,
    operationId: cache.operationId ?? crypto.randomUUID(),
    audit: cache.audit ?? { source: "manual" },
  });
  if (result.status === "ok") {
    saveMiddelenState(cache.state, { revision: result.revision, dirty: false });
    return false;
  }
  return result.status !== "unconfigured";
}

/**
 * Uitloggen mag nóóit blijven hangen: op een gedeelde werkplek is de sessie
 * beëindigen belangrijker dan deze laatste bewaarpoging. De pushes zelf kennen
 * geen eigen deadline, dus die staat hier. Verstrijkt hij, dan geldt het werk
 * als onbewaard — de cache blijft staan en de gebruiker wordt gewaarschuwd.
 */
const FLUSH_DEADLINE_MS = 3_000;

/**
 * Laatste poging om openstaande registraties centraal te bewaren. Geeft per
 * registratie terug of er ná die poging nog iets onbewaard is; die cache moet
 * dan blijven staan en de aanroeper hoort de gebruiker te waarschuwen.
 */
export async function flushOnbewaardeRegistraties(): Promise<OnbewaardeRegistraties> {
  const poging = Promise.all([flushHr(), flushMiddelen()]).then(([hr, middelen]) => ({ hr, middelen }));
  const deadline = new Promise<OnbewaardeRegistraties>((resolve) => {
    window.setTimeout(() => resolve(onbewaardeRegistraties()), FLUSH_DEADLINE_MS);
  });
  return Promise.race([poging, deadline]);
}

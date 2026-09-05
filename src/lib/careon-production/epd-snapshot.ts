import {
  type AgendaFacts,
  type DeclaratiesFacts,
  isAgendaFacts,
  isDeclaratiesFacts,
  isProductionState,
  isToeslagenFacts,
  isVerwijzersFacts,
  type ProductionState,
  type ToeslagenFacts,
  type VerwijzersFacts,
} from "./types";

export interface EpdSnapshot {
  generationId: string | null;
  production: ProductionState | null;
  agenda: AgendaFacts | null;
  verwijzers: VerwijzersFacts | null;
  toeslagen: ToeslagenFacts | null;
  declaraties: DeclaratiesFacts | null;
}

export const EMPTY_EPD_SNAPSHOT: EpdSnapshot = {
  generationId: null,
  production: null,
  agenda: null,
  verwijzers: null,
  toeslagen: null,
  declaraties: null,
};

/** Missing/invalid slices are errors; explicit null is allowed for role-redacted or legacy data. */
export function isEpdSnapshot(value: unknown, financieelZichtbaar: boolean): value is EpdSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (
    !(
      data.generationId === null ||
      (typeof data.generationId === "string" &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.generationId))
    )
  )
    return false;
  if (
    !(data.production === null || isProductionState(data.production)) ||
    !(data.agenda === null || isAgendaFacts(data.agenda)) ||
    !(data.verwijzers === null || isVerwijzersFacts(data.verwijzers)) ||
    !(data.toeslagen === null || isToeslagenFacts(data.toeslagen)) ||
    !(data.declaraties === null || isDeclaratiesFacts(data.declaraties))
  )
    return false;
  return (
    data.generationId === null ||
    Boolean(
      data.production &&
        data.agenda &&
        data.verwijzers &&
        (!financieelZichtbaar || (data.toeslagen && data.declaraties)),
    )
  );
}

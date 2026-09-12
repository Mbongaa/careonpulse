/** Experimental only: preserve source turns without assigning clinical roles. */
export interface DiarizationMetadataProposal {
  fragmentId: string;
  segmentId: string;
  sprekerLabel: string | null;
  /** Relative to the uploaded audio, never relative to the new/non-overlap part. */
  startMs: number | null;
  eindMs: number | null;
  timing: "provider" | "fragment-estimate";
}

export interface PreservedSourceTurn {
  tekst: string;
  spreker: "onbekend";
  beginMs: number;
  eindMs: number;
  diarisatie: DiarizationMetadataProposal;
  /** Local cluster identity; deliberately changes when fragmentId changes. */
  neutralSpeakerKey: string | null;
  overlap: "none" | "exact-duplicate" | "review";
  duplicateOf: string | null;
}

export interface SourceFragmentContext {
  fragmentId: string;
  offsetMs: number;
  duurMs: number;
  overlapMs: number;
}

export function scopedSpeakerKey(fragmentId: string, speakerLabel: string | null): string | null {
  return speakerLabel === null ? null : `${fragmentId}:${encodeURIComponent(speakerLabel)}`;
}

function identifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text.length > 0 && text.length <= 80 && !/\p{Cc}/u.test(text) ? text : null;
}

/** Malformed timing never causes invented uniform turn timestamps or lost text. */
export function preserveDiarizedTurns(payload: unknown, context: SourceFragmentContext): PreservedSourceTurn[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { segments?: unknown }).segments))
    throw new Error("Diarization prototype requires a provider segments array.");
  if (
    !/^[a-zA-Z0-9_-]{1,64}$/.test(context.fragmentId) ||
    !Number.isFinite(context.offsetMs) ||
    context.offsetMs < 0 ||
    !Number.isFinite(context.duurMs) ||
    context.duurMs <= 0 ||
    !Number.isFinite(context.overlapMs) ||
    context.overlapMs < 0 ||
    context.overlapMs >= context.duurMs
  )
    throw new Error("Invalid source fragment context.");
  const rows = (payload as { segments: unknown[] }).segments;
  return rows.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (typeof row.text !== "string" || row.text.trim().length === 0) return [];
    const startMs = typeof row.start === "number" ? Math.round(row.start * 1000) : Number.NaN;
    const endMs = typeof row.end === "number" ? Math.round(row.end * 1000) : Number.NaN;
    const validTiming =
      Number.isFinite(startMs) &&
      Number.isFinite(endMs) &&
      startMs >= 0 &&
      endMs > startMs &&
      endMs <= context.duurMs + 100;
    const speakerLabel = identifier(row.speaker);
    const timing = validTiming ? "provider" : "fragment-estimate";
    return [
      {
        tekst: row.text.trim(),
        spreker: "onbekend" as const,
        beginMs: context.offsetMs + (validTiming ? startMs : 0),
        eindMs: context.offsetMs + (validTiming ? Math.min(endMs, context.duurMs) : context.duurMs),
        diarisatie: {
          fragmentId: context.fragmentId,
          segmentId: identifier(row.id) ?? `segment-${index}`,
          sprekerLabel: speakerLabel,
          startMs: validTiming ? startMs : null,
          eindMs: validTiming ? Math.min(endMs, context.duurMs) : null,
          timing,
        },
        neutralSpeakerKey: scopedSpeakerKey(context.fragmentId, speakerLabel),
        overlap:
          context.overlapMs > 0 && (!validTiming || startMs < context.overlapMs)
            ? ("review" as const)
            : ("none" as const),
        duplicateOf: null,
      } satisfies PreservedSourceTurn,
    ];
  });
}

function normalizedLiteral(text: string): string {
  // Questions, negatives and punctuation remain meaningful; only layout/case is ignored.
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Mark only a unique, complete same-text/same-time overlap as duplicate.
 * Never remove a partial word prefix, trim a crossing turn or merge speaker labels.
 * All source alternatives remain present, including exact duplicates.
 */
export function markExactOverlap(
  previous: PreservedSourceTurn[],
  incoming: PreservedSourceTurn[],
  context: SourceFragmentContext,
): PreservedSourceTurn[] {
  if (context.overlapMs === 0) return incoming.map((turn) => ({ ...turn, overlap: "none", duplicateOf: null }));
  const boundary = context.offsetMs + context.overlapMs;
  const matches = (left: PreservedSourceTurn, right: PreservedSourceTurn): boolean =>
    left.diarisatie.timing === "provider" &&
    right.diarisatie.timing === "provider" &&
    Math.abs(left.beginMs - right.beginMs) <= 200 &&
    Math.abs(left.eindMs - right.eindMs) <= 200 &&
    normalizedLiteral(left.tekst) === normalizedLiteral(right.tekst);
  return incoming.map((turn) => {
    if (turn.overlap !== "review" || turn.diarisatie.timing !== "provider" || turn.eindMs > boundary)
      return { ...turn };
    const candidates = previous.filter((old) => matches(old, turn));
    if (candidates.length !== 1 || incoming.filter((other) => matches(other, turn)).length !== 1) return { ...turn };
    const matched = candidates[0];
    return {
      ...turn,
      overlap: "exact-duplicate",
      duplicateOf: `${matched.diarisatie.fragmentId}:${matched.diarisatie.segmentId}`,
    };
  });
}

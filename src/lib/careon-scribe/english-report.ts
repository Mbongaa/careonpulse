import { valideerEngelsBewijs } from "./english-evidence";
import type { Feit, KlinischeStaat, ScribeSegment, StaatCategorie } from "./types";

export const ENGLISH_FACT_REPORT_HEADER = "Vastgelegde feiten — controleer de inhoud vóór goedkeuring.";

/** Subset of the existing report mapping supported by the English evidence validator. */
export const ENGLISH_FACT_REPORT_FIELDS: Record<string, readonly StaatCategorie[]> = {
  subjectief: ["symptomen", "begeleidendeSymptomen", "medicatie", "allergieen", "leefstijl"],
  anamnese: ["symptomen", "medicatie", "allergieen"],
  plan: ["plan", "acties"],
  "speciele-anamnese": ["symptomen", "begeleidendeSymptomen"],
  "somatiek-medicatie": ["medicatie", "allergieen"],
  "sociale-anamnese": ["leefstijl"],
  beleid: ["plan", "acties"],
  observaties: ["symptomen", "medicatie", "allergieen"],
  interventies: ["plan"],
  vervolg: ["acties"],
  "beleid-vervolg": ["plan", "acties"],
  "beloop-sinds-vorig-contact": ["symptomen"],
  "huidige-klachten": ["symptomen", "medicatie", "allergieen"],
  beloop: ["symptomen"],
  "medicatie-bij-ontslag": ["medicatie", "allergieen"],
  vervolgafspraken: ["acties"],
  adviezen: ["plan"],
};

/** Existing section content that a literal English prefill must not replace. */
export const ENGLISH_FACT_REPORT_OTHER_FIELDS: Record<string, readonly (keyof KlinischeStaat)[]> = {
  subjectief: [
    "hoofdklacht",
    "duur",
    "beloop",
    "ernst",
    "uitlokkendeFactoren",
    "verlichtendeFactoren",
    "voorgeschiedenis",
    "familieanamnese",
  ],
  anamnese: ["hoofdklacht", "duur", "beloop", "ernst", "voorgeschiedenis", "familieanamnese"],
  "speciele-anamnese": ["uitlokkendeFactoren", "verlichtendeFactoren"],
  "somatiek-medicatie": ["voorgeschiedenis"],
  "sociale-anamnese": ["familieanamnese"],
  observaties: ["hoofdklacht", "duur", "ernst", "metingen", "psychisch"],
  "beloop-sinds-vorig-contact": ["beloop"],
  "huidige-klachten": ["hoofdklacht", "ernst"],
  beloop: ["beloop"],
};

/** No paraphrase or diagnosis: exact, reviewed-source statements in a reviewable draft. */
export function renderEnglishFacts(
  state: KlinischeStaat,
  segments: ScribeSegment[],
  sectionId: string,
): { tekst: string; bron: number[] } {
  for (const field of ENGLISH_FACT_REPORT_OTHER_FIELDS[sectionId] ?? []) {
    const value = state[field];
    if (Array.isArray(value) ? value.some((row) => !("ingetrokken" in row) || !row.ingetrokken) : value) {
      return { tekst: "", bron: [] };
    }
  }
  const sources = new Map(segments.map((segment) => [segment.volgnummer, segment]));
  const rows: Feit[] = [];
  const seen = new Set<string>();
  for (const field of ENGLISH_FACT_REPORT_FIELDS[sectionId] ?? []) {
    for (const row of state[field]) {
      if (row.ingetrokken) continue;
      // Structured human edits may carry dose, allergy or task details outside
      // tekst. Keep the existing complete canonical draft for that section.
      if (row.doorBehandelaar === true && !["symptomen", "begeleidendeSymptomen", "plan"].includes(field)) {
        return { tekst: "", bron: [] };
      }
      const evidence = row.bron.map((number) => sources.get(number));
      if (
        row.doorBehandelaar !== true &&
        !(
          evidence.every((segment) => segment && segment.sprekerBron === "behandelaar") &&
          valideerEngelsBewijs(field, row, evidence as ScribeSegment[])
        )
      )
        return { tekst: "", bron: [] };
      const key = `${row.tekst}|${row.bron.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return {
    tekst:
      rows.length > 0
        ? `${ENGLISH_FACT_REPORT_HEADER}\n\n${rows.map((row) => `- ${row.tekst}${row.bron.length ? ` (${row.bron.map((number) => `§${number}`).join(", ")})` : ""}`).join("\n")}`
        : "",
    bron: [...new Set(rows.flatMap((row) => row.bron))].sort((a, b) => a - b),
  };
}

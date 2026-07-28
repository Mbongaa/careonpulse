import type { AssistantResponse, AssistantVisualization } from "@/data/careon/careon-assistant";

// Financiële redactie van deterministische assistent-antwoorden (klantbesluit
// 28-07-2026): voor leden verdwijnen financiële tegels, rijen, tabellen,
// claims en zinnen uit het canvas en de kernantwoorden. Dit dekt het
// demo-/terugvalpad dat zonder servercall antwoordt; het live pad wordt
// daarnaast server-side afgedwongen (financieel-gate.ts).

const FIN_TEKST = /omzet|infomedics|declarat|onderhanden|factu|toeslag|tarie(?:f|ven)|€/i;

function redigeerVisualisatie(visual: AssistantVisualization): AssistantVisualization | null {
  if (FIN_TEKST.test(`${visual.title} ${visual.sub}`)) return null;
  const kopie = { ...visual };
  if (kopie.tiles) {
    kopie.tiles = kopie.tiles.filter((tile) => !FIN_TEKST.test(tile.label));
    if (kopie.tiles.length === 0) return null;
  }
  if (kopie.rows) {
    kopie.rows = kopie.rows.filter((row) => !FIN_TEKST.test(`${row.label} ${row.display}`));
    if (kopie.rows.length === 0) return null;
  }
  // Restcontrole over de volledige structuur: tabellen, statusregels,
  // maandreeksen en donutlabels kennen geen veiliger deel-filter — draagt de
  // rest nog financiële inhoud, dan verdwijnt de hele visualisatie.
  if (FIN_TEKST.test(JSON.stringify(kopie))) return null;
  return kopie;
}

/** Zinsgewijs filteren mét behoud van regels/bullets: alleen regels die al
    hun zinnen verliezen verdwijnen; lege bronregels (alinea-scheiders)
    blijven staan. */
function verwijderFinancieleZinnen(tekst: string): string {
  return tekst
    .split("\n")
    .map((regel) => {
      if (regel.trim() === "") return regel;
      const geschoond = regel
        .split(/(?<=[.!?;])\s+/)
        .filter((zin) => !FIN_TEKST.test(zin))
        .join(" ");
      return geschoond.trim() === "" ? null : geschoond;
    })
    .filter((regel): regel is string => regel !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function redigeerFinancieleAssistentResponse(response: AssistantResponse): AssistantResponse {
  const { artifact } = response;
  return {
    artifact: {
      ...artifact,
      visualizations: artifact.visualizations
        .map(redigeerVisualisatie)
        .filter((visual): visual is AssistantVisualization => visual !== null),
      // Claims dragen hun cijfers ook in `values` — de hele claim telt.
      claims: artifact.claims.filter((claim) => !FIN_TEKST.test(JSON.stringify(claim))),
    },
    brief: verwijderFinancieleZinnen(response.brief),
    deep: verwijderFinancieleZinnen(response.deep),
  };
}

import type { AssistantIntentId } from "@/data/careon/careon-assistant";
import type { CareonFilters } from "@/data/careon/careon-types";

import type { ProductionAgendaSnapshot, ProductionSnapshot } from "./types";

// Feitenblad voor de externe AI-dienst. Het payload is per intent begrensd:
// geen cliëntniveau-rijen, geen risicolijst/dossierlinks en geen medewerkers-
// namen buiten expliciete behandelaarvragen.

const TOP_BEHANDELAREN = 10;

export interface ProductionAssistantFactsOptions {
  intent: AssistantIntentId;
  includeNames?: boolean;
  /** Financiële rolregel (klantbesluit 28-07-2026): false = ledenweergave —
      geen omzet-KPI's, geen financiële signaleringen, geen financieel-domein.
      De server scrubt daarnaast zelf; dit houdt de context van leden schoon
      zodat die scrub nooit legitieme grounding hoeft weg te gooien. */
  financieelZichtbaar?: boolean;
}

export function buildProductionAssistantFacts(
  snapshot: ProductionSnapshot,
  filters: CareonFilters,
  options: ProductionAssistantFactsOptions = { intent: "directie-overzicht" },
): string {
  const metricLijst = (metrics: Record<string, { label: string; value: number; prev: number | null }>) =>
    Object.values(metrics).map((metric) => ({
      label: metric.label,
      waarde: metric.value,
      vorige: metric.prev,
    }));

  // Voor leden mag géén enkele intent financiële sleutels of vaktermen
  // meesturen: de server-scrub (verwijderFinancieleContext) zou het hele
  // feitenblok weggooien en elke beurt als request_blocked auditeren.
  const financieelZichtbaar = options.financieelZichtbaar !== false;
  const statsLijst = (stats: ProductionAgendaSnapshot["behandelaarStats"]) =>
    Object.entries(stats)
      .slice(0, TOP_BEHANDELAREN)
      .map(([naam, statistiek]) => {
        if (financieelZichtbaar) return { naam, ...statistiek };
        const { omzet: _weggelaten, ...rest } = statistiek;
        return { naam, ...rest };
      });

  const basis = {
    databron: {
      type: "EPD-export",
      bestand: snapshot.meta.fileName,
      referentiedatum: snapshot.meta.referenceDate,
      clientRijen: snapshot.meta.totalRows,
    },
    filters: { locatie: filters.locatie },
    toelichting: [
      "Outreachend = proxy op ZPM-setting S04 (bevestiging instelling gevraagd).",
      "'>30/60 dgn geen registratie' is een ondergrens wanneer afspraakdata ontbreken.",
      "'Hoog-risico' = zorgvraagtypen ZT05/ZT08 (proxy voor crisisrisico); mét agenda-crisisvelden toont de Patiënten-pagina 'Crisiscliënten (90 dgn)' = gehouden crisis-sessies in de laatste 90 dagen.",
      "Productie-uren = cumulatief geregistreerde tijd over de looptijd, geen maandproductie.",
      "Urgent op wachtlijst = wachtduur >60 dagen, gemeten sinds episodestart of verwijsdatum.",
      `${snapshot.meta.zonderVestiging} actieve cliënten hebben geen vestigingslabel en vallen buiten locatiefilters.`,
    ],
  };

  let domein: Record<string, unknown>;
  switch (options.intent) {
    case "noshow-analyse": {
      const agenda = snapshot.agenda;
      domein = {
        agendaBeschikbaar: Boolean(agenda),
        planningMetrics: agenda ? metricLijst(agenda.planningMetrics) : [],
        noshowPerWeekdag: agenda ? agenda.noshowWeekdagen : [],
        maandreeks: snapshot.monthly.map(({ key, m, noshowPct }) => ({ key, maand: m, noshowPct })),
        behandelaarStats: options.includeNames && agenda ? statsLijst(agenda.behandelaarStats) : undefined,
      };
      break;
    }
    case "capaciteit-planning": {
      const agenda = snapshot.agenda;
      domein = {
        gemWachttijdWkn: snapshot.gemWachttijdWkn.noData ? null : snapshot.gemWachttijdWkn.value,
        treeknormPerLocatie: snapshot.treekLocaties,
        wachtlijst: snapshot.dossiersProductie.wachtlijst,
        bezettingTotaal: agenda?.bezettingTotaal ?? null,
        bezettingPerLocatie: agenda ? agenda.bezettingPerLocatie : [],
        planningMetrics: agenda ? metricLijst(agenda.planningMetrics) : [],
        vooruitblik: agenda?.vooruitblik ?? null,
      };
      break;
    }
    case "patienten-instroom":
      domein = {
        patienten: metricLijst(snapshot.patientenMetrics),
        maandreeks: snapshot.monthly.map(({ key, m, aanmeldingen, uitstroom, caseload, verwijzingen }) => ({
          key,
          maand: m,
          aanmeldingen,
          uitstroom,
          caseload,
          verwijzingen,
        })),
        wachtlijst: snapshot.dossiersProductie.wachtlijst,
        wachttijdTrend: snapshot.wachttijdTrend,
        zorgvorm: snapshot.zorgvorm.map((item) => ({ naam: item.name, aantal: item.value })),
        populatieProfiel: snapshot.populatieProfiel,
      };
      break;
    case "financieel-omzet":
      if (options.financieelZichtbaar === false) {
        domein = {
          beschikbaar: false,
          toelichting: "Financiële gegevens zijn niet beschikbaar voor de rol van deze gebruiker.",
        };
        break;
      }
      domein = {
        financieel: snapshot.agenda
          ? {
              metrics: metricLijst(snapshot.agenda.financieel.metrics),
              omzetPerVerzekeraar: snapshot.agenda.financieel.omzetPerVerzekeraar,
              omzetPerLocatie: snapshot.agenda.financieel.omzetPerLocatie,
              onderhandenTotaal: snapshot.agenda.financieel.onderhandenTotaal,
              onderhandenOuderdom: snapshot.agenda.financieel.onderhandenOuderdom,
            }
          : null,
        declaraties: snapshot.declaraties,
        toeslagen: snapshot.toeslagen,
        maandreeks: snapshot.monthly.map(({ key, m, omzet, omzetVecozo, omzetServicebureau, omzetRmoRma }) => ({
          key,
          maand: m,
          omzet,
          omzetVecozo,
          omzetServicebureau,
          omzetRmoRma,
        })),
      };
      break;
    case "kwaliteit-dossier":
      domein = {
        dossiercontrole: snapshot.dossiercontrole,
        kwaliteitDossierscore: snapshot.kwaliteitDossierscore.value,
        datakwaliteit: snapshot.datakwaliteit,
        behandelduur: snapshot.dossiersProductie.behandelduur,
      };
      break;
    case "verzuim-hr":
      domein = {
        beschikbaar: false,
        toelichting:
          "De huidige productie-exports bevatten geen HR-verzuimbron. Geef geen demo-HR-cijfers als productiefeiten.",
      };
      break;
    case "behandelaar-coaching":
      domein = {
        behandelaren: options.includeNames ? snapshot.behandelaren.slice(0, TOP_BEHANDELAREN) : [],
        regiebehandelaren: options.includeNames ? snapshot.regiebehandelaren.slice(0, TOP_BEHANDELAREN) : [],
        agendaStats: options.includeNames && snapshot.agenda ? statsLijst(snapshot.agenda.behandelaarStats) : [],
      };
      break;
    case "databron-status": {
      const agenda = snapshot.agenda;
      const toeslagen = snapshot.toeslagen;
      const declaraties = snapshot.declaraties;
      domein = {
        hoofdexport: snapshot.meta,
        agenda: agenda ? agenda.meta : null,
        verwijzers: snapshot.verwijzerNetwerk
          ? {
              bestand: snapshot.verwijzerNetwerk.fileName,
              geimporteerdOp: snapshot.verwijzerNetwerk.importedAt,
              clienten: snapshot.verwijzerNetwerk.clienten,
              contacten: snapshot.verwijzerNetwerk.contacten.length,
            }
          : null,
        // Leden: de financiële sleutels bestaan hier niet eens (een kale
        // "toeslagen": null zou de server-scrub al laten afgaan).
        ...(financieelZichtbaar
          ? {
              toeslagen: toeslagen ? toeslagen.meta : null,
              declaraties: declaraties ? declaraties.meta : null,
            }
          : {}),
      };
      break;
    }
    case "assistent-acties":
      domein = {
        toelichting:
          "Deze beurt gaat over de handmatige medewerkers- en middelenregistratie; overige EPD-feiten zijn niet meegestuurd.",
      };
      break;
    case "directie-overzicht":
      domein = {
        kernKpis: Object.entries(snapshot.cockpitKpis)
          .filter(([id]) => options.financieelZichtbaar !== false || !id.startsWith("omzet"))
          .map(([id, kpi]) => ({
            id,
            waarde: kpi.value,
            vorige: kpi.prev,
            venster: kpi.windowLabel ?? null,
          })),
        cockpitSamenvatting: snapshot.cockpitSummary,
        signaleringen: snapshot.signaleringen
          .filter((alert) => options.financieelZichtbaar !== false || alert.page !== "financieel")
          .map((alert) => ({
            titel: alert.titel,
            aantal: alert.n,
            ernst: alert.sev,
          })),
        inzichten: snapshot.cockpitInsights,
      };
      break;
  }

  return JSON.stringify({ ...basis, domein });
}

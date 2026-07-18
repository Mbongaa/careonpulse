import type { CareonFilters } from "@/data/careon/careon-types";

import type { ProductionSnapshot } from "./types";

// Feitenblad voor de AI-assistent in productie-modus: een compacte,
// gestructureerde JSON-weergave van de ProductionSnapshot. Uitsluitend
// GEAGGREGEERDE cijfers — géén cliëntniveau-rijen (de risicolijst met
// cliënt-ID's en dossierlinks blijft bewust buiten dit blad, omdat het naar
// een externe AI-dienst gaat). Namen van behandelaren/verwijzers zijn
// medewerker-/praktijkgegevens en horen bij de managementvragen.

const TOP_BEHANDELAREN = 10;

export function buildProductionAssistantFacts(snapshot: ProductionSnapshot, filters: CareonFilters): string {
  const metricLijst = (metrics: Record<string, { label: string; value: number; prev: number | null }>) =>
    Object.values(metrics).map((metric) => ({
      label: metric.label,
      waarde: metric.value,
      vorige: metric.prev,
    }));

  return JSON.stringify({
    databron: `EPD-export ${snapshot.meta.fileName} · referentiedatum ${snapshot.meta.referenceDate} · ${snapshot.meta.totalRows} cliëntrijen`,
    filters: { locatie: filters.locatie },
    toelichting: [
      "Outreachend = proxy op ZPM-setting S04 (bevestiging instelling gevraagd).",
      "'>30/60 dgn geen registratie' = niet-wachtende dossiers zonder één minuut geregistreerde tijd (ondergrens; echte contactdata vereist de afsprakenexport).",
      "'Hoog-risico' = zorgvraagtypen ZT05/ZT08 (proxy voor crisisrisico).",
      "Productie-uren = cumulatief geregistreerde tijd over de looptijd, geen maandproductie.",
      "Urgent op wachtlijst = wachtduur >60 dagen, gemeten sinds episodestart of verwijsdatum.",
      `${snapshot.meta.zonderVestiging} actieve cliënten hebben geen vestigingslabel en vallen buiten locatiefilters.`,
    ],
    kernKpis: {
      cockpit: Object.entries(snapshot.cockpitKpis).map(([id, kpi]) => ({
        id,
        waarde: kpi.value,
        vorige: kpi.prev,
        venster: kpi.windowLabel ?? null,
      })),
      patienten: metricLijst(snapshot.patientenMetrics),
      dossiersProductie: metricLijst(snapshot.dossiersProductie.metrics),
      gemWachttijdWkn: snapshot.gemWachttijdWkn.noData ? null : snapshot.gemWachttijdWkn.value,
    },
    maandreeks: snapshot.monthly,
    wachttijdTrend: snapshot.wachttijdTrend,
    treeknormPerLocatie: snapshot.treekLocaties,
    wachtlijst: snapshot.dossiersProductie.wachtlijst,
    behandelduur: snapshot.dossiersProductie.behandelduur,
    populatie: {
      diagnoseGroepen: snapshot.dossiersProductie.diagnoseGroepen,
      comorbiditeit: snapshot.dossiersProductie.comorbiditeit,
      zorgvraagtypes: snapshot.dossiersProductie.zorgvraagtypes,
      geslacht: snapshot.dossiersProductie.geslacht.map((item) => ({ naam: item.name, aantal: item.value })),
      leeftijdGroepen: snapshot.dossiersProductie.leeftijdGroepen,
      verwijzers: snapshot.dossiersProductie.verwijzers,
      plaatsen: snapshot.dossiersProductie.plaatsen,
      verzekeraars: snapshot.dossiersProductie.verzekeraars,
      zorgvorm: snapshot.zorgvorm.map((item) => ({ naam: item.name, aantal: item.value })),
    },
    behandelaren: snapshot.behandelaren.slice(0, TOP_BEHANDELAREN),
    regiebehandelaren: snapshot.regiebehandelaren.slice(0, TOP_BEHANDELAREN),
    dossiercontrole: snapshot.dossiercontrole,
    kwaliteitDossierscore: snapshot.kwaliteitDossierscore.value,
    signaleringen: snapshot.signaleringen.map((alert) => ({ titel: alert.titel, aantal: alert.n, ernst: alert.sev })),
    datakwaliteit: snapshot.datakwaliteit,
    samenvatting: snapshot.cockpitInsights,
  });
}

export interface TgcSyncProgressUpdate {
  stage: string;
  progress: number;
  message: string;
}

const RULES: { pattern: RegExp; update: TgcSyncProgressUpdate }[] = [
  {
    pattern: /Aanmelden bij TGC/i,
    update: { stage: "login", progress: 5, message: "Veilig aangemeld bij TGC; exports worden voorbereid." },
  },
  {
    pattern: /cliëntendata-export aanvragen/i,
    update: { stage: "clients", progress: 12, message: "Volledige cliëntendata-export wordt opgehaald." },
  },
  {
    pattern: /agenda-export aanvragen/i,
    update: { stage: "agenda", progress: 28, message: "Agenda-export met toekomstvenster wordt opgehaald." },
  },
  {
    pattern: /huisarts\/verwijzer-snapshot/i,
    update: { stage: "referrers", progress: 43, message: "Huisarts- en verwijzersnapshot wordt opgehaald." },
  },
  {
    pattern: /gedeclareerde-toeslagenexport/i,
    update: { stage: "surcharges", progress: 54, message: "Volledige toeslagenhistorie wordt opgehaald." },
  },
  {
    pattern: /declaratie(?:-| )(?:totaalexport|finance-feedfallback)/i,
    update: { stage: "declarations", progress: 64, message: "Volledige factuurhistorie wordt opgehaald." },
  },
  {
    pattern: /Alle vijf downloads valideren/i,
    update: { stage: "validation", progress: 76, message: "Alle vijf exports worden inhoudelijk gevalideerd." },
  },
  {
    pattern: /Validatie geslaagd/i,
    update: { stage: "validation", progress: 84, message: "Bestands-, historie- en privacycontroles zijn geslaagd." },
  },
  {
    pattern: /Exports gepubliceerd/i,
    update: {
      stage: "upload",
      progress: 87,
      message: "Gevalideerde exports zijn lokaal als nieuwe snapshots gepubliceerd.",
    },
  },
  {
    pattern: /centrale Supabase-productiestand pushen/i,
    update: { stage: "upload", progress: 91, message: "Nieuwe snapshots worden centraal naar Supabase gestuurd." },
  },
  {
    pattern: /Volledige TGC-synchronisatie geslaagd/i,
    update: {
      stage: "verification",
      progress: 96,
      message: "Upload gereed; centrale dashboardstand wordt gecontroleerd.",
    },
  },
];

export function tgcProgressFromLog(line: string): TgcSyncProgressUpdate | null {
  return RULES.find((rule) => rule.pattern.test(line))?.update ?? null;
}

export function sanitizeTgcWorkerError(message: string, secrets: readonly string[] = []): string {
  let safe = message
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const secret of secrets) {
    if (secret) safe = safe.split(secret).join("[afgeschermd]");
  }
  return safe.slice(0, 1_000) || "Onbekende fout tijdens de TGC-import.";
}

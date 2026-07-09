import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Careon Pulse",
  version: packageJson.version,
  copyright: `© ${currentYear}, Careon Group.`,
  meta: {
    title: "Careon Pulse - Zorgdashboard TGC Groep",
    description:
      "Careon Pulse is het medische KPI-dashboard van TGC Groep: signaleringen, patiënten, planning, behandelaren, dossiercontrole, kwaliteit, financieel, HR en databron.",
  },
};

import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

// Enige plek voor de klantnaam in de app-shell. Zolang er één organisatie live
// is blijft dit een constante; bij onboarding van een tweede klant komt de naam
// uit de sessie en hoeft alleen deze export te verdwijnen. Bewust NIET gebruikt
// in publieke metadata — zie APP_CONFIG.meta.
export const APP_TENANT_NAME = "TGC Groep";

export const APP_CONFIG = {
  name: "Careon Pulse",
  version: packageJson.version,
  copyright: `© ${currentYear}, Careon Group.`,
  // Deze twee teksten zijn zonder sessie zichtbaar (documenttitel, OpenGraph-
  // preview bij het delen van een link, PWA-manifest). Ze moeten klantneutraal
  // blijven: de zorgaanbieder achter het platform mag niet uit een gedeelde
  // URL af te leiden zijn.
  meta: {
    title: "Careon Pulse — beveiligd zorgdashboard",
    description:
      "Careon Pulse is een beveiligd KPI-dashboard voor de geestelijke gezondheidszorg. Toegang uitsluitend na inloggen.",
  },
};

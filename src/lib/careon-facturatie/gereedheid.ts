import type { FacturatieInstellingen, FactuurTemplate } from "./types";

export interface FacturatieGereedheid {
  standaardTemplate: FactuurTemplate;
  ontbrekend: string[];
  pdfKlaar: boolean;
  mailKlaar: boolean;
}

function ingevuld(value: string | undefined): boolean {
  return (value ?? "").trim().length > 0;
}

/**
 * Presence-based go-live projection for the settings screen.
 *
 * Definitive issuance still performs the authoritative per-invoice validator;
 * this projection merely tells an administrator what the default template is
 * missing before they start the first invoice.
 */
export function facturatieGereedheid(
  instellingen: FacturatieInstellingen,
  mailBeschikbaar: boolean,
): FacturatieGereedheid {
  const standaardTemplate =
    instellingen.templates.find((template) => template.id === instellingen.standaardTemplateId) ??
    instellingen.templates[0];
  const ontbrekend: string[] = [];

  if (!ingevuld(standaardTemplate.afzender.statutaireNaam)) ontbrekend.push("statutaire naam");
  if (!ingevuld(standaardTemplate.afzender.adresRegel1)) ontbrekend.push("adres");
  if (!ingevuld(standaardTemplate.afzender.postcode)) ontbrekend.push("postcode");
  if (!ingevuld(standaardTemplate.afzender.plaats)) ontbrekend.push("plaats");
  if (!/^\d{8}$/.test(standaardTemplate.afzender.kvkNummer.trim())) ontbrekend.push("KvK-nummer");
  if (!ingevuld(standaardTemplate.bank.iban)) ontbrekend.push("IBAN");
  if (!ingevuld(standaardTemplate.bank.tenaamstelling)) ontbrekend.push("rekeninghouder");
  if (standaardTemplate.btw.standaardTarief !== "vrijgesteld" && !ingevuld(standaardTemplate.afzender.btwId)) {
    ontbrekend.push("btw-identificatienummer");
  }

  return {
    standaardTemplate,
    ontbrekend,
    pdfKlaar: ontbrekend.length === 0,
    mailKlaar: mailBeschikbaar,
  };
}

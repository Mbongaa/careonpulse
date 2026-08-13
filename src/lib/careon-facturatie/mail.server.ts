import { formatEuro } from "./totalen";
import { type Factuur, isEmailAdres } from "./types";

// Fase B (handoff 15 §7): transactionele e-mail via Resend — expliciete
// eigenaarskeuze 13-08-2026, in afwijking van het EU-soevereine voorstel
// (Brevo) uit klantantwoord V17. De afwijking en haar consequenties (VS-
// jurisdictie, DPF/SCC-afhankelijkheid) zijn vastgelegd in blueprint D19;
// de keuze blijft platformbreed (ook HumHub-SMTP, D19) en is bewust in één
// bestand geïsoleerd zodat terugwisselen een kleine ingreep blijft.
//
// FAIL-CLOSED TOT DE DPA: zolang CAREON_MAIL_RESEND_API_KEY of het
// afzenderadres ontbreekt, meldt `mailBeschikbaar()` false en antwoordt de
// verzendroute 503 — er kan dus niets verzonden worden vóór de eigenaar de
// verwerkersovereenkomst (incl. SCC's) heeft gesloten en de sleutels in de
// Vercel-secret-store heeft gezet (go-live-checklist in PRODUCTION_MODE.md).
//
// INHOUDSREGELS (hard, §7): onderwerp en tekst dragen uitsluitend het
// factuurnummer, het totaalbedrag en de vervaldatum — nooit regelteksten,
// cliënt- of behandelinhoud. De pdf gaat mee als bijlage (bytes uit Storage),
// nooit als publieke link. `bouwFactuurMail` is een pure functie zodat
// verify:careon deze regels data-gedreven kan afdwingen.

const RESEND_API_URL = "https://api.resend.com/emails";
const MAIL_TIMEOUT_MS = 15_000;

function env(sleutel: string): string {
  return (process.env[sleutel] ?? "").trim();
}

/** Alle drie vereist; ontbreekt er één, dan is verzending uitgeschakeld. */
export function mailBeschikbaar(): boolean {
  return (
    env("CAREON_MAIL_RESEND_API_KEY").length > 0 &&
    env("CAREON_MAIL_AFZENDER_EMAIL").length > 0 &&
    env("CAREON_MAIL_AFZENDER_NAAM").length > 0
  );
}

export interface FactuurMailInhoud {
  onderwerp: string;
  tekst: string;
}

const DATUM_FORMAT = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long" });

function formatDatum(isoDatum: string | null | undefined): string {
  return isoDatum ? DATUM_FORMAT.format(new Date(`${isoDatum}T00:00:00Z`)) : "—";
}

/**
 * Pure inhoudsopbouw: uitsluitend nummer, bedrag en vervaldatum (+ de
 * afzendernaam en het betaal-IBAN uit de bevroren afzender-snapshot — dat is
 * afzenderdata, geen cliëntdata). Regels/omschrijvingen komen hier bewust
 * nooit in; de details staan in de bijgevoegde pdf.
 */
export function bouwFactuurMail(factuur: Factuur): FactuurMailInhoud {
  const afzenderNaam = (factuur.afzender ? factuur.afzender.statutaireNaam.trim() : "") || "de afzender";
  const soort = factuur.soort === "creditfactuur" ? "creditfactuur" : "factuur";
  const onderwerp =
    `${soort === "creditfactuur" ? "Creditfactuur" : "Factuur"} ${factuur.nummer ?? ""} van ${afzenderNaam}`
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  const regels = [
    "Geachte heer/mevrouw,",
    "",
    `Hierbij ontvangt u ${soort} ${factuur.nummer ?? ""} van ${afzenderNaam}, met een totaalbedrag van ${formatEuro(factuur.totaalCent)}.`,
    factuur.soort === "creditfactuur"
      ? "Deze creditfactuur verrekent een eerder uitgereikte factuur."
      : `De uiterste betaaldatum is ${formatDatum(factuur.vervaldatum)}.`,
    factuur.afzender?.iban && factuur.soort !== "creditfactuur"
      ? `U kunt het bedrag overmaken naar ${factuur.afzender.iban}${factuur.afzender.tenaamstelling ? ` t.n.v. ${factuur.afzender.tenaamstelling}` : ""}, onder vermelding van het factuurnummer.`
      : null,
    "",
    "De volledige factuur vindt u als pdf in de bijlage.",
    "",
    "Met vriendelijke groet,",
    afzenderNaam,
  ].filter((regel): regel is string => regel !== null);
  return { onderwerp, tekst: regels.join("\n") };
}

export interface MailVerzendResultaat {
  ok: boolean;
  providerId?: string;
  foutCode?: string;
  foutTekst?: string;
}

/**
 * Eén verzending via de Resend API. De pdf gaat als base64-bijlage mee;
 * reply-to is het e-mailadres van het afzenderprofiel zodat antwoorden bij
 * de organisatie landen, niet bij het platformdomein.
 */
export async function verstuurFactuurMail(opties: {
  ontvanger: string;
  inhoud: FactuurMailInhoud;
  pdfBytes: ArrayBuffer;
  pdfNaam: string;
  replyTo?: string;
}): Promise<MailVerzendResultaat> {
  if (!mailBeschikbaar()) {
    return { ok: false, foutCode: "not_configured", foutTekst: "E-mailverzending is niet geconfigureerd." };
  }
  // Reply-to komt uit een vrij instellingenveld (sjabloon-e-mail) zonder
  // vormvalidatie; een tikfout daar mag niet élke verzending laten afketsen
  // op een providerweigering — dan liever geen reply-to.
  const replyTo = opties.replyTo && isEmailAdres(opties.replyTo) ? opties.replyTo : undefined;
  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("CAREON_MAIL_RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${env("CAREON_MAIL_AFZENDER_NAAM")} <${env("CAREON_MAIL_AFZENDER_EMAIL")}>`,
        to: [opties.ontvanger],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: opties.inhoud.onderwerp,
        text: opties.inhoud.tekst,
        attachments: [{ filename: opties.pdfNaam, content: Buffer.from(opties.pdfBytes).toString("base64") }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
    });
    if (!response.ok) {
      const tekst = (await response.text()).slice(0, 300);
      console.error("Facturatie: Resend-verzending faalde", response.status, tekst);
      return { ok: false, foutCode: `http_${response.status}`, foutTekst: tekst.slice(0, 500) };
    }
    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { ok: true, providerId: typeof body.id === "string" ? body.id.slice(0, 200) : undefined };
  } catch (error) {
    console.error("Facturatie: Resend onbereikbaar", error);
    return { ok: false, foutCode: "unreachable", foutTekst: "De mailprovider is niet bereikbaar." };
  }
}

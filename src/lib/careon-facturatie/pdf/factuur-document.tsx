import {
  Defs,
  Document as PdfDocument,
  Image as PdfImage,
  LinearGradient as PdfLinearGradient,
  Page as PdfPage,
  Rect as PdfRect,
  Stop as PdfStop,
  Svg as PdfSvg,
  Text as PdfText,
  View as PdfView,
  StyleSheet,
} from "@react-pdf/renderer";

import { btwRegelLabel, formatEuro, isVolledigVrijgesteld, regelBedragCent } from "../totalen";
import type { Factuur } from "../types";
import { WORDMARK_CREDITFACTUUR, WORDMARK_FACTUUR } from "./wordmarks";

// Hét factuurdocument (handoff 15 §5) — 1:1 naar het geïmporteerde ontwerp
// "Factuur Careon Group.dc.html" (claude.ai/design-project 8c721b90): de
// merkgradient (#169bff → #7c4dff → #bf1dff) als topbalk, gradient-wordmark
// en TOTAAL-band (react-pdf-Svg met LinearGradient), twee infokaarten,
// tabel zonder rasterlijnen en de Betaalinformatie-kaart in de voet. Maten
// zijn de ontwerp-pixels × 0,75 (A4: 794 css-px ≙ 595 pt).
// Eén component, twee consumenten: usePDF (preview) en renderToBuffer
// (archief). Importaliassen verplicht (naamsbotsing met lucide/shadcn).
// Presentatieregels bij vrijstelling (§6.2), hard afgedwongen: volledig
// vrijgesteld ⇒ geen btw-regel en geen 0%-regel; nooit een leeg
// "Btw-id"-label. Afwijkingen van het ontwerp, bewust en minimaal (art. 35a):
// afzenderadres onder de KvK-regel (sub e), prestatieperiode in de
// factuurgegevens-kaart (sub g), btw-kolom alléén bij gemengde tarieven
// (sub i) en de vrijstellingstekst onder het totalenblok (sub l).

const GRADIENT: [string, string, string] = ["#169bff", "#7c4dff", "#bf1dff"];
const INKT = "#16203a";
const MUTED = "#6b7694";
const LICHT = "#a7b0c9";
const ZACHT = "#46507a";
const LIJN = "#edf0f7";
const KAART_RAND = "#e3e7f2";
const KAART_BG = "#f8f9fd";
const ACCENT = "#169bff";

const styles = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 9.75, color: INKT, backgroundColor: "#ffffff" },
  inhoud: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    paddingTop: 27,
    paddingHorizontal: 42,
    paddingBottom: 36,
  },
  kop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 18 },
  logo: { height: 88.5, marginTop: -10.5, marginLeft: -7.5, objectFit: "contain" },
  kopMeta: { marginTop: 3, fontSize: 8.6, color: MUTED, textAlign: "right" },
  kaarten: { flexDirection: "row", gap: 16.5, marginTop: 25.5 },
  kaartFlex: { flex: 1 },
  kaart: {
    borderRadius: 9,
    borderWidth: 0.75,
    borderColor: KAART_RAND,
    backgroundColor: KAART_BG,
    paddingVertical: 13.5,
    paddingHorizontal: 15,
    display: "flex",
    flexDirection: "column",
    gap: 5.5,
  },
  kaartTitel: {
    fontSize: 7.9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.95,
    color: ACCENT,
    marginBottom: 2,
  },
  metaRij: { flexDirection: "row", alignItems: "center", gap: 7.5 },
  metaLabel: { width: 82.5, fontSize: 9.4, color: MUTED },
  metaWaarde: { flex: 1, fontSize: 9.75, color: INKT },
  adresRegel: { fontSize: 9.75, lineHeight: 1.45, color: INKT },
  adresSub: { fontSize: 8.6, lineHeight: 1.45, color: MUTED },
  tabelKop: {
    flexDirection: "row",
    gap: 7.5,
    borderBottomWidth: 1.5,
    borderBottomColor: INKT,
    paddingBottom: 6.75,
    marginTop: 22.5,
  },
  tabelKopTekst: { fontSize: 7.9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: MUTED },
  tabelRij: {
    flexDirection: "row",
    gap: 7.5,
    alignItems: "center",
    paddingVertical: 5.25,
    borderBottomWidth: 0.75,
    borderBottomColor: LIJN,
  },
  kolOmschrijving: { flex: 1 },
  kolAantal: { width: 50, textAlign: "right" },
  kolBtw: { width: 46, textAlign: "right" },
  kolBedrag: { width: 67.5, textAlign: "right" },
  regelSub: { fontSize: 8.25, color: LICHT, marginTop: 1.5 },
  totalen: { alignSelf: "flex-end", width: 225, marginTop: 15, display: "flex", flexDirection: "column", gap: 5.25 },
  totaalRij: { flexDirection: "row", justifyContent: "space-between", fontSize: 9.75 },
  vrijstelling: {
    marginTop: 10.5,
    fontSize: 8.25,
    lineHeight: 1.5,
    color: MUTED,
    maxWidth: 340,
    alignSelf: "flex-end",
    textAlign: "right",
  },
  opmerking: { marginTop: 12, fontSize: 9.4, lineHeight: 1.5, color: ZACHT },
  voet: { marginTop: "auto", paddingTop: 18 },
  betaalTekst: { fontSize: 9.4, lineHeight: 1.6, color: ZACHT },
  betaalSterk: { fontWeight: 700, color: INKT },
  voetRij: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 13.5,
    paddingTop: 10.5,
    borderTopWidth: 0.75,
    borderTopColor: LIJN,
  },
  voetTekst: { fontSize: 7.5, textTransform: "uppercase", letterSpacing: 1.5, color: LICHT },
});

const DATUM_FORMAT = new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });

function formatDatum(isoDatum: string | null): string {
  if (!isoDatum) return "—";
  return DATUM_FORMAT.format(new Date(`${isoDatum}T00:00:00Z`));
}

function formatAantal(aantal: number): string {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 3 }).format(aantal);
}

/** Merkgradient-topbalk over de volledige paginabreedte (fixed: elke pagina). */
function GradientBalk() {
  return (
    <PdfSvg fixed width={595.28} height={3.75} viewBox="0 0 595.28 3.75">
      <Defs>
        <PdfLinearGradient id="balk" x1="0" y1="0" x2="1" y2="0">
          <PdfStop offset="0" stopColor={GRADIENT[0]} />
          <PdfStop offset="0.52" stopColor={GRADIENT[1]} />
          <PdfStop offset="1" stopColor={GRADIENT[2]} />
        </PdfLinearGradient>
      </Defs>
      <PdfRect x="0" y="0" width="595.28" height="3.75" fill="url(#balk)" />
    </PdfSvg>
  );
}

/** Gradient-wordmark ("FACTUUR"/"CREDITFACTUUR"), rechts uitgelijnd.
    Gerasterde PNG (wordmarks.ts): react-pdf negeert gradient-fills op
    Svg-tekst stil, dus de wordmark wordt als afbeelding meegeleverd. */
function Wordmark({ titel }: Readonly<{ titel: string }>) {
  const wordmark = titel === "CREDITFACTUUR" ? WORDMARK_CREDITFACTUUR : WORDMARK_FACTUUR;
  const hoogte = titel === "CREDITFACTUUR" ? 14 : 19;
  const breedte = (wordmark.breedte / wordmark.hoogte) * hoogte;
  return <PdfImage src={wordmark.src} style={{ height: hoogte, width: breedte }} />;
}

/** TOTAAL-band met merkgradient (de signatuur van het ontwerp). */
function TotaalBand({ label, bedrag }: Readonly<{ label: string; bedrag: string }>) {
  return (
    <PdfSvg width={225} height={31.5} viewBox="0 0 225 31.5">
      <Defs>
        <PdfLinearGradient id="band" x1="0" y1="0" x2="1" y2="0">
          <PdfStop offset="0" stopColor={GRADIENT[0]} />
          <PdfStop offset="0.6" stopColor={GRADIENT[1]} />
          <PdfStop offset="1" stopColor={GRADIENT[2]} />
        </PdfLinearGradient>
      </Defs>
      <PdfRect x="0" y="0" width="225" height="31.5" rx="7.5" fill="url(#band)" />
      <PdfText
        x="12"
        y="20"
        style={{ fontFamily: "Geist", fontWeight: 700, fontSize: 9.75, letterSpacing: 0.4 }}
        fill="#ffffff"
      >
        {label}
      </PdfText>
      <PdfText
        x="213"
        y="20.75"
        textAnchor="end"
        style={{ fontFamily: "Geist", fontWeight: 700, fontSize: 13.5 }}
        fill="#ffffff"
      >
        {bedrag}
      </PdfText>
    </PdfSvg>
  );
}

/** Btw-kolomtekst per regel (sub i): verlegd (AE) wint van het tarief. */
function btwKolomTekst(regel: Factuur["regels"][number]): string {
  if (regel.btwCategorie === "AE") return "verlegd";
  if (regel.btwTarief === "vrijgesteld") return "vrijgest.";
  return `${regel.btwTarief}%`;
}

export function FactuurDocument({
  factuur,
  logoSrc,
}: Readonly<{
  factuur: Factuur;
  /** Optioneel logo: same-origin URL (preview) of data-URI (server). */
  logoSrc?: string;
}>) {
  const afzender = factuur.afzender;
  const afnemer = factuur.afnemer;
  const volledigVrijgesteld = isVolledigVrijgesteld(factuur.regels);
  // Btw-kolom alléén bij gemengde tarieven: het ontwerp kent één btw-regel in
  // het totalenblok; zodra regels verschillen moet het toegepaste tarief per
  // regel zichtbaar zijn (art. 35a sub i). Op tarief:categorie, zodat ook
  // verlegd (AE) naast 0% (Z) als gemengd telt.
  const tarieven = new Set(factuur.regels.map((regel) => `${regel.btwTarief}:${regel.btwCategorie}`));
  const toonBtwKolom = tarieven.size > 1;
  const titel = factuur.soort === "creditfactuur" ? "CREDITFACTUUR" : "FACTUUR";
  const documentTitel = factuur.soort === "creditfactuur" ? "Creditfactuur" : "Factuur";
  const prestatieperiode =
    factuur.prestatieVan || factuur.prestatieTot
      ? `${formatDatum(factuur.prestatieVan)} t/m ${formatDatum(factuur.prestatieTot)}`
      : "—";
  const kopMetaDelen = [
    afzender?.statutaireNaam,
    afzender?.kvkNummer ? `KvK ${afzender.kvkNummer}` : null,
    afzender?.btwId ? `BTW ${afzender.btwId}` : null,
  ].filter(Boolean);
  const adresDelen = [afzender?.adresRegel1, [afzender?.postcode, afzender?.plaats].filter(Boolean).join("  ")].filter(
    (deel) => typeof deel === "string" && deel.length > 0,
  );
  let voetNaam = "";
  if (afzender) voetNaam = afzender.templateNaam?.trim() ? afzender.templateNaam : afzender.statutaireNaam;
  const vrijgesteldeGrondslag = factuur.btwTotalen
    .filter((totaal) => totaal.tarief === "vrijgesteld")
    .reduce((som, totaal) => som + totaal.grondslagCent, 0);

  return (
    <PdfDocument
      title={factuur.nummer ? `${documentTitel} ${factuur.nummer}` : `${documentTitel} (concept)`}
      author={afzender?.statutaireNaam}
      language="nl"
    >
      <PdfPage size="A4" style={styles.page}>
        <GradientBalk />
        <PdfView style={styles.inhoud}>
          <PdfView style={styles.kop}>
            {logoSrc ? <PdfImage src={logoSrc} style={styles.logo} /> : <PdfView />}
            <PdfView style={{ alignItems: "flex-end" }}>
              <Wordmark titel={titel} />
              {kopMetaDelen.length > 0 ? <PdfText style={styles.kopMeta}>{kopMetaDelen.join(" · ")}</PdfText> : null}
              {adresDelen.length > 0 ? <PdfText style={styles.kopMeta}>{adresDelen.join(" · ")}</PdfText> : null}
              {afzender?.agbCode ? <PdfText style={styles.kopMeta}>AGB {afzender.agbCode}</PdfText> : null}
            </PdfView>
          </PdfView>

          <PdfView style={styles.kaarten}>
            <PdfView style={[styles.kaart, styles.kaartFlex]}>
              <PdfText style={styles.kaartTitel}>Factuurgegevens</PdfText>
              <PdfView style={styles.metaRij}>
                <PdfText style={styles.metaLabel}>Factuurnummer</PdfText>
                <PdfText style={styles.metaWaarde}>{factuur.nummer ?? "Concept"}</PdfText>
              </PdfView>
              <PdfView style={styles.metaRij}>
                <PdfText style={styles.metaLabel}>Factuurdatum</PdfText>
                <PdfText style={styles.metaWaarde}>{formatDatum(factuur.factuurdatum)}</PdfText>
              </PdfView>
              <PdfView style={styles.metaRij}>
                <PdfText style={styles.metaLabel}>Vervaldatum</PdfText>
                <PdfText style={styles.metaWaarde}>{formatDatum(factuur.vervaldatum)}</PdfText>
              </PdfView>
              <PdfView style={styles.metaRij}>
                <PdfText style={styles.metaLabel}>Periode</PdfText>
                <PdfText style={styles.metaWaarde}>{prestatieperiode}</PdfText>
              </PdfView>
              {factuur.uwKenmerk ? (
                <PdfView style={styles.metaRij}>
                  <PdfText style={styles.metaLabel}>Referentie</PdfText>
                  <PdfText style={styles.metaWaarde}>{factuur.uwKenmerk}</PdfText>
                </PdfView>
              ) : null}
              {factuur.orderReferentie ? (
                <PdfView style={styles.metaRij}>
                  <PdfText style={styles.metaLabel}>Ordernummer</PdfText>
                  <PdfText style={styles.metaWaarde}>{factuur.orderReferentie}</PdfText>
                </PdfView>
              ) : null}
            </PdfView>
            <PdfView style={[styles.kaart, styles.kaartFlex]}>
              <PdfText style={styles.kaartTitel}>Factuur aan</PdfText>
              <PdfText style={[styles.adresRegel, { fontWeight: 700 }]}>{afnemer ? afnemer.naam : ""}</PdfText>
              {afnemer?.contactpersoon ? (
                <PdfText style={styles.adresRegel}>t.a.v. {afnemer.contactpersoon}</PdfText>
              ) : null}
              {afnemer?.adresRegel1 ? <PdfText style={styles.adresRegel}>{afnemer.adresRegel1}</PdfText> : null}
              {afnemer?.adresRegel2 ? <PdfText style={styles.adresRegel}>{afnemer.adresRegel2}</PdfText> : null}
              {afnemer?.postcode || afnemer?.plaats ? (
                <PdfText style={styles.adresRegel}>
                  {[afnemer?.postcode, afnemer?.plaats].filter(Boolean).join("  ")}
                </PdfText>
              ) : null}
              {afnemer?.kvkNummer ? <PdfText style={styles.adresSub}>KvK {afnemer.kvkNummer}</PdfText> : null}
              {afnemer?.btwId ? <PdfText style={styles.adresSub}>Btw-id {afnemer.btwId}</PdfText> : null}
            </PdfView>
          </PdfView>

          <PdfView style={styles.tabelKop}>
            <PdfText style={[styles.kolOmschrijving, styles.tabelKopTekst]}>Omschrijving</PdfText>
            <PdfText style={[styles.kolAantal, styles.tabelKopTekst]}>Aantal</PdfText>
            {toonBtwKolom ? <PdfText style={[styles.kolBtw, styles.tabelKopTekst]}>Btw</PdfText> : null}
            <PdfText style={[styles.kolBedrag, styles.tabelKopTekst]}>Prijs</PdfText>
            <PdfText style={[styles.kolBedrag, styles.tabelKopTekst]}>Totaal</PdfText>
          </PdfView>
          {factuur.regels.map((regel) => (
            <PdfView key={regel.id} style={styles.tabelRij} wrap={false}>
              <PdfView style={styles.kolOmschrijving}>
                <PdfText>{regel.omschrijving}</PdfText>
                {regel.code || regel.kortingPct ? (
                  <PdfText style={styles.regelSub}>
                    {[regel.code, regel.kortingPct ? `Korting ${regel.kortingPct}%` : null].filter(Boolean).join(" · ")}
                  </PdfText>
                ) : null}
              </PdfView>
              <PdfText style={styles.kolAantal}>
                {formatAantal(regel.aantal)} {regel.eenheid}
              </PdfText>
              {toonBtwKolom ? (
                <PdfText style={[styles.kolBtw, { fontSize: 8.6, color: MUTED }]}>{btwKolomTekst(regel)}</PdfText>
              ) : null}
              <PdfText style={styles.kolBedrag}>{formatEuro(regel.stukprijsCent)}</PdfText>
              <PdfText style={[styles.kolBedrag, { fontWeight: 700 }]}>{formatEuro(regelBedragCent(regel))}</PdfText>
            </PdfView>
          ))}

          <PdfView style={styles.totalen}>
            {volledigVrijgesteld ? (
              <TotaalBand label="TOTAAL (VRIJGESTELD)" bedrag={formatEuro(factuur.totaalCent)} />
            ) : (
              <>
                <PdfView style={styles.totaalRij}>
                  <PdfText style={{ color: MUTED }}>Subtotaal</PdfText>
                  <PdfText>{formatEuro(factuur.subtotaalCent)}</PdfText>
                </PdfView>
                {factuur.btwTotalen
                  .filter((totaal) => totaal.tarief !== "vrijgesteld")
                  .map((totaal) => (
                    <PdfView key={`${totaal.tarief}-${totaal.categorie}`} style={styles.totaalRij}>
                      {/* Grondslag per tarief in het label (art. 35a sub h). */}
                      <PdfText style={{ color: MUTED }}>{btwRegelLabel(totaal)}</PdfText>
                      <PdfText>{formatEuro(totaal.btwCent)}</PdfText>
                    </PdfView>
                  ))}
                {vrijgesteldeGrondslag !== 0 ? (
                  <PdfView style={styles.totaalRij}>
                    <PdfText style={{ color: MUTED }}>Waarvan vrijgesteld van btw</PdfText>
                    <PdfText>{formatEuro(vrijgesteldeGrondslag)}</PdfText>
                  </PdfView>
                ) : null}
                <TotaalBand label="TOTAAL" bedrag={formatEuro(factuur.totaalCent)} />
              </>
            )}
          </PdfView>
          {factuur.vrijstellingTekst && factuur.regels.some((regel) => regel.btwTarief === "vrijgesteld") ? (
            <PdfText style={styles.vrijstelling}>{factuur.vrijstellingTekst}</PdfText>
          ) : null}
          {factuur.opmerking ? <PdfText style={styles.opmerking}>{factuur.opmerking}</PdfText> : null}

          <PdfView style={styles.voet}>
            <PdfView style={styles.kaart}>
              <PdfText style={styles.kaartTitel}>Betaalinformatie</PdfText>
              {afzender?.betaalinstructie ? (
                <PdfText style={styles.betaalTekst}>{afzender.betaalinstructie}</PdfText>
              ) : null}
              {afzender?.iban ? (
                <PdfText style={styles.betaalTekst}>
                  <PdfText style={styles.betaalSterk}>{afzender.iban}</PdfText>
                  {afzender.tenaamstelling ? ` t.n.v. ${afzender.tenaamstelling}` : ""}
                  {afzender.bic ? ` · BIC ${afzender.bic}` : ""}
                </PdfText>
              ) : null}
              {afzender?.voettekst ? <PdfText style={styles.betaalTekst}>{afzender.voettekst}</PdfText> : null}
            </PdfView>
            <PdfView style={styles.voetRij}>
              <PdfText style={styles.voetTekst}>{voetNaam}</PdfText>
              {afzender?.tagline ? <PdfText style={styles.voetTekst}>{afzender.tagline}</PdfText> : null}
              {afzender?.email ? <PdfText style={styles.voetTekst}>{afzender.email}</PdfText> : null}
            </PdfView>
          </PdfView>
        </PdfView>
      </PdfPage>
    </PdfDocument>
  );
}

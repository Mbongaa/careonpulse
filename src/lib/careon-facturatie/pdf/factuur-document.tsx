import {
  Document as PdfDocument,
  Image as PdfImage,
  Page as PdfPage,
  Text as PdfText,
  View as PdfView,
  StyleSheet,
} from "@react-pdf/renderer";

import { formatEuro, isVolledigVrijgesteld, regelBedragCent } from "../totalen";
import type { Factuur } from "../types";

// Hét factuurdocument (handoff 15 §5): één component met twee consumenten —
// usePDF in de browser-preview (wat u ziet ís de pdf) en renderToBuffer in de
// definitief-route (archief + latere e-mailbijlage). Importaliassen (PdfText
// enz.) zijn verplicht: de exportnamen botsen met lucide/shadcn.
// Presentatieregels bij vrijstelling (§6.2), hard afgedwongen:
//   * volledig vrijgesteld ⇒ géén btw-kolom en géén 0%-regel — subtotaal is
//     het te betalen totaal, met de vrijstellingstekst bij het totalenblok;
//   * nooit een leeg "Btw-nr.:"-label renderen (een volledig vrijgestelde
//     entiteit heeft er mogelijk geen).
// Fonts registreert de aanroeper (fonts.client.ts / fonts.server.ts).

const styles = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 9,
    color: "#1a2233",
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 110,
  },
  kop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 },
  logo: { maxHeight: 40, maxWidth: 160, objectFit: "contain", marginBottom: 6 },
  afzenderNaam: { fontSize: 15, fontWeight: 700 },
  documentTitel: { fontSize: 15, fontWeight: 700, textAlign: "right", textTransform: "uppercase" },
  documentNummer: { fontSize: 10, textAlign: "right", marginTop: 3, color: "#4a5568" },
  adressen: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  adresBlok: { maxWidth: "46%" },
  adresLabel: { fontSize: 7, textTransform: "uppercase", letterSpacing: 0.8, color: "#718096", marginBottom: 4 },
  adresRegel: { lineHeight: 1.45 },
  metaBlok: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginBottom: 18 },
  metaLabel: { fontSize: 7, textTransform: "uppercase", letterSpacing: 0.8, color: "#718096", marginBottom: 2 },
  metaWaarde: { fontSize: 9 },
  tabelKop: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1a2233",
    paddingBottom: 4,
    marginBottom: 2,
  },
  tabelRij: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 4 },
  kolomOmschrijving: { flexGrow: 1, flexShrink: 1, paddingRight: 8 },
  kolomSmal: { width: 52, textAlign: "right" },
  kolomBedrag: { width: 68, textAlign: "right" },
  kolomKopTekst: { fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 },
  regelCode: { color: "#718096", fontSize: 8 },
  totalen: { marginTop: 12, alignSelf: "flex-end", width: 240 },
  totaalRij: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totaalEind: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#1a2233",
    marginTop: 4,
    paddingTop: 5,
    fontWeight: 700,
    fontSize: 11,
  },
  vrijstelling: { marginTop: 14, color: "#4a5568", fontSize: 8, lineHeight: 1.5 },
  opmerking: { marginTop: 12, lineHeight: 1.5 },
  voet: {
    position: "absolute",
    left: 48,
    right: 48,
    bottom: 40,
    borderTopWidth: 0.5,
    borderTopColor: "#cbd5e0",
    paddingTop: 8,
    color: "#4a5568",
    fontSize: 8,
    lineHeight: 1.5,
  },
});

const DATUM_FORMAT = new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });

function formatDatum(isoDatum: string | null): string {
  if (!isoDatum) return "—";
  return DATUM_FORMAT.format(new Date(`${isoDatum}T00:00:00Z`));
}

function formatAantal(aantal: number): string {
  return new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 3 }).format(aantal);
}

function MetaVeld({ label, waarde }: Readonly<{ label: string; waarde: string }>) {
  return (
    <PdfView>
      <PdfText style={styles.metaLabel}>{label}</PdfText>
      <PdfText style={styles.metaWaarde}>{waarde}</PdfText>
    </PdfView>
  );
}

export function FactuurDocument({
  factuur,
  logoSrc,
}: Readonly<{
  factuur: Factuur;
  /** Optioneel organisatielogo: same-origin route-URL (preview) of data-URI (server). */
  logoSrc?: string;
}>) {
  const afzender = factuur.afzender;
  const afnemer = factuur.afnemer;
  const volledigVrijgesteld = isVolledigVrijgesteld(factuur.regels);
  const toonBtwKolom = !volledigVrijgesteld && factuur.regels.length > 0;
  const titel = factuur.soort === "creditfactuur" ? "Creditfactuur" : "Factuur";
  let afzenderNaam = "";
  if (afzender) {
    afzenderNaam = afzender.handelsnaam?.trim() ? afzender.handelsnaam : afzender.statutaireNaam;
  }
  const afnemerNaam = afnemer ? afnemer.naam : "";
  const afzenderStatutair = afzender ? afzender.statutaireNaam : "";
  const afnemerPlaatsregel = [afnemer?.postcode, afnemer?.plaats].filter(Boolean).join("  ");
  const afzenderPlaatsregel = [afzender?.postcode, afzender?.plaats].filter(Boolean).join("  ");
  const prestatieperiode =
    factuur.prestatieVan || factuur.prestatieTot
      ? `${formatDatum(factuur.prestatieVan)} t/m ${formatDatum(factuur.prestatieTot)}`
      : "—";

  return (
    <PdfDocument
      title={factuur.nummer ? `${titel} ${factuur.nummer}` : `${titel} (concept)`}
      author={afzender?.statutaireNaam}
      language="nl"
    >
      <PdfPage size="A4" style={styles.page}>
        <PdfView style={styles.kop}>
          <PdfView>
            {afzender?.toonLogo && logoSrc ? <PdfImage src={logoSrc} style={styles.logo} /> : null}
            <PdfText style={styles.afzenderNaam}>{afzenderNaam}</PdfText>
          </PdfView>
          <PdfView>
            <PdfText style={styles.documentTitel}>{titel}</PdfText>
            <PdfText style={styles.documentNummer}>{factuur.nummer ?? "CONCEPT"}</PdfText>
          </PdfView>
        </PdfView>

        <PdfView style={styles.adressen}>
          <PdfView style={styles.adresBlok}>
            <PdfText style={styles.adresLabel}>Factuur aan</PdfText>
            <PdfText style={[styles.adresRegel, { fontWeight: 700 }]}>{afnemerNaam}</PdfText>
            {afnemer?.contactpersoon ? (
              <PdfText style={styles.adresRegel}>t.a.v. {afnemer.contactpersoon}</PdfText>
            ) : null}
            {afnemer?.adresRegel1 ? <PdfText style={styles.adresRegel}>{afnemer.adresRegel1}</PdfText> : null}
            {afnemer?.adresRegel2 ? <PdfText style={styles.adresRegel}>{afnemer.adresRegel2}</PdfText> : null}
            {afnemerPlaatsregel ? <PdfText style={styles.adresRegel}>{afnemerPlaatsregel}</PdfText> : null}
            {afnemer?.kvkNummer ? <PdfText style={styles.adresRegel}>KvK {afnemer.kvkNummer}</PdfText> : null}
            {afnemer?.btwId ? <PdfText style={styles.adresRegel}>Btw-id {afnemer.btwId}</PdfText> : null}
          </PdfView>
          <PdfView style={[styles.adresBlok, { textAlign: "right" }]}>
            <PdfText style={styles.adresLabel}>Afzender</PdfText>
            <PdfText style={styles.adresRegel}>{afzenderStatutair}</PdfText>
            {afzender?.adresRegel1 ? <PdfText style={styles.adresRegel}>{afzender.adresRegel1}</PdfText> : null}
            {afzender?.adresRegel2 ? <PdfText style={styles.adresRegel}>{afzender.adresRegel2}</PdfText> : null}
            {afzenderPlaatsregel ? <PdfText style={styles.adresRegel}>{afzenderPlaatsregel}</PdfText> : null}
            {afzender?.kvkNummer ? <PdfText style={styles.adresRegel}>KvK {afzender.kvkNummer}</PdfText> : null}
            {afzender?.btwId ? <PdfText style={styles.adresRegel}>Btw-id {afzender.btwId}</PdfText> : null}
            {afzender?.agbCode ? <PdfText style={styles.adresRegel}>AGB {afzender.agbCode}</PdfText> : null}
            {afzender?.email ? <PdfText style={styles.adresRegel}>{afzender.email}</PdfText> : null}
            {afzender?.telefoon ? <PdfText style={styles.adresRegel}>{afzender.telefoon}</PdfText> : null}
          </PdfView>
        </PdfView>

        <PdfView style={styles.metaBlok}>
          <MetaVeld label="Factuurnummer" waarde={factuur.nummer ?? "concept"} />
          <MetaVeld label="Factuurdatum" waarde={formatDatum(factuur.factuurdatum)} />
          <MetaVeld label="Prestatieperiode" waarde={prestatieperiode} />
          <MetaVeld label="Vervaldatum" waarde={formatDatum(factuur.vervaldatum)} />
          {factuur.uwKenmerk ? <MetaVeld label="Uw kenmerk" waarde={factuur.uwKenmerk} /> : null}
          {factuur.orderReferentie ? <MetaVeld label="Ordernummer" waarde={factuur.orderReferentie} /> : null}
        </PdfView>

        <PdfView style={styles.tabelKop}>
          <PdfText style={[styles.kolomOmschrijving, styles.kolomKopTekst]}>Omschrijving</PdfText>
          <PdfText style={[styles.kolomSmal, styles.kolomKopTekst]}>Aantal</PdfText>
          <PdfText style={[styles.kolomSmal, styles.kolomKopTekst]}>Eenheid</PdfText>
          <PdfText style={[styles.kolomBedrag, styles.kolomKopTekst]}>Stukprijs</PdfText>
          {toonBtwKolom ? <PdfText style={[styles.kolomSmal, styles.kolomKopTekst]}>Btw</PdfText> : null}
          <PdfText style={[styles.kolomBedrag, styles.kolomKopTekst]}>Bedrag</PdfText>
        </PdfView>
        {factuur.regels.map((regel) => (
          <PdfView key={regel.id} style={styles.tabelRij} wrap={false}>
            <PdfView style={styles.kolomOmschrijving}>
              <PdfText>{regel.omschrijving}</PdfText>
              {regel.code ? <PdfText style={styles.regelCode}>{regel.code}</PdfText> : null}
              {regel.kortingPct ? <PdfText style={styles.regelCode}>Korting {regel.kortingPct}%</PdfText> : null}
            </PdfView>
            <PdfText style={styles.kolomSmal}>{formatAantal(regel.aantal)}</PdfText>
            <PdfText style={styles.kolomSmal}>{regel.eenheid}</PdfText>
            <PdfText style={styles.kolomBedrag}>{formatEuro(regel.stukprijsCent)}</PdfText>
            {toonBtwKolom ? (
              <PdfText style={styles.kolomSmal}>
                {regel.btwTarief === "vrijgesteld" ? "vrijgesteld" : `${regel.btwTarief}%`}
              </PdfText>
            ) : null}
            <PdfText style={styles.kolomBedrag}>{formatEuro(regelBedragCent(regel))}</PdfText>
          </PdfView>
        ))}

        <PdfView style={styles.totalen}>
          {volledigVrijgesteld ? (
            <PdfView style={styles.totaalEind}>
              <PdfText>Totaal (vrijgesteld van btw)</PdfText>
              <PdfText>{formatEuro(factuur.totaalCent)}</PdfText>
            </PdfView>
          ) : (
            <>
              <PdfView style={styles.totaalRij}>
                <PdfText>Subtotaal excl. btw</PdfText>
                <PdfText>{formatEuro(factuur.subtotaalCent)}</PdfText>
              </PdfView>
              {factuur.btwTotalen
                .filter((totaal) => totaal.tarief !== "vrijgesteld")
                .map((totaal) => (
                  <PdfView key={`${totaal.tarief}-${totaal.categorie}`} style={styles.totaalRij}>
                    <PdfText>
                      {totaal.categorie === "AE" ? "Btw verlegd" : `Btw ${totaal.tarief}%`} over{" "}
                      {formatEuro(totaal.grondslagCent)}
                    </PdfText>
                    <PdfText>{formatEuro(totaal.btwCent)}</PdfText>
                  </PdfView>
                ))}
              {factuur.btwTotalen.some((totaal) => totaal.tarief === "vrijgesteld") ? (
                <PdfView style={styles.totaalRij}>
                  <PdfText>Waarvan vrijgesteld van btw</PdfText>
                  <PdfText>
                    {formatEuro(
                      factuur.btwTotalen
                        .filter((totaal) => totaal.tarief === "vrijgesteld")
                        .reduce((som, totaal) => som + totaal.grondslagCent, 0),
                    )}
                  </PdfText>
                </PdfView>
              ) : null}
              <PdfView style={styles.totaalEind}>
                <PdfText>Totaal</PdfText>
                <PdfText>{formatEuro(factuur.totaalCent)}</PdfText>
              </PdfView>
            </>
          )}
        </PdfView>

        {factuur.vrijstellingTekst && factuur.regels.some((regel) => regel.btwTarief === "vrijgesteld") ? (
          <PdfText style={styles.vrijstelling}>{factuur.vrijstellingTekst}</PdfText>
        ) : null}
        {factuur.opmerking ? <PdfText style={styles.opmerking}>{factuur.opmerking}</PdfText> : null}

        <PdfView style={styles.voet} fixed>
          {afzender?.betaalinstructie ? <PdfText>{afzender.betaalinstructie}</PdfText> : null}
          {afzender?.iban ? (
            <PdfText>
              {[
                `IBAN ${afzender.iban}`,
                afzender.bic ? `BIC ${afzender.bic}` : null,
                afzender.tenaamstelling ? `t.n.v. ${afzender.tenaamstelling}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </PdfText>
          ) : null}
          {afzender?.voettekst ? <PdfText>{afzender.voettekst}</PdfText> : null}
        </PdfView>
      </PdfPage>
    </PdfDocument>
  );
}

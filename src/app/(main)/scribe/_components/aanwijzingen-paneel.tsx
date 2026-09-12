"use client";

import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import type { StaatEnvelop } from "@/lib/careon-scribe/api-contract";
import type { ScribeInstellingen, ScribeTaak, TaakStatus, Waarschuwing } from "@/lib/careon-scribe/types";
import { cn } from "@/lib/utils";

import { BronKnoppen } from "./staat-paneel";
import { TakenPaneel } from "./taken-paneel";

// Paneel C — Klinische aanwijzingen (handoff 20 §7.3).
//
// Het gevaarlijkste deel van deze module, en daarom het strengst begrensd:
//   * "Overweeg te vragen naar" verdwijnt nooit; een besproken item schuift
//     naar grijs met bron, zodat zichtbaar blijft dát het aan de orde kwam.
//   * "Klinische overwegingen" bevat UITSLUITEND wat de behandelaar zelf
//     uitsprak (S10). Er staat geen diagnose, geen risicotaxatie en geen
//     machinale polariteit; de kop zegt expliciet dat de beoordeling van de
//     behandelaar is.
//   * Medicatieveiligheid staat in twee gescheiden groepen: de gecureerde
//     regels uit medicatie-veiligheid.ts (altijd, ook zonder AI) en de
//     AI-signalen, die als ongeverifieerd zijn gemarkeerd. Dat onderscheid mag
//     nooit vervagen — een modelsignaal is geen gecontroleerde interactie.

const AI_SIGNAAL_KOP = "AI-signalen — niet geverifieerd, controleer in het Farmacotherapeutisch Kompas";

/**
 * Niet-wegklikbare eerlijkheidsregel (N6). `controleerMedicatie()` kijkt
 * uitsluitend naar wat in DIT gesprek is uitgesproken; bij een vervolgconsult
 * noemt niemand de hele lijst. "Geen gecontroleerde signalen" leest dan als een
 * geruststelling die de module niet kan geven. De regel verdwijnt pas wanneer
 * de behandelaar de actuele EPD-lijst heeft aangevuld — dezelfde zin staat in
 * de exportkop.
 */
const GEEN_VOLLEDIGE_BEWAKING =
  "Alleen gecontroleerd wat in dit gesprek is genoemd — dit is geen volledige medicatiebewaking.";

function WaarschuwingRegel({
  waarschuwing,
  onBron,
}: Readonly<{ waarschuwing: Waarschuwing; onBron: (bron: number[]) => void }>) {
  return (
    <li className="text-sm">
      {waarschuwing.tekst}
      <BronKnoppen bron={waarschuwing.bron} onBron={onBron} />
    </li>
  );
}

export function AanwijzingenPaneel({
  envelop,
  instellingen,
  taken,
  bewerkbaar,
  epdLijstIngevuld,
  onTaakStatus,
  onBron,
}: Readonly<{
  envelop: StaatEnvelop | null;
  instellingen: ScribeInstellingen;
  taken: ScribeTaak[];
  bewerkbaar: boolean;
  /** Heeft de behandelaar de actuele EPD-lijst aangevuld (N6)? */
  epdLijstIngevuld: boolean;
  onTaakStatus: (taakId: string, status: TaakStatus) => void;
  onBron: (bron: number[]) => void;
}>) {
  // Afgevinkte checklist-items zijn een puur lokale, vrijblijvende notitie:
  // het item blijft in de staat staan en verdwijnt nooit uit het verslagpad.
  const [genegeerd, setGenegeerd] = useState<string[]>([]);
  const staat = envelop?.staat ?? null;
  const regelWaarschuwingen = (staat?.waarschuwingen ?? []).filter((rij) => rij.herkomst === "regel");
  const modelWaarschuwingen = (staat?.waarschuwingen ?? []).filter((rij) => rij.herkomst === "model");
  const overwegingen = (staat?.overwegingen ?? []).filter((rij) => !rij.ingetrokken);
  const deterministisch = envelop === null || envelop.bron !== "ai";

  if (!instellingen.klinischeAanwijzingenAan) {
    return (
      <section aria-label="Klinische aanwijzingen" className="flex min-h-0 flex-col gap-2">
        <h2 className="font-medium text-sm">Aanwijzingen</h2>
        <p className="rounded-lg border p-3 text-muted-foreground text-sm">Uitgeschakeld door de beheerder</p>
      </section>
    );
  }

  return (
    <section aria-label="Klinische aanwijzingen" className="flex min-h-0 flex-col gap-2">
      <h2 className="font-medium text-sm">Aanwijzingen</h2>
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollbaar gebied moet met het toetsenbord bereikbaar zijn (axe scrollable-region-focusable)
        tabIndex={0}
        aria-label="Klinische aanwijzingen"
        className="max-h-[26rem] space-y-4 overflow-y-auto rounded-lg border p-3"
      >
        <div className="space-y-1">
          <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Overweeg te vragen naar</h3>
          {(staat?.ontbrekend ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm italic">Nog geen suggesties.</p>
          ) : (
            <ul className="space-y-1">
              {(staat?.ontbrekend ?? []).map((item) => {
                const uit = genegeerd.includes(item.tekst);
                return (
                  <li key={item.tekst} className="flex items-start gap-2 text-sm">
                    {item.status === "open" ? (
                      <Checkbox
                        className="mt-1"
                        checked={uit}
                        aria-label={`Suggestie negeren: ${item.tekst}`}
                        onCheckedChange={(waarde) =>
                          setGenegeerd((huidig) =>
                            waarde === true ? [...huidig, item.tekst] : huidig.filter((rij) => rij !== item.tekst),
                          )
                        }
                      />
                    ) : null}
                    <span
                      className={cn(
                        item.status === "besproken" && "text-muted-foreground",
                        uit && "text-muted-foreground line-through",
                      )}
                    >
                      {item.tekst}
                      {item.status === "besproken" ? " — besproken" : ""}
                      <BronKnoppen bron={item.bron} onBron={onBron} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-1">
          <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Klinische overwegingen</h3>
          <p className="font-medium text-sm">Beoordeling door behandelaar vereist</p>
          {deterministisch ? (
            <p className="text-muted-foreground text-xs">
              Dit paneel toont uw eigen uitgesproken overwegingen; alleen de AI-analyse voegt signalen toe.
            </p>
          ) : null}
          {overwegingen.length === 0 ? (
            <p className="text-muted-foreground text-sm italic">Nog geen uitgesproken overwegingen.</p>
          ) : (
            <ul className="space-y-1">
              {overwegingen.map((rij) => (
                <li key={rij.tekst} className="text-sm">
                  {rij.tekst}
                  <BronKnoppen bron={rij.bron} onBron={onBron} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Medicatieveiligheid</h3>
          {!instellingen.medicatiecheckAan ? (
            <p className="text-muted-foreground text-sm">Uitgeschakeld door de beheerder</p>
          ) : (
            <>
              {
                <p
                  role="note"
                  className="rounded-md border border-amber-600/40 bg-amber-600/10 px-2 py-1.5 text-amber-900 text-xs dark:text-amber-200"
                >
                  {epdLijstIngevuld
                    ? "Controle beperkt tot de ingevoerde lijst en beschikbare regels — dit is geen volledige medicatiebewaking."
                    : GEEN_VOLLEDIGE_BEWAKING}
                </p>
              }
              <div
                className={cn(
                  "space-y-1 rounded-md border p-2",
                  regelWaarschuwingen.length > 0 && "border-amber-600/40 bg-amber-600/10",
                )}
              >
                <p className="font-medium text-xs">Gecontroleerde medicatieregels</p>
                {regelWaarschuwingen.length === 0 ? (
                  <p className="text-muted-foreground text-sm italic">Geen gecontroleerde signalen.</p>
                ) : (
                  // role="alert" op de wrapper, niet op de <ul>: dat zou de
                  // lijstsemantiek van de <li>-regels overschrijven.
                  <div role="alert" className="text-amber-900 dark:text-amber-200">
                    <ul className="space-y-1">
                      {regelWaarschuwingen.map((waarschuwing) => (
                        <WaarschuwingRegel
                          key={`${waarschuwing.type}-${waarschuwing.tekst}`}
                          waarschuwing={waarschuwing}
                          onBron={onBron}
                        />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="space-y-1 rounded-md border p-2">
                <p className="font-medium text-xs">{AI_SIGNAAL_KOP}</p>
                {modelWaarschuwingen.length === 0 ? (
                  <p className="text-muted-foreground text-sm italic">Geen AI-signalen.</p>
                ) : (
                  <ul className="space-y-1">
                    {modelWaarschuwingen.map((waarschuwing) => (
                      <WaarschuwingRegel
                        key={`${waarschuwing.type}-${waarschuwing.tekst}`}
                        waarschuwing={waarschuwing}
                        onBron={onBron}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div className="space-y-1">
          <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Vervolgacties</h3>
          <TakenPaneel taken={taken} bewerkbaar={bewerkbaar} onStatus={onTaakStatus} onBron={onBron} />
        </div>
      </section>
    </section>
  );
}

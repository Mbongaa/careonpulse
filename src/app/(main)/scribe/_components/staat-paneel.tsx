"use client";

import { useId, useState } from "react";

import { Loader2, RefreshCcw, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ANALYSE_BRON_LABELS } from "@/data/careon/careon-scribe";
import type { StaatEnvelop, StaatFeitInvoer, StaatMutatieActie } from "@/lib/careon-scribe/api-contract";
import { ENGELSE_HANDMATIGE_BEOORDELING } from "@/lib/careon-scribe/deterministisch";
import { VERSLAG_FORMATEN } from "@/lib/careon-scribe/formaten";
import { medicatieRegel, STAAT_LABELS, type StaatSleutel } from "@/lib/careon-scribe/klinische-staat";
import {
  ALLERGIE_AARD,
  type AllergieAard,
  type GespreksContext,
  isStaatCategorie,
  type KlinischeStaat,
  MEDICATIE_GEBRUIK,
  type MedicatieGebruik,
  SCRIBE_LIMITS,
  type StaatCategorie,
} from "@/lib/careon-scribe/types";
import { cn } from "@/lib/utils";

const GESPREKSCONTEXT_TITELS = Object.fromEntries(
  Object.values(VERSLAG_FORMATEN).flatMap((formaat) => formaat.secties.map((sectie) => [sectie.id, sectie.titel])),
);

function groepeerGesprekscontext(context: GespreksContext[]) {
  const secties = new Map<string, Map<string, GespreksContext["citaten"][number]>>();
  for (const groep of context) {
    const citaten = secties.get(groep.sectieId) ?? new Map();
    for (const citaat of groep.citaten) {
      if (!citaten.has(citaat.segmentId)) citaten.set(citaat.segmentId, citaat);
    }
    if (citaten.size > 0) secties.set(groep.sectieId, citaten);
  }
  return [...secties].map(([sectieId, citaten]) => ({
    sectieId,
    citaten: [...citaten.values()].sort((links, rechts) => links.volgnummer - rechts.volgnummer),
  }));
}

// Paneel B — AI-notities (handoff 20 §7.3).
//
// Dit paneel toont de gestructureerde consultstaat, niet een herschreven
// gesprek: het kernprincipe van de eigenaar is "audio → transcriptie →
// gestructureerde feiten → ondersteuning van de redenering", nooit "LLM
// schrijft een verslag". Elk feit draagt zijn herkomst (§n) en die verwijzing
// is klikbaar — de behandelaar kan altijd terug naar wat er letterlijk gezegd
// is.
//
// Ingetrokken feiten blijven doorgehaald staan (S7): een weglating in een
// latere modelpass mag een allergie nooit stil wissen.
//
// De risicocategorieën in `psychisch` dragen bewust geen polariteit (S10):
// daar staat "… besproken — beoordeling behandelaar", nooit "geen suïcidale
// gedachten".
//
// N6/S7 — de behandelaar corrigeert hier zelf:
//   * "Intrekken" per regel haalt een verkeerd geëxtraheerd feit weg zonder de
//     herkomst te wissen (de regel blijft doorgehaald staan);
//   * onder Medicatie en Allergieën staat een toevoegformulier voor wat niet is
//     uitgesproken;
//   * "Actuele medicatie & allergieën uit het EPD" leest een geplakte lijst met
//     dezelfde deterministische extractie als het transcript.
// Elke mutatie draagt `doorBehandelaar: true`; een latere analysepas laat haar
// staan zoals de behandelaar haar achterliet.

/** Wat paneel B toont; ontbrekend, waarschuwingen, acties en overwegingen staan in paneel C. */
const PANEEL_SLEUTELS: StaatSleutel[] = [
  "hoofdklacht",
  "duur",
  "beloop",
  "ernst",
  "symptomen",
  "begeleidendeSymptomen",
  "uitlokkendeFactoren",
  "verlichtendeFactoren",
  "medicatie",
  "allergieen",
  "voorgeschiedenis",
  "familieanamnese",
  "leefstijl",
  "psychisch",
  "metingen",
  "onderzoek",
  "plan",
];

const MEDICATIE_GEBRUIK_LABELS: Record<MedicatieGebruik, string> = {
  huidig: "Huidig gebruik",
  gestopt: "Gestopt",
  voorgesteld: "Voorgesteld",
  onbekend: "Onbekend",
};

const ALLERGIE_AARD_LABELS: Record<AllergieAard, string> = {
  allergie: "Allergie",
  intolerantie: "Intolerantie",
  onbekend: "Onbekend",
};

export type StaatMutatie = (
  categorie: StaatCategorie,
  actie: StaatMutatieActie,
  feit: StaatFeitInvoer,
) => Promise<boolean>;

interface StaatRegel {
  tekst: string;
  /** Sleutel waarop een intrekking matcht: `naam` bij medicatie, anders `tekst`. */
  sleutel: string;
  bron: number[];
  ingetrokken: boolean;
  doorBehandelaar: boolean;
}

function regelsVoor(staat: KlinischeStaat, sleutel: StaatSleutel): StaatRegel[] {
  switch (sleutel) {
    case "hoofdklacht":
    case "duur":
    case "beloop":
    case "ernst":
      return staat[sleutel]
        ? [
            {
              tekst: staat[sleutel] as string,
              sleutel: staat[sleutel] as string,
              bron: [],
              ingetrokken: false,
              doorBehandelaar: false,
            },
          ]
        : [];
    case "medicatie":
      return staat.medicatie.map((rij) => ({
        tekst: medicatieRegel(rij),
        sleutel: rij.naam,
        bron: rij.bron,
        ingetrokken: rij.ingetrokken,
        doorBehandelaar: rij.doorBehandelaar === true,
      }));
    case "allergieen":
      return staat.allergieen.map((rij) => ({
        tekst: `${rij.tekst} (${rij.aard})`,
        sleutel: rij.tekst,
        bron: rij.bron,
        ingetrokken: rij.ingetrokken,
        doorBehandelaar: rij.doorBehandelaar === true,
      }));
    default: {
      const lijst = staat[sleutel];
      if (!Array.isArray(lijst)) return [];
      return (lijst as { tekst: string; bron: number[]; ingetrokken: boolean; doorBehandelaar?: boolean }[]).map(
        (rij) => ({
          tekst: rij.tekst,
          sleutel: rij.tekst,
          bron: rij.bron,
          ingetrokken: rij.ingetrokken,
          doorBehandelaar: rij.doorBehandelaar === true,
        }),
      );
    }
  }
}

export function BronKnoppen({ bron, onBron }: Readonly<{ bron: number[]; onBron: (bron: number[]) => void }>) {
  if (bron.length === 0) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1">
      {bron.map((nummer) => (
        <button
          key={nummer}
          type="button"
          onClick={() => onBron([nummer])}
          aria-label={`Toon transcriptregel ${nummer}`}
          className="rounded border px-1 text-[0.65rem] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
        >
          §{nummer}
        </button>
      ))}
    </span>
  );
}

/** Toevoegformulier voor medicatie en allergieën (N6). */
function ToevoegFormulier({ bezig, onMutatie }: Readonly<{ bezig: boolean; onMutatie: StaatMutatie }>) {
  const naamId = useId();
  const doseringId = useId();
  const gebruikId = useId();
  const allergieId = useId();
  const aardId = useId();

  const [naam, setNaam] = useState("");
  const [dosering, setDosering] = useState("");
  const [gebruik, setGebruik] = useState<MedicatieGebruik>("huidig");
  const [allergie, setAllergie] = useState("");
  const [aard, setAard] = useState<AllergieAard>("allergie");

  const voegMedicatieToe = async () => {
    const schoon = naam.trim();
    if (schoon.length === 0) return;
    const gelukt = await onMutatie("medicatie", "toevoegen", {
      tekst: schoon,
      naam: schoon,
      dosering: dosering.trim().length > 0 ? dosering.trim() : null,
      gebruik,
    });
    if (gelukt) {
      setNaam("");
      setDosering("");
    }
  };

  const voegAllergieToe = async () => {
    const schoon = allergie.trim();
    if (schoon.length === 0) return;
    const gelukt = await onMutatie("allergieen", "toevoegen", { tekst: schoon, aard });
    if (gelukt) setAllergie("");
  };

  return (
    <div className="space-y-3 rounded-md border p-2">
      <p className="font-medium text-xs">Zelf aanvullen</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={naamId} className="text-muted-foreground text-xs">
            Middel
          </Label>
          <Input
            id={naamId}
            value={naam}
            onChange={(gebeurtenis) => setNaam(gebeurtenis.target.value)}
            maxLength={SCRIBE_LIMITS.feitTekst}
            placeholder="Bijv. sertraline"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={doseringId} className="text-muted-foreground text-xs">
            Dosering
          </Label>
          <Input
            id={doseringId}
            value={dosering}
            onChange={(gebeurtenis) => setDosering(gebeurtenis.target.value)}
            maxLength={SCRIBE_LIMITS.feitTekst}
            placeholder="Bijv. 50 mg"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={gebruikId} className="text-muted-foreground text-xs">
            Gebruik
          </Label>
          <NativeSelect
            id={gebruikId}
            className="w-full"
            value={gebruik}
            onChange={(gebeurtenis) => setGebruik(gebeurtenis.target.value as MedicatieGebruik)}
          >
            {MEDICATIE_GEBRUIK.map((waarde) => (
              <NativeSelectOption key={waarde} value={waarde}>
                {MEDICATIE_GEBRUIK_LABELS[waarde]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={bezig || naam.trim().length === 0}
        onClick={() => void voegMedicatieToe()}
      >
        Medicatie toevoegen
      </Button>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={allergieId} className="text-muted-foreground text-xs">
            Allergie of intolerantie
          </Label>
          <Input
            id={allergieId}
            value={allergie}
            onChange={(gebeurtenis) => setAllergie(gebeurtenis.target.value)}
            maxLength={SCRIBE_LIMITS.feitTekst}
            placeholder="Bijv. amoxicilline"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={aardId} className="text-muted-foreground text-xs">
            Aard
          </Label>
          <NativeSelect
            id={aardId}
            className="w-full"
            value={aard}
            onChange={(gebeurtenis) => setAard(gebeurtenis.target.value as AllergieAard)}
          >
            {ALLERGIE_AARD.map((waarde) => (
              <NativeSelectOption key={waarde} value={waarde}>
                {ALLERGIE_AARD_LABELS[waarde]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={bezig || allergie.trim().length === 0}
        onClick={() => void voegAllergieToe()}
      >
        Allergie toevoegen
      </Button>
    </div>
  );
}

/** Plakveld voor de actuele EPD-lijst (N6). */
function EpdLijstVeld({
  bezig,
  ingevuld,
  onEpdLijst,
  onBeoordeeld,
}: Readonly<{
  bezig: boolean;
  ingevuld: boolean;
  onEpdLijst: (tekst: string) => Promise<boolean>;
  onBeoordeeld: () => Promise<boolean>;
}>) {
  const veldId = useId();
  const beoordelingId = useId();
  const [tekst, setTekst] = useState("");
  const [open, setOpen] = useState(false);

  const verwerk = async () => {
    const schoon = tekst.trim();
    if (schoon.length === 0) return;
    const gelukt = await onEpdLijst(schoon);
    if (gelukt) {
      setTekst("");
      setOpen(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={veldId} className="font-medium text-xs">
          Actuele medicatie &amp; allergieën uit het EPD
        </Label>
        {ingevuld ? (
          <Badge variant="outline" className="text-xs">
            Beoordeeld
          </Badge>
        ) : null}
      </div>
      {open ? (
        <>
          <Textarea
            id={veldId}
            value={tekst}
            onChange={(gebeurtenis) => setTekst(gebeurtenis.target.value)}
            rows={4}
            maxLength={SCRIBE_LIMITS.sectieTekst}
            placeholder="Plak hier de actuele medicatie- en allergielijst uit het EPD; één regel per middel."
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={bezig || tekst.trim().length === 0}
              onClick={() => void verwerk()}
            >
              Lijst overnemen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Annuleren
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          EPD-lijst plakken
        </Button>
      )}
      <div className="flex items-start gap-2">
        <Checkbox
          id={beoordelingId}
          checked={ingevuld}
          disabled={bezig || ingevuld}
          onCheckedChange={(value) => {
            if (value === true) void onBeoordeeld();
          }}
        />
        <Label htmlFor={beoordelingId} className="font-normal text-xs">
          Ik heb de actuele medicatie- en allergielijst uit het EPD gecontroleerd, inclusief ontbrekende middelen.
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">
        De lijst blijft in dit consult; Careon haalt niets uit het EPD op en schrijft er niets naartoe.
      </p>
    </div>
  );
}

export function StaatPaneel({
  envelop,
  bezig,
  bewerkbaar,
  epdLijstIngevuld,
  onAnalyse,
  onBron,
  onMutatie,
  onEpdLijst,
  onEpdBeoordeeld,
}: Readonly<{
  envelop: StaatEnvelop | null;
  bezig: boolean;
  bewerkbaar: boolean;
  epdLijstIngevuld: boolean;
  onAnalyse: () => void;
  onBron: (bron: number[]) => void;
  onMutatie: StaatMutatie;
  onEpdLijst: (tekst: string) => Promise<boolean>;
  onEpdBeoordeeld: () => Promise<boolean>;
}>) {
  const staat = envelop?.staat ?? null;
  const verouderd = envelop?.verouderd === true;
  const gesprekscontext = groepeerGesprekscontext(staat?.gesprekscontext ?? []);
  const citaatAantal = gesprekscontext.reduce((aantal, groep) => aantal + groep.citaten.length, 0);
  // Een oudere terugvalmelding kan bij het samenvoegen met AI-notities blijven
  // staan. Alleen die exacte statusmelding vervalt; consultinhoud blijft zichtbaar.
  const samenvatting =
    envelop?.bron === "ai" && staat?.samenvatting === ENGELSE_HANDMATIGE_BEOORDELING ? "" : (staat?.samenvatting ?? "");
  const geenOnderbouwdeInformatie =
    staat !== null &&
    envelop?.bron === "ai" &&
    !PANEEL_SLEUTELS.some((sleutel) => regelsVoor(staat, sleutel).some((regel) => !regel.ingetrokken)) &&
    !staat.overwegingen.some((regel) => !regel.ingetrokken) &&
    !staat.acties.some((regel) => !regel.ingetrokken);

  return (
    <section aria-label="AI-notities" className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-sm">Notities</h2>
        <span className="flex items-center gap-2">
          <Badge variant="outline" className={cn("text-xs", verouderd && "opacity-50")}>
            {envelop ? ANALYSE_BRON_LABELS[envelop.bron] : "Nog geen analyse"}
          </Badge>
          <Button size="sm" variant="outline" disabled={bezig} onClick={onAnalyse}>
            {bezig ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
            {verouderd ? "Opnieuw analyseren" : "Nu analyseren"}
          </Button>
        </span>
      </div>

      {verouderd ? (
        <p role="alert" className="text-amber-700 text-xs dark:text-amber-400">
          Analyse verouderd sinds uw correctie — opnieuw analyseren voordat u het verslag opstelt.
        </p>
      ) : null}

      {geenOnderbouwdeInformatie ? (
        <p role="alert" className="text-amber-700 text-xs dark:text-amber-400">
          {citaatAantal > 0
            ? `Er zijn nog geen onderbouwde klinische feiten vastgelegd. Er zijn wel ${citaatAantal} gesprekscitaten beschikbaar om te controleren. Controleer spreker en betekenis voordat u notities overneemt.`
            : "De AI-analyse heeft nog geen onderbouwde consultinformatie opgeleverd. Controleer het transcript en vul de notities handmatig aan. Een lege rubriek betekent niet dat het onderwerp niet is besproken."}
        </p>
      ) : null}

      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollbaar gebied moet met het toetsenbord bereikbaar zijn (axe scrollable-region-focusable)
        tabIndex={0}
        aria-label="AI-notities"
        className="max-h-[26rem] overflow-y-auto rounded-lg border p-3"
      >
        {!staat ? (
          <p className="text-muted-foreground text-sm">
            Nog geen analyse. Zodra er transcript is, verschijnt hier de gestructureerde consultstaat.
          </p>
        ) : (
          <div className="space-y-3">
            {samenvatting.trim().length > 0 ? (
              <p className="rounded-md bg-muted/60 p-2 text-sm">{samenvatting}</p>
            ) : null}
            {citaatAantal > 0 ? (
              <section aria-label="Gesprekscitaten — nog controleren" className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium text-sm">Gesprekscitaten — nog controleren</h3>
                  <Badge variant="outline" className="text-xs">
                    {citaatAantal} {citaatAantal === 1 ? "citaat" : "citaten"}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  Spreker en betekenis nog niet bevestigd. Controleer het transcript voordat u dit overneemt.
                </p>
                {gesprekscontext.map((groep) => (
                  <details key={groep.sectieId} open={groep.citaten.length <= 3} className="rounded-md border p-2">
                    <summary className="cursor-pointer text-sm">
                      {GESPREKSCONTEXT_TITELS[groep.sectieId] ?? "Gesprekscontext"}{" "}
                      <span className="text-muted-foreground text-xs">
                        ({groep.citaten.length} {groep.citaten.length === 1 ? "citaat" : "citaten"})
                      </span>
                    </summary>
                    <ul className="mt-2 space-y-3">
                      {groep.citaten.map((citaat) => (
                        <li key={`${citaat.segmentId}-${citaat.volgnummer}`} className="space-y-1">
                          <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-2 text-sm">
                            {citaat.tekst}
                          </blockquote>
                          <BronKnoppen bron={[citaat.volgnummer]} onBron={onBron} />
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </section>
            ) : null}
            <dl className="space-y-2">
              {PANEEL_SLEUTELS.map((sleutel) => {
                const regels = regelsVoor(staat, sleutel);
                const categorie = isStaatCategorie(sleutel) ? sleutel : null;
                return (
                  <div key={sleutel} className="grid gap-0.5">
                    <dt className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      {STAAT_LABELS[sleutel]}
                    </dt>
                    <dd className="text-sm">
                      {regels.length === 0 ? (
                        <span className="text-muted-foreground italic">
                          Geen informatie vastgelegd — controleer het transcript
                        </span>
                      ) : (
                        <ul className="space-y-0.5">
                          {regels.map((regel) => (
                            <li
                              key={`${sleutel}-${regel.tekst}`}
                              className={cn(regel.ingetrokken && "text-muted-foreground line-through")}
                            >
                              {regel.tekst}
                              <BronKnoppen bron={regel.bron} onBron={onBron} />
                              {regel.doorBehandelaar && !regel.ingetrokken ? (
                                <Badge variant="outline" className="ml-1 text-[0.65rem]">
                                  Zelf aangevuld
                                </Badge>
                              ) : null}
                              {bewerkbaar && categorie && !regel.ingetrokken ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="ml-1 h-5 px-1.5 text-muted-foreground text-xs"
                                  aria-label={`Intrekken: ${regel.tekst}`}
                                  disabled={bezig}
                                  onClick={() =>
                                    void onMutatie(categorie, "intrekken", {
                                      tekst: regel.sleutel,
                                      naam: categorie === "medicatie" ? regel.sleutel : undefined,
                                      omschrijving: categorie === "acties" ? regel.sleutel : undefined,
                                    })
                                  }
                                >
                                  <Undo2 className="size-3" />
                                  Intrekken
                                </Button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </dd>
                    {bewerkbaar && sleutel === "allergieen" ? (
                      // Een tweede <dd> (geen <div>): axe' definition-list-regel staat
                      // in een <dl>-groep uitsluitend dt/dd toe.
                      <dd className="mt-2 space-y-2">
                        <ToevoegFormulier bezig={bezig} onMutatie={onMutatie} />
                        <EpdLijstVeld
                          bezig={bezig}
                          ingevuld={epdLijstIngevuld}
                          onEpdLijst={onEpdLijst}
                          onBeoordeeld={onEpdBeoordeeld}
                        />
                      </dd>
                    ) : null}
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </section>
    </section>
  );
}

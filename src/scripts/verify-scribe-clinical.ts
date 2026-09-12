// Behavioral regressions for audit C01–C09. Synthetic fixtures only. This
// suite never contacts a provider: fetch is intercepted before every AI call.
import { analyseerSegmenten, genereerVerslag, valideerModelStaat } from "../lib/careon-scribe/agent.server";
import {
  bouwVerslagDeterministisch,
  deterministischeRonde,
  ENGELSE_HANDMATIGE_BEOORDELING,
  extraheerDeterministisch,
  normaliseerRisicopolariteit,
  rondStaatAf,
} from "../lib/careon-scribe/deterministisch";
import { heranalyseStartStaat, legeKlinischeStaat, mergeKlinischeStaat } from "../lib/careon-scribe/klinische-staat";
import { controleerMedicatie } from "../lib/careon-scribe/medicatie-veiligheid";
import type { Feit, KlinischeStaat, Medicatie, ScribeSegment, ScribeTaal, Spreker } from "../lib/careon-scribe/types";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}
function equal(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok);
  if (!ok) console.error(JSON.stringify({ actual, expected }));
}
function segment(tekst: string, spreker: Spreker = "patient", volgnummer = 1): ScribeSegment {
  return {
    id: `synthetic-${volgnummer}`,
    volgnummer,
    tekst,
    spreker,
    tekstGecorrigeerd: null,
    correctieBron: null,
    beginMs: 0,
    eindMs: 8000,
    bron: "handmatig",
    createdAt: "2026-09-10T00:00:00Z",
  };
}
function extract(tekst: string, spreker: Spreker = "patient", taal: ScribeTaal = "nl"): KlinischeStaat {
  return extraheerDeterministisch([segment(tekst, spreker)], "soap", taal);
}
function medicine(naam: string, dosering: string | null = null, bron: number[] = [1]): Medicatie {
  return {
    naam,
    dosering,
    gebruik: "huidig",
    tekst: `${naam}${dosering ? ` ${dosering}` : ""}`,
    bron,
    ingetrokken: false,
  };
}
function fact(tekst: string, bron = [1]): Feit {
  return { tekst, bron, ingetrokken: false };
}

function checkExtraction(): void {
  for (const [tekst, expected] of [
    [
      "Ik gebruik sertraline 50 mg en tramadol 100 mg.",
      [
        ["sertraline", "50 mg"],
        ["tramadol", "100 mg"],
      ],
    ],
    [
      "Ik gebruik tramadol 100 mg en sertraline 50 mg.",
      [
        ["tramadol", "100 mg"],
        ["sertraline", "50 mg"],
      ],
    ],
    [
      "Ik gebruik 50 mg sertraline en 100 mg tramadol.",
      [
        ["sertraline", "50 mg"],
        ["tramadol", "100 mg"],
      ],
    ],
    [
      "Ik gebruik lorazepam 0,5 mg en sertraline 12.5 mg.",
      [
        ["lorazepam", "0.5 mg"],
        ["sertraline", "12.5 mg"],
      ],
    ],
    [
      "Ik gebruik sertraline en tramadol 100 mg.",
      [
        ["sertraline", null],
        ["tramadol", "100 mg"],
      ],
    ],
    [
      "Ik gebruik sertraline vijftig milligram en tramadol honderd milligram.",
      [
        ["sertraline", "50 mg"],
        ["tramadol", "100 mg"],
      ],
    ],
  ] as const)
    equal(
      `C01 dose binding: ${tekst}`,
      extract(tekst).medicatie.map((rij) => [rij.naam, rij.dosering]),
      expected,
    );
  equal(
    "C01 hypothetical dosage is not current",
    extract("Als ik sertraline 50 mg zou gebruiken.").medicatie.map((rij) => rij.gebruik),
    ["onbekend"],
  );
  equal(
    "C01 proposed change remains proposed",
    extract("Ik wil sertraline ophogen naar 100 mg.", "arts").medicatie.map((rij) => [rij.gebruik, rij.dosering]),
    [["voorgesteld", "100 mg"]],
  );

  for (const tekst of [
    "Ik slaap goed en mijn eetlust is normaal.",
    "Ik slaap prima.",
    "Mijn eetlust is goed.",
    "Ik ben aangekomen.",
  ])
    equal(`C02 normal topic is not pathology: ${tekst}`, extract(tekst).symptomen, []);
  check(
    "C02 actual sleep complaint retained",
    extract("Ik slaap slecht.").symptomen.some((rij) => rij.tekst === "slaapproblemen"),
  );
  check(
    "C02 actual reduced appetite retained",
    extract("Mijn eetlust is verminderd.").symptomen.some((rij) => rij.tekst === "verminderde eetlust"),
  );
  check(
    "C02 no appetite is an actual complaint",
    extract("Ik heb geen eetlust.").symptomen.some((rij) => rij.tekst === "verminderde eetlust"),
  );
  equal(
    "C02 ordinary symptom negation retained",
    extract("Ik heb geen hoofdpijn.").symptomen.map((rij) => rij.tekst),
    ["hoofdpijn: ontkend"],
  );

  for (const tekst of [
    "Bent u allergisch voor penicilline?",
    "Bent u sinds drie maanden ernstig somber?",
    "Heeft u eerder bloedonderzoek gehad?",
    "Is uw bloeddruk 120/80?",
    "Drinkt u vier glazen alcohol?",
    "Ik vraag geen bloedonderzoek aan.",
    "U had eerder bloedonderzoek.",
    "Misschien bloedonderzoek aanvragen.",
    "Als we bloedonderzoek zouden doen.",
  ]) {
    const staat = extract(tekst, "arts");
    check(
      `C03 no invented assertions: ${tekst}`,
      staat.allergieen.length === 0 &&
        staat.hoofdklacht === null &&
        staat.duur === null &&
        staat.ernst === null &&
        staat.metingen.length === 0 &&
        staat.plan.length === 0 &&
        staat.acties.length === 0,
    );
    check(`C03 no asserted lifestyle amount: ${tekst}`, !staat.leefstijl.some((rij) => /vier glazen/.test(rij.tekst)));
  }
  check(
    "C03 a confirmed allergy remains",
    extract("Ik ben allergisch voor penicilline.").allergieen.some((rij) => rij.aard === "allergie"),
  );
  check(
    "C03 actual future lab request retained",
    extract("Ik vraag bloedonderzoek aan.", "arts").acties.some((rij) => rij.soort === "lab"),
  );
  check(
    "C03 historical patient illness is not a current complaint",
    extract("Vroeger was ik somber.").hoofdklacht === null,
  );
  check(
    "C03 question followed by statement is classified separately",
    extract("Bent u somber? Ik vraag bloedonderzoek aan.", "arts").acties.length === 1,
  );

  const family = extract("Mijn moeder is depressief en gebruikt sertraline 100 mg.");
  check(
    "C04 family context does not become patient's medication or symptoms",
    family.medicatie.length === 0 && family.symptomen.length === 0 && family.hoofdklacht === null,
  );
  check(
    "C04 family history retained in the draft",
    bouwVerslagDeterministisch(family, [], "soap")[0].tekst.includes("Mijn moeder"),
  );
  equal(
    "C04 explicit subject change retains patient's medicine",
    extract("Mijn moeder gebruikt sertraline en ik gebruik tramadol 100 mg.").medicatie.map((rij) => rij.naam),
    ["tramadol"],
  );
  equal(
    "C04 reverse subject change does not contaminate own medicine",
    extract("Ik gebruik sertraline 50 mg en mijn moeder gebruikt tramadol.").medicatie.map((rij) => rij.naam),
    ["sertraline"],
  );

  for (const tekst of [
    "I do not take tramadol.",
    "I am allergic to amoxicillin. I have felt depressed for three months.",
  ]) {
    const staat = extract(tekst, "patient", "en");
    check(
      "C05 English fallback does not invent facts",
      staat.medicatie.length === 0 && staat.allergieen.length === 0 && staat.hoofdklacht === null,
    );
    check("C05 English fallback is explicit", staat.samenvatting === ENGELSE_HANDMATIGE_BEOORDELING);
    const report = bouwVerslagDeterministisch(staat, [segment(tekst)], "soap", "en");
    check(
      "C05 every English fallback section requires manual entry",
      report.every((rij) => rij.vereistBehandelaar && rij.tekst === "" && rij.status === "leeg"),
    );
    check(
      "C05 unprocessed English is never reported as not discussed",
      report.every(
        (rij) =>
          rij.conceptTekst.includes(ENGELSE_HANDMATIGE_BEOORDELING) && !rij.conceptTekst.includes("Niet besproken"),
      ),
    );
  }
  const final = { ...segment("Ik vraag bloedonderzoek aan.", "onbekend"), bron: "live" as const };
  const round = deterministischeRonde([final], [final], "soap", legeKlinischeStaat());
  equal("C06 final fragment role assignment applied before extraction", round.sprekers, [
    { volgnummer: 1, spreker: "arts" },
  ]);
  check(
    "C06 final plan exists without another fragment",
    round.staat.acties.some((rij) => rij.soort === "lab"),
  );
  const typo = segment("Ik gebruik sertaline en tramadal.", "onbekend");
  const corrected = deterministischeRonde([typo], [typo], "soap", legeKlinischeStaat());
  equal(
    "C06 corrected names used in same round",
    corrected.staat.medicatie.map((rij) => rij.naam),
    ["sertraline", "tramadol"],
  );
  check(
    "C06 same-round safety rule sees corrected names",
    corrected.staat.waarschuwingen.some((rij) => rij.type === "interactie"),
  );
  equal("C06 input transcript is not mutated", typo.tekstGecorrigeerd, null);

  const original = [
    segment("Ik gebruik lithium 900 mg."),
    segment("Ik ben allergisch voor amoxicilline.", "patient", 2),
    segment("Ik gebruik amoxicilline 500 mg.", "patient", 3),
  ];
  const previous = extraheerDeterministisch(original, "soap");
  const eigen = { ...fact("Eigen klinische beoordeling blijft bewaard.", []), doorBehandelaar: true };
  previous.onderzoek.push(eigen);
  const changed = original.map((rij, index) => ({
    ...rij,
    tekstGecorrigeerd: ["Ik gebruik sertraline 50 mg.", "Mijn moeder is allergisch voor amoxicilline.", "Dank u."][
      index
    ],
    correctieBron: "behandelaar" as const,
  }));
  const rebuilt = deterministischeRonde(changed, changed, "soap", heranalyseStartStaat(previous)).staat;
  equal(
    "C06 correction rebuild replaces removed medication",
    rebuilt.medicatie.map((rij) => [rij.naam, rij.dosering]),
    [["sertraline", "50 mg"]],
  );
  equal("C06 correction rebuild removes a wrongly attributed allergy", rebuilt.allergieen, []);
  equal("C06 correction rebuild removes obsolete medication alarms", rebuilt.waarschuwingen, []);
  equal(
    "C06 correction rebuild preserves clinician fact",
    rebuilt.onderzoek.find((rij) => rij.doorBehandelaar),
    eigen,
  );
  check("C06 corrected family statement survives rebuild", rebuilt.familieanamnese.length === 1);
  const doseChange = [
    { ...original[0], tekstGecorrigeerd: "Ik gebruik lithium 450 mg.", correctieBron: "behandelaar" as const },
  ];
  const newDose = deterministischeRonde(doseChange, doseChange, "soap", heranalyseStartStaat(previous)).staat;
  equal(
    "C06 corrected dose does not retain obsolete competing dose",
    newDose.medicatie[0]?.doseringen?.map((rij) => rij.waarde),
    ["450 mg"],
  );
  const aiOnly = { ...legeKlinischeStaat(), medicatie: [medicine("syntheticdrug", "5 mg")] };
  const addition = segment("Ik heb hoofdpijn.", "patient", 2);
  const appended = deterministischeRonde([addition], [addition], "soap", aiOnly).staat;
  equal(
    "C06 ordinary append preserves earlier supported AI-only medicine",
    appended.medicatie[0]?.naam,
    "syntheticdrug",
  );
}

function checkProvenanceAndOwnership(): void {
  const headache = segment("Ik heb hoofdpijn.");
  for (const bron of [[], [0], [999], [1]]) {
    const state = { ...legeKlinischeStaat(), medicatie: [medicine("lithium", "900 mg", bron)] };
    equal(
      `C07 unsupported medicine rejected even with valid-looking source ${bron}`,
      valideerModelStaat(state, [headache], legeKlinischeStaat(), "soap", "nl").medicatie,
      [],
    );
  }
  const prescription = segment("Ik gebruik sertraline 50 mg.");
  const valid = { ...legeKlinischeStaat(), medicatie: [medicine("sertraline", "50 mg")] };
  equal(
    "C07 actual supported medicine accepted",
    valideerModelStaat(valid, [prescription], legeKlinischeStaat(), "soap", "nl").medicatie.length,
    1,
  );
  equal(
    "C07 wrong dose rejected despite correct medicine citation",
    valideerModelStaat(
      { ...valid, medicatie: [medicine("sertraline", "500 mg")] },
      [prescription],
      legeKlinischeStaat(),
      "soap",
      "nl",
    ).medicatie.length,
    0,
  );
  equal(
    "C07 correct dose does not validate invented medicine narrative",
    valideerModelStaat(
      { ...valid, medicatie: [{ ...valid.medicatie[0], tekst: "sertraline 50 mg veroorzaakt ernstig hartfalen" }] },
      [prescription],
      legeKlinischeStaat(),
      "soap",
      "nl",
    ).medicatie,
    [],
  );
  const stoppedQuote = segment("Ik ben gestopt met sertraline.");
  equal(
    "C07 literal cessation cannot be labeled current by the model",
    valideerModelStaat(
      { ...valid, medicatie: [{ ...medicine("sertraline"), tekst: stoppedQuote.tekst }] },
      [stoppedQuote],
      legeKlinischeStaat(),
      "soap",
      "nl",
    ).medicatie,
    [],
  );
  const oldPlan = segment("U had eerder bloedonderzoek.", "arts");
  equal(
    "C07 historical literal statement cannot become a future plan",
    valideerModelStaat(
      { ...legeKlinischeStaat(), plan: [fact(oldPlan.tekst)] },
      [oldPlan],
      legeKlinischeStaat(),
      "soap",
      "nl",
    ).plan,
    [],
  );
  const englishMedicine = { ...segment("I take sertraline 50 mg."), sprekerBron: "behandelaar" as const };
  equal(
    "C07 supported English model medicine remains available",
    valideerModelStaat(
      { ...valid, medicatie: [{ ...medicine("sertraline", "50 mg"), tekst: englishMedicine.tekst }] },
      [englishMedicine],
      legeKlinischeStaat(),
      "soap",
      "en",
    ).medicatie.length,
    1,
  );
  const spoofed = { ...valid, medicatie: [{ ...valid.medicatie[0], doorBehandelaar: true }] };
  check(
    "C07 model cannot spoof clinician ownership",
    valideerModelStaat(spoofed, [prescription], legeKlinischeStaat(), "soap", "nl").medicatie[0]?.doorBehandelaar !==
      true,
  );
  const denied = segment("Ik heb geen hoofdpijn.");
  const asserted = { ...legeKlinischeStaat(), symptomen: [fact("hoofdpijn")] };
  equal(
    "C07 positive claim cannot cite a negative statement",
    valideerModelStaat(asserted, [denied], legeKlinischeStaat(), "soap", "nl").symptomen,
    [],
  );
  equal(
    "C07 doctor consideration cannot cite patient speech",
    valideerModelStaat(
      { ...legeKlinischeStaat(), overwegingen: [fact(headache.tekst)] },
      [headache],
      legeKlinischeStaat(),
      "soap",
      "nl",
    ).overwegingen,
    [],
  );
  const lab = segment("Ik vraag bloedonderzoek aan.", "arts");
  const correctAction = { ...fact(lab.tekst), omschrijving: lab.tekst, soort: "lab" as const };
  equal(
    "C07 a fully supported task is retained",
    valideerModelStaat({ ...legeKlinischeStaat(), acties: [correctAction] }, [lab], legeKlinischeStaat(), "soap", "nl")
      .acties.length,
    1,
  );
  equal(
    "C07 a cited task cannot carry an invented task description",
    valideerModelStaat(
      { ...legeKlinischeStaat(), acties: [{ ...correctAction, omschrijving: "Stop alle medicatie onmiddellijk." }] },
      [lab],
      legeKlinischeStaat(),
      "soap",
      "nl",
    ).acties,
    [],
  );
  equal(
    "C07 a cited task cannot carry a different task kind",
    valideerModelStaat(
      { ...legeKlinischeStaat(), acties: [{ ...correctAction, soort: "medicatie" }] },
      [lab],
      legeKlinischeStaat(),
      "soap",
      "nl",
    ).acties,
    [],
  );
  equal(
    "C07 a literal statement cannot invent a risk category",
    valideerModelStaat(
      { ...legeKlinischeStaat(), psychisch: [{ ...fact(headache.tekst), categorie: "suicidaliteit" }] },
      [headache],
      legeKlinischeStaat(),
      "soap",
      "nl",
    ).psychisch,
    [],
  );

  const risk = "Geen suïcidaliteit";
  const modelState = {
    ...legeKlinischeStaat(),
    hoofdklacht: risk,
    duur: risk,
    beloop: risk,
    ernst: risk,
    uitlokkendeFactoren: [fact(risk)],
    verlichtendeFactoren: [fact(risk)],
    leefstijl: [{ ...fact(risk), categorie: "risico" }],
    metingen: [fact(risk)],
    acties: [{ ...fact(risk), omschrijving: risk, soort: "overig" as const }],
  };
  const normalized = normaliseerRisicopolariteit(modelState);
  check(
    "C08 every machine scalar is normalized",
    [normalized.hoofdklacht, normalized.duur, normalized.beloop, normalized.ernst].every(
      (rij) => !rij?.includes("Geen"),
    ),
  );
  check("C08 previously omitted machine fields are normalized", !JSON.stringify(normalized).includes(risk));
  for (const englishRisk of ["No psychosis", "Low risk of suicide", "No domestic violence", "No risk to others"]) {
    const normalizedEnglish = normaliseerRisicopolariteit({
      ...legeKlinischeStaat(),
      hoofdklacht: englishRisk,
      acties: [{ ...fact(englishRisk), soort: "overig", omschrijving: englishRisk }],
    });
    check(
      `C08 English risk polarity cannot bypass scalar or action guard: ${englishRisk}`,
      !JSON.stringify(normalizedEnglish).includes(englishRisk),
    );
  }
  const ownedFact = { ...fact(risk, []), doorBehandelaar: true };
  const owned = { ...legeKlinischeStaat(), hoofdklacht: risk, onderzoek: [ownedFact] };
  equal(
    "C08 clinician fact is preserved through normalization",
    normaliseerRisicopolariteit(owned).onderzoek[0],
    ownedFact,
  );
  equal("C08 clinician scalar is preserved by generic finalization", rondStaatAf(owned).hoofdklacht, risk);
  equal(
    "C08 clinician facts survive a later empty merge",
    mergeKlinischeStaat(owned, legeKlinischeStaat()).onderzoek[0],
    ownedFact,
  );
  const english = deterministischeRonde([headache], [headache], "soap", owned, "en");
  equal("C05/C08 English fallback preserves earlier clinician fact", english.staat.onderzoek[0], ownedFact);
  equal("C05/C08 English fallback preserves earlier scalar assessment", english.staat.hoofdklacht, risk);

  const first = segment("Ik gebruik sertraline 50 mg.");
  const stopped = segment("Ik ben gestopt met sertraline.", "patient", 2);
  const resumed = segment("Ik gebruik nu sertraline 50 mg.", "patient", 3);
  const stoppedState = extraheerDeterministisch([first, stopped], "soap");
  check(
    "C09 current medicine retracts on explicit stop",
    stoppedState.medicatie.some((rij) => rij.gebruik === "huidig" && rij.ingetrokken),
  );
  check(
    "C09 cessation remains visible",
    stoppedState.medicatie.some((rij) => rij.gebruik === "gestopt" && !rij.ingetrokken),
  );
  const resumedState = extraheerDeterministisch([first, stopped, resumed], "soap");
  check(
    "C09 explicit restart has exactly one active current row",
    resumedState.medicatie.filter((rij) => rij.gebruik === "huidig" && !rij.ingetrokken).length === 1,
  );
  check(
    "C09 resumed medicine does not remain actively stopped",
    !resumedState.medicatie.some((rij) => rij.gebruik === "gestopt" && !rij.ingetrokken),
  );
  const mergedStop = mergeKlinischeStaat(
    extraheerDeterministisch([first], "soap"),
    extraheerDeterministisch([stopped], "soap"),
  );
  check(
    "C09 transition also reconciles separate analysis passes",
    !mergedStop.medicatie.some((rij) => rij.gebruik === "huidig" && !rij.ingetrokken),
  );
  const mergedResume = mergeKlinischeStaat(mergedStop, resumedState);
  check(
    "C09 later restart survives additive merge",
    mergedResume.medicatie.some((rij) => rij.gebruik === "huidig" && !rij.ingetrokken),
  );
  equal(
    "C09 obsolete current row no longer causes an interaction",
    controleerMedicatie([...stoppedState.medicatie, medicine("tramadol")], []).filter(
      (rij) => rij.type === "interactie",
    ),
    [],
  );
  const reviewedMedicine = { ...medicine("sertraline", "50 mg"), doorBehandelaar: true };
  equal(
    "C09 automatic stop cannot override explicit clinician state",
    mergeKlinischeStaat(
      { ...legeKlinischeStaat(), medicatie: [reviewedMedicine] },
      extraheerDeterministisch([stopped], "soap"),
    ).medicatie[0],
    reviewedMedicine,
  );
}

async function checkActualAgent(): Promise<void> {
  process.env.CAREON_SCRIBE_LIVE = "1";
  process.env.CAREON_ASSISTANT_LIVE = "1";
  process.env.OPENAI_API_KEY = "synthetic-local-regression-placeholder";
  let response: unknown;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify(response),
        choices: [{ message: { content: JSON.stringify(response) } }],
      }),
      { status: 200 },
    );
  };
  const input = {
    staat: legeKlinischeStaat(),
    nieuweSegmenten: [segment("Ik heb hoofdpijn.")],
    contextSegmenten: [],
    consultType: "soap" as const,
    taal: "nl" as const,
    actorHash: "synthetic",
    orgId: null,
    userId: null,
    aiToegestaan: true,
    signal: new AbortController().signal,
  };
  response = {
    staat: {
      ...legeKlinischeStaat(),
      hoofdklacht: "Geen suïcidaliteit",
      medicatie: [medicine("lithium", "900 mg", [999])],
    },
    sprekers: [],
    correcties: [],
  };
  const rejected = await analyseerSegmenten(input);
  check(
    "C07/C08 actual agent rejects invented source/risk and keeps supported headache",
    rejected.staat.medicatie.length === 0 && rejected.staat.hoofdklacht === "hoofdpijn",
  );
  response = {
    staat: legeKlinischeStaat(),
    sprekers: [],
    correcties: [{ volgnummer: 1, tekstGecorrigeerd: "Ik gebruik lithium 900 mg." }],
  };
  equal("C07 unsafe model transcript rewrite rejected", (await analyseerSegmenten(input)).correcties, []);
  response = { staat: legeKlinischeStaat(), sprekers: [null, false, "bad", []], correcties: [null, 3, "bad", []] };
  const malformed = await analyseerSegmenten(input);
  check(
    "C07 malformed model array entries safely ignored",
    malformed.staat.hoofdklacht === "hoofdpijn" && malformed.correcties.length === 0 && malformed.sprekers.length === 0,
  );
  response = { staat: { ...legeKlinischeStaat(), medicatie: [null] }, sprekers: [], correcties: [] };
  const malformedState = await analyseerSegmenten(input);
  check(
    "C07 malformed model state safely falls back",
    malformedState.bron === "deterministisch" && malformedState.staat.hoofdklacht === "hoofdpijn",
  );
  response = { staat: legeKlinischeStaat(), sprekers: [], correcties: [] };
  const own = {
    ...legeKlinischeStaat(),
    hoofdklacht: "Geen suïcidaliteit",
    onderzoek: [{ ...fact("Geen suïcidaliteit", []), doorBehandelaar: true }],
  };
  const ownResult = await analyseerSegmenten({
    ...input,
    staat: own,
    nieuweSegmenten: [segment("Dank u.", "patient")],
  });
  equal("C08 actual agent preserves prior clinician scalar", ownResult.staat.hoofdklacht, own.hoofdklacht);
  equal("C08 actual agent preserves prior clinician fact", ownResult.staat.onderzoek[0], own.onderzoek[0]);

  const noteInput = {
    ...input,
    staat: extraheerDeterministisch(input.nieuweSegmenten, "soap"),
    citaten: input.nieuweSegmenten,
    gatSegmenten: [],
  };
  const canonicalNote = bouwVerslagDeterministisch(noteInput.staat, noteInput.citaten, "soap");
  response = {
    secties: [
      { id: "subjectief", tekst: "Patiënt gebruikt lithium 900 mg en is allergisch voor penicilline.", bron: [1] },
    ],
  };
  const fabricatedNote = await genereerVerslag(noteInput);
  equal(
    "C07 actual report rejects fabricated medicine/allergy on unrelated real source",
    fabricatedNote.secties[0].tekst,
    canonicalNote[0].tekst,
  );
  equal("C07 wholly rejected report carries deterministic provenance", fabricatedNote.bron, "deterministisch");
  const rejectedEnglishNote = await genereerVerslag({ ...noteInput, taal: "en" });
  check(
    "C05/C07 rejected English rewrite cannot unlock manual report sections",
    rejectedEnglishNote.secties.every((row) => row.vereistBehandelaar && row.tekst === ""),
  );
  response = { secties: [null, false, "malformed", []] };
  const malformedNote = await genereerVerslag(noteInput);
  equal("C07 null/nonobject report rows fall back safely", malformedNote.secties[0].tekst, canonicalNote[0].tekst);
  const validRewrite = canonicalNote[0].tekst.replace("Cliënt", "Patiënt").replace(" meldt ", "\nmeldt   ");
  response = { secties: [{ id: "subjectief", tekst: validRewrite, bron: [1] }] };
  const verifiedRewrite = await genereerVerslag(noteInput);
  equal("C07 verifiable complete report formatting rewrite retained", verifiedRewrite.secties[0].tekst, validRewrite);
  equal("C07 verifiable report rewrite records AI provenance", verifiedRewrite.bron, "ai");
  response = { secties: [{ id: "subjectief", tekst: validRewrite, bron: [1, 999] }] };
  equal(
    "C07 report rejects mixed valid/nonexistent citations",
    (await genereerVerslag(noteInput)).bron,
    "deterministisch",
  );
  response = { secties: [{ id: "subjectief", tekst: validRewrite, bron: [1, 0] }] };
  equal("C07 report rejects mixed valid/zero citations", (await genereerVerslag(noteInput)).bron, "deterministisch");
  const medicationSources = [
    segment("Ik gebruik sertraline 50 mg."),
    segment("Ik ben allergisch voor penicilline.", "patient", 2),
  ];
  const medicationNoteInput = {
    ...noteInput,
    staat: extraheerDeterministisch(medicationSources, "soap"),
    citaten: medicationSources,
  };
  const medicationCanonical = bouwVerslagDeterministisch(medicationNoteInput.staat, medicationSources, "soap")[0];
  response = {
    secties: [
      { id: "subjectief", tekst: medicationCanonical.tekst.replace("50 mg", "500 mg"), bron: medicationCanonical.bron },
    ],
  };
  equal(
    "C07 report cannot alter a dose despite valid sources",
    (await genereerVerslag(medicationNoteInput)).secties[0].tekst,
    medicationCanonical.tekst,
  );
  response = {
    secties: [
      {
        id: "subjectief",
        tekst: medicationCanonical.tekst.replace(/Allergieën: [^.]+\.\s*/, ""),
        bron: medicationCanonical.bron,
      },
    ],
  };
  equal(
    "C07 report cannot silently omit confirmed allergy",
    (await genereerVerslag(medicationNoteInput)).secties[0].tekst,
    medicationCanonical.tekst,
  );
  response = { secties: [{ id: "subjectief", tekst: medicationCanonical.tekst, bron: [1] }] };
  equal(
    "C07 report must retain complete section provenance",
    (await genereerVerslag(medicationNoteInput)).bron,
    "deterministisch",
  );
  const deniedSources = [segment("Ik heb geen hoofdpijn.")];
  const deniedNoteInput = {
    ...noteInput,
    staat: extraheerDeterministisch(deniedSources, "soap"),
    citaten: deniedSources,
  };
  const deniedCanonical = bouwVerslagDeterministisch(deniedNoteInput.staat, deniedSources, "soap")[0];
  response = {
    secties: [{ id: "subjectief", tekst: deniedCanonical.tekst.replace(": ontkend", ""), bron: deniedCanonical.bron }],
  };
  equal(
    "C07 report cannot turn symptom negation into affirmation",
    (await genereerVerslag(deniedNoteInput)).secties[0].tekst,
    deniedCanonical.tekst,
  );
  const beforeFallback = fetches;
  const fallback = await analyseerSegmenten({
    ...input,
    taal: "en",
    aiToegestaan: false,
    nieuweSegmenten: [segment("I do not take tramadol.")],
  });
  check("C05 denied AI gate makes no provider call", fetches === beforeFallback);
  check(
    "C05 actual agent language fallback is safe and explicit",
    fallback.staat.medicatie.length === 0 && fallback.staat.samenvatting === ENGELSE_HANDMATIGE_BEOORDELING,
  );
  const report = await genereerVerslag({
    ...input,
    staat: fallback.staat,
    citaten: [],
    gatSegmenten: [],
    taal: "en",
    aiToegestaan: false,
  });
  check(
    "C05 actual report fallback requires all sections manually",
    report.secties.every((rij) => rij.vereistBehandelaar && rij.tekst === ""),
  );
  check("synthetic agent tests exercised mocked provider only", fetches >= 3);
}

async function main(): Promise<void> {
  checkExtraction();
  checkProvenanceAndOwnership();
  await checkActualAgent();
  console.log(
    `Scribe clinical verification: ${passed} passed, ${failed} failed (synthetic inputs; no external provider calls).`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

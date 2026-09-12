/** Complete English analysis regressions using synthetic, intercepted provider responses.
 * No environment files, provider network, telemetry database or real consult data.
 */
import type { AnalyseInvoer, AnalyseUitkomst } from "../lib/careon-scribe/agent.server";
import type { Feit, KlinischeStaat, Medicatie, ScribeSegment, Spreker } from "../lib/careon-scribe/types";

type Step = { schema: string; value?: unknown; status?: number; malformed?: boolean };
type Captured = { schema: string; body: Record<string, unknown>; input: Record<string, unknown> };
const CONTEXT = "careon_scribe_gesprekscontext";
const FACTS = "careon_scribe_reviewed_english";
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
  const matches = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, matches);
  if (!matches) console.error(JSON.stringify({ actual, expected }));
}

function segment(
  tekst: string,
  volgnummer = 1,
  spreker: Spreker = "patient",
  sprekerBron: ScribeSegment["sprekerBron"] = "behandelaar",
): ScribeSegment {
  return {
    id: `reviewed-english-synthetic-${volgnummer}`,
    volgnummer,
    tekst,
    spreker,
    sprekerBron,
    tekstGecorrigeerd: null,
    correctieBron: null,
    beginMs: (volgnummer - 1) * 8000,
    eindMs: volgnummer * 8000,
    bron: "handmatig",
    createdAt: "2026-09-11T00:00:00.000Z",
  };
}

function fact(tekst: string, volgnummer = 1): Feit {
  return { tekst, bron: [volgnummer], ingetrokken: false };
}

function medicine(tekst: string, naam: string, dosering: string, volgnummer = 1): Medicatie {
  return { ...fact(tekst, volgnummer), naam, dosering, gebruik: "huidig" };
}

async function main(): Promise<void> {
  // The runtime captures some settings at module import. Isolate before loading it.
  const relevant = Object.keys(process.env).filter((key) =>
    /SUPABASE|^OPENAI_|^CAREON_ASSISTANT_|^CAREON_SCRIBE_/.test(key),
  );
  const saved = new Map(relevant.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  for (const key of relevant) delete process.env[key];
  const isolated = {
    CAREON_SCRIBE_LIVE: "1",
    CAREON_ASSISTANT_LIVE: "1",
    CAREON_ASSISTANT_MAX_RETRIES: "0",
    OPENAI_API_KEY: "synthetic-intercepted-provider-placeholder",
    OPENAI_MODEL: "synthetic-reviewed-english-model",
    OPENAI_API_MODE: "responses",
    OPENAI_API_BASE_URL: "https://scribe-provider.invalid/v1",
  };
  Object.assign(process.env, isolated);
  let steps: Step[] = [];
  let captured: Captured[] = [];
  const unexpected: string[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) !== "https://scribe-provider.invalid/v1/responses" || init?.method !== "POST") {
      unexpected.push("Unexpected URL or HTTP method");
      throw new Error("Synthetic test blocked unexpected network request.");
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const format = (body.text as { format: { name: string } }).format;
    const source = (body.input as { content: string }[])[0].content;
    captured.push({ schema: format.name, body, input: JSON.parse(source) as Record<string, unknown> });
    const expected = steps.shift();
    if (!expected || expected.schema !== format.name) {
      unexpected.push(`Unexpected schema ${format.name}`);
      throw new Error("Synthetic provider call order differed from the contract.");
    }
    if (expected.status) return new Response("synthetic provider failure", { status: expected.status });
    return Response.json({ output_text: expected.malformed ? "not JSON" : JSON.stringify(expected.value) });
  };

  try {
    const { analyseerSegmenten, genereerVerslag } = await import("../lib/careon-scribe/agent.server");
    const { ENGLISH_FACT_REPORT_HEADER } = await import("../lib/careon-scribe/english-report");
    const { legeKlinischeStaat } = await import("../lib/careon-scribe/klinische-staat");
    const { STAAT_CATEGORIEEN } = await import("../lib/careon-scribe/types");
    const empty = legeKlinischeStaat;
    const clinicalCount = (state: KlinischeStaat): number =>
      STAAT_CATEGORIEEN.reduce((sum, key) => sum + state[key].length, 0);
    const output = (state: KlinischeStaat): unknown => ({ staat: state, sprekers: [], correcties: [] });
    const contextFor = (sources: ScribeSegment[]): unknown => ({
      fragmenten: sources
        .filter((item) => item.bron !== "systeem")
        .map((item) => ({
          sectieId: "speciele-anamnese",
          van: item.volgnummer,
          tot: item.volgnummer,
        })),
    });
    const input = (sources: ScribeSegment[], state = empty(), prior: ScribeSegment[] = []): AnalyseInvoer => ({
      staat: state,
      nieuweSegmenten: sources,
      contextSegmenten: prior,
      consultType: "psychiatrie",
      taal: "en",
      actorHash: "synthetic-reviewed-english",
      orgId: null,
      userId: null,
      aiToegestaan: true,
      signal: new AbortController().signal,
    });
    async function run(invoer: AnalyseInvoer, replies: Step[]): Promise<AnalyseUitkomst> {
      steps = [...replies];
      captured = [];
      const before = JSON.stringify(invoer);
      const result = await analyseerSegmenten(invoer);
      equal("complete agent does not mutate source/state input", JSON.stringify(invoer), before);
      equal("complete agent consumed the expected provider sequence", steps.length, 0);
      check(
        "provider storage disabled on every request",
        captured.every((call) => call.body.store === false),
      );
      return result;
    }
    async function analyze(sources: ScribeSegment[], state: KlinischeStaat, prior = empty()): Promise<AnalyseUitkomst> {
      return run(input(sources, prior), [
        { schema: CONTEXT, value: contextFor(sources) },
        { schema: FACTS, value: output(state) },
      ]);
    }

    const positives = [
      segment("I take sertraline 50 mg.", 1),
      segment("I have a headache.", 2),
      segment("I smoke cannabis every evening.", 3),
      segment("The patient has nausea.", 4, "arts"),
      segment("I am allergic to penicillin.", 5),
      segment("I will arrange a follow-up appointment.", 6, "arts"),
      segment("I have stopped taking tramadol 100 mg.", 7),
      segment("I do not drink alcohol.", 8),
    ];
    const proposed = {
      ...empty(),
      medicatie: [
        medicine(positives[0].tekst, "sertraline", "50 mg"),
        { ...medicine(positives[6].tekst, "tramadol", "100 mg", 7), gebruik: "gestopt" as const },
      ],
      symptomen: [fact(positives[1].tekst, 2), fact(positives[3].tekst, 4)],
      leefstijl: [
        { ...fact(positives[2].tekst, 3), categorie: "drugs" },
        { ...fact(positives[7].tekst, 8), categorie: "alcohol" },
      ],
      allergieen: [{ ...fact(positives[4].tekst, 5), aard: "allergie" as const }],
      plan: [fact(positives[5].tekst, 6)],
      acties: [{ ...fact(positives[5].tekst, 6), omschrijving: positives[5].tekst, soort: "overig" as const }],
      hoofdklacht: "Invented chief complaint",
      duur: "Invented duration",
      beloop: "Invented course",
      ernst: "Invented severity",
      samenvatting: "Invented clinical summary.",
    };
    const accepted = await analyze(positives, proposed);
    equal(
      "confirmed medication names/doses/status retained",
      accepted.staat.medicatie.map((row) => [row.naam, row.dosering, row.gebruik]),
      [
        ["sertraline", "50 mg", "huidig"],
        ["tramadol", "100 mg", "gestopt"],
      ],
    );
    equal(
      "confirmed patient and clinician symptom statements retained verbatim",
      accepted.staat.symptomen.map((row) => row.tekst),
      [positives[1].tekst, positives[3].tekst],
    );
    equal(
      "literal lifestyle includes the unchanged denial",
      accepted.staat.leefstijl.map((row) => row.tekst),
      [positives[2].tekst, positives[7].tekst],
    );
    equal(
      "definite literal allergy retained",
      accepted.staat.allergieen.map((row) => row.tekst),
      [positives[4].tekst],
    );
    equal(
      "explicit clinician commitment retained",
      accepted.staat.plan.map((row) => row.tekst),
      [positives[5].tekst],
    );
    equal(
      "action retains full commitment and generic type",
      accepted.staat.acties.map((row) => [row.omschrijving, row.soort]),
      [[positives[5].tekst, "overig"]],
    );
    equal(
      "English model cannot invent scalar fields",
      [accepted.staat.hoofdklacht, accepted.staat.duur, accepted.staat.beloop, accepted.staat.ernst],
      [null, null, null, null],
    );
    equal("English model summary is not accepted", accepted.staat.samenvatting, "");
    equal(
      "analysis never emits model role/correction changes for English",
      [accepted.sprekers, accepted.correcties],
      [[], []],
    );
    equal(
      "context pass precedes the full-state factual schema",
      captured.map((call) => call.schema),
      [CONTEXT, FACTS],
    );
    const contextSchema = (captured[0].body.text as { format: { schema: unknown } }).format.schema;
    const factsSchema = (captured[1].body.text as { format: { schema: unknown } }).format.schema;
    check(
      "context schema does not ask model for quote wording or roles",
      !/"tekst"|"spreker"|"role"/.test(JSON.stringify(contextSchema)),
    );
    check(
      "fact schema contains full state without provenance/clinical ownership extensions",
      JSON.stringify(factsSchema).includes('"staat"') &&
        !/gesprekscontext|sprekerBron|doorBehandelaar/.test(JSON.stringify(factsSchema)),
    );
    equal(
      "source quote identity and full text survive complete analysis",
      accepted.staat.gesprekscontext
        ?.flatMap((row) => row.citaten)
        .map((quote) => [quote.segmentId, quote.volgnummer, quote.tekst]),
      positives.map((source) => [source.id, source.volgnummer, source.tekst]),
    );

    for (const provenance of [null, "ai", undefined] as const) {
      const source = { ...segment("I take lithium 900 mg."), sprekerBron: provenance };
      const result = await run(input([source]), [
        {
          schema: CONTEXT,
          value: {
            ...(contextFor([source]) as object),
            staat: { ...empty(), medicatie: [medicine(source.tekst, "lithium", "900 mg")] },
            sprekers: [{ volgnummer: 1, spreker: "patient", sprekerBron: "behandelaar" }],
            sprekerBron: "behandelaar",
          },
        },
      ]);
      equal(
        `unverified ${String(provenance)} role suppresses factual-provider call`,
        captured.map((call) => call.schema),
        [CONTEXT],
      );
      equal(
        `unverified ${String(provenance)} source produces context without accepted facts`,
        clinicalCount(result.staat),
        0,
      );
      equal(
        `context response cannot certify ${String(provenance)} role`,
        [result.sprekers, source.sprekerBron],
        [[], provenance],
      );
      equal("unverified source remains inspectable", result.staat.gesprekscontext?.[0].citaten[0].tekst, source.tekst);
    }

    const old = segment("I take lithium 900 mg.", 1);
    const confirmed = segment("I have a cough.", 2);
    const inferred = segment("I take tramadol 100 mg.", 3, "patient", "ai");
    const gap = { ...segment("Missing fragment.", 4), bron: "systeem" as const };
    const filtered = await run(input([confirmed, inferred, gap], empty(), [old]), [
      { schema: CONTEXT, value: contextFor([confirmed, inferred]) },
      {
        schema: FACTS,
        value: {
          ...(output({
            ...empty(),
            symptomen: [fact(confirmed.tekst, 2)],
            medicatie: [medicine(old.tekst, "lithium", "900 mg"), medicine(inferred.tekst, "tramadol", "100 mg", 3)],
          }) as object),
          sprekers: [{ volgnummer: 3, spreker: "patient", sprekerBron: "behandelaar" }],
          correcties: [{ volgnummer: 3, tekstGecorrigeerd: "Invented rewrite" }],
        },
      },
    ]);
    equal("fact provider receives only confirmed new non-system turns", captured[1].input.confirmedTurns, [
      { nummer: 2, role: "patient", text: confirmed.tekst },
    ]);
    equal(
      "old context and inferred source references cannot become new medication facts",
      filtered.staat.medicatie,
      [],
    );
    equal(
      "fact response cannot change inferred roles or transcript text",
      [filtered.sprekers, filtered.correcties],
      [[], []],
    );

    const rejected: { name: string; source: ScribeSegment; proposed: Partial<KlinischeStaat> }[] = [
      {
        name: "oversized exact source hidden by whitespace normalization",
        source: segment(`I${" ".repeat(601)}have a headache.`),
        proposed: { symptomen: [fact("I have a headache.")] },
      },
      {
        name: "oversized exact action hidden by whitespace normalization",
        source: segment(`I will${" ".repeat(301)}arrange an appointment.`, 1, "arts"),
        proposed: {
          acties: [
            {
              ...fact("I will arrange an appointment."),
              omschrijving: "I will arrange an appointment.",
              soort: "overig",
            },
          ],
        },
      },
      {
        name: "unpunctuated clinician question",
        source: segment("Do you have headaches", 1, "arts"),
        proposed: { symptomen: [fact("Do you have headaches")] },
      },
      {
        name: "tentative allergy",
        source: segment("I might be allergic to penicillin."),
        proposed: { allergieen: [{ ...fact("I might be allergic to penicillin."), aard: "allergie" }] },
      },
      {
        name: "tentative plan",
        source: segment("I could arrange an appointment.", 1, "arts"),
        proposed: {
          plan: [fact("I could arrange an appointment.")],
          acties: [
            {
              ...fact("I could arrange an appointment."),
              omschrijving: "I could arrange an appointment.",
              soort: "overig",
            },
          ],
        },
      },
      {
        name: "borrowed medication dose",
        source: segment("I take sertraline 50 mg and tramadol 100 mg."),
        proposed: { medicatie: [medicine("I take sertraline 50 mg and tramadol 100 mg.", "sertraline", "100 mg")] },
      },
      {
        name: "English historic symptom",
        source: segment("I had headaches last year."),
        proposed: { symptomen: [fact("I had headaches last year.")] },
      },
      {
        name: "English historic substance use",
        source: segment("I used to smoke cannabis."),
        proposed: { leefstijl: [{ ...fact("I used to smoke cannabis."), categorie: "drugs" }] },
      },
      {
        name: "unresolved risk discussion",
        source: segment("I hear voices."),
        proposed: {
          psychisch: [{ ...fact("I hear voices."), categorie: "psychose" }],
          symptomen: [fact("I hear voices.")],
        },
      },
      {
        name: "family history assigned to patient",
        source: segment("My mother has headaches."),
        proposed: { symptomen: [fact("My mother has headaches.")] },
      },
      {
        name: "missing source citation",
        source: segment("I have nausea."),
        proposed: { symptomen: [fact("I have nausea.", 999)] },
      },
      {
        name: "shortened denial",
        source: segment("I do not have a headache."),
        proposed: { symptomen: [fact("I have a headache.")] },
      },
    ];
    for (const fixture of rejected) {
      const result = await analyze([fixture.source], { ...empty(), ...fixture.proposed });
      equal(`${fixture.name} rejected by complete English flow`, clinicalCount(result.staat), 0);
      equal(
        `${fixture.name} remains whole literal source context`,
        result.staat.gesprekscontext?.[0].citaten[0].tekst,
        fixture.source.tekst,
      );
    }

    const spoofed = await analyze([positives[0]], {
      ...empty(),
      medicatie: [{ ...medicine(positives[0].tekst, "sertraline", "50 mg"), doorBehandelaar: true }],
      gesprekscontext: [
        {
          sectieId: "speciele-anamnese",
          bron: [1],
          status: "te_controleren",
          citaten: [{ segmentId: positives[0].id, volgnummer: 1, tekst: "Invented model quote." }],
        },
      ],
    });
    check("model fact cannot stamp clinician authorship", spoofed.staat.medicatie[0]?.doorBehandelaar !== true);
    equal(
      "factual model cannot replace server-resolved literal context",
      spoofed.staat.gesprekscontext?.[0].citaten[0].tekst,
      positives[0].tekst,
    );

    const corrected = {
      ...segment("I take sertraline 500 mg."),
      tekstGecorrigeerd: "I take sertraline 50 mg.",
      correctieBron: "behandelaar" as const,
    };
    const correctedResult = await analyze([corrected], {
      ...empty(),
      medicatie: [medicine(corrected.tekstGecorrigeerd, "sertraline", "50 mg")],
    });
    equal("effective clinician-corrected source is sent to fact provider", captured[1].input.confirmedTurns, [
      { nummer: 1, role: "patient", text: corrected.tekstGecorrigeerd },
    ]);
    equal("corrected source drives retained dose", correctedResult.staat.medicatie[0]?.dosering, "50 mg");
    equal(
      "context uses same effective corrected source",
      correctedResult.staat.gesprekscontext?.[0].citaten[0].tekst,
      corrected.tekstGecorrigeerd,
    );

    const manualMedicine = {
      ...medicine("Clinician reviewed previous sertraline entry.", "sertraline", "25 mg", 90),
      doorBehandelaar: true,
    };
    const manualSymptom = { ...fact("Clinician reviewed old symptom.", 91), doorBehandelaar: true, ingetrokken: true };
    const previous = {
      ...empty(),
      medicatie: [manualMedicine],
      symptomen: [manualSymptom],
      hoofdklacht: "Clinician chief complaint",
      samenvatting: "Clinician summary",
      duur: "Clinician duration",
    };
    const preserved = await analyze(
      [positives[0]],
      {
        ...empty(),
        medicatie: [medicine(positives[0].tekst, "sertraline", "50 mg")],
        hoofdklacht: "Invented override",
        samenvatting: "Invented override",
        duur: "Invented override",
      },
      previous,
    );
    equal(
      "prior clinician medication survives conflicting machine entry",
      preserved.staat.medicatie[0],
      manualMedicine,
    );
    equal("prior clinician retraction survives next full analysis", preserved.staat.symptomen[0], manualSymptom);
    equal(
      "prior clinician scalars survive model output",
      [preserved.staat.hoofdklacht, preserved.staat.samenvatting, preserved.staat.duur],
      [previous.hoofdklacht, previous.samenvatting, previous.duur],
    );

    const alcohol = segment("I drink beer every Friday.", 1);
    const unrelated = segment("Thank you for explaining.", 2);
    const uncertain = segment("How is your sleep? — It is fine.", 3, "onbekend", null);
    const firstBatch = await analyze([alcohol], {
      ...empty(),
      leefstijl: [{ ...fact(alcohol.tekst), categorie: "alcohol" }],
    });
    equal("retention fixture begins with one actually accepted alcohol fact", firstBatch.staat.leefstijl.length, 1);
    const repeatedAlcohol = await analyze(
      [alcohol],
      {
        ...empty(),
        leefstijl: [{ ...fact(alcohol.tekst), categorie: "alcohol" }],
      },
      firstBatch.staat,
    );
    equal(
      "repeated same source does not duplicate retained alcohol",
      repeatedAlcohol.staat.leefstijl,
      firstBatch.staat.leefstijl,
    );
    const secondBatch = await run(input([unrelated], firstBatch.staat, [alcohol]), [
      { schema: CONTEXT, value: contextFor([unrelated]) },
      { schema: FACTS, value: output(empty()) },
    ]);
    equal(
      "empty new factual delta retains earlier confirmed alcohol",
      secondBatch.staat.leefstijl,
      firstBatch.staat.leefstijl,
    );
    const thirdBatch = await run(input([uncertain], secondBatch.staat, [alcohol, unrelated]), [
      { schema: CONTEXT, value: contextFor([uncertain]) },
    ]);
    equal(
      "later context-only round retains earlier confirmed alcohol",
      thirdBatch.staat.leefstijl,
      firstBatch.staat.leefstijl,
    );
    steps = [];
    captured = [];
    const retainedReport = await genereerVerslag({
      ...input([], thirdBatch.staat),
      citaten: [alcohol, unrelated, uncertain],
      gatSegmenten: [],
    });
    const social = retainedReport.secties.find((row) => row.id === "sociale-anamnese");
    equal(
      "retained fact reaches actual deterministic English report",
      social?.tekst,
      `${ENGLISH_FACT_REPORT_HEADER}\n\n- ${alcohol.tekst} (§1)`,
    );
    equal("retained factual draft still cites its original reviewed source", social?.bron, [1]);
    check(
      "retained factual draft remains individually reviewed",
      social?.vereistBehandelaar === true && social.status === "concept",
    );
    equal("English source-bound report needs no additional provider call", captured, []);

    const firstMedicine = segment("I take sertraline 50 mg.", 1);
    const secondMedicine = segment("I take sertraline 100 mg.", 2);
    const firstMedicineBatch = await analyze([firstMedicine], {
      ...empty(),
      medicatie: [medicine(firstMedicine.tekst, "sertraline", "50 mg", 1)],
    });
    const secondMedicineBatch = await run(input([secondMedicine], firstMedicineBatch.staat, [firstMedicine]), [
      { schema: CONTEXT, value: contextFor([secondMedicine]) },
      {
        schema: FACTS,
        value: output({ ...empty(), medicatie: [medicine(secondMedicine.tekst, "sertraline", "100 mg", 2)] }),
      },
    ]);
    equal(
      "separate medication mentions retain one exact source each",
      secondMedicineBatch.staat.medicatie.map((row) => [row.tekst, row.dosering, row.bron]),
      [
        [firstMedicine.tekst, "50 mg", [1]],
        [secondMedicine.tekst, "100 mg", [2]],
      ],
    );
    const repeatMedicine = await analyze(
      [secondMedicine],
      {
        ...empty(),
        medicatie: [medicine(secondMedicine.tekst, "sertraline", "100 mg", 2)],
      },
      secondMedicineBatch.staat,
    );
    equal(
      "repeat medication delta is idempotent without merging source identities",
      repeatMedicine.staat.medicatie,
      secondMedicineBatch.staat.medicatie,
    );
    steps = [];
    captured = [];
    const medicationReport = await genereerVerslag({
      ...input([], repeatMedicine.staat),
      citaten: [firstMedicine, secondMedicine],
      gatSegmenten: [],
    });
    equal(
      "each medication source survives report evidence revalidation",
      medicationReport.secties.find((row) => row.id === "somatiek-medicatie")?.tekst,
      `${ENGLISH_FACT_REPORT_HEADER}\n\n- ${firstMedicine.tekst} (§1)\n- ${secondMedicine.tekst} (§2)`,
    );
    const factsWithoutContext = { ...repeatMedicine.staat };
    delete factsWithoutContext.gesprekscontext;
    const factOnlyReport = await genereerVerslag({
      ...input([], factsWithoutContext),
      citaten: [firstMedicine, secondMedicine],
      gatSegmenten: [],
    });
    equal(
      "English facts without conversation context retain exact deterministic draft",
      factOnlyReport.secties.find((row) => row.id === "somatiek-medicatie")?.tekst,
      medicationReport.secties.find((row) => row.id === "somatiek-medicatie")?.tekst,
    );
    equal("English report without context does not invoke another model", captured, []);

    const stoppedSource = segment("I stopped sertraline.", 2);
    const stoppedEvidence: Medicatie = {
      ...fact(stoppedSource.tekst, 2),
      naam: "sertraline",
      dosering: null,
      gebruik: "gestopt",
      // Some models use this to indicate stopped medication. The source
      // statement itself is still active evidence and must retire older use.
      ingetrokken: true,
    };
    equal(
      "stopping fixture begins with one active current medication",
      firstMedicineBatch.staat.medicatie.filter((row) => row.gebruik === "huidig" && !row.ingetrokken).length,
      1,
    );
    const stoppedBatch = await run(input([stoppedSource], firstMedicineBatch.staat, [firstMedicine]), [
      { schema: CONTEXT, value: contextFor([stoppedSource]) },
      { schema: FACTS, value: output({ ...empty(), medicatie: [stoppedEvidence] }) },
    ]);
    equal(
      "accepted stopped-medication evidence retires older current use",
      stoppedBatch.staat.medicatie.filter((row) => row.gebruik === "huidig" && !row.ingetrokken).length,
      0,
    );
    equal(
      "model withdrawal flag does not suppress valid stopping evidence",
      stoppedBatch.staat.medicatie
        .filter((row) => row.gebruik === "gestopt" && !row.ingetrokken)
        .map((row) => [row.tekst, row.bron]),
      [[stoppedSource.tekst, [2]]],
    );
    steps = [];
    captured = [];
    const stoppedReport = await genereerVerslag({
      ...input([], stoppedBatch.staat),
      citaten: [firstMedicine, stoppedSource],
      gatSegmenten: [],
    });
    equal(
      "actual report contains stopping evidence and no active old dose",
      stoppedReport.secties.find((row) => row.id === "somatiek-medicatie")?.tekst,
      `${ENGLISH_FACT_REPORT_HEADER}\n\n- ${stoppedSource.tekst} (§2)`,
    );

    const humanRetraction: Medicatie = {
      ...firstMedicineBatch.staat.medicatie[0],
      doorBehandelaar: true,
      ingetrokken: true,
    };
    const humanRetractedState = { ...firstMedicineBatch.staat, medicatie: [humanRetraction] };
    const stoppedAfterHumanRetraction = await run(input([stoppedSource], humanRetractedState, [firstMedicine]), [
      { schema: CONTEXT, value: contextFor([stoppedSource]) },
      { schema: FACTS, value: output({ ...empty(), medicatie: [stoppedEvidence] }) },
    ]);
    equal(
      "normalizing machine stopping evidence preserves the clinician's exact prior retraction",
      stoppedAfterHumanRetraction.staat.medicatie.find((row) => row.doorBehandelaar === true),
      humanRetraction,
    );
    equal(
      "clinician-retracted current use is never reactivated",
      stoppedAfterHumanRetraction.staat.medicatie.filter((row) => row.gebruik === "huidig" && !row.ingetrokken).length,
      0,
    );
    equal(
      "new stopping evidence remains active beside the clinician's historical retraction",
      stoppedAfterHumanRetraction.staat.medicatie.filter((row) => row.gebruik === "gestopt" && !row.ingetrokken).length,
      1,
    );

    for (const failure of [{ status: 400 }, { malformed: true }, { value: { fragmenten: null } }]) {
      const invoer = input([uncertain], firstBatch.staat, [alcohol]);
      const before = JSON.stringify(invoer);
      steps = [{ schema: CONTEXT, ...failure }];
      captured = [];
      let result: AnalyseUitkomst | undefined;
      let threw = false;
      try {
        result = await analyseerSegmenten(invoer);
      } catch {
        threw = true;
      }
      check("failed context selection throws instead of a cursor-advancing success", threw && result === undefined);
      equal("failed context provider cannot mutate prior state/source", JSON.stringify(invoer), before);
      equal(
        "failed context pass does not invoke factual provider",
        captured.map((call) => call.schema),
        [CONTEXT],
      );
    }

    for (const failure of [{ status: 400 }, { malformed: true }, { value: { staat: { medicatie: [null] } } }]) {
      const invoer = input([positives[0]], previous);
      const before = JSON.stringify(invoer);
      steps = [
        { schema: CONTEXT, value: contextFor(invoer.nieuweSegmenten) },
        { schema: FACTS, ...failure },
      ];
      captured = [];
      let result: AnalyseUitkomst | undefined;
      let threw = false;
      try {
        result = await analyseerSegmenten(invoer);
      } catch {
        threw = true;
      }
      check("failed factual provider throws instead of returning partial context", threw && result === undefined);
      equal("failed factual provider cannot mutate previous state/source", JSON.stringify(invoer), before);
      equal(
        "failed factual pass occurred after valid context selection",
        captured.map((call) => call.schema),
        [CONTEXT, FACTS],
      );
    }
    equal("all provider access was intercepted; no database/network fallback", unexpected, []);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of [...relevant, ...Object.keys(isolated)]) delete process.env[key];
    for (const [key, value] of saved) if (value !== undefined) process.env[key] = value;
  }
  console.log(
    `Scribe reviewed English verification: ${passed} passed, ${failed} failed (complete analysis; synthetic intercepted providers only).`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

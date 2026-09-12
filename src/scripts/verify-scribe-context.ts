/** Pure source-integrity checks. Synthetic examples; no audio, network or database access. */

import {
  bouwVerslagDeterministisch,
  deterministischeRonde,
  ENGELSE_HANDMATIGE_BEOORDELING,
  extraheerTaken,
  normaliseerRisicopolariteit,
} from "../lib/careon-scribe/deterministisch";
import { ENGLISH_FACT_REPORT_HEADER } from "../lib/careon-scribe/english-report";
import { formaatVoor } from "../lib/careon-scribe/formaten";
import {
  GESPREKSCONTEXT_KOP,
  geldigeGesprekscontext,
  gesprekscontextInvoer,
  onbewerkteGesprekscontext,
  renderGesprekscontext,
  resolveerGesprekscontext,
} from "../lib/careon-scribe/gesprekscontext";
import { isGesprekscontext, legeKlinischeStaat, mergeKlinischeStaat } from "../lib/careon-scribe/klinische-staat";
import {
  CONSULT_TYPES,
  type ConsultType,
  type GespreksContext,
  SCRIBE_LIMITS,
  type ScribeSegment,
  STAAT_CATEGORIEEN,
} from "../lib/careon-scribe/types";
import assert from "node:assert/strict";

let passed = 0;
const failed: string[] = [];

function check(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed.push(name);
    // Assertion diffs can contain entire quotes; print test names only.
    console.error(`FAIL ${name} (${error instanceof Error ? error.name : "unknown error"})`);
  }
}

function source(volgnummer: number, tekst = `Complete source fragment ${volgnummer}.`): ScribeSegment {
  return {
    id: `synthetic-source-${volgnummer}`,
    volgnummer,
    spreker: "onbekend",
    tekst,
    tekstGecorrigeerd: null,
    correctieBron: null,
    beginMs: (volgnummer - 1) * 8_000,
    eindMs: volgnummer * 8_000,
    bron: "live",
    createdAt: "2026-09-11T00:00:00.000Z",
  };
}

function select(
  segmenten: ScribeSegment[],
  van = segmenten[0]?.volgnummer ?? 1,
  tot = segmenten.at(-1)?.volgnummer ?? 1,
  sectieId = "speciele-anamnese",
  consultType: ConsultType = "psychiatrie",
  nieuweNummers = new Set(segmenten.map((segment) => segment.volgnummer)),
): GespreksContext[] {
  return resolveerGesprekscontext({ fragmenten: [{ sectieId, van, tot }] }, segmenten, nieuweNummers, consultType);
}

const exchange = [
  source(1, "Have you felt dizzy, or taken any extra medicine?"),
  source(2, "I felt dizzy yesterday. I did not take extra medicine, and I am not dizzy now."),
  source(3, "Would a review tomorrow work? I have not decided; please ask me again later."),
];
const valid = select(exchange);

check("complete questions, denials, timing and uncertainty are copied from source", () => {
  assert.equal(valid.length, 1);
  assert.deepEqual(
    valid[0].citaten.map((quote) => quote.tekst),
    exchange.map((segment) => segment.tekst),
  );
  assert.deepEqual(
    valid[0].citaten.map((quote) => quote.segmentId),
    exchange.map((segment) => segment.id),
  );
  assert.deepEqual(valid[0].bron, [1, 2, 3]);
  assert.equal(valid[0].status, "te_controleren");
  assert.equal(isGesprekscontext(valid), true);
});

check("model wording, source IDs and role claims cannot replace actual quotes", () => {
  const result = resolveerGesprekscontext(
    {
      fragmenten: [
        {
          sectieId: "speciele-anamnese",
          van: 1,
          tot: 2,
          tekst: "Invented summary",
          segmentId: "invented-id",
          spreker: "patient",
        },
      ],
    },
    exchange,
    new Set([2]),
    "psychiatrie",
  );
  assert.deepEqual(
    result[0].citaten.map((quote) => quote.tekst),
    exchange.slice(0, 2).map((segment) => segment.tekst),
  );
  assert.equal(JSON.stringify(result).includes("invented-id"), false);
  assert.equal(JSON.stringify(result).includes("Invented summary"), false);
});

check("malformed model envelopes yield no selected source", () => {
  for (const answer of [null, undefined, true, 3, "text", [], {}, { fragmenten: null }, { fragmenten: {} }]) {
    assert.deepEqual(resolveerGesprekscontext(answer, exchange, new Set([2]), "psychiatrie"), []);
  }
});

check("unknown sections, invented numbers and noninteger ranges are rejected", () => {
  const invalid = [
    { sectieId: "invented-section", van: 1, tot: 2 },
    { sectieId: "plan", van: 1, tot: 2 },
    ...[
      [0, 2],
      [-1, 2],
      [2, 1],
      [1, 4],
      [800, 801],
      [1.5, 2],
      [1, 2.5],
      [Number.NaN, 2],
      [1, Number.POSITIVE_INFINITY],
      ["1", 2],
      [1, "2"],
    ].map(([van, tot]) => ({ sectieId: "speciele-anamnese", van, tot })),
    { sectieId: "speciele-anamnese", segmentIds: ["invented-id"] },
    null,
    [],
    "text",
  ];
  for (const selection of invalid) {
    assert.deepEqual(
      resolveerGesprekscontext({ fragmenten: [selection] }, exchange, new Set([1, 2, 3]), "psychiatrie"),
      [],
    );
  }
});

check("noncontiguous available numbers and explicit recording gaps reject the entire range", () => {
  assert.deepEqual(select([exchange[0], exchange[2]], 1, 3), []);
  assert.deepEqual(select([exchange[0], { ...exchange[1], bron: "systeem" }, exchange[2]]), []);
});

check("old-only ranges cannot reselect previous material; mixed windows preserve context", () => {
  assert.deepEqual(select(exchange, 1, 2, "speciele-anamnese", "psychiatrie", new Set([3])), []);
  const mixed = select(exchange, 1, 3, "speciele-anamnese", "psychiatrie", new Set([3]));
  assert.deepEqual(mixed[0]?.bron, [1, 2, 3]);
});

check("a long contiguous conversation splits into bounded groups without losing any source", () => {
  const sources = Array.from({ length: 52 }, (_, index) => source(index + 1));
  const selected = select(sources, 1, 52, "speciele-anamnese", "psychiatrie", new Set([52]));
  assert.equal(selected.length, 18);
  assert.equal(
    selected.every((row) => row.citaten.length <= 3),
    true,
  );
  assert.deepEqual(
    selected.flatMap((row) => row.citaten.map((quote) => quote.tekst)),
    sources.map((segment) => segment.tekst),
  );
  assert.equal(isGesprekscontext(selected), true);
  assert.deepEqual(select([...sources, source(53)]), []);
});

check("empty and overlong source quotes reject their whole selected conversation", () => {
  assert.deepEqual(select([source(1, "   "), exchange[1]]), []);
  assert.deepEqual(select([source(1, "x".repeat(SCRIBE_LIMITS.segmentTekst + 1)), exchange[1]]), []);
});

check("a quote at the source length limit retains its final negation", () => {
  const ending = " I did not agree.";
  const quote = "x".repeat(SCRIBE_LIMITS.segmentTekst - ending.length) + ending;
  const result = select([source(1, quote)], 1, 1, "beleid");
  assert.equal(result[0]?.citaten[0]?.tekst, quote);
  const rendered = renderGesprekscontext(result, "beleid");
  assert.equal(rendered.tekst.endsWith(ending), true);
});

check("over-budget selections fail the round rather than silently returning partial conversations", () => {
  const sources = Array.from({ length: 52 }, (_, index) =>
    source(index + 1, `${"x".repeat(SCRIBE_LIMITS.segmentTekst - 50)} fragment ${index + 1}. I have not agreed.`),
  );
  const fragmenten = formaatVoor("psychiatrie").secties.map((section) => ({ sectieId: section.id, van: 1, tot: 52 }));
  assert.throws(() => resolveerGesprekscontext({ fragmenten }, sources, new Set([52]), "psychiatrie"));
});

check("resolver output remains valid under many overlapping legal selections", () => {
  const sources = Array.from({ length: 52 }, (_, index) => source(index + 1));
  const fragmenten = formaatVoor("psychiatrie").secties.flatMap((section) =>
    Array.from({ length: 10 }, (_, index) => ({ sectieId: section.id, van: index + 1, tot: 52 })),
  );
  const result = resolveerGesprekscontext({ fragmenten }, sources, new Set([52]), "psychiatrie");
  assert.equal(isGesprekscontext(result), true);
});

check("matching duplicate selections do not duplicate evidence", () => {
  const selection = { sectieId: "speciele-anamnese", van: 1, tot: 3 };
  assert.deepEqual(
    resolveerGesprekscontext({ fragmenten: [selection, selection] }, exchange, new Set([3]), "psychiatrie"),
    valid,
  );
});

check("unchanged source passes revalidation and source-ID replacement invalidates it", () => {
  assert.deepEqual(geldigeGesprekscontext(valid, exchange, "psychiatrie"), valid);
  const replaced = exchange.map((segment) =>
    segment.volgnummer === 2 ? { ...segment, id: "replacement-id" } : segment,
  );
  assert.deepEqual(geldigeGesprekscontext(valid, replaced, "psychiatrie"), []);
});

check("clinician text corrections invalidate old evidence and newly resolved quotes use the correction", () => {
  const corrected = exchange.map((segment) =>
    segment.volgnummer === 2
      ? {
          ...segment,
          tekstGecorrigeerd: "I was dizzy on Monday, not yesterday.",
          correctieBron: "behandelaar" as const,
        }
      : segment,
  );
  assert.deepEqual(geldigeGesprekscontext(valid, corrected, "psychiatrie"), []);
  const updated = select(corrected);
  assert.equal(updated[0].citaten[1].tekst, corrected[1].tekstGecorrigeerd);
  assert.deepEqual(geldigeGesprekscontext(updated, corrected, "psychiatrie"), updated);
  assert.deepEqual(geldigeGesprekscontext(updated, exchange, "psychiatrie"), []);
});

check("removed source, recording gap and changed section invalidate stored evidence", () => {
  assert.deepEqual(geldigeGesprekscontext(valid, exchange.slice(1), "psychiatrie"), []);
  assert.deepEqual(
    geldigeGesprekscontext(
      valid,
      exchange.map((segment) => ({ ...segment, bron: "systeem" })),
      "psychiatrie",
    ),
    [],
  );
  assert.deepEqual(
    geldigeGesprekscontext([{ ...valid[0], sectieId: "invented-section" }], exchange, "psychiatrie"),
    [],
  );
  assert.deepEqual(geldigeGesprekscontext(valid, exchange, "soap"), []);
});

check("persisted evidence cannot omit an intervening source or recording gap", () => {
  const sparse = [{ ...valid[0], bron: [1, 3], citaten: [valid[0].citaten[0], valid[0].citaten[2]] }];
  assert.deepEqual(geldigeGesprekscontext(sparse, exchange, "psychiatrie"), []);
  assert.deepEqual(
    geldigeGesprekscontext(
      sparse,
      exchange.map((segment) => (segment.volgnummer === 2 ? { ...segment, bron: "systeem" } : segment)),
      "psychiatrie",
    ),
    [],
  );
});

check("malformed stored evidence fails closed rather than crashing report validation", () => {
  const malformed = [
    null,
    {},
    { ...valid[0], citaten: null },
    { ...valid[0], bron: null },
    { ...valid[0], citaten: [null] },
    { ...valid[0], citaten: [{}] },
    { ...valid[0], bron: [1], citaten: [{ ...valid[0].citaten[0], tekst: 3 }] },
    { ...valid[0], status: "goedgekeurd" },
  ];
  for (const item of malformed) {
    assert.deepEqual(geldigeGesprekscontext([item] as unknown as GespreksContext[], exchange, "psychiatrie"), []);
  }
});

check("source bundles cannot contain duplicate, reversed or noninteger numbers", () => {
  for (const positions of [
    [0, 0],
    [1, 0],
  ]) {
    const quotes = positions.map((position) => valid[0].citaten[position]);
    const forged = [{ ...valid[0], bron: quotes.map((quote) => quote.volgnummer), citaten: quotes }];
    assert.deepEqual(geldigeGesprekscontext(forged, exchange, "psychiatrie"), []);
  }
  const noninteger = [{ ...valid[0], bron: [1.5], citaten: [{ ...valid[0].citaten[0], volgnummer: 1.5 }] }];
  assert.deepEqual(geldigeGesprekscontext(noninteger, exchange, "psychiatrie"), []);
});

check("rendering retains complete literal quotes, orders references and deduplicates repeated evidence", () => {
  const single = exchange.map((segment) => select([segment])[0]);
  const rendered = renderGesprekscontext([single[2], single[0], single[1], single[1]], "speciele-anamnese");
  assert.deepEqual(rendered.bron, [1, 2, 3]);
  assert.equal(
    rendered.tekst,
    `${GESPREKSCONTEXT_KOP}\n\n${exchange.map((segment) => `§${segment.volgnummer}: ${segment.tekst}`).join("\n\n")}`,
  );
  assert.deepEqual(renderGesprekscontext(valid, "beleid"), { tekst: "", bron: [] });
});

check("selection input preserves corrected source and marks missing fragments", () => {
  const corrected = { ...exchange[1], tekstGecorrigeerd: "No extra medicine was taken." };
  const gap = { ...exchange[2], bron: "systeem" as const };
  const input = JSON.parse(gesprekscontextInvoer("psychiatrie", [exchange[0]], [corrected, gap]));
  assert.deepEqual(input.nieuweNummers, [2, 3]);
  assert.equal(input.transcript[1].tekst, corrected.tekstGecorrigeerd);
  assert.equal(input.transcript[2].ontbreekt, true);
  assert.deepEqual(
    input.secties.map((section: { id: string }) => section.id),
    formaatVoor("psychiatrie").secties.map((section) => section.id),
  );
});

check("risk source wording is never normalized and risk assessment remains empty", () => {
  const sources = [
    source(1, "Any suicidal thoughts or weapons at home?"),
    source(2, "No suicidal thoughts. I do have a knife at home; I do not want to hurt anyone."),
  ];
  const context = select(sources, 1, 2, "risicotaxatie");
  const state = { ...legeKlinischeStaat(), gesprekscontext: context };
  const normalized = normaliseerRisicopolariteit(state);
  assert.deepEqual(normalized.gesprekscontext, context);
  const section = bouwVerslagDeterministisch(normalized, sources, "psychiatrie", "en").find(
    (item) => item.id === "risicotaxatie",
  );
  assert.ok(section);
  assert.equal(section.tekst, "");
  assert.equal(section.status, "leeg");
  assert.equal(section.vereistBehandelaar, true);
  assert.equal(section.conceptTekst.includes(sources[1].tekst), true);
  assert.deepEqual(section.bron, [1, 2]);
});

check("discussed options produce source context only, no asserted facts, roles or tasks", () => {
  const sources = [
    source(1, "We could consider medication or a hospital review."),
    source(2, "I have not agreed to either. Could we discuss it next time?"),
  ];
  const context = select(sources, 1, 2, "beleid");
  const merged = mergeKlinischeStaat(legeKlinischeStaat(), { ...legeKlinischeStaat(), gesprekscontext: context });
  const result = deterministischeRonde(sources, sources, "psychiatrie", merged, "en");
  assert.deepEqual(result.sprekers, []);
  assert.deepEqual(result.correcties, []);
  assert.deepEqual(extraheerTaken(result.staat), []);
  for (const category of STAAT_CATEGORIEEN) assert.deepEqual(result.staat[category], []);
  for (const field of ["hoofdklacht", "duur", "beloop", "ernst"] as const) assert.equal(result.staat[field], null);
  assert.equal(result.staat.samenvatting, "");
  const report = bouwVerslagDeterministisch(result.staat, sources, "psychiatrie", "en");
  assert.equal(report.find((section) => section.id === "beleid")?.tekst.includes(sources[1].tekst), true);
});

check("all six psychiatry factual sections can display source drafts but require a clinician", () => {
  const factual = formaatVoor("psychiatrie").secties.filter((section) => !section.vereistBehandelaar);
  assert.equal(factual.length, 6);
  const sources = factual.map((_, index) =>
    source(index + 1, `Unconfirmed English conversation window ${index + 1}; no clinical role assigned.`),
  );
  const contexts = factual.flatMap((section, index) => select([sources[index]], index + 1, index + 1, section.id));
  const report = bouwVerslagDeterministisch(
    { ...legeKlinischeStaat(), gesprekscontext: contexts },
    sources,
    "psychiatrie",
    "en",
  );
  for (const definition of factual) {
    const section = report.find((item) => item.id === definition.id);
    assert.ok(section);
    assert.equal(section.status, "concept");
    assert.equal(section.vereistBehandelaar, true);
    assert.equal(section.tekst, section.conceptTekst);
    assert.equal(onbewerkteGesprekscontext(section), true);
  }
  assert.equal(report.filter((section) => section.tekst.length > 0).length, 6);
  assert.equal(report.filter((section) => section.status === "leeg").length, 2);
});

check("source prefills never replace clinician-entered or previously validated factual content", () => {
  for (const doorBehandelaar of [true, false]) {
    const state = legeKlinischeStaat();
    state.symptomen = [{ tekst: "Previously recorded symptom.", bron: [1], ingetrokken: false, doorBehandelaar }];
    state.plan = [{ tekst: "Previously recorded clinician plan.", bron: [3], ingetrokken: false, doorBehandelaar }];
    state.medicatie = [
      {
        naam: "Synthetic medicine",
        tekst: "Clinician checked medication.",
        dosering: "5 mg",
        gebruik: "huidig",
        bron: [2],
        ingetrokken: false,
        doorBehandelaar,
      },
    ];
    state.gesprekscontext = [
      ...select(exchange, 1, 3, "speciele-anamnese"),
      ...select(exchange, 1, 3, "somatiek-medicatie"),
      ...select(exchange, 1, 3, "beleid"),
    ];
    const before = structuredClone(state);
    const report = bouwVerslagDeterministisch(state, exchange, "psychiatrie", "en");
    const history = report.find((section) => section.id === "speciele-anamnese");
    const medication = report.find((section) => section.id === "somatiek-medicatie");
    const plan = report.find((section) => section.id === "beleid");
    assert.ok(history);
    assert.ok(medication);
    assert.ok(plan);
    assert.equal(history.conceptTekst.includes("Previously recorded symptom."), true);
    assert.equal(medication.conceptTekst.includes("Synthetic medicine"), true);
    assert.equal(medication.conceptTekst.includes("5 mg"), true);
    assert.equal(plan.conceptTekst.includes("Previously recorded clinician plan."), true);
    for (const section of [history, medication, plan]) {
      assert.equal(section.conceptTekst.includes(GESPREKSCONTEXT_KOP), false);
      assert.equal(section.vereistBehandelaar, true);
    }
    for (const section of [history, plan]) {
      assert.equal(section.conceptTekst.includes(ENGLISH_FACT_REPORT_HEADER), doorBehandelaar);
      assert.equal(section.tekst, doorBehandelaar ? section.conceptTekst : "");
      assert.equal(section.status, doorBehandelaar ? "concept" : "leeg");
    }
    assert.equal(medication.tekst, "", "Structured medication details retain the full canonical manual context");
    assert.equal(medication.status, "leeg");
    assert.equal(medication.conceptTekst.includes(ENGLISH_FACT_REPORT_HEADER), false);
    assert.deepEqual(state, before, "Generating a report must not alter facts or source context");
  }
});

check("clinician assessment context remains visible and assessment text stays blank", () => {
  const state = legeKlinischeStaat();
  state.overwegingen = [
    { tekst: "The clinician recorded this consideration.", bron: [1], ingetrokken: false, doorBehandelaar: true },
  ];
  state.gesprekscontext = select(exchange, 1, 3, "overwegingen");
  const section = bouwVerslagDeterministisch(state, exchange, "psychiatrie", "en").find(
    (item) => item.id === "overwegingen",
  );
  assert.ok(section);
  assert.equal(section.conceptTekst.includes("The clinician recorded this consideration."), true);
  assert.equal(section.conceptTekst.includes(GESPREKSCONTEXT_KOP), false);
  assert.equal(section.tekst, "");
  assert.equal(section.status, "leeg");
  assert.equal(section.vereistBehandelaar, true);
  assert.deepEqual(section.bron, [1]);
});

check("unchanged quote prefills including surrounding whitespace are blocked by approval guard", () => {
  const section = bouwVerslagDeterministisch(
    { ...legeKlinischeStaat(), gesprekscontext: valid },
    exchange,
    "psychiatrie",
    "en",
  ).find((item) => item.id === "speciele-anamnese");
  assert.ok(section);
  assert.equal(onbewerkteGesprekscontext(section), true);
  assert.equal(onbewerkteGesprekscontext(section, `\n ${section.conceptTekst} \n`), true);
  assert.equal(onbewerkteGesprekscontext(section, "Clinician-reviewed account of the conversation."), false);
  assert.equal(
    onbewerkteGesprekscontext({
      ...section,
      conceptTekst: "Ordinary clinician text.",
      tekst: "Ordinary clinician text.",
    }),
    false,
  );
});

check("oversized report source bundles never cut a denial to fit the section limit", () => {
  const sources = Array.from({ length: Math.ceil(SCRIBE_LIMITS.sectieTekst / 3_800) + 1 }, (_, index) =>
    source(index + 1, `${"x".repeat(3_800)} I have not agreed, fragment ${index + 1}.`),
  );
  const contexts = select(sources, 1, sources.length, "beleid");
  const section = bouwVerslagDeterministisch(
    { ...legeKlinischeStaat(), gesprekscontext: contexts },
    sources,
    "psychiatrie",
    "en",
  ).find((item) => item.id === "beleid");
  assert.ok(section);
  assert.equal(section.conceptTekst.length <= SCRIBE_LIMITS.sectieTekst, true);
  assert.equal(section.conceptTekst.includes(GESPREKSCONTEXT_KOP), false);
  assert.equal(section.conceptTekst.includes("Er zijn te veel broncitaten voor één verslagsectie."), true);
  assert.equal(section.conceptTekst.includes("Bekijk de gekoppelde transcriptregels"), true);
  assert.equal(section.conceptTekst.includes(ENGELSE_HANDMATIGE_BEOORDELING), false);
  assert.deepEqual(
    section.bron,
    sources.map((segment) => segment.volgnummer),
  );
  assert.equal(section.tekst, "");
});

check("report generation revalidates stale context instead of rendering it", () => {
  const corrected = exchange.map((segment) => ({ ...segment, id: `new-${segment.id}` }));
  const report = bouwVerslagDeterministisch(
    { ...legeKlinischeStaat(), gesprekscontext: valid },
    corrected,
    "psychiatrie",
    "en",
  );
  for (const section of report) {
    assert.equal(section.conceptTekst.includes(GESPREKSCONTEXT_KOP), false);
    assert.deepEqual(section.bron, []);
  }
});

for (const consultType of CONSULT_TYPES) {
  check(`source groups and clinician boundaries hold for format ${consultType}`, () => {
    const definitions = formaatVoor(consultType).secties;
    const sources = definitions.map((_, index) => source(index + 1));
    const contexts = definitions.flatMap((section, index) =>
      select([sources[index]], index + 1, index + 1, section.id, consultType),
    );
    assert.equal(isGesprekscontext(contexts), true);
    assert.deepEqual(geldigeGesprekscontext(contexts, sources, consultType), contexts);
    const report = bouwVerslagDeterministisch(
      { ...legeKlinischeStaat(), gesprekscontext: contexts },
      sources,
      consultType,
      "en",
    );
    assert.deepEqual(
      report.map((section) => section.id),
      definitions.map((definition) => definition.id),
    );
    for (let index = 0; index < definitions.length; index += 1) {
      const section = report[index];
      assert.deepEqual(section.bron, [sources[index].volgnummer]);
      assert.equal(section.conceptTekst.includes(sources[index].tekst), true);
      assert.equal(section.vereistBehandelaar, true);
      assert.equal(section.tekst, definitions[index].vereistBehandelaar ? "" : section.conceptTekst);
      if (section.tekst) assert.equal(onbewerkteGesprekscontext(section), true);
    }
  });
}

console.log(`Scribe source context: ${passed} passed, ${failed.length} failed; no provider calls.`);
if (failed.length > 0) process.exitCode = 1;

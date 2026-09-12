// Actual UI controllers with synthetic I/O: no audio, provider calls or patient data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const sharedModules = new Map();
function sharedModule(name) {
  const file = path.join(root, "src/lib/careon-scribe", `${name}.ts`);
  if (sharedModules.has(file)) return sharedModules.get(file);
  const context = {
    exports: {},
    require(dependency) {
      assert.match(dependency, /^\.\/[a-z-]+$/, "UI fixtures may load only pure Scribe modules");
      return sharedModule(dependency.slice(2));
    },
  };
  sharedModules.set(file, context.exports);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  return context.exports;
}

const { ENGELSE_HANDMATIGE_BEOORDELING, bouwVerslagDeterministisch } = sharedModule("deterministisch");
const { legeKlinischeStaat } = sharedModule("klinische-staat");
const { GESPREKSCONTEXT_KOP } = sharedModule("gesprekscontext");
const { ENGLISH_FACT_REPORT_HEADER } = sharedModule("english-report");
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => value === b[index]);
const tick = async () => {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
};

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function text(tree) {
  if (typeof tree === "number") return String(tree);
  if (typeof tree === "string") return tree;
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree && typeof tree === "object") return text(tree.props?.children);
  return "";
}

function button(tree, label) {
  return nodes(tree).find((node) => node.type === "Button" && text(node) === label);
}

function controller(file, component, props, remote = {}, display = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useId: () => `test-${cursor++}`,
    useCallback(callback, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useRef(value) {
      const index = cursor++;
      slots[index] ??= { current: value };
      return slots[index];
    },
    useState(value) {
      const index = cursor++;
      slots[index] ??= { value: typeof value === "function" ? value() : value };
      return [
        slots[index].value,
        (next) => {
          slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
        },
      ];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps))
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
    },
  };
  const context = {
    exports: {},
    Blob,
    Date,
    window: {
      localStorage: { getItem: () => null },
      matchMedia: () => ({
        matches: display.breedScherm ?? false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      setInterval: () => 1,
      clearInterval: () => undefined,
    },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name.endsWith("remote.client")) return remote;
      if (name.endsWith("opname.client"))
        return { useScribeOpname: () => ({ status: "uit", wachtrijLeeg: true, lokaleGaten: 0 }) };
      if (name.endsWith("drafts.client"))
        return { useUnsentScribeDraft: () => false, hasUnsentScribeDraft: () => false };
      if (name.endsWith("native-file.client")) return { hasCareonNativeFileBridge: () => false };
      if (name.endsWith("scribe-navigatie")) return { zetOpnameActief: () => undefined };
      if (name.endsWith("formaten")) return sharedModule("formaten");
      if (name.endsWith("english-report")) return sharedModule("english-report");
      if (name.endsWith("deterministisch")) return sharedModule("deterministisch");
      if (name.endsWith("gesprekscontext")) return sharedModule("gesprekscontext");
      if (name.endsWith("types"))
        return {
          GEANNULEERD_GRONDEN: [],
          SCRIBE_LIMITS: { sectieTekst: 20000, segmentTekst: 4000, patientReferentieMax: 50 },
          isPatientReferentie: (value) => value === "QA-EN-001",
          isConsultType: () => false,
          isStaatCategorie: () => false,
          vulConsenttekstIn: () => "Synthetic consent text",
        };
      if (name.endsWith("klinische-staat"))
        return {
          STAAT_LABELS: {},
          medicatieRegel: (row) => row.naam,
          bronLabel: sharedModule("klinische-staat").bronLabel,
        };
      if (name.endsWith("careon-scribe"))
        return {
          EMPTY_SCRIBE_INSTELLINGEN: {},
          ANALYSE_BRON_LABELS: {},
          GEANNULEERD_GROND_LABELS: {},
          SECTIE_STATUS_LABELS: {},
          SPREKER_LABELS: { arts: "Arts", patient: "Patiënt", overig: "Overig", onbekend: "Onbekend" },
          CONSULT_TYPE_LABELS: {},
          SESSIE_STATUS_LABELS: {},
        };
      return new Proxy({}, { get: (_, key) => (key === "cn" ? (...parts) => parts.join(" ") : key) });
    },
  };
  let source = fs.readFileSync(path.join(root, "src/app/(main)/scribe/_components", file), "utf8");
  // Expose the row only inside this synthetic module; product exports stay unchanged.
  if (component === "TranscriptRegel") source += "\nexport { TranscriptRegel };\n";
  if (component === "SectieBlok") source += "\nexport { SectieBlok };\n";
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    context,
  );
  const render = () => {
    cursor = 0;
    const tree = context.exports[component](props);
    const pending = effects;
    effects = [];
    pending.forEach((effect) => {
      effect();
    });
    return tree;
  };
  return Object.assign(render, {
    exports: context.exports,
    refs: () => slots.filter((slot) => slot && "current" in slot),
  });
}

async function verifyEnglishCapabilities() {
  for (const live of [false, true]) {
    for (const analyseLive of [false, true]) {
      for (const aiAnalyseAan of [false, true]) {
        let resolve;
        const settings = new Promise((done) => {
          resolve = done;
        });
        const render = controller(
          "nieuw-consult-form.tsx",
          "NieuwConsultForm",
          {},
          {
            haalScribeInstellingen: () => settings,
          },
        );
        let tree = render();
        assert.equal(text(tree).includes("Automatische extractie is hier niet beschikbaar voor Engels"), false);
        const taal = nodes(tree).find((node) => node.type === "NativeSelect" && node.props.value === "nl");
        taal.props.onChange({ target: { value: "en" } });
        tree = render();
        assert.match(text(tree), /wordt gecontroleerd/);
        resolve({
          ok: true,
          instellingen: { aiAnalyseAan, standaardFormaat: "soap" },
          revision: 1,
          providerStatus: { live, analyseLive },
        });
        await tick();
        tree = render();
        const available = live && analyseLive && aiAnalyseAan;
        assert.equal(text(tree).includes("AI-analyse is ingeschakeld"), available);
        assert.equal(text(tree).includes("notities onvolledig blijven of handmatige invoer vereisen"), available);
        assert.equal(text(tree).includes("AI-extractie is ingeschakeld voor Engels"), false);
        assert.equal(text(tree).includes("Automatische extractie is hier niet beschikbaar voor Engels"), !available);
        const selector = nodes(tree).find((node) => node.type === "NativeSelect" && node.props.value === "en");
        assert.ok(nodes(tree).some((node) => node.props?.id === selector.props["aria-describedby"]));
        assert.equal(button(tree, "Consult starten").props.disabled, true, "Capability text must not waive consent");
      }
    }
  }
  const render = controller(
    "nieuw-consult-form.tsx",
    "NieuwConsultForm",
    {},
    {
      haalScribeInstellingen: async () => ({ ok: false }),
    },
  );
  const tree = render();
  nodes(tree)
    .find((node) => node.type === "NativeSelect" && node.props.value === "nl")
    .props.onChange({
      target: { value: "en" },
    });
  await tick();
  assert.match(text(render()), /kon niet worden gecontroleerd/);
}

function verifyEmptyStateAndDemo() {
  const stateProps = {
    envelop: {
      staat: {
        samenvatting: "Synthetic extraction unavailable notice",
        medicatie: [],
        allergieen: [],
        overwegingen: [],
        acties: [],
      },
      bron: "deterministisch",
    },
    bewerkbaar: false,
    bezig: false,
  };
  const render = controller("staat-paneel.tsx", "StaatPaneel", stateProps);
  const tree = render();
  assert.equal(text(tree).includes("Nog niet besproken"), false, "Missing extraction must not assert absence");
  assert.equal(text(tree).match(/Geen informatie vastgelegd/g)?.length, 17);
  assert.equal(text(tree).includes("geen onderbouwde consultinformatie"), false);
  stateProps.envelop.bron = "ai";
  assert.match(text(render()), /geen onderbouwde consultinformatie/);
  stateProps.envelop.staat.hoofdklacht = "A literal validated source statement";
  assert.equal(text(render()).includes("geen onderbouwde consultinformatie"), false);
  stateProps.envelop.staat.hoofdklacht = null;
  stateProps.envelop.staat.overwegingen = [{ tekst: "A clinician statement", bron: [1], ingetrokken: false }];
  assert.equal(text(render()).includes("geen onderbouwde consultinformatie"), false);
  stateProps.envelop.staat.samenvatting = ENGELSE_HANDMATIGE_BEOORDELING;
  assert.equal(
    text(render()).includes(ENGELSE_HANDMATIGE_BEOORDELING),
    false,
    "AI must not show stale fallback status",
  );
  stateProps.envelop.staat.overwegingen = [];
  assert.match(
    text(render()),
    /geen onderbouwde consultinformatie/,
    "Hiding stale status must preserve empty-AI alert",
  );
  stateProps.envelop.bron = "deterministisch";
  assert.ok(
    text(render()).includes(ENGELSE_HANDMATIGE_BEOORDELING),
    "Current deterministic status must remain visible",
  );
  stateProps.envelop.bron = "ai";
  for (const summary of [
    "Clinical summary preserved.",
    `${ENGELSE_HANDMATIGE_BEOORDELING} Additional clinical text.`,
  ]) {
    stateProps.envelop.staat.samenvatting = summary;
    assert.ok(text(render()).includes(summary), "Only the exact status marker may be suppressed");
  }
  const demo = controller("opname-besturing.tsx", "OpnameBesturing", {
    bron: "lokaal",
    opname: { status: "uit", wachtrijLeeg: true },
    demoRest: 30,
  });
  assert.match(text(demo()), /vast Nederlands script, ook bij taalkeuze Engels/);
  assert.match(text(demo()), /geen audio verwerkt/);
  const queueText = demo.exports.opnameWachtrijTekst;
  for (const status of ["opnemen", "starten", "gepauzeerd"]) assert.equal(queueText(status), "Fragmenten verwerken…");
  for (const status of ["stoppen", "uit"]) assert.equal(queueText(status), "Laatste fragmenten verwerken…");
}

function verifyBulkApproval() {
  let approvals = 0;
  let prevented = 0;
  const props = {
    sessie: { id: "synthetic", status: "afgerond", consultType: "soap", ontbrekendeFragmenten: 0 },
    notitie: {
      id: "synthetic-note",
      bewerkRevisie: 1,
      versie: 1,
      formaat: "soap",
      status: "concept",
      secties: [
        { id: "a", status: "concept", vereistBehandelaar: true, tekst: "", bron: [] },
        { id: "b", status: "concept", vereistBehandelaar: true, tekst: "", bron: [] },
      ],
    },
    instellingen: {},
    bron: "lokaal",
    rol: "eigenaar",
    bezig: false,
    onAlleGoedkeuren: async () => {
      approvals += 1;
      return [];
    },
  };
  const render = controller("verslag-review.tsx", "VerslagReview", props);
  let tree = render();
  assert.equal(button(tree, "Alles goedkeuren").props.disabled, true);
  assert.match(text(tree), /afzonderlijke goedkeuring/);
  const confirm = nodes(tree).find((node) => node.type === "AlertDialogAction" && text(node) === "Goedkeuren");
  assert.equal(confirm.props.disabled, true);
  confirm.props.onClick({
    preventDefault: () => {
      prevented += 1;
    },
  });
  assert.equal(prevented, 1);
  assert.equal(approvals, 0, "A direct/stale trigger must not call bulk approval when no sections are eligible");
  props.notitie.secties[0] = { ...props.notitie.secties[0], vereistBehandelaar: false, tekst: "Synthetic facts" };
  tree = render();
  assert.equal(button(tree, "Alles goedkeuren").props.disabled, false, "An open factual section remains eligible");
  props.notitie.secties[0] = { ...props.notitie.secties[0], status: "goedgekeurd" };
  tree = render();
  assert.equal(button(tree, "Alles goedkeuren").props.disabled, true, "Already approved facts are not eligible");
}

function verifyConversationContext() {
  const navigation = [];
  const props = {
    envelop: { staat: legeKlinischeStaat(), bron: "ai", verouderd: false },
    bewerkbaar: false,
    bezig: false,
    onBron: (numbers) => navigation.push(numbers),
  };
  const render = controller("staat-paneel.tsx", "StaatPaneel", props);
  const contextPanel = (tree) =>
    nodes(tree).find(
      (node) => node.type === "section" && node.props["aria-label"] === "Gesprekscitaten — nog controleren",
    );
  assert.equal(contextPanel(render()), undefined, "Older states without context remain supported");
  const quotes = ["Exact question?", "No.", "  Exact wording, with whitespace.\nSecond line.", "Uncertain response."];
  props.envelop.staat.gesprekscontext = [
    {
      sectieId: "speciele-anamnese",
      status: "te_controleren",
      bron: [41, 42, 43, 44],
      citaten: quotes.map((quote, index) => ({ segmentId: `source-${index}`, volgnummer: index + 41, tekst: quote })),
    },
    {
      sectieId: "reden-van-komst",
      status: "te_controleren",
      bron: [45],
      citaten: [{ segmentId: "source-45", volgnummer: 45, tekst: "A full source statement." }],
    },
    {
      sectieId: "speciele-anamnese",
      status: "te_controleren",
      bron: [40, 41],
      citaten: [
        { segmentId: "source-0", volgnummer: 41, tekst: quotes[0] },
        { segmentId: "source-40", volgnummer: 40, tekst: "An earlier source statement." },
      ],
    },
    { sectieId: "beleid", status: "te_controleren", bron: [], citaten: [] },
  ];
  let tree = render();
  const panel = contextPanel(tree);
  assert.ok(panel);
  assert.match(text(panel), /6 citaten/);
  assert.match(text(panel), /Speciële anamnese/);
  assert.match(text(panel), /Reden van komst/);
  assert.match(text(panel), /Spreker en betekenis nog niet bevestigd/);
  assert.equal(text(panel).includes("Beleid"), false, "Empty groups must not imply available excerpts");
  const excerpts = nodes(panel).filter((node) => node.type === "blockquote");
  assert.deepEqual(
    excerpts.map(text),
    ["An earlier source statement.", ...quotes, "A full source statement."],
    "Every excerpt remains exact and complete",
  );
  const groups = nodes(panel).filter((node) => node.type === "details");
  assert.equal(groups.length, 2, "Overlapping windows render once per section, deduplicated by segment ID");
  assert.equal(groups[0].props.open, false, "Long groups start collapsed, with all excerpt text retained");
  assert.equal(groups[1].props.open, true);
  assert.match(text(tree), /nog geen onderbouwde klinische feiten/);
  assert.match(text(tree), /wel 6 gesprekscitaten beschikbaar/);
  assert.equal(text(tree).includes("geen onderbouwde consultinformatie opgeleverd"), false);
  const sources = nodes(panel).filter((node) => node.type?.name === "BronKnoppen");
  for (const [index, source] of sources.entries()) {
    const sourceTree = source.type(source.props);
    const link = nodes(sourceTree).find((node) => node.type === "button");
    assert.equal(link.props["aria-label"], `Toon transcriptregel ${index + 40}`);
    link.props.onClick();
  }
  assert.deepEqual(
    navigation.map((numbers) => [...numbers]),
    [[40], [41], [42], [43], [44], [45]],
  );
  props.envelop.staat.hoofdklacht = "A separately validated fact.";
  props.envelop.verouderd = true;
  tree = render();
  assert.ok(contextPanel(tree), "Context remains available alongside validated facts");
  assert.equal(text(tree).includes("nog geen onderbouwde klinische feiten"), false);
  assert.match(text(tree), /Analyse verouderd sinds uw correctie/);
  props.envelop.staat.gesprekscontext = [];
  assert.equal(contextPanel(render()), undefined);
}

function verifySourceDraftApproval() {
  const draft = `${GESPREKSCONTEXT_KOP}\n\n§41: Exact question?\n\n§42: No.`;
  const approvals = [];
  const props = {
    sessie: { id: "synthetic", status: "afgerond", consultType: "psychiatrie", ontbrekendeFragmenten: 0 },
    notitie: {
      id: "source-context-note",
      bewerkRevisie: 1,
      versie: 1,
      formaat: "psychiatrie",
      status: "concept",
      secties: [
        {
          id: "speciele-anamnese",
          titel: "Speciële anamnese",
          status: "concept",
          vereistBehandelaar: true,
          tekst: draft,
          conceptTekst: draft,
          bron: [],
        },
        {
          id: "risicotaxatie",
          titel: "Risicotaxatie",
          status: "leeg",
          vereistBehandelaar: true,
          tekst: "",
          conceptTekst: "",
          bron: [],
        },
      ],
    },
    instellingen: {},
    bron: "lokaal",
    rol: "eigenaar",
    bezig: false,
    onSectie: (...args) => approvals.push(args),
  };
  const render = controller("verslag-review.tsx", "VerslagReview", props);
  const section = () => nodes(render()).find((node) => node.type?.name === "SectieBlok");
  let block = section();
  let tree = block.type(block.props);
  assert.match(text(tree), /Broncitaten — afzonderlijk controleren/);
  assert.match(text(tree), /Werk deze broncitaten uit tot een gecontroleerde notitie/);
  assert.equal(button(tree, "Goedkeuren").props.disabled, true);
  assert.equal(button(render(), "Alles goedkeuren").props.disabled, true);
  block.props.onGoedkeuren();
  assert.equal(approvals.length, 0, "Direct/stale handlers cannot approve unchanged source excerpts");
  block.props.onConcept(` \n${draft}\n `);
  block = section();
  tree = block.type(block.props);
  assert.equal(button(tree, "Goedkeuren").props.disabled, true, "Whitespace edits are not review");
  block.props.onGoedkeuren();
  assert.equal(approvals.length, 0);
  block.props.onConcept("A note the clinician has checked and edited.");
  block = section();
  tree = block.type(block.props);
  assert.equal(button(tree, "Goedkeuren").props.disabled, false);
  block.props.onGoedkeuren();
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0][1].tekst, "A note the clinician has checked and edited.");
  assert.equal(approvals[0][1].status, "goedgekeurd");
  const editedProps = { ...block.props, sectie: { ...block.props.sectie, status: "bewerkt" } };
  assert.match(text(block.type(editedProps)), /Handmatig bewerkt — afzonderlijk controleren/);
  assert.equal(text(block.type(editedProps)).includes("Broncitaten — afzonderlijk controleren"), false);
  const approvedProps = { ...block.props, sectie: { ...block.props.sectie, status: "goedgekeurd" } };
  assert.match(text(block.type(approvedProps)), /Afzonderlijk goedgekeurd/);
  const emptyProps = { ...block.props, sectie: { ...block.props.sectie, status: "leeg", tekst: "" }, concept: "" };
  assert.match(text(block.type(emptyProps)), /Handmatige invoer vereist/);
  assert.equal(text(block.type(emptyProps)).includes("Broncitaten — afzonderlijk controleren"), false);
}

function verifyRemainingReportContext() {
  const navigation = [];
  const sources = [
    { nr: 196, tekst: "I take sertraline 50 mg." },
    { nr: 205, tekst: "I might take another medicine, but I cannot remember its name." },
    { nr: 206, tekst: "  Exact source wording.\nAnother full line." },
    { nr: 207, tekst: "No, I have not agreed to admission." },
    { nr: 208, tekst: `${"Full source sentence.\n".repeat(90)}The final uncertainty remains.` },
  ].map((source) => ({
    id: `source-${source.nr}`,
    volgnummer: source.nr,
    tekst: source.tekst,
    tekstGecorrigeerd: null,
    spreker: "onbekend",
    bron: "live",
  }));
  const group = (numbers) => ({
    sectieId: "somatiek-medicatie",
    bron: numbers,
    status: "te_controleren",
    citaten: numbers.map((nr) => {
      const source = sources.find((row) => row.volgnummer === nr);
      return { segmentId: source.id, volgnummer: nr, tekst: source.tekst };
    }),
  });
  const context = [group([196]), group([205, 206, 207]), group([206, 207, 208])];
  const draft = `${ENGLISH_FACT_REPORT_HEADER}\n\n- ${sources[0].tekst} (§196)`;
  const factSection = {
    id: "somatiek-medicatie",
    titel: "Somatiek en medicatie",
    tekst: draft,
    conceptTekst: draft,
    bron: [196],
    status: "concept",
    vereistBehandelaar: true,
  };
  const props = {
    sessie: { id: "synthetic", status: "afgerond", consultType: "psychiatrie", ontbrekendeFragmenten: 0 },
    notitie: { id: "mixed-note", formaat: "psychiatrie", status: "concept", secties: [factSection] },
    instellingen: {},
    rol: "eigenaar",
    bron: "centraal",
    bezig: false,
    gesprekscontext: context,
    segmenten: sources,
    onBron: (numbers) => navigation.push([...numbers]),
  };
  const render = controller("verslag-review.tsx", "VerslagReview", props);
  const block = () => nodes(render()).find((node) => node.type?.name === "SectieBlok");
  let row = block();
  const sectionTree = row.type(row.props);
  assert.equal(nodes(sectionTree).find((node) => node.type === "Textarea").props.value, draft);
  const residual = nodes(sectionTree).find((node) => node.type?.name === "GesprekscitatenBlok");
  assert.ok(residual, "Accepted facts must not hide remaining source conversations");
  let residualTree = residual.type(residual.props);
  assert.equal(residualTree.props.open, false, "Long source lists start collapsed");
  assert.match(text(residualTree), /Nog te controleren gesprekscitaten \(4\)/);
  assert.match(text(residualTree), /niet als feit in het concept opgenomen/);
  assert.deepEqual(
    nodes(residualTree)
      .filter((node) => node.type === "blockquote")
      .map(text),
    sources.slice(1).map((source) => source.tekst),
  );
  const scroll = nodes(residualTree).find(
    (node) => node.props?.["aria-label"] === "Nog te controleren gesprekscitaten: Somatiek en medicatie",
  );
  assert.equal(scroll.props.tabIndex, 0);
  assert.match(scroll.props.className, /max-h-64/);
  for (const link of nodes(residualTree).filter((node) => node.type === "button")) link.props.onClick();
  assert.deepEqual(navigation, [[205], [206], [207], [208]]);
  assert.equal(
    text(residualTree).includes(sources[0].tekst),
    false,
    "The fully cited accepted fact needs no duplicate quote",
  );
  assert.equal(
    nodes(sectionTree)
      .find((node) => node.type === "Textarea")
      .props.value.includes(sources[1].tekst),
    false,
  );

  const quoted = sharedModule("gesprekscontext").renderGesprekscontext(context, factSection.id);
  props.notitie.secties = [{ ...factSection, conceptTekst: quoted.tekst, tekst: quoted.tekst, bron: quoted.bron }];
  row = block();
  assert.equal(row.props.gesprekscitaten.length, 0, "An identical existing quote-only preview must not be duplicated");
  props.notitie.secties = [factSection];
  props.bronVerouderd = true;
  assert.equal(block().props.gesprekscitaten.length, 0, "Stale role/text context must not be rendered");
  props.bronVerouderd = false;
  props.segmenten = sources.map((source) =>
    source.volgnummer === 205 ? { ...source, tekstGecorrigeerd: "Corrected source wording." } : source,
  );
  assert.equal(
    block().props.gesprekscitaten.some((quote) => quote.volgnummer === 205),
    false,
    "Source binding also rejects an old quote before any stale flag reaches the view",
  );
  props.segmenten = sources;

  props.notitie = {
    ...props.notitie,
    formaat: "soap",
    secties: [{ ...factSection, id: "subjectief", titel: "Subjectief" }],
  };
  const otherGroup = nodes(render()).find(
    (node) => node.props?.["aria-label"] === "Gesprekscitaten buiten dit verslagformaat",
  );
  assert.ok(otherGroup, "Changing the report format must retain unmapped source without reclassification");
  const otherBlock = nodes(otherGroup).find((node) => node.type?.name === "GesprekscitatenBlok");
  residualTree = otherBlock.type(otherBlock.props);
  assert.deepEqual(
    nodes(residualTree)
      .filter((node) => node.type === "blockquote")
      .map(text),
    sources.map((source) => source.tekst),
  );
  assert.equal(block().props.gesprekscitaten.length, 0);
  props.rol = "vrijgave";
  assert.equal(
    nodes(render()).some((node) => node.props?.["aria-label"] === "Gesprekscitaten buiten dit verslagformaat"),
    false,
    "Private source remains owner-only",
  );
}

function verifyLongReportAndFactDraft() {
  const draft = `${GESPREKSCONTEXT_KOP}\n\n${"Full source sentence.\n".repeat(200)}Final denial: I did not agree.`;
  const saved = [];
  const props = {
    sectie: {
      id: "speciele-anamnese",
      titel: "Speciële anamnese",
      tekst: draft,
      conceptTekst: draft,
      bron: [1],
      status: "concept",
      vereistBehandelaar: true,
    },
    beoordelingsSectie: false,
    bewerkbaar: true,
    exporteerbaar: false,
    bezig: false,
    concept: draft,
    onConcept: (value) => saved.push(value),
  };
  const render = controller("verslag-review.tsx", "SectieBlok", props);
  const field = (tree) => nodes(tree).find((node) => node.type === "Textarea");
  const context = (tree) => nodes(tree).find((node) => node.props?.["aria-label"] === "Broncontext: Speciële anamnese");
  let tree = render();
  assert.match(field(tree).props.className, /max-h-64/);
  assert.match(field(tree).props.className, /overflow-y-auto/);
  assert.equal(field(tree).props.value, draft, "Bounding the editor must preserve the complete stored quote draft");
  assert.equal(text(context(tree)), draft);
  assert.equal(context(tree).props.tabIndex, 0, "The context scroll region is keyboard accessible");
  assert.match(context(tree).props.className, /max-h-64/);
  const expand = button(tree, "Weergave uitklappen");
  assert.equal(expand.props["aria-expanded"], false);
  assert.equal(expand.props["aria-controls"], field(tree).props.id);
  expand.props.onClick();
  tree = render();
  assert.equal(field(tree).props.className.includes("max-h-64"), false);
  assert.equal(context(tree).props.className.includes("max-h-64"), false);
  assert.equal(field(tree).props.value, draft);
  assert.equal(saved.length, 0, "Expanding or collapsing must not rewrite or save text");
  button(tree, "Weergave beperken").props.onClick();
  props.sectie = { ...props.sectie, status: "goedgekeurd" };
  tree = render();
  const approved = nodes(tree).find((node) => node.props?.["aria-label"] === "Sectietekst: Speciële anamnese");
  assert.equal(text(approved), draft);
  assert.equal(approved.props.tabIndex, 0);
  assert.match(approved.props.className, /max-h-64/);
  const facts = `${ENGLISH_FACT_REPORT_HEADER}\n\n- Exact clinician-reviewed statement. (§1)`;
  props.sectie = { ...props.sectie, tekst: facts, conceptTekst: facts, status: "concept" };
  props.concept = facts;
  tree = render();
  assert.match(text(tree), /Vastgelegde feiten — afzonderlijk controleren/);
  assert.match(text(tree), /Controleer de vastgelegde feiten, pas het concept zo nodig aan/);
  assert.match(text(tree), /Oorspronkelijk feitenconcept/);
  assert.equal(text(tree).includes("Handmatige invoer vereist"), false);
  assert.equal(
    button(tree, "Goedkeuren").props.disabled,
    false,
    "Verified factual drafts may be approved individually without quote-context rewriting",
  );
}

async function verifyWorkspaceCorrectionRefresh(breedScherm) {
  const source = {
    id: "source-1",
    volgnummer: 1,
    spreker: "onbekend",
    tekst: "Synthetic original source.",
    tekstGecorrigeerd: null,
    beginMs: 0,
    eindMs: 8000,
    bron: "live",
  };
  const context = [
    {
      sectieId: "speciele-anamnese",
      bron: [1],
      status: "te_controleren",
      citaten: [{ segmentId: source.id, volgnummer: 1, tekst: source.tekst }],
    },
  ];
  const server = {
    ok: true,
    rol: "eigenaar",
    bron: "centraal",
    vrijgaveReden: null,
    instellingen: {},
    taken: [],
    sessie: {
      id: "synthetic",
      status: "afgerond",
      consultType: "psychiatrie",
      segmentTeller: 1,
      ontbrekendeFragmenten: 0,
    },
    segmenten: [source],
    staat: {
      staat: { ...legeKlinischeStaat(), gesprekscontext: context },
      versie: 1,
      laatsteSegment: 1,
      verouderd: Boolean(0),
      epdLijstBeoordeeld: true,
    },
    notitie: { id: "original-note", versie: 1, secties: [], status: "concept", bewerkRevisie: 1 },
  };
  const calls = [];
  const failures = new Set(["save"]);
  const remote = {
    haalSessie: async () => {
      calls.push("load");
      return structuredClone(server);
    },
    haalScribeInstellingen: async () => ({ ok: false }),
    wijzigSegment: async (_id, _number, patch) => {
      if (failures.has("save")) return { ok: false, fout: "Synthetic save failed" };
      server.segmenten[0] = { ...server.segmenten[0], ...patch };
      if (patch.spreker) server.segmenten[0].sprekerBron = "behandelaar";
      delete server.staat.staat.gesprekscontext;
      server.staat.verouderd = true;
      server.staat.laatsteSegment = 0;
      server.staat.versie += 1;
      return { ok: true, segment: structuredClone(server.segmenten[0]), verouderd: true, laatsteSegment: 0 };
    },
    genereerNotitie: async () => {
      calls.push("generate");
      if (server.staat.verouderd) return { ok: false, status: 409 };
      server.notitie = { ...server.notitie, id: "regenerated-note", versie: 2 };
      return { ok: true, notitie: structuredClone(server.notitie) };
    },
    analyseer: async () => {
      calls.push("analyse");
      server.staat = {
        ...server.staat,
        verouderd: false,
        laatsteSegment: 1,
        versie: server.staat.versie + 1,
        staat: {
          ...server.staat.staat,
          gesprekscontext: [
            { ...context[0], citaten: [{ ...context[0].citaten[0], tekst: server.segmenten[0].tekstGecorrigeerd }] },
          ],
        },
      };
      return { ok: true, envelop: structuredClone(server.staat), taken: [], sprekers: [], correcties: [] };
    },
  };
  const render = controller("consult-werkruimte.tsx", "ConsultWerkruimte", { sessieId: "synthetic" }, remote, {
    breedScherm,
  });
  render();
  await tick();
  const transcript = () => nodes(render()).find((node) => node.type === "TranscriptPaneel");
  const envelope = () => render.refs().find((ref) => ref.current?.staat && "laatsteSegment" in ref.current)?.current;
  assert.equal(transcript().props.bewerkbaar, true);
  assert.equal(transcript().props.invoerToegestaan, false);
  assert.equal(await transcript().props.onCorrectie(1, "Synthetic corrected source."), false);
  assert.equal(envelope().staat.gesprekscontext.length, 1, "Failed saves must retain current valid source context");
  transcript().props.onSpreker(1, "patient");
  await tick();
  assert.equal(envelope().staat.gesprekscontext.length, 1);
  assert.equal(transcript().props.segmenten[0].spreker, "onbekend");
  failures.clear();
  transcript().props.onSpreker(1, "patient");
  await tick();
  assert.equal(
    envelope().staat.gesprekscontext,
    undefined,
    "Source correction must synchronously clear the envelope ref before another render",
  );
  assert.equal(envelope().verouderd, true);
  assert.equal(envelope().laatsteSegment, 0);
  assert.equal(envelope().epdLijstBeoordeeld, false);
  const staleReport = nodes(render()).find((node) => node.type === "VerslagReview");
  assert.equal(staleReport.props.bronVerouderd, true, "Both desktop and mobile reports receive stale source state");
  assert.equal(
    staleReport.props.gesprekscontext,
    undefined,
    "Role correction removes report source context immediately",
  );
  const reportView = controller("verslag-review.tsx", "VerslagReview", staleReport.props)();
  assert.match(
    text(nodes(reportView).find((node) => node.props?.role === "alert")),
    /Dit verslag gebruikt nog de vorige bron/,
  );
  assert.equal(button(reportView, "Verslag opnieuw genereren").props.disabled, false);
  assert.equal(transcript().props.segmenten[0].sprekerBron, "behandelaar");
  assert.equal(await transcript().props.onCorrectie(1, "Synthetic corrected source."), true);
  assert.equal(envelope().staat.gesprekscontext, undefined);
  assert.equal(nodes(render()).find((node) => node.type === "VerslagReview").props.gesprekscontext, undefined);
  calls.length = 0;
  nodes(render())
    .find((node) => node.type === "VerslagReview")
    .props.onOpnieuwGenereren();
  await tick();
  assert.deepEqual(calls, ["generate", "analyse", "generate", "load"]);
  assert.equal(envelope().verouderd, false, "Successful regeneration must refresh the stale analysis display and ref");
  assert.equal(envelope().staat.gesprekscontext[0].citaten[0].tekst, "Synthetic corrected source.");
  assert.equal(text(render()).includes("Analyse verouderd sinds uw correctie"), false);
  assert.equal(nodes(render()).find((node) => node.type === "VerslagReview").props.notitie.id, "regenerated-note");
  assert.equal(nodes(render()).find((node) => node.type === "VerslagReview").props.bronVerouderd, false);
  assert.equal(
    nodes(render()).find((node) => node.type === "VerslagReview").props.gesprekscontext[0].citaten[0].tekst,
    "Synthetic corrected source.",
  );
}

function verifyStaleReportApproval() {
  const calls = [];
  const props = {
    sessie: { id: "synthetic", status: "afgerond", consultType: "psychiatrie", ontbrekendeFragmenten: 1 },
    notitie: {
      id: "synthetic-report",
      status: "concept",
      formaat: "psychiatrie",
      secties: [
        {
          id: "speciele-anamnese",
          titel: "Speciële anamnese",
          tekst: "Synthetic checked fact.",
          conceptTekst: "Synthetic checked fact.",
          status: "concept",
          bron: [],
          vereistBehandelaar: false,
        },
      ],
    },
    instellingen: {},
    rol: "eigenaar",
    bron: "centraal",
    bezig: false,
    bronVerouderd: true,
    onSectie: () => calls.push("section"),
    onAlleGoedkeuren: () => calls.push("bulk"),
    onOpnieuwGenereren: () => calls.push("regenerate"),
  };
  const render = controller("verslag-review.tsx", "VerslagReview", props);
  let tree = render();
  const checkbox = nodes(tree).find((node) => node.type === "Checkbox");
  checkbox.props.onCheckedChange(true);
  tree = render();
  assert.match(
    text(nodes(tree).find((node) => node.props?.role === "alert")),
    /Genereer het verslag opnieuw voordat u goedkeurt/,
  );
  assert.equal(button(tree, "Alles goedkeuren").props.disabled, true);
  const block = nodes(tree).find((node) => node.type?.name === "SectieBlok");
  assert.equal(button(block.type(block.props), "Goedkeuren").props.disabled, true);
  block.props.onGoedkeuren();
  const actions = nodes(tree).filter((node) => node.type === "AlertDialogAction" && text(node) === "Goedkeuren");
  assert.equal(actions.length, 2);
  for (const action of actions) {
    assert.equal(action.props.disabled, true);
    let prevented = false;
    action.props.onClick({
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
  }
  assert.deepEqual(calls, [], "Neither individual, bulk nor final-dialog handlers may approve a stale report");
  button(tree, "Verslag opnieuw genereren").props.onClick();
  assert.deepEqual(calls, ["regenerate"]);
  props.bronVerouderd = false;
  tree = render();
  assert.equal(
    nodes(tree).some((node) => node.props?.role === "alert"),
    false,
  );
  assert.equal(button(tree, "Alles goedkeuren").props.disabled, false);
  const freshBlock = nodes(tree).find((node) => node.type?.name === "SectieBlok");
  assert.equal(button(freshBlock.type(freshBlock.props), "Goedkeuren").props.disabled, false);
}

async function verifySpeakerReview() {
  const requests = [];
  const pending = [];
  const props = {
    segment: {
      id: "synthetic-source-1",
      volgnummer: 1,
      spreker: "patient",
      sprekerBron: "ai",
      tekst: "Synthetic source text.",
      tekstGecorrigeerd: null,
      beginMs: 0,
      bron: "live",
    },
    gemarkeerd: false,
    bewerkbaar: true,
    onSpreker: (number, role) => {
      requests.push([number, role]);
      // Match the workspace callback: persisted props change only after success.
      return new Promise((resolve) => pending.push(resolve)).then((ok) => {
        if (ok) props.segment = { ...props.segment, spreker: role, sprekerBron: "behandelaar" };
      });
    },
    onCorrectie: async () => false,
  };
  const render = controller("transcript-paneel.tsx", "TranscriptRegel", props);
  const trigger = () =>
    nodes(render()).find((node) => node.type === "Button" && node.props["aria-label"]?.startsWith("Spreker van"));
  const choose = (role) =>
    nodes(render()).find(
      (node) => node.type === "DropdownMenuItem" && node.props["aria-label"].includes(`${role} voor`),
    );
  assert.match(text(trigger()), /Patiënt · AI-voorstel, niet bevestigd/);
  assert.deepEqual(
    nodes(render())
      .filter((node) => node.type === "DropdownMenuItem")
      .map((node) => text(node).replace("Huidig", "")),
    ["Arts", "Patiënt", "Overig", "Onbekend"],
  );
  choose("Patiënt").props.onSelect();
  assert.deepEqual(requests, [[1, "patient"]], "Selecting the current AI role still requests explicit confirmation");
  assert.match(
    text(trigger()),
    /AI-voorstel, niet bevestigd/,
    "A pending request must not optimistically confirm a role",
  );
  pending.shift()(false);
  await tick();
  assert.match(
    text(trigger()),
    /Patiënt · AI-voorstel, niet bevestigd/,
    "A failed save preserves the persisted role and provenance",
  );
  choose("Arts").props.onSelect();
  pending.shift()(true);
  await tick();
  assert.match(text(trigger()), /^Arts · bevestigd$/);
  choose("Arts").props.onSelect();
  assert.deepEqual(requests.at(-1), [1, "arts"], "Current role confirmation must not be suppressed");
  pending.shift()(true);
  await tick();
  choose("Onbekend").props.onSelect();
  pending.shift()(true);
  await tick();
  assert.equal(props.segment.sprekerBron, "behandelaar");
  assert.equal(
    text(trigger()),
    "Onbekend · niet bevestigd",
    "An explicit unknown choice must not claim a confirmed speaker",
  );
  props.segment = { ...props.segment, spreker: "overig", sprekerBron: undefined };
  assert.equal(text(trigger()), "Overig · niet bevestigd", "Legacy roles have no clinician confirmation provenance");
  props.bewerkbaar = false;
  assert.equal(trigger().props.disabled, true);
  const before = requests.length;
  choose("Arts").props.onSelect();
  assert.equal(requests.length, before, "A stale handler cannot confirm a read-only row");
  props.bewerkbaar = true;
  props.segment.bron = "systeem";
  assert.equal(trigger().props.disabled, true);
  choose("Arts").props.onSelect();
  assert.equal(requests.length, before, "Recording gaps cannot be assigned to a speaker");

  const paneelProps = {
    sessieId: "synthetic",
    segmenten: [
      { ...props.segment, id: "first", volgnummer: 1, spreker: "onbekend", bron: "live" },
      { ...props.segment, id: "gap", volgnummer: 2, spreker: "onbekend", bron: "systeem" },
      { ...props.segment, id: "third", volgnummer: 3, spreker: "onbekend", bron: "live" },
      { ...props.segment, id: "fourth", volgnummer: 4, spreker: "arts", bron: "live" },
    ],
    gemarkeerd: [],
    bewerkbaar: true,
    onSpreker: () => assert.fail("Navigating must never assign a role"),
  };
  const paneel = controller("transcript-paneel.tsx", "TranscriptPaneel", paneelProps);
  assert.match(text(paneel()), /hele regel bij die persoon/);
  assert.match(text(paneel()), /meerdere of onduidelijke sprekers onbekend/);
  assert.equal(nodes(paneel()).filter((node) => node.type === "HandmatigeInvoer").length, 1);
  paneelProps.invoerToegestaan = false;
  assert.equal(
    nodes(paneel()).filter((node) => node.type === "HandmatigeInvoer").length,
    0,
    "A finished consult can keep speaker review while disallowing new source input",
  );
  assert.ok(
    nodes(paneel())
      .filter((node) => node.type?.name === "TranscriptRegel")
      .every((node) => node.props.bewerkbaar),
  );
  for (const expected of [1, 3, 1]) {
    button(paneel(), "Volgende onbekende").props.onClick();
    const marked = nodes(paneel()).filter((node) => node.type?.name === "TranscriptRegel" && node.props.gemarkeerd);
    assert.deepEqual(
      marked.map((node) => node.props.segment.volgnummer),
      [expected],
    );
  }
  paneelProps.segmenten = paneelProps.segmenten.map((segment) => ({ ...segment, spreker: "arts" }));
  assert.equal(button(paneel(), "Volgende onbekende").props.disabled, true);
}

async function verifyReportFallbackLabels() {
  const sections = bouwVerslagDeterministisch(legeKlinischeStaat(), [], "psychiatrie", "en");
  assert.equal(sections.length, 8);
  assert.ok(sections.every((section) => section.vereistBehandelaar));
  const props = {
    sessie: { id: "synthetic", status: "afgerond", consultType: "soap", ontbrekendeFragmenten: 0 },
    notitie: {
      id: "synthetic-note",
      bewerkRevisie: 1,
      versie: 1,
      formaat: "psychiatrie",
      status: "concept",
      secties: sections,
    },
    instellingen: {},
    bron: "lokaal",
    rol: "eigenaar",
    bezig: false,
    onAlleGoedkeuren: async () => sections.map((section) => section.id),
  };
  const render = controller("verslag-review.tsx", "VerslagReview", props);
  let tree = render();
  assert.equal(button(tree, "Alles goedkeuren").props.disabled, true, "Fallback sections remain individually reviewed");
  const blocks = nodes(tree).filter((node) => node.type?.name === "SectieBlok");
  assert.equal(blocks.filter((node) => node.props.beoordelingsSectie).length, 2, "Use note format, not session format");
  for (const block of blocks) {
    const sectionTree = block.type(block.props);
    const assessment = ["risicotaxatie", "overwegingen"].includes(block.props.sectie.id);
    assert.equal(text(sectionTree).includes("Beoordeling door behandelaar"), assessment);
    assert.equal(text(sectionTree).includes("Handmatige invoer vereist"), !assessment);
    assert.equal(text(sectionTree).includes("Context voor handmatige invoer"), !assessment);
    assert.equal(text(sectionTree).includes("Context voor uw beoordeling"), assessment);
    assert.ok(text(sectionTree).includes(ENGELSE_HANDMATIGE_BEOORDELING), "Fallback explanation must remain readable");
    const field = nodes(sectionTree).find((node) => node.type === "Textarea");
    assert.equal(field.props.placeholder.includes("wordt niet machinaal geschreven"), assessment);
    assert.equal(field.props.placeholder.includes("afzonderlijk goed"), !assessment);
  }
  props.notitie.secties = [
    ...sections,
    { id: "synthetic-facts", status: "concept", vereistBehandelaar: false, tekst: "Synthetic facts", bron: [] },
  ];
  tree = render();
  nodes(tree)
    .find((node) => node.type === "AlertDialogAction" && text(node) === "Goedkeuren")
    .props.onClick({
      preventDefault() {
        assert.fail("An eligible factual section must allow the bulk action");
      },
    });
  await tick();
  assert.match(text(render()), /8 secties met handmatige invoer zijn overgeslagen/);
  props.notitie.secties = props.notitie.secties.map((section) =>
    ["risicotaxatie", "overwegingen"].includes(section.id) ? section : { ...section, status: "goedgekeurd" },
  );
  assert.match(text(render()), /2 beoordelingssecties zijn overgeslagen/);
}

(async () => {
  await verifyEnglishCapabilities();
  verifyEmptyStateAndDemo();
  verifyBulkApproval();
  verifyConversationContext();
  verifySourceDraftApproval();
  verifyLongReportAndFactDraft();
  verifyRemainingReportContext();
  await verifyWorkspaceCorrectionRefresh(false);
  await verifyWorkspaceCorrectionRefresh(true);
  verifyStaleReportApproval();
  await verifySpeakerReview();
  await verifyReportFallbackLabels();
  console.log(
    "PASS Scribe UI readiness: 8 provider gates, stale-status suppression, clinical summaries, empty notes, exact quote panels and source navigation, unchanged/whitespace draft approval guards, explicit speaker selection and confirmation provenance, failed-save labels, unknown navigation, Dutch demo, 6 factual versus 2 assessment fallback labels, bulk approval.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

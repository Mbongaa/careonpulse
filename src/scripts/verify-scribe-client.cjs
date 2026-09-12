// Synthetic lifecycle regression tests: no browser server, microphone or provider.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
const recorder = compile("src/lib/careon-scribe/opname.client.ts");
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => value === b[index]);
const tick = async () => {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
};

function harness(options = {}) {
  const sessionStorage = options.sessionStorage ?? memoryStorage();
  const localStorage = memoryStorage();
  const drafts = draftHarness(sessionStorage, localStorage);
  const slots = [];
  let cursor = 0;
  let effects = [];
  const listeners = new Map();
  const uploads = [];
  const gaps = [];
  const tracks = [];
  const processors = [];
  const errors = [];
  const react = {
    useRef: (value) => {
      const index = cursor++;
      slots[index] ??= { current: value };
      return slots[index];
    },
    useState: (value) => {
      const index = cursor++;
      slots[index] ??= { value: typeof value === "function" ? value() : value };
      return [
        slots[index].value,
        (next) => {
          slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
        },
      ];
    },
    useCallback: (callback, deps) => {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect: (effect, deps) => {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const stream = () => {
    const track = {
      stopped: false,
      readyState: "live",
      stop() {
        this.stopped = true;
        this.readyState = "ended";
      },
      addEventListener() {
        /* Synthetic no-op. */
      },
    };
    tracks.push(track);
    return { getTracks: () => [track] };
  };
  class AudioContext {
    constructor() {
      if (options.failInitialization) throw new Error("Synthetic context failure");
      this.sampleRate = 16000;
      this.state = "running";
    }
    createMediaStreamSource() {
      return {
        connect() {
          /* Synthetic no-op. */
        },
        disconnect() {
          /* Synthetic no-op. */
        },
      };
    }
    createScriptProcessor() {
      const processor = {
        connect() {
          /* Synthetic no-op. */
        },
        disconnect() {
          /* Synthetic no-op. */
        },
      };
      processors.push(processor);
      return processor;
    }
    createGain() {
      return {
        gain: { value: 1 },
        connect() {
          /* Synthetic no-op. */
        },
      };
    }
    close() {
      this.state = "closed";
      return Promise.resolve();
    }
  }
  const context = {
    exports: {},
    AudioContext,
    Blob,
    Float32Array,
    ArrayBuffer,
    DataView,
    Date,
    Math,
    Number,
    Promise,
    crypto: require("node:crypto").webcrypto,
    require: (name) => {
      if (name === "react") return react;
      if (name === "./drafts.client") return drafts;
      return {
        stuurAudioFragment: async (_id, _blob, input) => {
          uploads.push(input);
          return options.failUpload
            ? { ok: false, status: 400, fout: "synthetic failure" }
            : { ok: true, segmenten: [], segmentTeller: uploads.length };
        },
        voegSegmentToe: async (_id, _text, _speaker, _source, _duration, fragmentId) => {
          gaps.push(fragmentId);
          return options.failGap
            ? { ok: false, status: 0 }
            : { ok: true, segmenten: [{ id: fragmentId }], ontbrekendeFragmenten: gaps.length };
        },
      };
    },
    navigator: {
      onLine: true,
      mediaDevices: { getUserMedia: options.getUserMedia ? () => options.getUserMedia(stream) : async () => stream() },
    },
    window: {
      setTimeout,
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
  };
  vm.runInNewContext(recorder, context);
  const hookOptions = {
    sessieId: "synthetic",
    beginMs: options.beginMs ?? 0,
    onSegmenten() {
      /* Synthetic no-op. */
    },
    onGat() {
      /* Synthetic no-op. */
    },
    onFout: (error) => errors.push(error),
  };
  const render = () => {
    cursor = 0;
    const hook = context.exports.useScribeOpname(hookOptions);
    const pending = effects;
    effects = [];
    pending.forEach((effect) => {
      effect();
    });
    return hook;
  };
  const feed = (blocks) => {
    for (let index = 0; index < blocks; index += 1)
      processors.at(-1).onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(0.1) } });
  };
  return {
    render,
    feed,
    uploads,
    gaps,
    tracks,
    listeners,
    errors,
    sessionStorage,
    drafts,
    unmount: () =>
      slots.forEach((slot) => {
        slot?.cleanup?.();
      }),
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
  };
}

function draftHarness(sessionStorage, localStorage = memoryStorage()) {
  const draftContext = {
    exports: {},
    window: {
      localStorage,
      sessionStorage,
      addEventListener() {
        /* Synthetic no-op. */
      },
    },
    require: (name) =>
      name === "react"
        ? {
            useSyncExternalStore() {
              /* Synthetic no-op. */
            },
          }
        : { SCRIBE_LIMITS: { segmentTekst: 4000 } },
  };
  vm.runInNewContext(compile("src/lib/careon-scribe/drafts.client.ts"), draftContext);
  return draftContext.exports;
}

/** Render the actual report controller while replacing only UI primitives and I/O. */
async function verifyReportVersionBoundary() {
  const pureModules = new Map();
  function pureModule(name) {
    if (pureModules.has(name)) return pureModules.get(name);
    const moduleContext = {
      exports: {},
      require(dependency) {
        assert.match(dependency, /^\.\/[a-z-]+$/, "Report fixtures load only pure Scribe modules");
        return pureModule(dependency.slice(2));
      },
    };
    pureModules.set(name, moduleContext.exports);
    vm.runInNewContext(compile(`src/lib/careon-scribe/${name}.ts`), moduleContext);
    return moduleContext.exports;
  }
  const formatContext = { exports: pureModule("formaten") };
  const sourceContext = { exports: pureModule("gesprekscontext") };
  const slots = [];
  let cursor = 0;
  let effects = [];
  const registrations = [];
  const react = {
    useRef(value) {
      const index = cursor++;
      slots[index] ??= { current: value };
      return slots[index];
    },
    useId() {
      return `id-${cursor++}`;
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
    navigator: { clipboard: { writeText: async () => undefined } },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name.endsWith("remote.client"))
        return {
          exporteerVerslag: async () => ({
            ok: true,
            tekst: "Synthetic approved report",
            bestandsnaam: "synthetic.txt",
          }),
          registreerVerslagExport: async (_, body) => {
            registrations.push(body);
            return { ok: true };
          },
        };
      if (name.endsWith("export-tekst")) return { bouwSectieTekst: () => "Synthetic approved section" };
      if (name.endsWith("retentie"))
        return { berekenRetentie: () => ({ transcriptVerwijderNa: null, sessieVerwijderNa: null }) };
      if (name.endsWith("formaten")) return formatContext.exports;
      if (name.endsWith("gesprekscontext")) return sourceContext.exports;
      if (name.endsWith("types")) return { GEANNULEERD_GRONDEN: [], SCRIBE_LIMITS: { sectieTekst: 20000 } };
      if (name.endsWith("careon-scribe")) return { GEANNULEERD_GROND_LABELS: {}, SECTIE_STATUS_LABELS: {} };
      return new Proxy({}, { get: (_, key) => (key === "cn" ? (...parts) => parts.join(" ") : key) });
    },
  };
  vm.runInNewContext(compile("src/app/(main)/scribe/_components/verslag-review.tsx"), context);
  const props = {
    sessie: {
      id: "synthetic",
      status: "goedgekeurd",
      consultType: "soap",
      dossierReferentie: "SYNTHETIC",
      ontbrekendeFragmenten: 0,
      createdAt: "2026-09-10T00:00:00Z",
    },
    notitie: {
      id: "report-one",
      bewerkRevisie: 1,
      versie: 1,
      formaat: "soap",
      status: "goedgekeurd",
      secties: [
        {
          id: "subjectief",
          titel: "Subjectief",
          tekst: "Synthetic",
          conceptTekst: "Synthetic",
          status: "goedgekeurd",
          bron: [],
        },
      ],
    },
    instellingen: {},
    rol: "eigenaar",
    bron: "lokaal",
    bezig: false,
  };
  const render = () => {
    cursor = 0;
    const tree = context.exports.VerslagReview(props);
    const pendingEffects = effects;
    effects = [];
    pendingEffects.forEach((effect) => {
      effect();
    });
    return tree;
  };
  const nodes = (tree) => {
    if (!tree || typeof tree !== "object") return [];
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return [tree, ...nodes(tree.props?.children)];
  };
  const text = (tree) => {
    if (typeof tree === "string") return tree;
    if (Array.isArray(tree)) return tree.map(text).join("");
    if (tree && typeof tree === "object") return text(tree.props?.children);
    return "";
  };
  const button = (tree, label) =>
    nodes(tree).find((node) => node.type === "Button" && text(node.props.children) === label);
  render();
  await tick();
  let tree = render();
  assert.equal(button(tree, "Overgenomen in het EPD").props.disabled, true);
  const section = nodes(tree).find((node) => node.type?.name === "SectieBlok");
  assert.equal(section.props.exporteerbaar, true);
  section.props.onKopieer();
  await tick();
  tree = render();
  assert.equal(
    button(tree, "Overgenomen in het EPD").props.disabled,
    true,
    "Section copy must not authorize whole-report transfer",
  );
  button(tree, "Kopiëren voor EPD").props.onClick();
  await tick();
  tree = render();
  assert.equal(
    button(tree, "Overgenomen in het EPD").props.disabled,
    false,
    "Successful full export authorizes only the current version",
  );
  props.notitie = { ...props.notitie, bewerkRevisie: 2 };
  tree = render();
  assert.equal(
    button(tree, "Overgenomen in het EPD").props.disabled,
    true,
    "A new edit revision must invalidate previous export readiness immediately",
  );
  await tick();
  tree = render();
  button(tree, "Kopiëren voor EPD").props.onClick();
  await tick();
  tree = render();
  assert.equal(button(tree, "Overgenomen in het EPD").props.disabled, false);
  props.notitie = { ...props.notitie, id: "report-two", bewerkRevisie: 1, versie: 2 };
  tree = render();
  assert.equal(
    button(tree, "Overgenomen in het EPD").props.disabled,
    true,
    "A replacement approved report must require its own export",
  );
  props.notitie = { ...props.notitie, status: "concept" };
  tree = render();
  assert.equal(
    nodes(tree).find((node) => node.type?.name === "SectieBlok").props.exporteerbaar,
    false,
    "No section can be copied before full approval",
  );
  assert.equal(
    registrations.length,
    3,
    "Preview must not register an export; only actual section/full copy actions do",
  );
  props.notitie = {
    ...props.notitie,
    formaat: "psychiatrie",
    secties: [
      {
        id: "risicotaxatie",
        titel: "Risk",
        tekst: "",
        conceptTekst: "",
        status: "leeg",
        bron: [],
        vereistBehandelaar: true,
      },
      {
        id: "overwegingen",
        titel: "Consideration",
        tekst: "",
        conceptTekst: "",
        status: "leeg",
        bron: [],
        vereistBehandelaar: true,
      },
      {
        id: "facts",
        titel: "Facts",
        tekst: "Synthetic factual section",
        conceptTekst: "Synthetic factual section",
        status: "concept",
        bron: [],
        vereistBehandelaar: false,
      },
    ],
  };
  props.onAlleGoedkeuren = async () => ["risicotaxatie", "overwegingen"];
  tree = render();
  nodes(tree)
    .find((node) => node.type === "AlertDialogAction" && text(node.props.children) === "Goedkeuren")
    .props.onClick({
      preventDefault() {
        /* Synthetic no-op. */
      },
    });
  await tick();
  tree = render();
  const reminder = (view) =>
    nodes(view).filter(
      (node) => node.type === "ScribeStatusregel" && text(node.props.children).includes("overgeslagen: schrijf"),
    );
  assert.equal(reminder(tree).length, 1, "Bulk approval must remind the clinician of skipped required sections");
  props.notitie = {
    ...props.notitie,
    secties: props.notitie.secties.map((section, index) =>
      index === 0 ? { ...section, status: "goedgekeurd" } : section,
    ),
  };
  tree = render();
  assert.ok(
    text(reminder(tree)[0]).includes("beoordelingssectie is"),
    "Reminder count must shrink as sections are approved",
  );
  props.notitie = { ...props.notitie, id: "replacement-with-same-section-ids" };
  tree = render();
  assert.equal(reminder(tree).length, 0, "A previous bulk reminder must not leak into a replacement note");
  props.notitie = {
    ...props.notitie,
    id: "report-two",
    status: "goedgekeurd",
    secties: props.notitie.secties.map((section) => ({ ...section, status: "goedgekeurd" })),
  };
  tree = render();
  assert.equal(reminder(tree).length, 0, "No stale instruction may remain after full approval");
}

function verifyDemoSourceBoundary() {
  const modules = new Map();
  const load = (inputFile) => {
    let file = path.resolve(root, inputFile);
    if (!file.endsWith(".ts")) file += ".ts";
    if (modules.has(file)) return modules.get(file);
    const output = {};
    modules.set(file, output);
    const context = {
      exports: output,
      crypto: require("node:crypto").webcrypto,
      require(name) {
        if (name.startsWith("@/")) return load(path.join("src", name.slice(2)));
        if (name.startsWith(".")) return load(path.resolve(path.dirname(file), name));
        return require(name);
      },
    };
    vm.runInNewContext(compile(path.relative(root, file)), context);
    return output;
  };
  const store = load("src/lib/careon-scribe/storage.client.ts");
  const { GESPREKSCONTEXT_KOP } = load("src/lib/careon-scribe/gesprekscontext.ts");
  const { isBeoordelingsSectie } = load("src/lib/careon-scribe/formaten.ts");
  const approvalState = store.demoScribeState();
  const approvalSession = approvalState.sessies.find((item) => item.status === "afgerond");
  const approvalNote = store.laatsteNotitie(approvalState, approvalSession.id);
  const factual = approvalNote.secties.find((section) => !isBeoordelingsSectie(approvalNote.formaat, section.id));
  const assessment = approvalNote.secties.find((section) => isBeoordelingsSectie(approvalNote.formaat, section.id));
  const quoteDraft = `${GESPREKSCONTEXT_KOP}\n\n§1: Synthetic source.`;
  factual.conceptTekst = quoteDraft;
  factual.vereistBehandelaar = true;
  const editApproval = (sections) =>
    store.wijzigNotitieLokaal(approvalState, approvalSession.id, approvalNote.id, {
      bewerkRevisie: store.laatsteNotitie(approvalState, approvalSession.id).bewerkRevisie,
      secties: sections,
    });
  assert.equal(
    editApproval([{ id: factual.id, tekst: "Synthetic clinician rewrite.", status: "goedgekeurd" }]).ok,
    true,
  );
  const reverted = editApproval([{ id: factual.id, tekst: quoteDraft }]);
  assert.equal(reverted.ok, true);
  assert.equal(
    reverted.notitie.secties.find((section) => section.id === factual.id).status,
    "bewerkt",
    "A text-only edit must revoke a prior section approval even when it restores source quotations",
  );
  assert.equal(editApproval([{ id: factual.id, status: "goedgekeurd" }]).ok, false);
  assert.equal(
    editApproval([{ id: factual.id, tekst: "Synthetic clinician rewrite.", status: "goedgekeurd" }]).ok,
    true,
  );
  const cleared = editApproval([{ id: factual.id, tekst: " " }]);
  assert.equal(cleared.notitie.secties.find((section) => section.id === factual.id).status, "leeg");
  assert.ok(assessment);
  const currentAssessment = store
    .laatsteNotitie(approvalState, approvalSession.id)
    .secties.find((section) => section.id === assessment.id);
  currentAssessment.conceptTekst = quoteDraft;
  assert.equal(
    editApproval([{ id: assessment.id, tekst: quoteDraft, status: "goedgekeurd" }]).ok,
    true,
    "Actual assessments retain their existing individual-entry approval behavior, matching SQL and UI",
  );
  const state = store.demoScribeState();
  const sessie = state.sessies.find((item) => item.status === "afgerond");
  const note = store.laatsteNotitie(state, sessie.id);
  const segment = state.segmenten[sessie.id][0];
  const context = [
    {
      sectieId: "speciele-anamnese",
      status: "te_controleren",
      bron: [segment.volgnummer],
      citaten: [
        { segmentId: segment.id, volgnummer: segment.volgnummer, tekst: segment.tekstGecorrigeerd ?? segment.tekst },
      ],
    },
  ];
  state.staat[sessie.id].staat.gesprekscontext = context;
  state.staat[sessie.id].staat.symptomen.push({
    tekst: "Synthetic clinician fact to retain.",
    bron: [],
    ingetrokken: false,
    doorBehandelaar: true,
  });
  const untouched = store.demoScribeState();
  untouched.staat[sessie.id].staat.gesprekscontext = context;
  assert.equal(store.laatsteNotitie(untouched, sessie.id).id, note.id);
  assert.equal(
    untouched.staat[sessie.id].staat.gesprekscontext.length,
    1,
    "Reading a report must retain valid source context",
  );
  store.wijzigSegmentLokaal(state, sessie.id, segment.volgnummer, { tekstGecorrigeerd: "Synthetic correction" });
  assert.equal(
    state.staat[sessie.id].staat.gesprekscontext,
    undefined,
    "A corrected source must disappear from quote panels before reanalysis",
  );
  assert.equal(
    state.staat[sessie.id].staat.symptomen.some((fact) => fact.tekst === "Synthetic clinician fact to retain."),
    true,
  );
  state.staat[sessie.id].staat.gesprekscontext = context;
  state.staat[sessie.id].laatsteSegment = segment.volgnummer;
  store.wijzigSegmentLokaal(state, sessie.id, segment.volgnummer, { spreker: "patient" });
  assert.equal(
    state.staat[sessie.id].staat.gesprekscontext,
    undefined,
    "Speaker correction must also clear provisional context",
  );
  const stale = store.wijzigNotitieLokaal(state, sessie.id, note.id, {
    bewerkRevisie: note.bewerkRevisie,
    alleGoedkeuren: true,
  });
  assert.equal(stale.status, 409, "Transcript correction must invalidate approval of an existing report");
  assert.equal(state.staat[sessie.id].laatsteSegment, 0, "A source correction must force full reanalysis");
  store.analyseerLokaal(state, sessie.id);
  const afterAnalysis = store.wijzigNotitieLokaal(state, sessie.id, note.id, {
    bewerkRevisie: note.bewerkRevisie,
    alleGoedkeuren: true,
  });
  assert.equal(afterAnalysis.status, 409, "Reanalysis alone must not make the old report current again");
  const fresh = store.genereerNotitieLokaal(state, sessie.id);
  const accepted = store.wijzigNotitieLokaal(state, sessie.id, fresh.id, {
    bewerkRevisie: fresh.bewerkRevisie,
    ontbrekendeFragmentenBeoordeeld: true,
    secties: fresh.secties.map((section) => ({
      id: section.id,
      tekst: "Synthetic clinician-reviewed text",
      status: "goedgekeurd",
    })),
  });
  assert.equal(accepted.goedgekeurd, true, "Fresh report with all sections reviewed can be approved");
  assert.equal(accepted.notitie.bewerkRevisie, 2);
  const conflict = store.wijzigNotitieLokaal(state, sessie.id, fresh.id, { bewerkRevisie: 1, alleGoedkeuren: true });
  assert.equal(conflict.status, 409, "Stale autosave must not overwrite the accepted revision");
  const demo = store.demoScribeState();
  const active = demo.sessies[0];
  active.status = "actief";
  const gapId = require("node:crypto").randomUUID();
  const original = store.voegHandmatigSegmentToe(
    demo,
    active.id,
    "[Synthetic missing fragment]",
    "onbekend",
    "systeem",
    2048,
    gapId,
  );
  const repeat = store.voegHandmatigSegmentToe(
    demo,
    active.id,
    "[Synthetic missing fragment]",
    "onbekend",
    "systeem",
    2048,
    gapId,
  );
  assert.equal(original[0].id, repeat[0].id, "Gap recovery must be idempotent in demo too");
  assert.equal(store.vindSessie(demo, active.id).ontbrekendeFragmenten, 1);

  const correctedTasks = store.demoScribeState();
  const taskSession = correctedTasks.sessies[0];
  taskSession.status = "actief";
  store.voegHandmatigSegmentToe(correctedTasks, taskSession.id, "Ik vraag bloedonderzoek aan.", "arts");
  store.analyseerLokaal(correctedTasks, taskSession.id);
  const proposedTask = correctedTasks.taken[taskSession.id].find((task) => task.status === "voorgesteld");
  assert.ok(proposedTask, "The original synthetic doctor request must propose a laboratory task");
  const reviewedTask = { ...proposedTask, id: "reviewed-synthetic-task", status: "goedgekeurd" };
  correctedTasks.taken[taskSession.id].push(reviewedTask);
  store.wijzigSegmentLokaal(correctedTasks, taskSession.id, 1, {
    tekstGecorrigeerd: "Ik vraag geen bloedonderzoek aan.",
  });
  assert.equal(
    correctedTasks.taken[taskSession.id].some((task) => task.status === "voorgesteld"),
    false,
    "Correction must immediately remove stale unreviewed proposals",
  );
  store.analyseerLokaal(correctedTasks, taskSession.id);
  assert.equal(
    correctedTasks.taken[taskSession.id].some((task) => task.status === "voorgesteld"),
    false,
    "Reanalysis must not recreate the negated laboratory request",
  );
  assert.ok(
    correctedTasks.taken[taskSession.id].some((task) => task.id === reviewedTask.id && task.status === "goedgekeurd"),
    "Transcript correction must preserve clinician task decisions",
  );

  const batched = store.demoScribeState();
  const batchSession = batched.sessies[0];
  batchSession.status = "actief";
  for (let index = 0; index < 40; index += 1) {
    store.voegHandmatigSegmentToe(batched, batchSession.id, "Synthetische neutrale zin.", "patient");
  }
  store.voegHandmatigSegmentToe(batched, batchSession.id, "Ik gebruik sertaline 50 mg.", "patient");
  store.analyseerLokaal(batched, batchSession.id);
  assert.equal(batched.staat[batchSession.id].laatsteSegment, 40);
  assert.equal(
    batched.staat[batchSession.id].staat.medicatie.length,
    0,
    "Analysis must not infer facts from a future unprocessed batch",
  );
  store.analyseerLokaal(batched, batchSession.id);
  assert.equal(batched.staat[batchSession.id].laatsteSegment, 41);
  assert.equal(
    batched.staat[batchSession.id].staat.medicatie.length,
    1,
    "Processing the second batch must not retain the uncorrected medicine spelling",
  );
  assert.equal(batched.staat[batchSession.id].staat.medicatie[0].naam, "sertraline");
}

(async () => {
  let grant;
  const late = harness({
    getUserMedia: (stream) =>
      new Promise((resolve) => {
        grant = () => resolve(stream());
      }),
  });
  const opening = late.render().start();
  late.unmount();
  grant();
  await opening;
  assert.equal(late.tracks[0].stopped, true, "Late permission must release its track after unmount");

  const canceled = harness({
    getUserMedia: (stream) =>
      new Promise((resolve) => {
        grant = () => resolve(stream());
      }),
  });
  const pending = canceled.render().start();
  await canceled.render().stop();
  grant();
  await pending;
  assert.equal(canceled.tracks[0].stopped, true, "Stop must cancel pending microphone permission");

  const broken = harness({ failInitialization: true });
  await broken.render().start();
  assert.equal(broken.tracks[0].stopped, true, "Initialization failure must release its track");

  const partial = harness();
  await partial.render().start();
  partial.feed(4);
  partial.render().pauzeer();
  let warning = false;
  partial.listeners.get("beforeunload")({
    preventDefault() {
      warning = true;
    },
  });
  assert.equal(warning, true, "Paused PCM must block document unload");
  assert.equal(partial.render().wachtrijLeeg, false, "Unpacked PCM must block completion");
  const partialIds = partial.drafts.readScribePendingFragments("synthetic");
  assert.equal(partialIds.length, 1, "Partial PCM must persist recovery metadata before it becomes an upload");
  assert.deepEqual(
    Object.keys(partialIds[0]).sort(),
    ["duurMs", "id"],
    "Recovery metadata must not contain audio or transcript text",
  );
  // A crash does not run React cleanup: mount a fresh hook with only the saved metadata.
  const reloadOptions = { sessionStorage: partial.sessionStorage, failGap: true };
  const reloaded = harness(reloadOptions);
  reloaded.render();
  await tick();
  assert.equal(
    reloaded.render().wachtrijLeeg,
    false,
    "Reloaded partial PCM must remain unresolved until a durable gap acknowledgment",
  );
  assert.equal(reloaded.gaps[0], partialIds[0].id, "Reload must recover the exact fragment token");
  reloadOptions.failGap = false;
  await reloaded.render().herprobeer();
  assert.equal(reloaded.render().wachtrijLeeg, true);
  assert.equal(reloaded.drafts.readScribePendingFragments("synthetic").length, 0);
  await partial.render().stop();

  const restarted = harness({ beginMs: 5000 });
  await restarted.render().start();
  restarted.feed(32);
  await restarted.render().stop();
  await tick();
  await restarted.render().start();
  restarted.feed(32);
  await restarted.render().stop();
  await tick();
  assert.equal(restarted.uploads[0].offsetMs, 5000, "Reload must use the persisted timeline origin");
  assert.ok(restarted.uploads[2].offsetMs >= 13192, "Restart must continue the previous capture timeline");

  const failures = { failUpload: true, failGap: true };
  const lost = harness(failures);
  await lost.render().start();
  lost.feed(32);
  await tick();
  await lost.render().stop();
  await tick();
  assert.equal(lost.render().wachtrijLeeg, false, "Unpersisted gap metadata must block completion");
  assert.ok(lost.render().lokaleGaten > 0);
  failures.failGap = false;
  await lost.render().herprobeer();
  await tick();
  assert.equal(lost.render().wachtrijLeeg, true, "Persisting all gap metadata releases the gate");
  assert.equal(lost.gaps[0], lost.gaps[1], "Gap retries must retain their idempotency token");

  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  const drafts = draftHarness(sessionStorage, localStorage);
  drafts.bewaakScribeEigenaar("same-org", "first@example.test");
  const token = drafts.scribeDraftGeneration("synthetic");
  drafts.writeScribeDraft("synthetic", "Synthetic draft", "patient", token);
  assert.equal(drafts.readScribeDraft("synthetic").spreker, "patient");
  drafts.clearScribeDrafts();
  drafts.writeScribeDraft("synthetic", "Late callback", "arts", token);
  assert.equal(drafts.readScribeDraft("synthetic").tekst, "", "Logout invalidates late draft writes");
  const fresh = drafts.scribeDraftGeneration("synthetic");
  drafts.writeScribeDraft("synthetic", "Owner-only draft", "arts", fresh);
  drafts.bewaakScribeEigenaar("same-org", "second@example.test");
  assert.equal(drafts.readScribeDraft("synthetic").tekst, "", "A same-org user switch clears personal drafts");
  await verifyReportVersionBoundary();
  verifyDemoSourceBoundary();
  console.log("Scribe client lifecycle: all assertions passed (synthetic; no microphone, network or provider).");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

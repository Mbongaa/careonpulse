# Scribe engine repair: evidence design and acceptance

**Status:** local implementation contract, 11 September 2026. The first repair persists exact conversation context for clinician review and distinguishes inferred from explicitly confirmed segment roles. The richer per-fact/span provenance design below remains future work. This document does not change a platform decision, activate a provider, apply a production migration or establish clinical acceptance. G20 and the existing D24 release gates remain open.

## Observed problem and baseline

The [recording audit](./SCRIBE_RECORDING_AUDIT_2026-09-11.md) establishes the failing baseline. Immutable browser runs D and E each completed the recording-to-report workflow with 92 successful fragments, 736 new audio seconds, a recorded tail at 744 seconds, no internal recorded interval gaps, and a final analysis cursor of 92/92. Both retained zero clinical facts and populated zero of eight psychiatric report sections. Six sections are factual and two require the clinician's own assessment. The late weapons, pills/overdose, substance-use and mother-discussion material reached both transcripts.

The experimental prompt produced some assigned roles without retained facts. It also labelled the clinician's opening greeting as patient speech. A role-assignment count is therefore not an accuracy metric. A single stochastic experiment does not establish a causal effect of its prompt change.

Content-bearing evidence remains in ignored `.next-e2e/scribe-audio-20260911/`. Use `baseline-8s.json`, `clinical-source-review.md`, `final-browser-comparison.json`, and immutable D/E snapshots as fixtures. The source review compares machine transcripts; disputed wording is not human-adjudicated ground truth. Synthetic, hand-reviewed text fixtures must isolate the engine contract from recognition errors.

## Existing contracts to preserve

| Boundary | Current implementation | Constraint for the repair |
|---|---|---|
| Transcript | `ScribeSegment` has text, corrected text, role, optional role provenance and absolute times; the transcription adapter now preserves optional provider-relative turn times | Legacy rows remain readable and unverified; neutral provider identity must not silently become a clinical role |
| Fact | `Feit` has `tekst`, `bron:number[]`, `ingetrokken`, optional `doorBehandelaar`; facts live in state JSONB | Keep legacy citations and clinician decisions; new evidence must be explicitly validated |
| Model schema | `klinische-staat.ts` builds a strict model schema separately from server-derived extensions | The model cannot certify its own role, clinician authorship or source verification |
| State read | `scribe.server.ts:staatVanRij` validates optional conversation context while retaining legacy-state compatibility | Every future evidence extension needs its own bounded compatibility parser |
| Analysis | `voerScribeAnalyseUit` persists state, roles, corrections and tasks through one RPC with state-version CAS and session lock | A late model response cannot overwrite source edits or clinician decisions |
| Source edits | Correction RPC and transcript trigger increment revision, rewind analysis, mark state stale and clear context/proposed tasks; provenance-only confirmation participates | Future evidence/turn edits must participate in the same invalidation path |
| Report | Notes bind `bron_staat_versie`, `bron_transcript_revisie`, and `bewerk_revisie`; approval validates all three | Changed evidence or role cannot leave an old note approvable |
| Access/retention | Owner-bound content RLS, metadata-only administrator listing, approved-report-only colleague release, terminal-state guards and purge | Evidence and quoted context are transcript content and inherit its access/retention restrictions |

Sources: `src/lib/careon-scribe/{types,api-contract,klinische-staat,scribe.server}.ts`; `supabase/migrations/20260907120000_careon_scribe.sql`; `supabase/migrations/20260910120000_scribe_audit_integrity.sql`.

## Implemented minimal vertical slice: conversation context

The first repair deliberately stores **reviewable conversation quotations separately from accepted clinical facts**. Optional `KlinischeStaat.gesprekscontext` contains `{sectieId, bron, citaten:[{segmentId,volgnummer,tekst}], status:"te_controleren"}`. The model chooses section and source-number ranges only. Server code resolves each whole effective source string and ID; it adds no role or clinical interpretation. The old strict clinical-state model schema and legacy state defaults do not gain this extension.

Each entry has at most three citations. Merge deduplicates each section by source ID, uses the newest exact text for a repeated ID, orders by source number and groups consecutive citations into bundles of at most three. State permits at most 600 bundles and 256,000 quoted characters; overflow is an error, never silent truncation or a successful cursor advance. Reanalysis starts without old context.

`20260911180611_scribe_conversation_context.sql` adds shape/source validation to the existing JSONB state, without a new table or RLS policy. Existing parent-session locks and state-version CAS remain authoritative. The trigger validates actual session, segment ID, sequence number, effective original/corrected text, non-system source and canonical section. A source or role correction clears every provisional quote, rewinds analysis and invalidates old report review through the existing state/transcript revisions. Source append retains valid earlier quotes.

The deterministic draft renders the exact warning `Gesprekscitaten — spreker en betekenis controleren. Dit zijn geen vastgestelde bevindingen of afspraken.` followed by chronological `§N: exact source text` blocks. SQL independently reproduces that section-specific string, including the existing missing-fragment header on the first section, and rejects arbitrary additions, mismatched citations or false review flags. Six factual psychiatric sections may receive this draft, always `vereistBehandelaar:true` and `status:"concept"`. Actual assessment text remains empty; its quotations may appear only in concept text. English reports without eligible reviewed facts or context retain the all-manual fallback.

Bulk approval skips these clinician-required sections. An individual factual section can be approved only after its nonempty final text differs from the quoted concept after whitespace trimming. A status-only approval, unchanged text PATCH, or whitespace-only rewrite cannot bypass this rule, including after an intermediate `bewerkt` status. This proves a rewrite occurred, not that its clinical meaning was checked. Clinical review remains necessary.

Quoted context inherits existing owner-bound transcript/state access and synchronous purge. An approved report may intentionally retain quotations that its clinician chose to keep after review; it does not expose the separate private context corpus to a released colleague. No production rollout or clinical acceptance follows from local verification.

### Segment speaker provenance

The separate `20260911182326_scribe_speaker_provenance.sql` migration adds nullable `spreker_bron` and the API exposes optional `ScribeSegment.sprekerBron:"behandelaar"|"ai"|null`. All existing and newly appended rows remain unverified (`null`), even if their role enum already says patient or clinician. Append payloads cannot supply either spelling of provenance. A text-only correction does not confirm its speaker.

An explicit owner speaker PATCH stamps `behandelaar`. Confirming the same existing role enum changes source revision, invalidates state and clears provisional context; repeating the already confirmed same value is idempotent. The analysis RPC stamps `ai` only while assigning a previously unknown, unconfirmed role. It cannot change a clinician-confirmed unknown role, downgrade confirmation, or overwrite a legacy known role. A trigger guards these transitions, including direct privileged content updates. No new RLS policy or authenticated SECURITY DEFINER endpoint is introduced.

This provenance records a deliberate role choice for the entire segment. It does not establish that a mixed-dialogue fragment has a single speaker or that a human's role choice is accurate. Per-turn/span identity and audit metadata remain separate future work. English factual extraction must treat only explicitly confirmed source roles as eligible; all uncertain sources remain reviewable conversation context.

### Canonical reviewed English factual drafts

`20260911183823_scribe_reviewed_english_drafts.sql` permits exact section drafts headed `Vastgelegde feiten — controleer de inhoud vóór goedkeuring.`. Each line contains the full accepted source statement and its existing source numbers. Machine rows require one current non-system source, an explicitly confirmed patient/clinician role, exact effective source text, and the narrow English field/grammar guard. Medication name, dose and status stay linked; uncertainty, questions, past history, family attribution and risk discussion are not promoted to current clinical facts. SQL reproduces field/array order, text-plus-source deduplication, sorted section source projection and the first-section missing-fragment header.

The prefill is all-or-nothing for a section. Unsupported existing section fields, active invalid/unconfirmed machine rows, or structured human medication/allergy/lifestyle/action rows retain the prior complete manual concept. Simple human symptom and plan rows remain supported explicitly. The new rendering cannot silently discard clinician-entered dose/action metadata or replace a partially supported section. Individual factual-draft approval may retain the exact accepted statements; bulk approval still skips every clinician-required section. Conversation-context drafts keep their separate rewrite requirement, and actual assessment text remains empty.

English analysis is a sequence of source-bound deltas. An unrelated later round or context-only round must not delete earlier facts. Repeating an identical source is idempotent; two medication mentions retain separate single-source identities so report validation cannot turn one quote into a multi-source claim. Both context-selection and factual-provider failure abort the analysis instead of returning a cursor-advancing partial success. English report generation remains deterministic even when conversation context is absent.

### Provider timing contract

`TranscriptieSegment` now carries optional `relatieveBeginMs` / `relatieveEindMs`. `plaatsTranscriptieSegmenten` validates finite, ordered provider boundaries against the submitted request duration (with a 250 ms end tolerance), clips the end to the request and computes absolute times as **request offset + provider-relative time**. It never adds overlap a second time. Without valid provider boundaries, it divides only the new-audio interval after overlap. Existing absolute `begin_ms` / `eind_ms` columns persist these positions.

These are turn boundaries, not exact word/span alignment or confirmed identities. Stable cross-request neutral speaker IDs and an explicit persisted timing-origin marker remain future work. Removing overlapped text can make its surviving text alignment approximate; provider timing alone does not establish which participant uttered a clinical statement.

### Local persistence verification

The final database verification suite passed **732 combined assertions**: 105 original-schema, 125 integrity-upgrade, 57 context-upgrade, 28 provenance-upgrade, 167 factual-draft-upgrade and 250 fresh-chain checks. This comprises **626 database assertions plus 106 TypeScript fixture controls**: the same 53 English examples run through the current TypeScript validator and actual SQL eligibility function in both upgrade and fresh paths. This parity check caught and fixed a retracted-symptom eligibility mismatch; question, uncertainty, history, dose and raw-length examples now agree.

The fresh chain exercises all three new migrations together. Tests use disposable loopback databases and synthetic text, including real competing connections. The additive-upgrade test proves existing role rows retain null provenance. Forged quotes/roles, foreign sources, nonconsecutive bundles, same-text/whitespace-only approval, stale source responses, provenance spoofing and terminal resurrection fail closed. TypeScript typecheck and scoped Biome checks passed; pure merge checks covered overlapping-window deduplication, chronological gap bundling, newest exact text, legacy strict-schema exclusion, immutability and reanalysis reset.

`verify-scribe-reviewed-english.ts` currently passes **186 complete-function assertions** with fully intercepted synthetic provider responses and an isolated environment. It tests eligibility, scalar/provenance spoofing, source correction, provider failures, raw source length bounds, later-round retention, medication source identity and actual deterministic report output. A current-use → stopped-use sequence also proves that a model's retraction flag cannot suppress valid stopping evidence or leave older current medication active; existing clinician retractions remain unchanged. Neither a real provider nor a database is contacted by this suite.

These checks do not establish useful model selection, transcription accuracy, role accuracy or clinical readiness. Actual teaching-audio repeat and source review evidence belongs to the recording audit and must be assessed separately.

## Future extension: accepted facts and span provenance

Add optional evidence to the existing fact/state JSON and optional diarization metadata to transcript rows. Retain current report sections, clinician editing and approval. Introduce no separately exposed evidence table for the first repair.

Implement one path completely: an exact source statement or question/answer pair becomes a validated fact, persists through the normal transaction, renders with inspectable source evidence, becomes stale after a source correction, is regenerated, and receives ordinary clinician review. Exercise that path in Dutch and English before expanding category coverage. Increasing model/chunk size alone is not this repair.

The first implementation must include persistence and invalidation, not just an in-memory extractor. Existing JSONB storage can hold additional fields, but its present coarse shape check is not sufficient evidence validation. A coordinated additive migration/RPC update is needed for server-stamped role provenance and database checks. Until that migration is available, the richer engine remains an isolated verification feature.

### Additive evidence records

The following is a design shape, not a committed API definition. Final names may change while preserving these invariants.

```ts
type SourceSpanV1 = {
  segmentId: string;
  volgnummer: number;
  textView: "original" | "corrected";
  textHash: string;
  start: number;
  end: number;
  quote: string;
};

type EvidenceV1 = {
  version: 1;
  id: string;
  kind: "statement" | "question_answer";
  primary: SourceSpanV1[];
  context?: { relation: "answer_to"; question: SourceSpanV1 }[];
  role: {
    value: "arts" | "patient" | "overig" | "onbekend";
    provenance: "inferred" | "clinician_confirmed" | "unknown";
    method?: "provider" | "context_model" | "clinician" | "legacy";
  };
  sourceTranscriptRevision: number;
};

// Persisted fact extension; old records may omit it.
type FactEvidenceExtension = { bewijs?: EvidenceV1[] };
```

- **Exact coordinates:** choose zero-based, half-open Unicode-codepoint offsets, not JavaScript UTF-16 offsets. `Array.from(text).slice(start,end).join("")` must equal `quote`; PostgreSQL uses the corresponding one-based substring. Include accented characters, emoji and CRLF fixtures so both implementations agree. Do not normalize the stored source before calculating positions.
- **Text binding:** hash the exact effective source text in UTF-8, with an explicit original/corrected view. Use a documented hash algorithm/version; a hash proves equality, not authorship or clinical correctness. Store a bounded quote, not another complete transcript copy.
- **Reference integrity:** segment ID and sequence number must identify the same row in the same session. Every span is within the source text; system-gap rows cannot support a fact. All IDs, hashes, revisions and verification statuses are resolved/stamped by trusted application/DB code, not accepted as model declarations.
- **Legacy citations:** `bron` is the sorted unique projection of every primary and contextual source sequence number. Do not replace it. A legacy fact without spans keeps its existing display and clinician ownership but is marked as legacy evidence; it is never silently promoted to exact verified evidence.
- **Identity/merge:** use a stable server-generated evidence ID. Do not key evidence by mutable array position. If facts merge by the existing medication/category/text keys, union only validated evidence with the same interpretation; keep disputed, retracted and clinician-confirmed provenance distinct. A merged citation number must not outlive its actual evidence.
- **Scalar fields:** chief complaint, duration, course and severity also need bindings. Add an optional bounded scalar-evidence map, or derive these fields from evidenced facts. A string alone must not bypass the provenance rules applied to arrays.
- **Role ownership:** role provenance belongs to the cited span/turn. One inferred role for a mixed audio fragment does not establish the speaker of every sentence. Confirming a role records the authenticated owner and time in protected server metadata/audit, never in model-controlled fields. Old non-unknown roles have legacy provenance until reviewed; absence of provenance is not confirmation.

The model proposes candidate quotes and optional question/answer relationships. A separate candidate schema should omit server-only fields. The validator resolves the candidates against the current source and produces the persisted shape. If the provider's strict schema requires every property, represent optional candidate values explicitly as nullable values; do not weaken server provenance checks to satisfy that schema.

### Question/answer handling

Support an answer such as “Three” only with its exact “How many voices?” question and correct turn order. Both spans remain inspectable. The question is context, not a patient finding. A fragment can contain multiple questions, quotations and speakers; whitespace adjacency alone does not prove that an answer belongs to a particular question.

For the first vertical slice, accept bounded relationships with unambiguous ordering and no intervening competing question. Ambiguous multi-option questions, an unclear respondent, a missing answer or a quoted voice stay unresolved. Do not extract a clinical proposition from “yes/no” merely because a model supplied a category. A source-display fallback may quote the uncertain discussion with its uncertainty intact without asserting a diagnosis or a definite patient history.

Separate the literal evidence from normalized display/category text. The existing canonical risk wording need not literally occur in an English transcript, but every normalized category must be supported by validated source evidence and an explicit mapping. Maintain the invariant that machine risk entries identify a discussion, not its polarity or clinical assessment. Do not remove the current question guard globally; replace whole-fragment exclusion with validated turn/span handling.

### Diarization and time metadata

Preserve optional provider metadata such as `{fragmentId, segmentId, sprekerLabel, startMs, eindMs}`. A neutral label is scoped to `(fragmentId, sprekerLabel)`; “A” in two requests is not established to be the same person. Cross-fragment linking needs separately recorded tentative/confirmed provenance. Never map provider index zero to the clinician by convention.

Keep provider timestamps relative to the submitted fragment and derive absolute times from its offset. Identify estimated fragment timing separately. Trimming overlap/text must update any affected alignment or mark it approximate; do not retain apparently exact offsets after altering the underlying text. Character spans identify evidence even when audio timing is approximate. No raw audio is persisted by this design.

## Persistence, edits and concurrency

1. **Ingestion:** parse provider metadata with size/range checks and persist it through `careon_scribe_voeg_segmenten_toe`; preserve fragment idempotency. New optional fields must round-trip through `ScribeSegmentRij`, SELECT field lists, `segmentVanRij`, API responses, the remote store and isolated test adapter.
2. **Analysis snapshot:** load session/source revision, state version and source rows before the provider call. Resolve candidate spans against that snapshot. Keep provider role suggestions as inferred; do not allow the same response to assert clinician confirmation. Record rejection categories/counts without logging quotes or transcript text.
3. **Atomic save:** extend the existing session-lock/state-CAS transaction with a source-snapshot revision check, and validate evidence against rows visible under the caller's RLS. Check the starting revision before applying this same transaction's permissible role/text updates. Reconcile anchors against the resulting effective rows before commit. Do not compare a pre-call revision to the transaction's own post-update revision and cause unavoidable conflicts.
4. **RPC provenance:** the model-analysis RPC must reject or strip attempted new `clinician_confirmed` metadata and preserve existing DB-owned confirmations. A distinct manual confirmation/edit action validates its anchor, stamps `auth.uid()`/server time and increments revision. Passing a confirmed flag in a generic analysis JSON body is insufficient. Client-provided actor IDs/timestamps are never authoritative.
5. **Source mutation:** a text correction, restore-original, role change, role-provenance change or turn-boundary edit invalidates affected machine evidence. The minimal implementation can conservatively rewind/rebuild all machine facts using the existing cursor-zero mechanism. Clear proposed tasks and EPD-list review as today; preserve explicit clinician facts, retractions and completed/rejected tasks. Preserve clinician decisions while showing that their old citation needs review; never present stale evidence as current.
6. **Trigger coverage:** the current transcript trigger compares role, role provenance, corrected text and correction origin. Future turn/span metadata must join its equality test when it changes meaning. Same-role inferred-to-confirmed transitions already invalidate the current snapshots. Metadata-only changes unrelated to meaning should not generate an analysis loop.
7. **State/report binding:** evidence changes increment state version; source changes increment transcript revision. Report generation must use the current validated state and sources, and remain bound to both revisions. Stale generation/approval is a conflict, never an implicit approval. A machine-generated factual section may contain unresolved quoted source material only if uncertainty is visible; the two assessment sections remain clinician-owned.
8. **Retention/release:** evidence stored in state is deleted with state/transcript on cancellation, consent withdrawal, configured transfer cleanup or expiry. Do not copy underlying quotes/context into a retained released-note metadata field accidentally. Released colleagues receive the approved report as currently authorized, not its private transcript/evidence corpus. When source is intentionally removed, indicate source unavailability instead of leaving a working-looking citation.

A reader deployment should tolerate old rows and new optional fields. New writes require the upgraded contract. Deploy schema/RPC support before enabling new writer behavior; reject an unavailable contract clearly rather than silently dropping evidence. Existing approved reports must not be rewritten by a backfill. Reanalysis of eligible unapproved sessions is an explicit source-versioned operation.

### Storage options

| Option | Advantages | Costs / decision |
|---|---|---|
| Optional evidence within existing state JSON; optional segment metadata | Smallest complete vertical slice; existing ownership, purge and transaction boundaries apply | Recommended first. Needs strict bounded validators, merge behavior, RPC checks and migration sequencing |
| Dedicated session/segment evidence table with stable rows | Strong relational keys, efficient per-span invalidation and separate auditability | Later option if volume/query needs justify it. Requires owner-bound RLS, immutable ownership, matching purge/release rules, grants, indexes and new atomic transaction paths |
| Evidence held only in the browser/in-memory adapter | Fast prototype | Insufficient acceptance: reload, direct API, source edits, retention and report approval can lose provenance |
| Longer fragments or unconditional model roles only | Low code cost | Rejected as the repair: neither solves mixed turns, source validation or role trust |

No new authenticated SECURITY DEFINER endpoint is required. Preserve current security-invoker content RPCs and owner predicates. Any new exposed table needs explicit grants plus RLS; these are distinct controls. See the current [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security). The changelog index was reviewed for relevant database/security changes; this proposal introduces no provider platform, auth or API-gateway migration.

## Acceptance: clinical evidence and six factual sections

Success means useful, correct source-backed coverage, not merely six nonempty strings. Run the complete saved baseline through the actual analysis/validation/report functions with both source fixtures and repeat real-audio browser runs. A manual listening/adjudication pass resolves disputed recognitions before they become gold expected wording.

| Psychiatric section | Minimum meaningful supported content for this fixture | Must not introduce |
|---|---|---|
| Reden van komst | Referral/discussion prompted by reported distressing experiences; source context in opening §2-5 | The greeting as a symptom, a diagnosis or an invented reason |
| Speciële anamnese | Reported experiences and about-two-month duration; three voices with question/answer evidence (§9, §15-25) | Questions as positive findings; disputed direct-address classification |
| Psychiatrisch onderzoek | Clinician's stated observation of looking around, distinguished from the patient's reported experience (§14-15) | A complete normal/abnormal mental-state examination or independent diagnostic conclusion |
| Somatiek & medicatie | Correctly attributed answer about regular prescribed pills, kept separate from substances (§64); explicit limits on unasked history | Medication/dose/allergy denial invented from missing history; overdose pills as prescribed treatment |
| Sociale anamnese | Supported living/family/study/substance context; literal cannabis wording and qualified stimulant timing where evidence is clear | Definite parental conspiracy belief; invented units, currency, frequency or negative substance history |
| Beleid | Proposed discussion with the mother (§90-92); treatment options and uncertainty, if included, labelled as such (§84-85) | Agreed prescription, completed admission, referral or external message not established in source |

The above are coverage checks against transcript content, not authorization to infer omitted answers. If a purported six-section pass uses irrelevant quotes, generic warnings, “not discussed” filler, or duplicates one fact throughout, it fails.

**Assessment boundary:** Risicotaxatie and Overwegingen remain empty for clinician-authored conclusions. Source-backed discussion of weapons (§47-50) and pills/overdose (§52-54) must be easy to review; neither a denial nor a generic risk label may erase relevant source material. No automatic risk level, diagnosis, “no risk” conclusion or completed overdose is acceptable.

### Required assertions

- Every machine factual statement resolves to current exact spans and a valid interpretation/context relationship. No phantom, cross-session, out-of-range, stale-hash or question-only citation passes. Primary and context sources both appear in the legacy citation projection.
- Distinguish fact extraction, retained facts, factual-section coverage, clinical accuracy, source ambiguity and clinician-owned assessment completion. Report each separately. “AI response succeeded,” “roles assigned” and “summary exists” are not quality passes.
- Reject the opening greeting labelled as a patient finding. Preserve mixed dialogue as separate spans or explicitly unresolved; do not assign one confirmed role to an entire mixed fragment.
- Test negative/positive medication and allergy cases, family history versus patient history, old versus current use, proposed versus agreed plans, and a medication name/dose appearing inside a question. Preserve existing clinician corrections and retractions after append, retry and regeneration.
- Test answer-context ambiguity: a question without an answer, multiple questions followed by one “yes,” an unrelated nearby answer, speaker uncertainty, a quoted voice, and an answer spanning a chunk boundary. All must retain correct uncertainty without hallucinated completion.
- For English, the literal evidence path must not depend on a nonempty Dutch deterministic category array. Validate normalized categories independently from raw quote wording while retaining the risk-assessment boundary.
- Full browser transport: source tail at least 734.076 seconds for this fixture, no unexpected internal recorded interval gaps, zero pending requests, actual persisted report, source edits/review before approval, and two completed immutable-build runs including pause/resume. Include desktop/phone usability checks separately.
- Run at least one independent held-out English teaching consultation before broader clinical-readiness claims. Repeating one fixture establishes reproducibility on that fixture only.

## Actual PostgreSQL verification

`verify-scribe-postgres.py` and `lib/scribe_integrity.py` already create a disposable local PostgreSQL database, apply real migrations, exercise real RLS/RPCs/triggers and run concurrent connections. `lib/local_postgres.py` forces loopback, an explicit unprivileged port, synthetic database prefix and a sanitized PG environment; it never loads application `.env`. Use that path for the migration, not the browser adapter as a substitute.

**Migration sequencing is repaired:** verification now runs distinct original-baseline → integrity-upgrade → context-upgrade stages, then an independent fresh chronological chain. This prevents a later migration from running before integrity and having its RPCs overwritten. The context suite in `lib/scribe_context.py` tests actual shape/source integrity, six factual/two assessment section boundaries, legacy English fallback, individual rewrite guards, stale-source rejection, competing source edits, owner-only access and terminal purge. These synthetic tests establish the persistence contract, not relevance or clinical correctness of model-selected quotations.

Add real-DB assertions for:

1. Old JSON/state/notes load after upgrade; valid new evidence round-trips unchanged and legacy source arrays remain consistent.
2. Owner allowed, unauthorized same-org colleague denied, cross-org denied, inactive/revoked owner denied, metadata-only administrator behavior unchanged, released colleague receives only the approved report, and anonymous access denied.
3. Direct writes remain blocked; new RPCs do not accept foreign segment IDs, actor/confirmation spoofing, invalid spans/hash, oversized evidence, or confirmed flags from analysis candidates. Ownership cannot be reassigned.
4. A concurrent source/role edit wins against a late analysis response; the loser receives conflict. A concurrent note writer cannot overwrite the first edit. Approval after an evidence revision is rejected until regenerated/reviewed.
5. Same-value inferred→confirmed role change advances the correct revision. Analysis's own allowed updates commit consistently without a false CAS loop. Clinician-confirmed evidence cannot be downgraded by the next model pass.
6. Cancellation/consent withdrawal/expiry/transfer cleanup removes evidence under the existing retention policy; late transcription/analysis cannot reinsert it. Source removal does not expose retained private context through approved-report release.
7. No new public RPC executable by authenticated users bypasses RLS as SECURITY DEFINER. Verify grants, triggers and policies in the fresh and upgrade schemas, not only by source-text matching.

Validation order: pure context/parser tests → meaningful multilingual engine regression fixtures → API/store round-trip and invalidation tests → actual PostgreSQL upgrade/fresh-chain/concurrency tests → immutable full-audio browser repeats → independent clinical/source review. Per-fact spans and per-turn role provenance remain unimplemented future work and their corresponding checklist items must not be reported as passed by the conversation-context slice.

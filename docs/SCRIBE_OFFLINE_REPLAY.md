# Scribe note verification and offline replay

`src/scripts/verify-scribe-recording-notes.ts` runs the actual note adapter, clinical validators, state merge and deterministic English report renderer in an isolated local session. It never calls application routes or writes to Supabase. Teaching transcripts and provider content belong only under the ignored `.next-e2e/` tree.

Live execution requires an explicitly authorized recording test. It reads only the allowlisted OpenAI configuration, clears database credentials before importing provider modules, and permits only the official OpenAI note endpoints. Console output contains counters and bounded error diagnostics, not transcript or model content.

## Offline replay

Run from `careon-dashboard/`:

```powershell
npx ts-node -r tsconfig-paths/register -P tsconfig.scripts.json src/scripts/verify-scribe-recording-notes.ts --input .next-e2e/example/input.json --batch 12 --run replay-fixed --replay .next-e2e/example/original/notes.json --output .next-e2e/example/replay-fixed
```

All paths in this example are placeholders for locally saved evidence. The output directory must be new. The input file and cached `notes.json` are never modified. `--input`, `--run`, `--replay`, and `--output` are required for replay. The batch size must match the cached run.

Replay verifies the input SHA-256, cached request sequence, endpoint, analysis stage and structured-output schema name. It feeds exact saved HTTP-200 response bodies through the existing response capture and engine JSON parser. Current validator and merge code is exercised; current prompt behavior is **not** measured because the responses came from the earlier run.

No environment file or real provider key is loaded in replay mode. The process uses a dummy key and an intercepted loopback URL. Fetch is blocked before lazy provider imports and has no network fallback. A missing, extra, reordered or incompatible response fails the run. Cached response usage is historical usage, not additional billed usage.

Output records `execution: "offline-replay"`, the cache manifest hash, the number of consumed responses, and `realProviderRequests: 0`. Live and replay runs have distinct labels. When the source uses synthetic clinical-role assertions, that limitation remains in the output label. Such controls do not validate diarization, clinician-confirmed roles or clinical accuracy.

## What the counters mean

- `activeFacts` and `citedFacts` count only the clinical categories in `STAAT_CATEGORIEEN`, excluding withdrawn rows.
- Checklist items, warnings and source-context quote groups have separate counters. Their presence is not a validated clinical fact.
- `realProviderRequests` and `replayedRequests` distinguish newly sent requests from cached responses.
- Source coverage counts show retained source IDs, not recognition accuracy or medical completeness. Review quote integrity and section placement separately.

## Verification evidence

The original 252-turn teaching control exposed a state-merge defect: an accepted alcohol statement was omitted by a later delta and disappeared from the final report. Replaying its 42 cached responses after the merge fix retained that exact statement through every remaining batch, with no plans or tasks. A subsequent full live control also retained it. These are branch and retention checks under **synthetic role assertions**, not clinical validation.

A separate incomplete live control saved 41 valid responses before a runtime failure. Native replay decoded all 41 and advanced to the missing request 42, where the offline guard correctly stopped. The original transient cause was not captured and remains unknown; the saved response was not malformed.

Run the synthetic isolation checks without any provider calls:

```powershell
npx ts-node -r tsconfig-paths/register -P tsconfig.scripts.json src/scripts/verify-scribe-notes-replay.ts
```

These check successful replay, required explicit output, ignored-path limits, input and batch binding, traversal rejection, endpoint/schema/stage matching, and a network trap. Test artifacts contain only synthetic text and are saved beneath `.next-e2e/`.

# EPD review checkbox retry analysis

Conclusion: asynchronous test assertion timing, not a browser crash or failed EPD state mutation. The application's final snapshot from the failing attempt already shows the successfully persisted reviewed state. No application/control behavior was changed.

Inspected read-only evidence:

- `test-results/careon-scribe-demo-pad-han-53444-n-en-de-EPD-lijst-overnemen-desktop/error-context.md`
- The same directory's `trace.zip`: `0-trace.trace`, `0-trace.network`, request/response resources and `test.trace`.

## What failed

The failure at `e2e/careon.spec.ts:1137` was `locator.check: Clicking the checkbox did not change its state`. Playwright completed the click, then performed its immediate checkbox postcondition before the controlled React checkbox reflected the asynchronous persistence result.

This checkbox deliberately reads the authoritative envelope (`staat-paneel.tsx:377`, `checked={ingevuld}`), disables itself while saving/already reviewed, and calls `onBeoordeeld()`. `consult-werkruimte.tsx:587` awaits `wijzigStaat(...)` before updating the envelope. In this inert demo run the expected HTTP 501 response triggers the local demo persistence path and then the React update.

The failed attempt's own final page snapshot is decisive: `error-context.md:609` contains **Beoordeeld**, and line 612 contains the same review checkbox **[checked] [disabled]**. The multi-item import success message and medications also remain present. The click was handled and the review persisted successfully; the test failed too early to observe it.

## Trace sequence

All times below are trace monotonic milliseconds, not wall-clock dates.

| Event | Time |
|---|---:|
| `call@1736`, Frame.check starts | 692760.432 |
| Input snapshot for the click | 692874.974 |
| Review PATCH request begins | 692938.582 |
| Expected demo response completes (request duration 10.520 ms) | approximately 692949.102 |
| `.check()` fails its state postcondition | 692957.034 |
| Post-action frame snapshot | 693002.959 |

Request resource `cd4295117523a11aa17291124200d2c4446fbc7a.json` contains exactly `{"versie":6,"epdLijstBeoordeeld":true}`. Response resource `7c88d4889ce0af098a3d082dbca526dc6fcac5e1.json` contains `{"configured":false,"demo":true}`, HTTP 501. This is the configured inert demo fallback, not an unexpected server error. The checkbox postcondition failed only about 8 ms after the response completed; the asynchronous local persistence/React commit followed. The trace contains an ordinary live page and test cleanup, not a browser crash event.

## Bounded correction and verification

With root authorization, only this test action/assertion was changed:

```ts
const epdBeoordeling = notities.getByLabel(
  "Ik heb de actuele medicatie- en allergielijst uit het EPD gecontroleerd, inclusief ontbrekende middelen.",
);
await epdBeoordeling.click();
await expect(epdBeoordeling).toBeChecked();
```

The test still performs one user click and requires the persisted checked state through Playwright's retrying assertion. It does not add sleeps, retries, forced clicks, optimistic application state, or weaker acceptance. Existing **Beoordeeld** and limited medication-monitoring warning assertions remain.

Scoped command: `npx biome check --write e2e/careon.spec.ts` — passed, one file checked, no fixes applied.

Exact source hunk relative to the verified application build snapshot (the only intended source-manifest difference):

```diff
--- e2e/careon.spec.ts (final application build snapshot)
+++ e2e/careon.spec.ts (test wait correction)
@@
-    await notities
-      .getByLabel(
-        "Ik heb de actuele medicatie- en allergielijst uit het EPD gecontroleerd, inclusief ontbrekende middelen.",
-      )
-      .check();
+    const epdBeoordeling = notities.getByLabel(
+      "Ik heb de actuele medicatie- en allergielijst uit het EPD gecontroleerd, inclusief ontbrekende middelen.",
+    );
+    await epdBeoordeling.click();
+    await expect(epdBeoordeling).toBeChecked();
     await expect(notities.getByText("Beoordeeld", { exact: true })).toBeVisible();
```

Root owns the current complete suite result, preservation of this failed-attempt trace and subsequent focused retry-free repetition against the unchanged verified application build. This worker did not start another server or rerun broad browser tests.

The raw `trace.zip` capture is retained locally and excluded from the source release; this synthetic analysis is versioned.

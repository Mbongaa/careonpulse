# Final Scribe visual acceptance

Captured against root's final optimized inert demo build at `http://localhost:3299`, on 2026-09-09 23:49 UTC (2026-09-10 local date). The six PNGs and [structured results](results.json.txt) in this directory replace the earlier pre-fix capture. All six PNGs were opened and visually inspected after the final run.

Command: `node .next-e2e/scribe-fixes/visual/capture.cjs` — exit 0. Three isolated Chromium contexts, with synthetic demo data, localhost-only network, no microphone, provider calls or extra server. Source and tests were unchanged during capture.

## Mobile, 390 × 844

- Dark and light consult lists fit the viewport: measured viewport width 390 px and document scroll width 390 px in both themes. No horizontal overflow, overlapping labels or clipped actions were visible.
- Each visible consult card includes its status, cleanup date and readable Openen/Verwijderen actions. The inspected active card's controls stay inside the screen (right edge 358 px). Rows and action labels remain distinct in both themes.
- The delete dialog is centered and fully visible in both themes, with readable deletion consequences and separate Verwijderen/Annuleren actions. Opening and canceling it succeeded; no consult was deleted.

Evidence: [dark consult list](mobile-dark-consult-list.png), [light consult list](mobile-light-consult-list.png), [dark delete dialog](mobile-dark-delete-dialog.png), [light delete dialog](mobile-light-delete-dialog.png).

## Desktop, 1440 × 1080

- The report and transcript form clear adjacent columns. Before approval, clinician-only sections are empty and labeled for clinician assessment; section copy controls are absent.
- Bulk approval leaves the required assessment sections for the clinician and shows the two-section reminder. Entering synthetic text and approving those sections completes report approval. The stale skipped-section reminder is absent in the final approved screenshot and DOM (`staleSkippedWarningAfterApproval: false`).
- Approved sections display their entered text. The actual export-preview textarea value contains both complete synthetic Risicotaxatie and Overwegingen texts (`riskTextInPreview: true`, `considerationTextInPreview: true`), also visible in the final screenshot.
- Showing the report text leaves Overgenomen in het EPD disabled. The explicit manual-copy acknowledgment is separate and visible. No copy, download or transfer was performed during this visual pass.

Evidence: [report review](desktop-light-report-review.png), [approved report](desktop-light-report-approved.png).

No meaningful layout/workflow failures or uncaught page errors were observed in this bounded pass (`errors: []`). This visual check covers Chromium rendering and the exercised synthetic paths; root's complete browser suite covers the broader acceptance matrix. It does not certify real-device microphone behavior or production/provider integration.

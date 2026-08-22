# G11 — identity-minimised YAAZ Space rollout candidate

Status: **review required; no apply authorised**  
Observed: **22 August 2026** through Zairo's signed-in Microsoft Teams admin view  
Machine-readable companion: `G11_SPACE_ROLLOUT_CANDIDATE.json`

## Outcome

The tenant-wide inventory is now known without exporting employee identities. Microsoft
shows 9 active private Teams, each with one standard channel and no private or shared
channels. Together they contain 19 unique internal users, no guests and one unique owner
across all nine Teams. The Entra tenant has 59 internal users, so 40 internal employees
are not represented in these Teams. Teams therefore cannot replace Entra as the
company-wide employee source.

Only 2 of the 19 Team members currently have an active YAAZ account. The other 17 must
complete their first Microsoft login so Careon JIT can create the Careon membership and
YAAZ identity. Until then, an exact-membership Space plan correctly fails closed.

No Team, channel, owner, member, Entra assignment, YAAZ Space or ACL was changed during
this inventory.

## Recommended platform boundary

- Preserve `TGC Groep` as the protected company-wide Space. Its eligibility comes from
  Entra/Careon JIT, never from membership of one or more Teams.
- Use Microsoft Team membership only as the proposed ACL source for matching private
  departmental Spaces.
- Keep SharePoint `All Company/Gedeelde documenten` authoritative for files and Outlook
  authoritative for calendars. The first rollout therefore proposes only `tasks` and
  `polls`; it does not create a second file or calendar authority in HumHub.
- Use private, invite-only, exact membership with auto-add disabled and members unable
  to leave independently. A Team membership change must produce a reviewed YAAZ plan.
- Require two operational owners per Team/Space: one business owner and one redundant
  TGC IT or delegated backup. The present single-owner pattern is not rollout-ready.
- Retention classes below are planning labels only. TGC IT must map each one to an
  approved identifier before a real private manifest can be marked approved.

## Candidate phases

| Microsoft Team | Members | Active YAAZ | First login needed | Recommendation | Proposed boundary |
|---|---:|---:|---:|---|---|
| Backoffice | 6 | 1 | 5 | Phase A candidate | Internal; tasks + polls; internal-standard retention class |
| Behandelteam | 13 | 2 | 11 | Phase A candidate | Confidential; tasks + polls; no patient-record content in YAAZ |
| Kwaliteit&Audits | 3 | 0 | 3 | Phase A candidate | Confidential; tasks + polls; quality/audit retention class |
| Bestuur TGC | 2 | 1 | 1 | Phase B governance review | Confidential board area; board-content and retention decision required |
| Zorgproces & Verbetering | 1 | 0 | 1 | Hold | Review membership first; a one-person collaboration Space has no rollout value |
| Bestuur Vurans | 2 | 1 | 1 | Separate-entity review | Do not place in TGC YAAZ until the Vurans platform/controller boundary is approved |
| Facturen & Betalingen TGC/Vurans | 4 | 1 | 3 | Mixed-entity finance review | Financial and cross-entity authority/retention decision required |
| Management TGC/Vurans | 3 | 1 | 2 | Mixed-entity management review | Cross-entity authority and controller decision required |
| Raad van Toezicht TGC groep | 4 | 1 | 3 | Independent oversight review | Oversight independence, ownership and retention must be approved separately |

All nine Teams currently have one owner, no guest members and one standard channel.
Across the nine lists there are 19 unique users; overlap explains why the row counts do
not add up to 19.

## Safe rollout sequence

1. Make the 17 Team members Entra-eligible and have them use Microsoft login once.
2. Add a second approved owner to every Team selected for rollout.
3. Have TGC IT approve the Phase A Team list, exact membership, business owners and real
   retention identifiers. Decide the Vurans, mixed-entity and oversight boundaries
   separately.
4. Generate the identity-bearing manifest privately outside Git with mode `0600`.
5. Keep `CAREON_SPACE_APPLY_ENABLED=0` and run the live read-only plan. Review its exact
   manifest, inventory and plan hashes plus all aggregate mutations and blockers.
6. Only after explicit plan approval: create a fresh verified backup, enable the gate for
   the controlled window, apply the exact hash, test an approved member and a real
   non-member for every confidential Space, and immediately return the capability to
   `0`.

The production engine is ready for this sequence, but this redacted candidate is
deliberately not a runnable manifest and cannot change production.

# G11 — identity-minimised YAAZ Space rollout candidate

Status: **review required; no apply authorised**  
Observed: **22 August 2026** through Zairo's signed-in Microsoft Teams admin view  
Machine-readable companion: `G11_SPACE_ROLLOUT_CANDIDATE.json`

## Outcome

The tenant-wide inventory is now known without exporting employee identities. Microsoft
shows 9 active private Teams, each with one standard channel and no private or shared
channels. Together they contain 19 unique identities: 17 tenant members and 2 Entra
guests. The nine Teams share one unique owner. The Entra tenant has 59 internal users,
so 42 internal employees are not represented in these Teams. Teams therefore cannot
replace Entra as the company-wide employee source.

Only 2 of the 17 tenant Team members currently have an active YAAZ account. The Phase A
eligibility step is complete: its 16 enabled/licensed tenant members now have
`Careon.User`—3 existing assignments plus 13 exact direct assignments—while its guest
remains deliberately ineligible. Careon still has only 3 active accounts and reports 13
pending first logins; assignment alone created no account or elevated role. The 15
tenant Team members without active YAAZ identities still need the appropriate first
login/opening step before an exact-membership Space plan can resolve them.

The exact Phase A target set is recorded only as digest
`4488be4e...97612`. No identity was persisted. Entra eligibility changed by 13 direct
`Careon.User` assignments; no Team, channel, owner, Team membership, Careon account,
Careon role, YAAZ Space or ACL changed.

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

| Microsoft Team | Total | Tenant | Guest | Careon.User | Active YAAZ | Safe assignment | Recommendation |
|---|---:|---:|---:|---:|---:|---:|---|
| Backoffice | 6 | 6 | 0 | 6 | 1 | 0 | Phase A · internal · tasks + polls |
| Behandelteam | 13 | 12 | 1 | 12 | 2 | 0 | Phase A · confidential · exclude guest and patient-record content |
| Kwaliteit&Audits | 3 | 3 | 0 | 3 | 0 | 0 | Phase A · confidential · tasks + polls |
| Bestuur TGC | 2 | 2 | 0 | 2 | 1 | 0 | Phase B governance review |
| Zorgproces & Verbetering | 1 | 1 | 0 | 1 | 0 | 0 | Hold: review one-person membership first |
| Bestuur Vurans | 2 | 2 | 0 | 2 | 1 | 0 | Separate-entity review |
| Facturen & Betalingen TGC/Vurans | 4 | 4 | 0 | 3 | 1 | 1 | Mixed-entity finance review |
| Management TGC/Vurans | 3 | 3 | 0 | 3 | 1 | 0 | Mixed-entity management review |
| Raad van Toezicht TGC groep | 4 | 3 | 1 | 2 | 1 | 1 | Independent oversight review; exclude guest from JIT |

All nine Teams currently have one owner and one standard channel. Across the nine lists
there are 19 unique identities; overlap explains why the row counts do not add up to 19.
Guest status comes from Careon's authoritative Entra reconciliation, not from a username
heuristic in the Teams member grid.

## Safe rollout sequence

1. **Completed:** Phase A's one guest stayed excluded and the exact 13 unassigned,
   enabled/licensed tenant members received only `Careon.User`.
2. Have the 13 newly eligible employees complete Microsoft login and open YAAZ; have
   the existing Careon user whose YAAZ status is still unopened open that tile once.
3. Add a second approved owner to every Team selected for rollout.
4. Have TGC IT approve the Phase A Team list, exact membership, business owners and real
   retention identifiers. Decide the Vurans, mixed-entity and oversight boundaries
   separately.
5. Generate the identity-bearing manifest privately outside Git with mode `0600`.
6. Keep `CAREON_SPACE_APPLY_ENABLED=0` and run the live read-only plan. Review its exact
   manifest, inventory and plan hashes plus all aggregate mutations and blockers.
7. Only after explicit plan approval: create a fresh verified backup, enable the gate for
   the controlled window, apply the exact hash, test an approved member and a real
   non-member for every confidential Space, and immediately return the capability to
   `0`.

The production engine is ready for this sequence, but this redacted candidate is
deliberately not a runnable manifest and cannot change production.

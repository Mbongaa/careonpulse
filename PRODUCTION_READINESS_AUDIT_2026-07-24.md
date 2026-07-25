# Production readiness audit — 2026-07-24

Scope excludes end-user authentication and GDPR/privacy-program decisions at the owner's explicit request. Data minimisation controls already present were preserved.

## Verdict

**Release-candidate score: 9.2/10 (go after environment activation).**

The codebase and live Supabase schema clear the requested 9/10 threshold. A public production deployment has not been created from this workspace because the connected Vercel account exposes no team or project. The deployment must set the documented secrets and return 200 from `/api/health/ready` before traffic is enabled.

| Area | Score | Evidence |
| --- | ---: | --- |
| Dashboard correctness and UX | 9.6 | 518 domain assertions, 400 production-data assertions, 96 production-build browser tests |
| AI execution safety and reliability | 9.4 | strict allowlisted tools; concept/apply boundary; destructive and bulk confirmations; fail-closed moderation; sensitive-proxy block; terminal stream validation; 17 fault-injection tests; live model evaluation passed |
| Persistence and concurrency | 9.2 | revision conflicts for means/HR; unique operation IDs; bounded/batched imports; compensating rollback; atomic Postgres quotas |
| Supply chain and CI | 9.3 | zero npm vulnerabilities including dev dependencies; exact security overrides; pinned GitHub Actions; CodeQL; secret/export scan; SBOM artifact; Dependabot |
| Browser/runtime security | 9.1 | nonce CSP without script `unsafe-inline`; HSTS without premature preload; security headers; bounded request bodies; no dashboard HTML in PWA caches |
| Observability and operations | 8.8 | structured request IDs/events, liveness/readiness, scheduled retention RPC and runbooks; external alerting/deployment evidence still requires the hosting project |
| Recovery | 8.7 | immutable-build and restore procedure documented; first managed-backup restore drill requires an isolated operator-provisioned Supabase environment |

## High-risk findings closed

- Production dependency vulnerabilities: 7 → 0; complete dependency tree: 0.
- Non-atomic cross-instance assistant limits → atomic Postgres RPC with fail-closed outage behavior.
- Moderation fail-open → controlled 503 with deterministic dashboard fallback.
- Failed/incomplete/malformed provider streams previously looked successful → tool calls are discarded and a wire error is emitted/logged.
- Name-based language inference was rewarded by the live evaluation → route-level policy block and a negative live test.
- IP/user-agent safety identity → stable pseudonymous browser-session identifier, HMAC-hashed server-side.
- Audit endpoint content-length-only protection → streamed byte limit and separate shared quota.
- High-impact bulk concepts → second explicit bulk-impact confirmation.
- Full-body production import and one huge insert → streamed 25 MB cap, validation, 500-row batches and cascade rollback.
- Auxiliary snapshot last-write retry duplication → database-enforced operation IDs.
- Local data and cached pages survived logout → all Careon state/session stores and Careon CacheStorage are cleared; dashboard HTML is never cached.
- Request-script CSP `unsafe-inline` → per-request nonces and `strict-dynamic`.
- Best-effort-only telemetry retention → daily authenticated cron plus database maintenance RPC.
- No release supply-chain gates → audit, typecheck, secret/export scan, CodeQL, SBOM and pinned actions.

## Verification results

- `npm run verify:ci`: passed.
- `npm run build`: passed on Next.js 16.2.11; 78 routes.
- `npm run test:e2e`: 96/96 passed.
- `npm audit`: zero vulnerabilities.
- Live Responses API evaluation: passed all read-only, bulk, counting, sensitive-inference, onboarding and offboarding scenarios.
- Supabase: migrations 0001–0008 represented in live history; HR/quota tables and five idempotency columns verified.
- Atomic quota proof: requests 1 and 2 allowed, request 3 denied for a limit of 2.
- Supabase advisors: no error/warning-level security finding; informational no-policy notices are intentional server-only RLS deny-by-default tables.

## Environment activation gate

1. Link the repository to a hosting project and save an immutable deployment.
2. Configure every variable in `.env.example`, including a dedicated `CAREON_ASSISTANT_SAFETY_SALT` and `CRON_SECRET`.
3. Require 200 from both health endpoints.
4. Connect uptime/alert delivery to readiness, error rate, AI 5xx/429 rate, latency and cron failure.
5. Run and record the first isolated database restore drill.

# PingX Progress

Current milestone: **Deploy**. M1–M6 are built and tested locally. Remaining items need external accounts or the VM (see `docs/spikes/pending.md`).

## R&D (week 1)
- [ ] Spike: SMTP egress from host (Gmail 465/587, Outlook, Zoho). Reachability is OK from dev; the authenticated send and the Oracle VM run are still pending (docs/spikes/smtp-egress.md)
- [ ] Spike: Gmail daily cap detection. Classifier and 15-min provider block are built and unit-tested; needs one real cap hit to confirm
- [ ] Spike: Handlebars + MJML render (Gmail web/app, Outlook). Rendering works and is tested; the visual check in real clients is pending
- [x] Spike: BullMQ retry, delay, DLQ, per-provider rate limit (docs/spikes/crypto-queue-render.md)
- [x] Spike: AES-256-GCM encrypt/decrypt with key_version (docs/spikes/crypto-queue-render.md)
- [x] Spike: Redis quota counter + burst limit, load test 50 req/s (docs/spikes/quota-load.md)
- [ ] Spike: Razorpay test subscription → webhook. Built; needs Razorpay test keys
- [ ] Spike: Gmail API send with OAuth (gmail.send). Built; needs a Google OAuth client
- [ ] Publish the SDK on npm as `pingx-mail` (npm rejected `pingx` as too similar to ping/pino/pinia)
- [x] Final Prisma schema + OpenAPI spec for /v1/* (docs/openapi.yaml; schema assumptions in decision 002)

## M1 Foundation
- [x] Monorepo scaffold (pnpm + turbo, apps/*, packages/*)
- [x] Docker Compose (postgres, redis), env.ts, lint, prettier, vitest
- [x] Prisma schema + migrations + seed (plans, admin, presets, system templates)
- [x] Auth: signup, verify, login, refresh, reset, Google sign-in, role guard. Google sign-in still needs a real client id to test

## M2 Providers + send pipeline
- [x] Account-level providers (SMTP, Gmail OAuth, Resend, SES API), encrypted config
- [x] Test-before-save endpoint (unsaved config)
- [x] Priority order (default + fallback) endpoint
- [x] API keys + API-key auth middleware
- [x] POST /v1/send raw → queue → worker → adapter → status/events
- [x] Retries, fallback chain, provider health, per-provider cap, DLQ

## M3 Templates + quota
- [x] Templates CRUD, versions, render, preview, test-send, layouts
- [x] AI template assistant (prompt → MJML) with plan limit. Needs ANTHROPIC_API_KEY for a live test
- [x] Quota middleware (daily, monthly, burst) + usage_daily rollup
- [x] Idempotency, scheduled send, batch, signed outbound webhooks

## M4 User dashboard
- [x] Auth screens, projects, providers (presets, test, reorder), templates (Monaco + preview + AI), API keys, messages log, usage, settings
- [ ] Portfolio contact form on PingX. The "Contact form" gallery template exists; wiring it into personal-portfolio with the SDK happens in that repo

## M5 Admin + billing
- [x] Admin: plans, users, subscriptions, usage, providers, presets, system/gallery templates, messages, settings, audit log
- [ ] Razorpay subscriptions + webhook; 80%/100% limit emails. Built; needs Razorpay test keys for the end-to-end run

## M6 SDK + hardening
- [x] `pingx-mail` SDK v0.1.0 + README + publish workflow
- [x] Security pass, auth rate limits, signup captcha (SSRF guard added for SMTP hosts and webhook URLs)
- [x] Integration + load tests

## Deploy
- [ ] Vercel (dashboard) + Neon (DB) + Oracle VM (API, worker, Redis, Caddy). Config and guide ready (docs/deploy.md, decision 004); not yet deployed
- [ ] CI/CD (PR checks, deploy on main, SDK publish on tag). Workflows are written but haven't run on GitHub yet
- [ ] Backups + monitoring + go-live checklist. Backup service and checklist are in docs/deploy.md

## Log
<!-- YYYY-MM-DD — what was done, anything notable -->
2026-10-23 — Moved PROGRESS.md to docs/. Scaffolded pnpm+turbo monorepo (apps/api, worker, dashboard; packages/db, channels, templates, shared, sdk; spikes). lint/typecheck/test/build green. Pinned TS 6, Prisma 6, Zod 3 (decision 001).
2026-10-23 — SMTP egress spike: all Gmail/Outlook/Zoho hosts reachable on 465/587 from the dev Mac; authenticated send not run (no creds).
2026-10-23 — Built M1–M3 backend without PINGX_PLAN.md (assumptions in decision 002). 25 API + 17 worker integration tests against real Postgres/Redis. Live smoke: signup → Mailpit verify → provider test → fallback → delivery.
2026-10-23 — API moved to port 4100 (4000 is used by another local container). Added Mailpit to compose.
2026-10-23 — M4/M5 dashboard and admin (shadcn/ui on Base UI, Monaco, SVG usage chart). Clicked through in headless Brave across 18 screens, desktop and mobile.
2026-10-23 — M6: pingx SDK (retries with idempotency, batch, webhook verification), live-tested against the API. SSRF guard. Load test: 50 req/s → all 202, p95 8 ms; burst limit enforced at 80 req/s.
2026-10-23 — Deploy artifacts: server/web Dockerfiles verified locally (migrate, api, worker run in container), prod compose with Caddy + nightly pg_dump, GitHub Actions for CI/deploy/SDK publish.
2026-10-25 — Hosting plan: Vercel + Neon + Oracle VM (decision 004). Prisma directUrl for Neon, TRUST_PROXY, docker-compose.vm.yml + Caddyfile.api, vercel.json with /api rewrite, deploy guide rewritten.
2026-10-26 — npm rejected the name `pingx` (too similar to ping/pino/pinia); SDK renamed to `pingx-mail`. Package metadata, LICENSE, README server-only note; public types no longer need @types/node.

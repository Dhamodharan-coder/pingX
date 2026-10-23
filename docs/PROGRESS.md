# PingX Progress

Current milestone: **R&D** (M1 scaffold done early, spikes need it)

## R&D (week 1)
- [ ] Spike: SMTP egress from host (Gmail 465/587, Outlook, Zoho) — reachability OK locally; auth send + VM run pending (docs/spikes/smtp-egress.md)
- [ ] Spike: Gmail daily cap error detection
- [ ] Spike: Handlebars + MJML render (Gmail web/app, Outlook)
- [ ] Spike: BullMQ retry, delay, DLQ, per-provider rate limit
- [ ] Spike: AES-256-GCM encrypt/decrypt with key_version
- [ ] Spike: Redis quota counter + burst limit, load test 50 req/s
- [ ] Spike: Razorpay test subscription → webhook
- [ ] Spike: Gmail API send with OAuth (gmail.send)
- [ ] Claim `pingx` on npm (0.0.1 placeholder)
- [ ] Final Prisma schema + OpenAPI spec for /v1/*

## M1 Foundation
- [x] Monorepo scaffold (pnpm + turbo, apps/*, packages/*)
- [x] Docker Compose (postgres, redis), env.ts, lint, prettier, vitest
- [ ] Prisma schema + migrations + seed (plans, admin, presets, system templates)
- [ ] Auth: signup, verify, login, refresh, reset, Google sign-in, role guard

## M2 Providers + send pipeline
- [ ] Account-level providers (SMTP, Gmail OAuth, Resend, SES API), encrypted config
- [ ] Test-before-save endpoint (unsaved config)
- [ ] Priority order (default + fallback) endpoint
- [ ] API keys + API-key auth middleware
- [ ] POST /v1/send raw → queue → worker → adapter → status/events
- [ ] Retries, fallback chain, provider health, per-provider cap, DLQ

## M3 Templates + quota
- [ ] Templates CRUD, versions, render, preview, test-send, layouts
- [ ] AI template assistant (prompt → MJML) with plan limit
- [ ] Quota middleware (daily, monthly, burst) + usage_daily rollup
- [ ] Idempotency, scheduled send, batch, signed outbound webhooks

## M4 User dashboard
- [ ] Auth screens, projects, providers (presets, test, reorder), templates (Monaco + preview + AI), API keys, messages log, usage, settings
- [ ] Portfolio contact form on PingX

## M5 Admin + billing
- [ ] Admin: plans, users, subscriptions, usage, providers, presets, system/gallery templates, messages, settings, audit log
- [ ] Razorpay subscriptions + webhook; 80%/100% limit emails

## M6 SDK + hardening
- [ ] `pingx` SDK v0.1.0 + README + publish workflow
- [ ] Security pass, auth rate limits, signup captcha
- [ ] Integration + load tests

## Deploy
- [ ] Oracle VM + Docker Compose + Caddy
- [ ] CI/CD (PR checks, deploy on main, SDK publish on tag)
- [ ] Backups + monitoring + go-live checklist

## Log
<!-- YYYY-MM-DD — what was done, anything notable -->
2026-10-23 — Moved PROGRESS.md to docs/. Scaffolded pnpm+turbo monorepo (apps/api, worker, dashboard; packages/db, channels, templates, shared, sdk; spikes). lint/typecheck/test/build green. Pinned TS 6, Prisma 6, Zod 3 (decision 001).
2026-10-23 — SMTP egress spike: all Gmail/Outlook/Zoho hosts reachable on 465/587 from dev Mac; authenticated send not run (no creds).

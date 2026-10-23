# PingX

Multi-tenant messaging microservice. Users sign up, connect their own email providers once (SMTP, Gmail OAuth, Resend, SES API), build templates, and send through one API or the `pingx` npm SDK. Email only in v1; push/WhatsApp later via the same `ChannelAdapter` interface.

Full spec: @docs/PINGX_PLAN.md — read the relevant section before starting any task.
Progress tracker: @docs/PROGRESS.md — update it at the end of every task.

## Stack (do not change without asking)

- API: Node 20, Express, TypeScript (strict), Zod
- Worker: BullMQ (separate process, same monorepo)
- DB: PostgreSQL 16 + Prisma
- Queue/counters: Redis 7
- Email: Nodemailer, Handlebars, MJML; Gmail API (gmail.send) for Gmail OAuth; Resend + SES HTTP APIs
- Dashboard + admin: React, Vite, TanStack Query, Tailwind, shadcn/ui, Monaco
- Auth: JWT access (15m) + refresh (7d, httpOnly cookie), argon2, Google sign-in
- Payments: Razorpay Subscriptions
- Monorepo: pnpm + Turborepo; SDK built with tsup
- Infra: Docker Compose, Caddy, GitHub Actions

## Structure

```
apps/api        routes, middleware (auth, quota), services
apps/worker     bullmq processors, cron jobs
apps/dashboard  user UI + admin UI under /admin (role-guarded)
packages/db         prisma schema, migrations, seed
packages/channels   ChannelAdapter + email adapters (smtp, gmail-api, resend, ses)
packages/templates  handlebars + mjml render
packages/shared     types, zod schemas, crypto, errors
packages/sdk        the `pingx` npm package
```

## Architecture

```
Client apps (SDK/REST + API key) ─┐
User dashboard (JWT) ─────────────┼─► API: auth → quota → render → save message → enqueue
Admin panel (JWT + admin) ────────┘         │              │
                                    Postgres ◄┘     Redis/BullMQ ◄── Razorpay webhook → API
                                         ▲               │
                                         └──── Worker: decrypt creds → send → retry
                                                → fallback chain (by priority) → log status
                                                         │
                                         Email adapters → user's own provider → inbox
```

## Core rules

- Providers are account-level (`providers.user_id`), shared by all projects; ordered by `priority` (1 = default). Fallback only on provider-side errors (auth, cap, timeout, 5xx), never on recipient errors (550, invalid address).
- Provider test runs on unsaved config; never persist credentials during a test.
- All limits come from the DB (`plans`, `users.daily_limit_override`) via a 60s cache. Never hard-code limits or prices.
- Quota check happens in the API before enqueue (Redis INCRBY per user per day). Return 429 with X-RateLimit-* headers.
- Every user-owned query is scoped by `user_id`/`project_id`. No exceptions outside `/admin`.

## Security (non-negotiable)

- Provider secrets (SMTP passwords, API keys, OAuth tokens) encrypted AES-256-GCM with `key_version`; never returned by any API (mask as `••••`).
- API keys: `pgx_live_` + 32 random bytes, store SHA-256 hash only, show once.
- Validate every request body with Zod. Handlebars: no triple-stash on user data.
- No secrets in code or commits; read from env via a validated `env.ts`.
- Admin can never decrypt user credentials. Log admin actions to `audit_logs`.

## Conventions

- TypeScript strict, no `any`. ESM. Named exports.
- Errors: throw `AppError(code, status, message)`; API responds `{ error: { code, message } }`.
- Tests: Vitest; integration tests hit real Postgres/Redis from docker compose.
- Commits: Conventional Commits (`feat(api): ...`). One task = one commit.
- Keep code concise; no over-abstraction; no comments that restate code.

## Commands

```
pnpm i
docker compose up -d postgres redis
pnpm db:migrate     # prisma migrate dev
pnpm db:seed
pnpm dev            # turbo: api + worker + dashboard
pnpm test
pnpm lint && pnpm typecheck
```

## Workflow for every task

1. Read the task's section in docs/PINGX_PLAN.md and the current docs/PROGRESS.md.
2. Propose a short plan (files to touch) before writing code for anything non-trivial.
3. Implement, add/adjust tests, run lint + typecheck + tests.
4. Tick the task in docs/PROGRESS.md and add a one-line note under "Log".
5. If a decision changes the plan, write `docs/decisions/NNN-title.md` (context, decision, why).

## Out of scope for v1 (do not build)

Push, WhatsApp, SMS, open/click tracking, unsubscribe/suppression, self-hosted MTA, teams.

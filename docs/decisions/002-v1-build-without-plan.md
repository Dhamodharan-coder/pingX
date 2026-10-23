# 002: Building v1 without docs/PINGX_PLAN.md

## Context
`docs/PINGX_PLAN.md` (data model, API design, security sections) was not in the repo when the full v1 build was requested. The build followed CLAUDE.md and PROGRESS.md, and every gap was filled with the choices below.

## Decisions
- **Data model** (`packages/db/prisma/schema.prisma`):
  - Tables: plans, users, refresh_tokens, user_tokens, projects, providers, provider_presets, api_keys, layouts, templates and template_versions, messages, message_events, usage_daily, webhooks, subscriptions, audit_logs, settings.
  - Providers are account-level and ordered by `priority`.
  - `projects.default_provider_id` optionally moves one provider to the front of that project's chain.
- **Quota:**
  - Daily, monthly and burst (per second) limits come from `plans`, with `users.daily_limit_override` taking precedence.
  - One unit per message, not per recipient (max 50 recipients per message).
  - Rejected and failed-to-render requests are refunded.
- **Monthly limit** is a plan column. The seed sets daily × 30.
- **Burst default:** 5/s on Free, 10/s on Starter, 50/s on Pro.
- **AI assistant:** `claude-opus-5-5` at low effort with structured output (subject, MJML fragment, sample data) and server-side refusal fallback. Each plan has an `ai_daily_limit` (5 / 25 / 100).
- **Captcha:** Cloudflare Turnstile, optional through env.
- **System emails** (verify, reset, 80%/100% limit warnings) go through the worker via `SYSTEM_SMTP_URL`. They are not sent through users' providers.
- **Gmail:** both the SMTP app-password preset and the Gmail API OAuth provider are supported.
- **Webhooks** are per project, cover `message.sent` and `message.failed`, and are signed with Stripe-style `t=…,v1=…` HMAC-SHA256.
- **SSRF guard:** in production, SMTP hosts and webhook URLs that resolve to private or loopback ranges are rejected.
- **API port 4100:** 4000 was taken on the dev machine. The dashboard reaches the API through `/api` (the Vite proxy in dev, Caddy in prod), and the refresh cookie path follows `PUBLIC_API_PREFIX`.
- **Production image:**
  - One server image (API, worker and migrations) carrying the full workspace `node_modules`. It is about 1.4 GB uncompressed: simple and reliable for v1, and a candidate to slim later.
  - tsup bundles `@pingx/*` source. Third-party packages stay external, and `pnpm check:bundle` makes sure each app declares them.
- **Portfolio contact form:** the "Contact form" gallery template covers PingX's side. Wiring it into the portfolio site happens in that repo with the `pingx` SDK.

## Why
These choices unblock the build with conventional, reversible defaults. Diff them against PINGX_PLAN.md once it is added and record any change as a new decision.

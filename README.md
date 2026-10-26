# PingX

Multi-tenant email microservice. Users connect their **own** providers once, at account level:
- Gmail, through an app password or Google OAuth
- Outlook, Zoho or any other SMTP server
- Resend
- Amazon SES

Then they build templates and send through one API or the `pingx-mail` npm SDK. PingX tries providers in priority order and **falls back automatically** on provider-side errors (auth, caps, timeouts, 5xx), never on bad recipients.

```
apps/api        Express API: auth, providers, projects, templates, quota, /v1 send, billing, admin
apps/worker     BullMQ: send pipeline + fallback chain, retries/DLQ, webhooks, system email
apps/dashboard  React + Vite + shadcn/ui: user dashboard and /admin
packages/db         Prisma schema, migrations, seed
packages/channels   SMTP / Gmail API / Resend / SES adapters + error classifier
packages/templates  HTML + Handlebars rendering
packages/shared     env, crypto (AES-256-GCM), queue contracts, schemas
packages/sdk        the `pingx-mail` npm package
```

## Run locally

Requirements: Node 20+, Docker, pnpm (`corepack enable`).

```bash
pnpm i
cp .env.example .env            # fill JWT secrets, ENCRYPTION_KEY_V1, ADMIN_PASSWORD
docker compose up -d postgres redis mailpit
pnpm db:migrate                 # creates tables
pnpm db:seed                    # plans, presets, gallery templates, admin user
pnpm dev                        # api :4100, worker, dashboard :5173
```

- Dashboard: http://localhost:5173. Sign up, or sign in as `ADMIN_EMAIL` to reach `/admin`.
- Mailpit inbox: http://localhost:8025. Verification and reset emails land here.
- To send for real locally, add a **Custom SMTP** provider with host `localhost`, port `1025`, and any username and password. Mailpit catches everything.

## Checks

```bash
pnpm lint && pnpm typecheck
pnpm test            # unit + integration (uses pingx_test / pingx_worker_test databases, created automatically)
pnpm build && pnpm check:bundle
```

## Docs
- API: [docs/openapi.yaml](docs/openapi.yaml) · SDK: [packages/sdk/README.md](packages/sdk/README.md)
- Deploy + go-live checklist: [docs/deploy.md](docs/deploy.md)
- Progress: [docs/PROGRESS.md](docs/PROGRESS.md) · Decisions: [docs/decisions](docs/decisions) · Spikes: [docs/spikes](docs/spikes)

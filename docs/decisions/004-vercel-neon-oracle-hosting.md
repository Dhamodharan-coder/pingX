# 004: Hosting on Vercel + Neon + Oracle VM

## Context
The user has Vercel and Neon accounts. PingX needs a static dashboard, Postgres, an Express API, and an always-on BullMQ worker with Redis. Vercel functions are request-scoped (no long-running worker, no Redis). Neon is managed Postgres with a PgBouncer pooler.

## Decision
- **Dashboard → Vercel** (root `apps/dashboard`, `vercel.json`).
  - `/api/*` is rewritten to the VM, so the browser stays same-origin.
  - The refresh cookie (`path=/api/auth`) and CORS need no change.
- **Database → Neon.**
  - The app uses the pooled URL (`pgbouncer=true`); migrations use `DIRECT_URL` through Prisma `directUrl`.
  - Locally both point at the same Docker Postgres.
- **API + worker + Redis → Oracle Always Free VM** (`docker-compose.vm.yml`, existing server image).
  - Caddy terminates TLS for `API_DOMAIN`; `sslip.io` works when there is no custom domain.
- **`TRUST_PROXY` env** sets the number of proxy hops; 2 for Vercel → Caddy. Per-IP rate limits then see the real visitor.
- `docker-compose.prod.yml` stays as the single-VM alternative.

## Why
Vercel and Neon cover the static and database parts with no ops work. The worker needs a long-running process, and the free Oracle VM runs it with the Docker setup that's already tested. A proxy rewrite avoids cross-site cookie configuration.

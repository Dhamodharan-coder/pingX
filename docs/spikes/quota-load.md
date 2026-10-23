# Spike: Redis quota counter + burst limit, load test 50 req/s

Script: `spikes/load-test.ts`. Run `PINGX_API_KEY=… pnpm --filter @pingx/spikes load-test -- --rate 50 --seconds 10`.

## What we tested
`POST /v1/send` at a fixed request rate against the dev stack (API + worker + Postgres + Redis + Mailpit on a MacBook). The user was on the Pro plan (10,000/day, burst 50/s).

## Result (2026-10-23)
| Rate | Requests | Result | Latency p50 / p95 / p99 |
|---|---|---|---|
| 50 req/s × 10s | 500 | 500 × 202 | 4.8 / 8.1 / 28 ms |
| 80 req/s × 5s | 400 | 266 × 202, 134 × 429 (burst) | 4.1 / 10.7 / 15.7 ms |

- The worker delivered all 766 accepted messages to Mailpit within about 8 s at concurrency 10.
- Over the burst limit, accepted throughput settled at about 53/s against the 50/s limit. The counter uses a fixed 1-second window, so a boundary can let up to 2× through briefly.
- A rejected request refunds its INCRBY, so the daily counters stay exact.

## Decision
- Keep the fixed-window `MULTI` (INCRBY day/month/second with EXPIRE).
- It is cheap: one round-trip per send.
- The burst overshoot at window boundaries is acceptable for a per-account limit.
- If it ever needs to be smooth, switch the burst key to a sliding window or a token bucket in Lua.

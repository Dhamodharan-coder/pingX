# Spike: SMTP egress

Script: `spikes/smtp-egress.ts` — run `pnpm --filter @pingx/spikes smtp-egress`.

## What we tested
1. Raw TCP (587) / TLS (465) connect + 220 banner, no auth: Gmail, Outlook/Office 365, Zoho (.com, .in).
2. Authenticated Nodemailer send on 465 (implicit TLS) and 587 (STARTTLS, `requireTLS`) using `SMTP_HOST/USER/PASS` from `.env`, with timing and full error dump.

## Result (2026-10-23, dev Mac, home network)
| Host | Port | Result |
|---|---|---|
| smtp.gmail.com | 465 / 587 | OK, ~0.6s banner |
| smtp.office365.com | 587 | OK, 126ms |
| smtp-mail.outlook.com | 587 | OK, 61ms |
| smtp.zoho.com | 465 / 587 | OK, ~0.5–0.75s |
| smtp.zoho.in | 465 | OK, 123ms |

Authenticated send: **not run yet** (no credentials in `.env`).

## Still to do before ticking
- Fill `SMTP_*` in `.env` (Gmail app password) and run the authenticated send on both ports.
- Re-run on the Oracle VM: cloud hosts often block outbound 25/465/587. That run decides the plan.

## Decision (provisional)
Nodemailer config per port: `secure: true` for 465, `requireTLS: true` for 587, 10s connection/greeting/socket timeouts. A timeout or connection refusal is a provider-side error and should trigger fallback.

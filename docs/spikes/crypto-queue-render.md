# Spikes covered by implementation tests

These spikes were folded into the real implementation. Each is backed by tests instead of a throwaway script.

## AES-256-GCM encrypt/decrypt with key_version
- Code: `packages/shared/src/crypto.ts`. Tests: `crypto.test.ts`.
- Format: `base64(iv).base64(tag).base64(ciphertext)`, with `key_version` stored next to it.
- Rotation:
  1. Add `ENCRYPTION_KEY_V2`.
  2. Set `ENCRYPTION_KEY_VERSION=2`.
  3. Old rows still decrypt with v1, and new writes use v2.
- Tampered ciphertext fails on the auth tag.
- **Decision:** adopted as-is.

## BullMQ retry, delay, DLQ, per-provider rate limit
- Code: `apps/worker/src/send.ts`. Tests: `send.test.ts`, which run against real Postgres and Redis.
- Retries: 4 attempts with exponential backoff starting at 30 s (`SEND_JOB_OPTIONS`).
- Scheduled sends use BullMQ `delay`.
- On the last attempt the message is marked failed and copied to the `send-dlq` queue.
- Per-provider limits are Redis counters:
  - `dailyCap` per UTC day
  - `ratePerSecond` with a 1 s window
  - a cap or 429 error from a provider blocks that provider for 15 min
- **Decision:** adopted. BullMQ's built-in group rate limiter (Pro) isn't needed.

## Handlebars + MJML render
- Code: `packages/templates`. Tests: `index.test.ts`.
- MJML 5 renders asynchronously. Fragments get wrapped in `mjml > mj-body > mj-section > mj-column`.
- Layouts insert the rendered template through `{{{content}}}`. That is the only unescaped output allowed: triple-stash anywhere else is rejected on save.
- **Still to do:** visual check in Gmail web/app and Outlook. Use Mailpit locally, then send real test emails to those clients before go-live.

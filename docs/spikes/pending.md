# Spikes still needing external accounts

| Spike | What's built | What's needed to finish |
|---|---|---|
| SMTP egress (auth send + Oracle VM) | `spikes/smtp-egress.ts`. Reachability is OK from dev | Gmail app password in `.env`; run it once on the Oracle VM |
| Gmail daily cap detection | Classifier maps `550 5.4.5` / `dailyLimitExceeded` to a provider-side cap and blocks the provider for 15 min (tests in `channels/src/errors.test.ts`) | Hit a real Gmail cap once to confirm the exact wording |
| Razorpay test subscription → webhook | `/billing/subscribe`, `/webhooks/razorpay` with HMAC check, plan switching | Razorpay test keys and a test plan id on each paid plan (Admin → Plans) |
| Gmail API send with OAuth | `/providers/gmail/authorize` → callback → encrypted refresh token; sends through the `gmail.send` API | A Google Cloud OAuth client with redirect URI `{API_URL}/providers/gmail/callback` and the gmail.send scope verified |
| Claim `pingx` on npm | Name is free (checked 2026-10-23); `packages/sdk` builds and the publish workflow is ready | Run `npm publish` from `packages/sdk` with your npm account |

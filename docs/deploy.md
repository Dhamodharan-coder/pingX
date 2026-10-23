# Deploying PingX (Oracle Cloud VM + Docker Compose + Caddy)

## 1. VM
1. Create an Ampere A1 or x86 VM with Ubuntu 24.04 (2 OCPU / 12 GB is plenty for v1). Reserve a public IP.
2. Open ingress in **both** places:
   - **VCN security list:** 80, 443 TCP and 443 UDP.
   - **The VM's own firewall** (Oracle images ship with iptables rules):
     ```bash
     sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT
     sudo iptables -I INPUT 6 -p udp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```
3. Check SMTP egress before anything else (see `docs/spikes/pending.md`):
   ```bash
   nc -vz smtp.gmail.com 465
   nc -vz smtp.gmail.com 587
   ```
   If OCI blocks them, request an SMTP egress exception or rely on the Resend, SES and Gmail API providers, which use HTTPS.
4. Install Docker: `curl -fsSL https://get.docker.com | sh`, then `sudo usermod -aG docker $USER`.
5. Point a DNS A record (e.g. `pingx.example.com`) at the VM.

## 2. App
```bash
sudo mkdir -p /opt/pingx && sudo chown $USER /opt/pingx
git clone <repo> /opt/pingx && cd /opt/pingx
cp .env.production.example .env.production   # fill every value
openssl rand -base64 48   # JWT_ACCESS_SECRET, then again for JWT_REFRESH_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY_V1 — store a copy in your password manager; losing it loses all provider credentials
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
The `migrate` service applies migrations and seeds plans, presets and gallery templates (plus the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`). Then `api`, `worker` and `web` (Caddy with automatic HTTPS) start.

## 3. Integrations
| Integration | Steps |
|---|---|
| **Google sign-in + Gmail provider** | 1. Create an OAuth client (Web).<br>2. Authorized JS origin: `https://DOMAIN`.<br>3. Redirect URI: `https://DOMAIN/api/providers/gmail/callback`.<br>4. Add the `gmail.send` scope to the consent screen (needs Google verification before going public).<br>5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `VITE_GOOGLE_CLIENT_ID`. |
| **Razorpay** | 1. Create monthly plans in Razorpay.<br>2. Paste each plan id into Admin → Plans.<br>3. Webhook URL: `https://DOMAIN/api/webhooks/razorpay`, events `subscription.*`, secret in `RAZORPAY_WEBHOOK_SECRET`. |
| **AI assistant** | Set `ANTHROPIC_API_KEY`. |
| **Captcha** | Create a Cloudflare Turnstile site and set `TURNSTILE_SECRET` and `VITE_TURNSTILE_SITE_KEY`. |
| **System email** | Set `SYSTEM_SMTP_URL`, e.g. `smtps://user:pass@smtp.zoho.in:465` or a Resend SMTP relay. |

`VITE_*` values are baked into the dashboard at build time, so rebuild `web` after changing them.

## 4. CI/CD (GitHub Actions)
- **`ci.yml`:** lint, typecheck, tests (Postgres and Redis service containers), build, bundle-deps check and Docker builds on every PR and push to main.
- **`deploy.yml`:** after CI passes on main, SSHes to the VM, resets to `origin/main`, rebuilds and restarts, then polls `https://DOMAIN/api/health`. It needs:
  - secrets `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`
  - variables `DOMAIN` and (optionally) `DEPLOY_DIR`
  - a `production` environment
- **`sdk-publish.yml`:** push a tag `sdk-vX.Y.Z` matching `packages/sdk/package.json` to publish `pingx` with provenance. Needs the `NPM_TOKEN` secret.

## 5. Backups
- The `backup` service runs `pg_dump` nightly at 02:00 UTC into `./backups` and keeps `BACKUP_KEEP_DAYS` days.
- Copy the backups off the VM, for example with rclone to OCI Object Storage:
  ```
  0 3 * * * rclone copy /opt/pingx/backups oci:pingx-backups
  ```
- To restore: `gunzip -c backups/pingx-….sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U pingx pingx`.
- Back up `.env.production` separately. The encryption key is required to read provider credentials.

## 6. Monitoring
- Uptime: monitor `https://DOMAIN/api/health` (UptimeRobot or Better Stack, 1-minute interval).
- The Admin overview shows queue depth, failures today and unhealthy providers. Alert if the queue stays above 0 for long.
- Logs: `docker compose -f docker-compose.prod.yml logs -f api worker`.
- Disk: keep an eye on the `pgdata` volume and `./backups`.

## Go-live checklist
- [ ] `.env.production` filled; `COOKIE_SECURE=true`; strong unique secrets; encryption key backed up offline
- [ ] DNS points at the VM and HTTPS works (Caddy obtained a certificate)
- [ ] SMTP egress verified on the VM (465/587), or HTTPS-only providers chosen
- [ ] `SYSTEM_SMTP_URL` sends verify and reset emails (sign up with a real address)
- [ ] Admin login works and the admin password has been changed after first login
- [ ] Each paid plan has a Razorpay plan id; a test-mode subscription moves a user to the paid plan via webhook
- [ ] Google OAuth consent screen is configured; Gmail provider connect works
- [ ] Test emails render correctly in Gmail web, Gmail app and Outlook
- [ ] Backups run and one restore has been tested
- [ ] Uptime monitor on `/api/health`
- [ ] `pingx` SDK published; dashboard Quickstart shows the production URL
- [ ] CI is green on main and the deploy workflow succeeds

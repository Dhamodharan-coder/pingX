# Deploying PingX: Vercel + Neon + Oracle VM

```
Browser / SDK ──► Vercel  https://pingx-yourname.vercel.app      dashboard (static React)
                    │  /api/*  ─ rewrite (proxy) ─┐
                    ▼                             ▼
                          Oracle VM  https://api.<VM-IP>.sslip.io   Caddy (auto HTTPS)
                            ├─ api     Express :4100
                            ├─ worker  BullMQ: sends, retries, webhooks, cleanup
                            └─ redis   queue + quota counters
                                          │
                                          ▼
                               Neon Postgres (pooled for the app, direct for migrations)
```

The dashboard and every client (portfolio, SDK, Razorpay webhook) use the **Vercel URL + `/api`**. Vercel forwards those requests to the VM, so the login cookie stays first-party and no CORS setup is needed.

Do the steps in order: 1 Neon → 2 VM → 3 Vercel → 4 connect them → 5 check.

---

## 1. Neon (database)

1. In the Neon console, create a project in the region closest to the VM, e.g. **AWS ap-south-1 (Mumbai)** for an Oracle Mumbai/Hyderabad VM. Create a database named `pingx`.
2. Open **Connect**, then copy two connection strings:
   - **Pooled** (host contains `-pooler`): this becomes `DATABASE_URL`. Append `&pgbouncer=true&connect_timeout=15`.
   - **Direct** (pooling switched off): this becomes `DIRECT_URL`. Append `&connect_timeout=15`.
3. Both must end with `sslmode=require`. You don't create any tables yourself: the VM's `migrate` service does it on first start.

> Neon autosuspends idle databases on the free plan. The first request after a pause takes about 1 s longer; `connect_timeout=15` covers that.

## 2. Oracle VM (API + worker + Redis)

### 2.1 Create the VM
1. Oracle Cloud → Compute → **Create instance**: Ubuntu 24.04, shape **VM.Standard.A1.Flex** (Always Free: 2 OCPU / 12 GB is plenty). Add your SSH public key.
2. Networking → **Reserve** the public IP so it never changes. Note it, e.g. `140.245.12.34`.
3. Open ports 80 and 443 in **two** places:
   - VCN → Security List → Ingress rules: TCP 80 and TCP 443 from `0.0.0.0/0`.
   - On the VM itself (Oracle images ship with iptables rules):
     ```bash
     sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT
     sudo netfilter-persistent save
     ```
4. Check that the VM can reach Gmail SMTP (some clouds block it):
   ```bash
   nc -vz smtp.gmail.com 587 && nc -vz smtp.gmail.com 465
   ```
   If both fail, use Resend or SES providers (HTTPS), or request an SMTP exception from Oracle.

### 2.2 Install Docker and get the code
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && exit        # log in again afterwards

sudo mkdir -p /opt/pingx && sudo chown $USER /opt/pingx
git clone https://github.com/Dhamodharan-coder/pingX.git /opt/pingx
cd /opt/pingx
```
If the repo is private, create a GitHub deploy key (read-only), or clone with a fine-grained token.

### 2.3 Configure `.env.production`
```bash
cp .env.production.example .env.production
nano .env.production
```
| Setting | Value |
|---|---|
| `API_DOMAIN` | `api.<IP with dashes>.sslip.io`, e.g. `api.140-245-12-34.sslip.io`. Or your own subdomain, e.g. `api.yourdomain.com`, with an A record to the VM IP |
| `ACME_EMAIL` | your email (for the HTTPS certificate) |
| `APP_URL` | your Vercel URL, e.g. `https://pingx-yourname.vercel.app`. If you don't know it yet, set it after step 3 and restart |
| `API_URL` | `APP_URL` + `/api` |
| `DATABASE_URL` / `DIRECT_URL` | the two Neon strings from step 1 |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `openssl rand -base64 48`, two different values |
| `ENCRYPTION_KEY_V1` | `openssl rand -base64 32`. **Save a copy in your password manager**: without it, saved provider passwords can't be decrypted |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | your first admin login |
| `EMAIL_*`, `SMTP_*` | same as your local `.env` (Gmail + app password) |

Keep `TRUST_PROXY=2`, `COOKIE_SECURE=true` and `PUBLIC_API_PREFIX=/api` as they are.

### 2.4 Start it
```bash
docker compose -f docker-compose.vm.yml --env-file .env.production up -d --build
docker compose -f docker-compose.vm.yml logs -f migrate     # "seed done", then Ctrl+C
curl https://api.140-245-12-34.sslip.io/health              # {"ok":true}
```
The first build takes a few minutes. Caddy gets the HTTPS certificate automatically on the first request.

## 3. Vercel (dashboard)

1. Edit `apps/dashboard/vercel.json`: replace `REPLACE_WITH_API_DOMAIN` with your `API_DOMAIN` (e.g. `api.140-245-12-34.sslip.io`). Commit and push.
2. Vercel → **Add New → Project** → import `Dhamodharan-coder/pingX`.
3. Settings on the import screen:
   - **Root Directory:** `apps/dashboard`. The framework (Vite), build and install commands come from `vercel.json`.
   - **Environment Variables:**
     - `ENABLE_EXPERIMENTAL_COREPACK` = `1`, so Vercel uses the repo's pnpm version.
     - `VITE_GOOGLE_CLIENT_ID` and `VITE_TURNSTILE_SITE_KEY`, only if you use them.
4. **Deploy**. Note the URL, e.g. `https://pingx-yourname.vercel.app`.

Every push to `main` now redeploys the dashboard automatically.

## 4. Connect everything

1. On the VM, make sure `APP_URL`/`API_URL` in `.env.production` match the Vercel URL, then:
   ```bash
   docker compose -f docker-compose.vm.yml --env-file .env.production up -d
   ```
2. Open the Vercel URL, sign in as `ADMIN_EMAIL` and change the admin password (Settings).
3. Add your Gmail provider, project, API key and templates again. The production database is new and empty, so nothing from your laptop is in it.
4. **Portfolio (Netlify):** in Site settings → Environment variables, set:
   - `PINGX_BASE_URL` = `https://pingx-yourname.vercel.app/api`
   - `PINGX_API_KEY` = the new production key
   - `PINGX_TEMPLATE_OWNER` and `PINGX_TEMPLATE_CONFIRMATION` = your template slugs
   Redeploy the site.
5. Optional integrations:
   - **Google sign-in / Gmail provider:**
     - Authorized JS origin: the Vercel URL.
     - Redirect URI: `https://pingx-yourname.vercel.app/api/providers/gmail/callback`.
   - **Razorpay:** webhook URL `https://pingx-yourname.vercel.app/api/webhooks/razorpay`.

## 5. Check
- [ ] `https://<API_DOMAIN>/health` returns `{"ok":true}`
- [ ] The Vercel URL loads, login works, and refreshing the page keeps you logged in (refresh cookie through `/api`)
- [ ] Sign up with a second email: the verification email arrives
- [ ] The provider **Send test email** arrives
- [ ] Your portfolio contact form sends both emails; they appear under **Messages**
- [ ] `docker compose -f docker-compose.vm.yml ps` shows api, worker, redis and caddy as running/healthy

## Updating

**Manually:**
```bash
cd /opt/pingx && git pull
docker compose -f docker-compose.vm.yml --env-file .env.production up -d --build
```
Migrations run automatically through the `migrate` service.

**Automatically with GitHub Actions** (`.github/workflows/deploy.yml`): after CI passes on `main`, it SSHes to the VM and runs the commands above. Add:
- repository secrets `DEPLOY_SSH_KEY`, `DEPLOY_HOST` (VM IP) and `DEPLOY_USER` (`ubuntu`)
- variables `API_DOMAIN` and optionally `DEPLOY_DIR`
- an environment named `production`

## Backups and monitoring
- **Database:** Neon keeps point-in-time restore history (length depends on your plan). For an extra copy: `pg_dump "$DIRECT_URL" | gzip > pingx-$(date +%F).sql.gz` from any machine.
- **Secrets:** keep `.env.production` (especially `ENCRYPTION_KEY_V1`) in your password manager.
- **Redis** only holds queues and counters. It survives restarts (append-only file), and losing it only drops jobs that were in flight.
- **Uptime:** monitor `https://<API_DOMAIN>/health` with UptimeRobot or Better Stack.
- **Logs:** `docker compose -f docker-compose.vm.yml logs -f api worker`.

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| Dashboard loads but login fails with 404/502 | `vercel.json` still has `REPLACE_WITH_API_DOMAIN`, or the VM is down. Check `https://<API_DOMAIN>/health` |
| Logged out after every refresh | `APP_URL`/`API_URL` don't match the Vercel URL, or `COOKIE_SECURE` is wrong. Fix `.env.production` and restart |
| Caddy can't get a certificate | Ports 80/443 aren't open in the security list or iptables, or `API_DOMAIN` doesn't resolve to the VM |
| `migrate` fails with P1001 | Neon URL wrong or missing `sslmode=require`; check `DIRECT_URL` |
| Emails stay "queued" | Worker not running (`docker compose … ps`) or SMTP blocked on the VM (step 2.1.4) |
| Rate limits hit everyone at once | `TRUST_PROXY` isn't `2`, so every visitor looks like Vercel's IP |

## Alternative: everything on the VM
`docker-compose.prod.yml` runs the dashboard (Caddy), API, worker, Redis and Postgres all on one VM with your own domain, with no Vercel or Neon. Use `.env.production.example` as a base, and add `DOMAIN`, `POSTGRES_PASSWORD` and the local `DATABASE_URL`/`DIRECT_URL=postgresql://pingx:<password>@postgres:5432/pingx`.

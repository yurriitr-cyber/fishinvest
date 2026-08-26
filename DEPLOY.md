# Deploy to Railway (stable Mini App host)

This replaces localhost tunnels. You get a fixed HTTPS URL that Telegram and Telenor Nettvern can reach.

## Architecture

| Service | Dockerfile | Public? | Role |
|---------|------------|---------|------|
| **Postgres** | Railway plugin | no | `DATABASE_URL` |
| **api** | `Dockerfile.api` | private or public | Nest API + migrate/seed on boot |
| **web** | `Dockerfile.web` | **yes** (BotFather URL) | Mini App static + `/api` proxy |
| **bot** | `Dockerfile.bot` | no | Grammy long-polling |

## 1. Push the repo to GitHub

```bash
git remote add origin git@github.com:YOUR_USER/rare-fish-investment.git   # if needed
git push -u origin HEAD
```

## 2. Create the Railway project

1. Open [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → select this repo.
2. Add **PostgreSQL** (Plugins / Database).
3. Create **three** empty services from the same repo (or duplicate the first service twice). Name them `api`, `web`, `bot`.

### Per-service config file

In each service → **Settings** → **Config-as-code** → set path:

| Service | Config file |
|---------|-------------|
| api | `/railway/api.toml` |
| web | `/railway/web.toml` |
| bot | `/railway/bot.toml` |

(Alternatively set variable `RAILWAY_DOCKERFILE_PATH` to `Dockerfile.api` / `Dockerfile.web` / `Dockerfile.bot`.)

Leave **Root Directory** empty (shared monorepo — build context must be the repo root).

Generate a **public domain** for **web** (and optionally for **api** if you want direct API access).

## 3. Variables

### Shared / api

Link Postgres so `DATABASE_URL` is injected into **api**.

Set on **api** (and share via Railway shared variables where useful):

```
NODE_ENV=production
PORT=3000
TELEGRAM_BOT_TOKEN=<from BotFather — revoke if it was leaked>
TELEGRAM_BOT_USERNAME=rarefishinvestment_bot
TELEGRAM_MINI_APP_NAME=app
INTERNAL_API_SECRET=<long random string>
ADMIN_API_SECRET=<long random string — used to sign into /admin>
ADMIN_TELEGRAM_IDS=<your telegram user id>
STARS_TO_GAME_CREDIT_RATE=1
STARS_DEPOSIT_FEE_PERCENT=0
INITIAL_BONUS_AMOUNT=200
REFERRAL_BONUS_AMOUNT=300
REFERRAL_JOIN_BONUS_AMOUNT=50
REFERRAL_ENABLED=true
PRICE_UPDATE_INTERVAL=3s
RUN_SEED=true
```

After the first successful seed you can set `RUN_SEED=false` (optional; seed uses upserts).

### web

```
PORT=5180
API_PROXY_TARGET=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}
```

If private networking fails, use the public API URL instead:

```
API_PROXY_TARGET=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
```

Do **not** set `VITE_API_URL` unless you intentionally want the browser to call the API origin directly (CORS is already enabled).

### bot

```
TELEGRAM_BOT_TOKEN=${{api.TELEGRAM_BOT_TOKEN}}
TELEGRAM_BOT_USERNAME=${{api.TELEGRAM_BOT_USERNAME}}
TELEGRAM_MINI_APP_NAME=app
INTERNAL_API_SECRET=${{api.INTERNAL_API_SECRET}}
WEBAPP_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}/api
```

Public fallback for API from bot:

```
API_INTERNAL_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}/api
```

## 4. Deploy order

1. Deploy **Postgres** + **api** first (watch logs for migrate + seed + `API running`).
2. Deploy **web** — open `https://<web-domain>/` and confirm the UI loads; `/api/health` via the web host should return ok.
3. Deploy **bot** — logs should show `Bot @… running` and the `WEBAPP_URL`.

## 5. Admin console (daily fish growth)

URL: `https://<web.RAILWAY_PUBLIC_DOMAIN>/admin/`

1. Set on **api**: `ADMIN_API_SECRET` (long random) and `ADMIN_TELEGRAM_IDS` (your numeric Telegram id from `@userinfobot`).
2. Open `/admin/`, paste Telegram id + secret → **Sign in**.
3. Tab **Daily growth**: enter e.g. `15` for +15%/day per fish → **Save all**.
   Prices drift toward that target over ~24h (not an instant jump). Use **Prices** tab for one-shot bumps.

## 6. BotFather

1. `/mybots` → your bot → **Bot Settings** → **Menu Button** / **Configure Mini App**.
2. Set URL to: `https://<web.RAILWAY_PUBLIC_DOMAIN>`
3. Open the bot → **/start** → Open Mini App.

## 7. Security

- If the bot token was pasted in chat earlier, run **/revoke** in BotFather and update `TELEGRAM_BOT_TOKEN` on Railway.
- Keep `INTERNAL_API_SECRET` and `ADMIN_API_SECRET` long and private.

## Local still works

```bash
npx pnpm@9.15.0 db:up
npx pnpm@9.15.0 --filter @rare-fish/api dev
npx pnpm@9.15.0 --filter @rare-fish/web dev
npx pnpm@9.15.0 --filter @rare-fish/bot dev
```

No tunnel needed for day-to-day coding; use Railway URL only for Telegram.

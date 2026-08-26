# Rare Fish Investment

Telegram Mini App + Bot + API: meme fish market simulator with game credits and referrals.

## Stack

| Layer | Tech |
|-------|------|
| Mini App | Vite + React (`apps/web`) |
| Bot | Grammy (`apps/bot`) |
| API | NestJS + Fastify (`apps/api`) |
| DB | PostgreSQL + Prisma (`packages/db`) |

## Economy

| Event | Amount |
|-------|--------|
| First join | +200 game ⭐ |
| Join via invite | +50 game ⭐ |
| Friend joins (you) | +300 game ⭐ |

Game credits ≠ real Telegram Stars.

## Quick start

```bash
cp -n .env.example .env
# If Docker is available:
docker compose -f docker/docker-compose.yml up -d
# If Docker is NOT available (this machine):
pnpm db:up
pnpm install
pnpm db:generate
pnpm db:migrate:deploy   # or: pnpm db:migrate
pnpm db:seed
pnpm --filter @rare-fish/api dev
pnpm --filter @rare-fish/web dev
```

Browser smoke test (no Telegram): open http://localhost:5180 — uses `x-dev-telegram-id: 1001`.

### Bot

1. Create a bot with [@BotFather](https://t.me/BotFather), paste token into `.env`
2. Create a Mini App (`/newapp`) pointing at your HTTPS `WEBAPP_URL`
3. Run:

```bash
pnpm --filter @rare-fish/bot dev
```

Local Mini Apps need HTTPS. Prefer Railway (stable) over tunnels — see [DEPLOY.md](./DEPLOY.md).

## Deploy (Railway)

Stable production host (API + web + bot + Postgres): **[DEPLOY.md](./DEPLOY.md)**.

## Apps

- `GET /api/me` — register + bonuses
- `GET /api/fish` — market
- `POST /api/trade/buy|sell`
- `GET /api/portfolio` / `leaderboard` / `referrals`
- `GET /api/deposit/methods` — payment providers (disabled until Phase payments)

## Status

- [x] API core loop + referrals
- [x] Mini App UI
- [x] Telegram bot launcher
- [x] Telegram Stars deposits (invoice + bot confirm + ledger)
- [x] TON oracle scaffold (`GET /api/oracle/ton`)
- [x] TON deposits (wallet + memo + poller)
- [x] Admin panel (`apps/admin` → http://localhost:5181)
- [ ] Live Gifts / other crypto checkout

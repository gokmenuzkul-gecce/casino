# Aurora — repo notes for agents

Licensable online casino platform. Provably-fair engine, internal games, wallet, payments,
KYC, risk, affiliates and a staff back office.

## Layout

- `apps/engine` — Fastify API + Socket.IO (`tsx watch`, port 4000). Owns auth, wallet, bets,
  admin, and the game socket rooms.
- `apps/web` — React + Vite SPA (port 12000 via the workspace proxy). Single global stylesheet
  at `src/styles.css`; the design system is class-based with CSS custom properties.
- `packages/game-core` — deterministic game resolution (limbo, dice, mines, plinko, keno,
  crash, slots, roulette, blackjack). Every round is replayable from seeds.
- `packages/shared` — zod schemas and money helpers shared by engine and web.
- `infra/` — docker-compose for Postgres, Redis and Mailpit.

## Commands

```bash
npm test                              # vitest across workspaces
npx tsc -p apps/web/tsconfig.json --noEmit
npm run build -w apps/web
python3 apps/web/scripts/generate_art.py   # regenerates public/ SVGs
```

## Conventions

- UI copy is Turkish written without diacritics (`Yatirim`, `Cuzdan`, `Gercek`) to match the
  existing codebase. Keep it consistent.
- Never invent game data, providers or categories in the UI. Empty categories are hidden until
  the backend reports `gameCount > 0`; empty shelves show an honest empty state instead.
- Game art comes from `apps/web/public/{banners,games,providers}/`. Game slugs map to
  `games/<slug>.svg` with `games/default.svg` as fallback; unknown slugs must not 404.
- Preserve the existing class names and CSS variables (`--bg`, `--primary`, `--gold`, ...).
  Restyling happens by changing values, not by renaming hooks other components rely on.
- Bet params are validated by `packages/game-core`; e.g. limbo takes `targetMultiplier`
  (not `target`). Wrong param names surface as `INTERNAL` errors.

## Cold start

A fresh sandbox has no Docker daemon and no services. To bring the platform up:

```bash
sudo dockerd > /tmp/docker.log 2>&1 &      # daemon does not auto-start
sleep 5
sudo docker compose -f infra/docker-compose.yml up -d

npx prisma generate --schema packages/db/prisma/schema.prisma
cd packages/db && npx prisma db push --skip-generate   # no migrations/ dir exists
cd ../.. && npm run db:seed                            # 57 tables, idempotent

nohup npm run dev:engine > /tmp/engine.log 2>&1 &      # port 4000
cd apps/web && nohup npx vite --port 12000 --host 0.0.0.0 > /tmp/web.log 2>&1 &
```

Notes:

- `npm run db:migrate` runs `prisma migrate dev`, which prompts interactively and hangs.
  There is no `prisma/migrations/` directory, so use `db push`.
- The external tunnel maps to port **12000**, but `vite.config.ts` declares 3000. Vite must
  be started with `--port 12000` or the work host returns 502.
- `npm run dev:engine` prints an `EBADF` error from `tsx watch` losing stdin under `nohup`;
  the child server still starts and `/health` returns 200. Harmless.

## Access

- Site: `/` · Admin: `/admin` · Mailpit: port 8025
- Demo admin: `admin@aurora.local` / `Admin!2345`
- Engine health: `GET http://localhost:4000/health` → `checks.database` / `checks.redis`

## Tests

- `npm test` runs across workspaces. `apps/engine` has DB-backed tests (seamless wallet
  settlement and the Gregmorn callback route); they need the `infra/docker-compose.yml`
  services and skip with a printed reason when Postgres is unreachable.
- `apps/engine/vitest.config.ts` loads the repo `.env` so tests use the same database,
  Redis and secrets as the server, and runs files serially because they share rows.
- Tests assert against real ledger and wallet state; nothing there is mocked.

## Gregmorn Hub smoke test

- `npm run smoke:gregmorn` (`apps/engine/scripts/gregmorn-smoke.ts`) walks login →
  catalogue → `openGame` (demo) → wallet callbacks and prints a PASS/FAIL verdict per
  step. It is an operator tool, not part of `npm test`, because it needs real stage
  credentials and network access.
- All six `GREG_MORN_*` values must be set; the registry hands back a
  `DisabledAggregator` unless every one of them, including `userId`, is present.
- Use `demo: "1"` (`openGame`) to verify a launch before an inbound-public callback
  URL exists — demo sessions never issue wallet callbacks.
- The stage base URLs in `.env.example` are live and reachable; the login/password
  examples printed in the vendor spec are placeholders and answer HTTP 401.
- `PLATFORM_MODE` decides whether an aggregator reports `live` or `demo`; it is not a
  credential, so a configured provider still runs in demo mode until it is set to `live`.

### Getting aggregator games onto the site

The provider catalogue does not appear in `/games` on its own — it has to be imported
once and re-imported after catalogue changes:

1. Set the six `GREG_MORN_*` values and `GAME_AGGREGATOR=gregmorn`, then restart the
   engine (provider config is read at boot).
2. Admin → Games → **"Sağlayıcıdan İçe Aktar"** (`POST /api/admin/games/sync`) upserts
   every enabled remote game into `Game` + `GameProviderModel`. Re-running is safe:
   games already imported by `providerGameId` are updated, not duplicated.
3. `/games` then lists them with `type=external`; launching works through
   `POST /api/games/:slug/launch` with `{ mode: "demo" | "real" }`.

Verifying this end to end without live credentials is possible by pointing
`GREG_MORN_OFFICE_URL` / `GREG_MORN_CLIENT_URL` at a local stub that answers
`POST /auth/login`, `GET /users/:id/getUserGames/:currency`, and
`POST /games/openGame`. That exercises the real login, import, listing and launch
code paths; only the vendor's network is simulated.

## Aggregator wallets

Games hosted by an aggregator settle against our ledger over a **seamless
wallet**: the provider owns the round and calls our callback for every money
movement. See `docs/providers/betskilla.md` and `docs/providers/gregmorn.md`.

The wallet callback route is registered under the *active* aggregator's name
(`/webhooks/aggregator/<name>/wallet`), with `/webhooks/aggregator/gregmorn/wallet`
kept as an alias for existing deployments. When adding a provider, implement
`verifyCallback`, `parseWalletCallback`, `walletResponse` and `walletError` on
the adapter — the route and the settlement service are provider-agnostic.

A `verifyCallback` that always returns `false` is the failure mode to watch for:
the game still launches, but it runs on the provider's own balance instead of the
player's, which reads as "there is no balance in the game". `GET /webhooks/health`
reports whether the bridge is armed.

That said, a correct callback handler is only half of it: the provider must
actually bind sessions to a player and call our wallet URL. BetSkilla's
`BETSKILLA_LOGIN` is a *player* account and the vendor ignores player identity at
launch, so on that provider the wallet is disconnected no matter what our side
does. Before trusting a new provider, load the brand host's own SPA bundle,
extract its API calls, and check whether the launch endpoint accepts a player
identity — `BetSkillaAggregator.describeAccount()` and the health detail exist
precisely so this is visible instead of assumed.

## Gotchas

- Provider credentials can now be entered at **Admin → Entegrasyon → Kimlik Gir**
  (`PUT /api/admin/integrations/:kind`). They are AES-256-GCM encrypted into
  `provider_configs`, overlaid onto `process.env` at boot and again on save, and a
  saved value wins over `.env`. Secrets are masked in the API response and never
  written to the audit trail — only the changed key names are. See
  `apps/engine/src/services/provider-config.ts`.
- Gregmorn/Gamble Hub: use the hosts from `docs/providers/gregmorn-openapi.json`
  (`*.gregmorn.org`), not the `*.gamble-hub.net` aliases. The aliases sit behind a
  Cloudflare JavaScript challenge and answer a server-to-server call with HTTP 403
  ("Just a moment...") no matter how correct the credentials are. A working host
  answers `401 {"error":"authorization failed"}` to wrong credentials, which is the
  signal that the host — not the credentials — is fine.
- BetSkilla's operator host does **not** answer 401/403 when its session dies. It answers
  `400 {"error":true,"code":266,"message":"game is not available"}`. The adapter caches one
  cookie for its whole lifetime, so before `sessionExpired()` treated 400 as an expiry, a
  long-running engine failed *every* launch with that opaque message until restarted —
  while a freshly started process worked. `apps/engine/src/providers/betskilla.test.ts`
  covers this against a real HTTP stub; do not narrow that check back to 401/403.
- "Ministry of Information Technology" warning text does not exist anywhere in this repo.
  It is xenzora.com's own licence banner, not a feature that was ever implemented here.
- Do not edit JSX closing tags with `sed`; `>Text<h1>` style replacements silently break JSX.
  Always run `tsc --noEmit` after bulk text edits.
- `public/` was empty historically, so every DB-referenced image 404'd into the SPA fallback.
  If images vanish again, check the proxy is serving `public/` before touching components.

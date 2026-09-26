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

## Access

- Site: `/` · Admin: `/admin` · Mailpit: port 8025
- Demo admin: `admin@aurora.local` / `Admin!2345`
- Engine health: `GET http://localhost:4000/health` → `checks.database` / `checks.redis`

## Gotchas

- Do not edit JSX closing tags with `sed`; `>Text<h1>` style replacements silently break JSX.
  Always run `tsc --noEmit` after bulk text edits.
- `public/` was empty historically, so every DB-referenced image 404'd into the SPA fallback.
  If images vanish again, check the proxy is serving `public/` before touching components.

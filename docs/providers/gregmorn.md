# Gregmorn Hub integration

Gregmorn Hub is the game aggregator that supplies slot, live-casino and table
content. It uses the **seamless wallet** model: Gregmorn owns the round, and it
calls our wallet for every money movement instead of us mirroring its balance.

The vendor specification is checked in at
[`gregmorn-openapi.json`](./gregmorn-openapi.json).

## What is implemented

| Gregmorn endpoint | Our side |
| --- | --- |
| `POST /auth/login` | `GregmornAggregator.authenticate()` — form-encoded, cached until expiry, refreshed once on 401 |
| `GET /users/{user_id}/getUserGames/{currencyISO}` | `GregmornAggregator.listGames()` → `/api/admin/games/sync` |
| `POST /games/openGame` | `GregmornAggregator.launchSession()` via `POST /api/games/:slug/launch` |
| `POST /games/freespinsInfo` | `GregmornAggregator.freespinsInfo()` via `POST /api/admin/games/freespins-info` |
| Wallet callbacks (`getBalance`, `writeBet`, `rollback`) | `POST /webhooks/aggregator/gregmorn/wallet` |

The transfer-wallet commands (`userCreate`, `userCash`, `userInfo`) are
deliberately **not** wired up: they are the alternative to seamless mode, and
enabling both would double-count every bet. Seamless alone is implemented.

## Configuration

Set these in `.env`, then restart the engine:

```bash
GAME_AGGREGATOR=gregmorn
GREG_MORN_OFFICE_URL=https://office-api-dev.gregmorn.org   # stage: auth + catalogue
GREG_MORN_CLIENT_URL=https://client-api-dev.gregmorn.org   # stage: game launch
GREG_MORN_LOGIN=...
GREG_MORN_PASSWORD=...
GREG_MORN_SECRET_KEY=...      # signs outbound calls, verifies callbacks
GREG_MORN_USER_ID=...         # API user id issued by Gregmorn
GREG_MORN_CURRENCY=TRY
```

Stage and production are separate deployments with separate logins, secret keys
and IP allowlists. Start on stage and only move to production after acceptance.

Two things must be arranged with Gregmorn before real play works:

1. **A publicly reachable callback URL.** Gregmorn must be able to POST to
   `{API_PUBLIC_URL}/webhooks/aggregator/gregmorn/wallet`. Callback URLs are
   configured per currency on their side. The launch call also sends an explicit
   `callbackUrl` override so the session settles against this deployment even if
   the panel default points elsewhere.
2. **IP allowlisting.** Gregmorn needs our egress IPs; our firewall needs their
   ingress IPs. Separate lists for stage and production.

## How settlement stays correct

- `transactionId` is the idempotency key, namespaced as
  `agg:gregmorn:<transactionId>`. Providers retry on timeout, so a repeated
  `writeBet` returns the current balance without moving money again.
- A `writeBet` carries `bet` **and** `win` together, so the net movement is what
  reaches the ledger. A losing spin is a debit, a winning spin a credit.
- Amounts arrive in **major units** and may be numbers or strings (SL-Games and
  X-Games send strings). They are converted with the currency's precision:
  25 USD becomes 2500 minor units, 0.00012345 BTC becomes 12345 satoshi.
- An uncovered bet is rejected with HTTP 400 and `status: "fail"`, which is the
  signal providers read as "do not start the spin". The platform never lets a
  provider overdraw a wallet.
- A rollback reverses the recorded net delta of the original transaction, so the
  wallet returns to its exact pre-bet state, and only once.
- Every callback is stored in `webhook_events` before processing, verified flag
  included, so a disputed settlement can be reconstructed from what was sent.

## Verifying the integration

```bash
npm test                      # engine tests cover settlement + the HTTP callback
```

The tests run against the real database and the real ledger when Postgres is
reachable; otherwise they skip with an explicit reason.

To check a stage deployment by hand:

```bash
# Signature and shape, without credentials.
curl -i -X POST http://localhost:4000/webhooks/aggregator/gregmorn/wallet \
  -H 'content-type: application/json' \
  -d '{"cmd":"getBalance","login":"demo_player","sessionid":"s"}'
# => HTTP 400 {"status":"fail"} when unsigned, as intended

# Provider health, including whether Gregmorn auth succeeds.
curl -s http://localhost:4000/webhooks/health
```

## Adding games to the lobby

Once credentials are in place, pull the catalogue:

```bash
POST /api/admin/games/sync      # upserts providers, categories and games
```

Synced games are stored with `embedType: EXTERNAL` and `providerGameId` set to
Gregmorn's `integration:provider:game` id, and they appear in the lobby next to
the internal games. `GET /api/config/public` reports the aggregator profile so
the admin integrations page shows what is configured.

# BetSkilla seamless-wallet integration

BetSkilla brands (Xenzora, Kingsbet) are white-label hubs: their own `/api`
gateway serves the catalogue, launches game sessions and passes the player
identity through to us. Games settle against **our** ledger over a seamless
wallet, so the balance inside a game is the player's real balance.

## What is implemented

| Hub side | Our side |
| --- | --- |
| `POST /api/client-login` | `BetSkillaAggregator.login()` — cookie session, refreshed once on expiry |
| `GET /api/v3/games?type=slot\|live` | `BetSkillaAggregator.listGames()` → `/api/admin/games/sync` |
| `POST /api/games/{router}` | `BetSkillaAggregator.launchSession()` via `POST /api/games/:slug/launch` |
| Wallet callbacks (`getBalance`, `writeBet`, `rollback`) | `POST /webhooks/aggregator/betskilla/wallet` |

## Why the balance was disconnected

Two things had to line up, and neither did:

1. **Launch carried no player identity.** The launch payload only sent `demo`
   and `currency`, so every session opened as the operator account and the hub
   had no idea which player was playing. Real launches now send `login`,
   `userId`, `sessionToken` and `callbackUrl`; demo launches stay anonymous
   because they never touch the wallet.
2. **The callback bridge was switched off.** `verifyCallback()` returned `false`
   unconditionally, so the wallet route rejected every callback with
   `{"status":"fail","error":"invalid signature"}` and nothing ever moved in our
   ledger. It now verifies an HMAC-SHA256 over the raw body with
   `BETSKILLA_CALLBACK_SECRET`.

The hub speaks the same command envelope as Gregmorn (`cmd` + `login` +
`bet`/`win`), so the adapter maps it onto the same normalised shape and the
shared `AggregatorWalletService` does the settlement — the same code path
already proven against Gregmorn, including idempotency and rollback.

## Configuration

```bash
GAME_AGGREGATOR=betskilla
BETSKILLA_BASE_URL=https://xenzora.com
BETSKILLA_LOGIN=...             # aggregator-issued operator login
BETSKILLA_PASSWORD=...
BETSKILLA_CURRENCY=TRY          # must equal CURRENCY
BETSKILLA_CALLBACK_SECRET=...   # signs the hub's wallet callbacks
```

`BETSKILLA_CURRENCY` must match `CURRENCY`. Settlement refuses a session in an
unsupported currency rather than treating it as TRY, so a mismatch shows up as a
rejected callback instead of a silently mispriced bet.

Leave `BETSKILLA_CALLBACK_SECRET` empty to keep the bridge off: games still
open, but they play on the hub's balance. `GET /webhooks/health` says which
state the deployment is in.

## How settlement stays correct

- `transactionId` is the idempotency key, namespaced `agg:betskilla:<id>`. The
  hub retries on timeout, so a repeated `writeBet` replays the balance without
  moving money again.
- A `writeBet` carries `bet` **and** `win`; the net movement reaches the ledger.
- An uncovered bet is rejected with HTTP 400 and `status: "fail"`, the signal the
  hub reads as "do not start the spin".
- A rollback reverses the recorded net delta once; a replayed rollback is a
  no-op.
- Every callback is stored in `webhook_events` before processing.

## Verifying the integration

```bash
npm test -w @aurora/engine -- src/routes/webhooks-betskilla.test.ts
```

The test drives the real Fastify app with a real signature and reads the
resulting balance from Postgres, so it fails if the money does not actually
move. It skips with a reason when Postgres is unreachable.

To check a deployment by hand (needs `BETSKILLA_CALLBACK_SECRET`):

```bash
# Unsigned => rejected, as intended.
curl -i -X POST http://localhost:4000/webhooks/aggregator/betskilla/wallet \
  -H 'content-type: application/json' \
  -d '{"cmd":"getBalance","login":"demo_player"}'
# => HTTP 400 {"status":"fail","error":"invalid signature"}

curl -s http://localhost:4000/webhooks/health   # includes the wallet-bridge state
```

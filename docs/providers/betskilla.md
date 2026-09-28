# BetSkilla integration (catalogue + launch; wallet not connected)

BetSkilla brands (Xenzora, Kingsbet) are white-label, player-facing platforms.
The brand host fronts a catalogue API (`xenzora.betskilla.com`) used for
cataloguing and launching games.

**Status: catalogue and launch work; the player wallet does not.** Games launch
on a single shared account and the vendor does not accept a player identity, so
the in-game balance is not the platform player's. Read the next section before
promising anything about balance on this provider.

## Why the game balance is NOT the player's balance

This is the open problem, stated plainly.

`BETSKILLA_LOGIN` / `BETSKILLA_PASSWORD` are a **player account's** credentials,
not an operator's. Verified against the live host:

```
POST /api/client-login
→ 200 {"login":"test_sale","role":"player","balance":0,"currency":"INR",...}
```

Every game session is bound to whoever that cookie is logged in as. The vendor
**ignores the player identity in the launch body** — measured, not assumed:

| Launch body | Result |
| --- | --- |
| `{device, lang}` | session minted, `mode=REAL` |
| `{device, lang, login: "someone_else"}` | identical session, no effect |
| `{device, lang, userId, playerId}` | identical session, no effect |
| `{device, lang, demo: true}` | still a real session, no demo flag |

Because the session resolves to a single account, the balance shown inside a
game is that account's (`0 INR`, from the login response) — never the signed-in
player's. `GET /webhooks/health` now reports this explicitly.

There is **no operator API on the brand host**: `/api/operator/login`,
`/api/office/login`, `/api/admin/login` and `/api/v3/wallet` all return 404, and
the SPA bundle exposes no wallet, seamless or operator routes (`gameSessionRouter`
is launch-only). So these credentials cannot be made to open games on behalf of
arbitrary players.

## What is implemented

| Vendor side | Our side |
| --- | --- |
| `POST /api/client-login` | `BetSkillaAggregator.login()` — cookie session, refreshed once on expiry |
| `GET /api/v3/games?type=slot\|live` | `BetSkillaAggregator.listGames()` → `/api/admin/games/sync` |
| `POST /api/games/{router}` | `BetSkillaAggregator.launchSession()` via `POST /api/games/:slug/launch` |

Cataloguing and launching work. Launch is catalogue-compatible: it opens the
game, but on the shared account rather than on the player.

The seamless-wallet callback handler (`parseWalletCallback`, `verifyCallback`,
`walletResponse`/`walletError`, `POST /webhooks/aggregator/betskilla/wallet`) is
implemented and tested, but it is **not reachable with these credentials**: the
vendor never calls a wallet URL for a plain player session, so the handler would
sit idle. It is correct code waiting for the right integration, not a working
bridge.

## How to actually connect the wallet

The wallet has to come from a BetSkilla **operator/seamless** agreement, which
means different credentials and a different API surface than the purely
player-facing one above. Concretely:

1. Ask BetSkilla for operator API credentials (merchant/operator id + secret),
   distinct from the player login currently in `BETSKILLA_LOGIN`.
2. Confirm the operator integration supports single-wallet (`transfer`/
   `balance` callbacks) and obtain the wallet callback URL + signing key format.
3. Point `BETSKILLA_CALLBACK_SECRET` at that key, and have BetSkilla register
   `https://<our-host>/webhooks/aggregator/betskilla/wallet`.
4. Relaunch: with an operator account, `describeAccount()` should report
   `role != "player"` and the health detail should stop warning.

Until step 1 lands, no code change on our side can make the in-game balance
follow the platform player, because the vendor does not accept a player identity
at launch. The Gregmorn/Gamble Hub integration (`docs/providers/gregmorn.md`) is
the path that does support this per-player wallet.

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

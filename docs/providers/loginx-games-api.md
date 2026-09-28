# loginxgamesapi / GitSlotPark — verified contract

This is a *different* aggregator from the one documented in
`gregmorn-openapi.json`. It fronts four vendors behind one GitSlotPark Seamless
Wallet API v2 contract. The catalogue section below was verified live against the
Stage credentials supplied on 2026-09-28; the launch and wallet sections were
reverse-engineered from the four official Postman collections (`GitSlotPark
Seamless Wallet APIV2 with FreeSpin`, `GitSlotPark PGSoft Seamless API`, `Amatic
API`, `API LX Amusnet Seamless Wallet API`).

## What verifiably works

The catalogue can be pulled. `GET /GameList` with a bearer token returns the
whole vendor catalogue in one response:

```
GET https://pk2api.loginxgamesapi.com/GameList
Authorization: Bearer <apitoken>
User-Agent: <any browser-like string>
```

Result (`code: 0` means OK):

```json
{
  "updatetime": "2026-09-13T23:59:03",
  "code": 0,
  "message": "OK",
  "data": [
    { "vendorid": "Pragmatic Play", "gameid": 2373, "name": "Tales of Egypt",
      "symbol": "vs20egypt", "iconurl1": "...", "iconurl2": "...", "iconurl3": "...",
      "miniBet": 1.0, "minlevel": 1, "maxlevel": 1250, "replay": false,
      "releasedate": "2016-06-01" }
  ]
}
```

Four credentials, four vendors, all responding:

| Host | Vendor | Games |
|---|---|---|
| `pk2api.loginxgamesapi.com` | Pragmatic Play | 672 |
| `ggapi.loginxgamesapi.com` | PG Soft | 155 |
| `amapi.loginxgamesapi.com` | Amatic | 232 |
| `api.gitamus.net` | Amusnet | 343 |

Total 1,402.

## Two traps worth remembering

**Cloudflare blocks non-browser clients with error 1010.** Requests without a
browser-like `User-Agent` get `403 Error 1010: Access denied` from Cloudflare
before ever reaching the API. Bulk-parallel probing also trips a rate limit that
masquerades as 403 on *every* path — that is not a signal that endpoints exist.
Send a browser `User-Agent` and throttle.

**The API is not under `/api/v1`.** Paths are single PascalCase segments
(`/GameList`). `/api/v1/games`, `/swagger.json` and every `/api/...` variant
return 404.

## The Seamless Wallet API v2 contract

The Postman collections define a five-endpoint callback family plus a launch
call. The `callbackdomain` placeholder in the collections is the operator's own
host: the base path is configured as `WALLET_CALLBACK_BASE` (default
`/webhooks/callback`) and all five paths below it are registered verbatim.

### Launch — `POST /userAuth`

Bearer token auth (`Authorization: Bearer <apitoken>`). Request body:

```json
{ "agentID": "Partner01", "userID": "Player01", "isaffiliate": false,
  "lang": "fr", "gameid": 2001, "lobbyUrl": "https://mycasino.com/lobby" }
```

Response carries the landing URL: `{ "code": 0, "message": "OK", "url": "…" }`.
Codes other than 0 are failures (e.g. `101` = invalid api token).

### Callbacks

All five are signed and all five are idempotent; **only an HTTP 200 is a
successful acknowledgement** (so a business rejection is 200 with a non-zero
code, never a 4xx). Each callback echoes the resulting `balance`, and the
money-moving ones (`BetWin`, `Withdraw`, `Deposit`) also return
`platformTransactionID`.

| Operation | Sign parameter order | Effect |
|---|---|---|
| `GetBalance` | `agentID, userid, gameid` | read balance |
| `BetWin` | `agentID, userid, betAmount, winAmount, transactionID, roundID, gameID` | debit bet, credit win |
| `Withdraw` | `agentID, userid, amount, transactionID, roundID, gameID` | debit only (payout unknown yet) |
| `Deposit` | `agentID, userid, amount, refTransactionID, transactionID, roundID, gameID` | credit a win for a prior withdraw |
| `RollbackTransaction` | `agentID, userID, refTransactionID, gameID` | reverse a referenced transaction |

`Withdraw` + `Deposit` are the split-round pair: a bet whose payout is not yet
known is a `Withdraw`, and each payout piece arrives as its own `Deposit` sharing
the withdraw's `refTransactionID`. **PG Soft and Amatic send several `Deposit`s
for one `Withdraw`** — every piece has a distinct `transactionID`, so idempotency
keys on `transactionID`, never on `refTransactionID`.

`freeSpinID`, `isBonusBuy` and `endRound` are present on some callbacks and are
documented as **not participating in the sign**, so they are ignored when signing
and verifying.

### Creating the sign

HMAC-SHA-256 over the concatenation of the parameters in the order above, with
the vendor's secret key, uppercased hex. Amounts are always formatted to exactly
two decimal places.

Published test vector (Withdraw):

```
message = Partner01 + Player01 + 12.30 + 474e1a293c2f4e7ab122c52d68423fcb + ab9c15f2efdd46278e4a56b303127234
key     = 1234567890
sign    = 475D834ACC3AB61D7DF4EA42751C6275387BC1787A098D2D0E091698D9BF2043
```

### Result codes

`0` success, `1` general error, `2` wrong params, `3` invalid sign, `4` invalid
agent, `5` user not found, `6` insufficient funds, `7` invalid api token,
`8` reference not found, `9` already rolled back, `11` duplicate. The set is per
operation: `RollbackTransaction` answers only `0,1,2,3,4,5,9`, so an unmatched
rollback reference is reported as `9`, not `8`.

## Use in this repo

- Adapter: `apps/engine/src/providers/loginx.ts` — catalogue, launch, callback
  verification/parsing, and the response envelopes.
- Callback routes: `apps/engine/src/routes/webhooks.ts`, under
  `WALLET_CALLBACK_BASE`.
- Settlement: `apps/engine/src/services/aggregator-wallet.ts`.
- Catalogue import: `npm run sync:loginx` or the admin panel button.
- Credentials: `LOGINX_<VENDOR>_{AGENTID,APITOKEN,SECRETKEY,HOST}` — see
  `.env.example`.

# loginxgamesapi / gitamus — verified contract and the gaps

This is a *different* aggregator from the one documented in
`gregmorn-openapi.json`. It arrived as four per-vendor credential sets, each on
its own host. Everything below was verified live against the Stage credentials
supplied on 2026-09-28; nothing here is inferred from a spec.

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

## What is missing — and it is the whole point

**`/GameList` is the only endpoint that answers.** Every launch-shaped path tried
(`/GameUrl`, `/GetGameUrl`, `/Launch`, `/LaunchGame`, `/OpenGame`, `/GameURL`,
`/GameSession`, `/Play`, `/StartGame`, and more) returns 404 across all four
hosts. Query parameters on `/GameList` (`?type=live`, `?vendor=…`, `?limit=`,
`?page=`) are silently ignored — the same full list comes back every time.

So:

- **There is no way to open a game.** We can import the catalogue but cannot
  launch a session, because the launch call is not exposed.
- **There is no wallet/callback contract on our side to match.** The vendor says
  the API is wired to our callback URL, but we have no documented definition of
  what they POST, or of the signature. A third-party description of this call
  family specifies `md5(timestamp + salt_key)` carried with a `timestamp` and
  `key` — our `/webhooks/aggregator/gregmorn/wallet` route verifies HMAC-SHA256
  and would reject that. This must be confirmed, not guessed: balance is money.
- **There are no live tables in this catalogue.** All 1,402 titles are slots or
  instant games. Grepping for live-table names surfaces only slot titles that
  happen to contain a word (`Dragon Tiger`, `Dragon Tiger Luck`, `Speed Winner`,
  `Roulette Royal`). Pragmatic Play *Live* is not part of this vendor set.

Without the launch and wallet definitions this integration cannot move a single
euro, no matter how many games we list. Listing them anyway would put ~1,400
tiles in the lobby that fail on click — which is exactly the failure mode the
BetSkilla importer guards against with its playability probe.

## The one thing that unblocks it

The full API documentation for this aggregator: the game-launch call, and the
seamless-wallet callback contract with its signature definition. See
`docs/providers/loginx-games-api-request.md` for the message to send.

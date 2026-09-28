# loginxgamesapi / gitamus — what we need to finish the integration

Send this to whoever issued the four Stage credential sets (Pragmatic, PG Soft,
Amatic, Amusnet). Fill in the bracketed parts.

---

**To:** [integration contact]
**Subject:** Aurora — launch and seamless-wallet specification for the Stage API

Hello,

We have your Stage credentials in place and we are already reading the
catalogue. `GET /GameList` with a bearer token works on all four hosts and
returns the full list (Pragmatic Play 672, PG Soft 155, Amatic 232, Amusnet
343). Thank you for that.

To actually run games we are missing the launch and wallet parts of the API.
Please send the following.

1. **The full API documentation.** We searched for it and could not find a
   public reference. `GET /GameList` is currently the only path that answers;
   every launch-shaped path we tried returns 404, and query parameters on
   `GameList` (`type`, `vendor`, `limit`, `page`) are ignored. A Postman
   collection, PDF or endpoint list is fine — we only need the exact paths,
   methods and field names.

2. **The game-launch endpoint.** Specifically: the path, the request fields
   (player reference, `gameid` or `symbol`, currency, language, real vs demo,
   exit URL), and the response shape (launch URL, session/token id, expiry).
   How long is a launch URL valid, and is it single-use?

3. **The seamless-wallet callback contract.** Your side will call our endpoint,
   so we need the exact definition:
   - the action names and their request fields (balance / debit / credit /
     rollback),
   - the response body you expect from us, including how to signal
     insufficient funds,
   - **the signature scheme.** One description of this call family says the
     callback carries a `timestamp` and a `key` where
     `key = md5(timestamp + salt_key)`. Please confirm whether that is your
     scheme, what `salt_key` is, and which header carries it. Our current
     callback verifier expects HMAC-SHA256 and will reject anything else, so we
     will implement exactly what you specify. **Because this moves money, we
     will not guess it.** If the algorithm is different, send the reference
     snippet.

4. **Currency and base URL for the callback.** The callback URL we configured
   is:
   ```
   https://work-1-tyusmaoyqerdyrfr.prod-runtime.all-hands.dev/webhooks/aggregator/gregmorn/wallet
   ```
   Please confirm this is registered for each currency we will use, and tell us
   the currency/base URL list. (We will move this to our production domain
   before go-live.)

5. **Live tables.** Your four vendor sets are all slots and instant games. We
   could not find live-dealer tables in them. Do you offer Pragmatic Play Live
   or another live-dealer vendor on this API? If so, provide the credentials and
   host for that set. If not, we will keep live tables on a separate
   integration.

6. **IP allowlist.** Please add our egress IPs for the Stage environment
   (separate from Prod, and separate per host if that matters):
   [EGRESS IP(S)].

7. **One worked example** of a full real-money round, end to end: launch a
   session for a test player, then the exact callback bodies your side sends for
   a debit and the matching credit. That single example removes most of the
   remaining ambiguity.

Once we have items 1–3 we can implement launch and the wallet bridge and run a
real round on Stage the same day.

Thank you,

[Name]
[Role], Aurora
[Email] · [Phone]

---

## Notes (not part of the email)

- `callbackurl` currently points at our `gregmorn` route. That route exists and
  answers, but its verifier is HMAC-SHA256. If the vendor confirms the MD5
  scheme, that path — or a new dedicated path — needs the matching verifier
  before a single bet will settle. This is the blocker, not the catalogue.
- Do not import the catalogue before the launch call works. The games would
  appear in the lobby and fail on click.
- Four hosts, four credential sets, four vendors. Decide before implementing
  whether this is one adapter with per-vendor credentials or four provider
  rows. Our engine currently assumes a single active `GAME_AGGREGATOR`; four
  independent vendor connections are a genuine design change, not a config edit.

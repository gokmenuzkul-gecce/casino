# Gregmorn Hub — stage credential request

Ready to send to whoever supplied `docs/providers/gregmorn-openapi.json`
(Gamble Hub / Gregmorn Hub integration contact). Fill in the bracketed parts
before sending.

---

**To:** [Gregmorn Hub integration contact]
**Subject:** Stage operator credentials — Aurora [operator/brand name]

Hello,

We are integrating Gregmorn Hub against the Stage environment using the
OpenAPI spec you provided, and we are ready to run our side against it. We have
the endpoints wired up and the login, catalogue, `openGame` and seamless-wallet
callbacks implemented and signed exactly as the spec describes. What we are
missing is an operator account for Stage.

Could you please issue the following:

1. **Stage login and password** for the operator console — the pair used with
   `POST /auth/login` (`application/x-www-form-urlencoded`).
2. **`user_id`** — the API user identifier our requests should carry, which the
   spec says resolves the player-specific `secret_api_key`.
3. **`secret_api_key`** — the value used for `X-Signature` (hex HMAC-SHA256 over
   the exact raw JSON body). The spec states this is per player and resolved by
   `user_id`, so it is not something we can derive from the spec.
4. **Confirmation of the Stage host names.** The spec lists
   `office-api-dev.gregmorn.org` and `client-api-dev.gregmorn.org`. We also have
   `office-api-dev.gamble-hub.net` / `client-api-dev.gamble-hub.net` on our side,
   but those resolve to a Cloudflare JavaScript challenge and answer our
   server-to-server calls with HTTP 403 before reaching your API. Please confirm
   which host we should use and whether the `.gamble-hub.net` aliases are
   intended for API traffic.
5. **Callback URL registration.** Please register our seamless-wallet callback
   for the Stage currency(s) we will use — note the spec says callback URLs are
   configured per currency — and confirm the callback secret, if it differs from
   the one above.
6. **IP allowlist.** Please add the egress IPs below to the Stage allowlist
   (separate lists for Stage and Prod, per the spec). If outbound source IPs are
   needed before your side can allowlist, tell us and we will provide them:
   [EGRESS IP(S)].

For reference, our Stage callback endpoint is:

```
[API_PUBLIC_URL]/webhooks/aggregator/gregmorn/wallet
```

Please also confirm the currencies enabled for our operator on Stage. We intend
to start with [TRY / INR / ...].

Two points where we want to avoid a mismatch:

- The `openGame` request is `additionalProperties: false` in the spec. We send
  only the documented fields. If your Stage build accepts a field that the spec
  does not list, tell us and we will align rather than discover it at launch.
- We will validate a real session end to end before moving to production. If you
  can share a Stage test player and a demo game id, that shortens the loop.

Once we have items 1–4 we can confirm login and catalogue within the hour, and
we will report back with the result of a full real-money session on Stage.

Thank you,

[Name]
[Role], Aurora
[Email] · [Phone]

---

## Notes (not part of the email)

- Send the credentials over a channel that is not plain email if the provider
  offers one; these values authorise money movement.
- Enter whatever arrives at **Admin → Entegrasyon → Kimlik Gir** with the
  provider profile set to `gregmorn`. Do not paste them into the repo: `.env` is
  git-ignored, but the panel is encrypted and applies without a restart.
- After saving, run `npm run smoke:gregmorn` in `apps/engine`. Steps 1 and 2
  passing means the account works. Step 3 passing means a real session opens.
  Step 4 passing means the wallet bridge is armed. Values still failing on
  `*.gregmorn.org` with HTTP 401 point at the account, not the code — our half is
  covered by `apps/engine/src/providers/gregmorn.test.ts`.

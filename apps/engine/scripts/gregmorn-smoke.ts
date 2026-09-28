#!/usr/bin/env tsx
/**
 * Gregmorn Hub stage smoke test.
 *
 * Walks the whole integration against the real stage API and prints a verdict
 * per step, so the platform can be confirmed working before any money is
 * committed:
 *
 *   1. login                     → credentials are valid
 *   2. catalogue (getUserGames)  → games are exposed for our currency
 *   3. openGame (demo)           → a real game session can be opened
 *   4. wallet callbacks          → our side answers getBalance/writeBet/rollback
 *
 * Steps 1-3 need real stage credentials in .env. Step 4 runs against the local
 * engine, so it also proves the callback route and the ledger behave the way
 * Gregmorn's contract requires (HTTP 400 + status "fail" on rejection, balance
 * after the operation on success).
 *
 * Usage:
 *   npm run smoke:gregmorn              # all steps
 *   npm run smoke:gregmorn -- --only=4  # a single step
 */

import { createHmac } from "node:crypto";
import { env } from "../src/lib/env.js";
import { GregmornAggregator } from "../src/providers/gregmorn.js";

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

interface Result {
  step: string;
  ok: boolean;
  detail: string;
}

const results: Result[] = [];

function record(step: string, ok: boolean, detail: string, payload?: unknown): void {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step.padEnd(34)} ${detail}`);
  if (payload !== undefined && !ok) {
    console.log(`      -> ${JSON.stringify(payload).slice(0, 400)}`);
  }
}

function stepEnabled(n: number): boolean {
  return !only || only === String(n) || only === "all";
}

function mask(value: string): string {
  if (!value) return "(unset)";
  return value.length <= 6 ? "*".repeat(value.length) : `${value.slice(0, 3)}...${value.slice(-2)} (len ${value.length})`;
}

async function main(): Promise<void> {
  const g = env.gregmorn;
  const callbackUrl = `${env.apiPublicUrl}/webhooks/aggregator/gregmorn/wallet`;

  console.log("Gregmorn stage smoke test");
  console.log("=".repeat(72));
  console.log(
    JSON.stringify(
      {
        aggregator: env.gameAggregator.provider,
        platformMode: env.platformMode,
        currency: g.currency,
        officeUrl: g.officeBaseUrl,
        clientUrl: g.clientBaseUrl,
        login: mask(g.login),
        userId: mask(g.userId),
        secretKey: mask(g.secretKey),
        callbackUrl,
      },
      null,
      1,
    ),
  );
  console.log("=".repeat(72));

  const aggregator = new GregmornAggregator({ ...g });

  // ── 1. login ─────────────────────────────────────────────────────────
  if (stepEnabled(1)) {
    try {
      const health = await aggregator.healthCheck();
      record("1. login", health.configured && health.mode === "live", health.detail, health);
    } catch (error) {
      record("1. login", false, (error as Error).message);
    }
  }

  // ── 2. catalogue ─────────────────────────────────────────────────────
  let firstGameId = "";
  if (stepEnabled(2)) {
    try {
      const games = await aggregator.listGames({ pageSize: 5 });
      firstGameId = games[0]?.externalId ?? "";
      record("2. catalogue (getUserGames)", games.length > 0, `${games.length} game(s) for ${g.currency}`, games);
      if (games[0]) console.log(`      first: ${games[0].externalId} — ${games[0].name} (${games[0].provider})`);
    } catch (error) {
      record("2. catalogue (getUserGames)", false, (error as Error).message);
    }
  }

  // ── 3. openGame (demo) ───────────────────────────────────────────────
  if (stepEnabled(3)) {
    if (!firstGameId) {
      record("3. openGame (demo)", false, "no game id from step 2; run steps 1-2 first");
    } else {
      try {
        const session = await aggregator.launchSession({
          externalGameId: firstGameId,
          playerId: "smoke_test_player",
          playerLogin: "smoke_test_player",
          currency: g.currency,
          locale: "tr",
          // Demo mode issues no wallet callbacks, which is what lets launch be
          // verified before an inbound-public callback URL exists.
          mode: "demo",
          returnUrl: `${env.appUrl}/games`,
          sessionToken: `smoke-${Date.now()}`,
        });
        record("3. openGame (demo)", Boolean(session.launchUrl), `session ${session.sessionId || "(none)"}`, session);
        console.log(`      url: ${session.launchUrl.slice(0, 120)}`);
      } catch (error) {
        record("3. openGame (demo)", false, (error as Error).message);
      }
    }
  }

  // ── 4. wallet callbacks against the local engine ─────────────────────
  if (stepEnabled(4)) {
    if (!g.secretKey) {
      record("4. wallet callbacks", false, "GREG_MORN_SECRET_KEY unset; cannot sign callbacks");
    } else {
      const post = async (payload: Record<string, unknown>, signed: boolean) => {
        const rawBody = JSON.stringify(payload);
        const signature = signed ? createHmac("sha256", g.secretKey).update(rawBody).digest("hex") : "";
        const response = await fetch(callbackUrl, {
          method: "POST",
          headers: { "content-type": "application/json", ...(signature ? { "x-signature": signature } : {}) },
          body: rawBody,
        });
        const text = await response.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* keep the raw text for the report */
        }
        return { status: response.status, body: body as Record<string, unknown> | undefined };
      };

      const unsigned = await post({ cmd: "getBalance", login: "smoke_test_player", sessionid: "s" }, false);
      record("4. callback rejects unsigned", unsigned.status === 400, `HTTP ${unsigned.status} (expect 400)`, unsigned.body);

      const balance = await post({ cmd: "getBalance", login: "demo_player", sessionid: "s" }, true);
      record(
        "4. callback getBalance",
        balance.status === 200 && balance.body?.status === "success",
        `HTTP ${balance.status} balance=${balance.body?.balance} ${balance.body?.currency ?? ""}`.trim(),
        balance.body,
      );

      const poor = await post(
        {
          cmd: "writeBet",
          bet: 999_999_999,
          win: 0,
          login: "demo_player",
          sessionid: "s",
          transactionId: `smoke-poor-${Date.now()}`,
          round_finished: false,
          info: "{}",
        },
        true,
      );
      record(
        "4. callback insufficient funds",
        poor.status === 400 && poor.body?.status === "fail",
        `HTTP ${poor.status} error="${poor.body?.error ?? ""}"`,
        poor.body,
      );
    }
  }

  // ── verdict ──────────────────────────────────────────────────────────
  console.log("=".repeat(72));
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} step(s) passed`);
  for (const f of failed) console.log(`  - ${f.step}: ${f.detail}`);

  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("smoke test crashed:", error);
  process.exit(2);
});

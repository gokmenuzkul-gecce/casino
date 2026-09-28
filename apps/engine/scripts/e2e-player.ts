#!/usr/bin/env tsx
/**
 * End-to-end walk of the player money flow against a running engine.
 *
 * This is the "does the platform actually work" check that needs no vendor
 * credentials: it drives the real HTTP API — register, deposit, bet through the
 * internal Aurora Originals engine, read the ledger — and asserts the balance
 * moves exactly as the wagering result says it should.
 *
 * It runs against whatever engine is listening on ENGINE_URL (default
 * http://localhost:4000) and creates a throwaway account per run, so it is safe
 * to repeat.
 *
 * Usage:
 *   npm run e2e:player                        # demo engine on :4000
 *   ENGINE_URL=https://stage.example npm run e2e:player
 */

import { randomUUID } from "node:crypto";

const BASE = process.env.ENGINE_URL ?? "http://localhost:4000";
const STAMP = Date.now().toString(36);

interface Result {
  step: string;
  ok: boolean;
  detail: string;
}

const results: Result[] = [];

function record(step: string, ok: boolean, detail: string): boolean {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step.padEnd(38)} ${detail}`);
  return ok;
}

/** Minor units came back as a decimal string; compare in minor units. */
function minor(amount: string): bigint {
  const [whole = "0", frac = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
}

async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text for the report */
  }
  return { status: response.status, body: parsed as T };
}

/**
 * A real-money bet needs funds, and deposits are what fund them. Demo mode
 * reports the deposit COMPLETED immediately, so the balance is visible on the
 * next read rather than after a webhook.
 */
async function fundWallet(token: string, amount: string, method: string): Promise<boolean> {
  const { status, body } = await api("POST", "/api/wallet/deposit", { amount, method, currency: "TRY" }, token);
  if (status !== 200 && status !== 201) return false;
  return String(body?.status ?? body?.intent?.status ?? "").toUpperCase() === "COMPLETED";
}

async function main(): Promise<void> {
  console.log(`Player flow E2E against ${BASE}`);
  console.log("=".repeat(72));

  // A password that satisfies the policy: lower, upper, digit, 8+.
  const email = `e2e_${STAMP}@example.com`;
  const username = `e2e${STAMP}`.slice(0, 20);
  const password = process.env.E2E_PASSWORD ?? "E2e!Passw0rd";

  // ── 1. register ──────────────────────────────────────────────────────
  const register = await api("POST", "/api/auth/register", {
    email,
    username,
    password,
    currency: "TRY",
    acceptTerms: true,
    ageConfirmed: true,
  });
  if (!record("1. register", register.status < 300 && register.status !== 0, `HTTP ${register.status} ${email}`)) {
    console.log(`      -> ${JSON.stringify(register.body).slice(0, 300)}`);
    finish();
    return;
  }

  // ── 2. login ─────────────────────────────────────────────────────────
  const login = await api("POST", "/api/auth/login", { identifier: username, password });
  const token: string | undefined = login.body?.accessToken ?? login.body?.token ?? login.body?.tokens?.accessToken;
  if (!record("2. login", Boolean(token), `HTTP ${login.status} token=${token ? "yes" : "no"}`)) {
    console.log(`      -> ${JSON.stringify(login.body).slice(0, 300)}`);
    finish();
    return;
  }

  // ── 3. wallets start empty and are created for the player ────────────
  const wallet0 = await api("GET", "/api/wallet", undefined, token!);
  const start: string = wallet0.body?.real ?? "0";
  record("3. wallet exists", wallet0.status === 200, `HTTP ${wallet0.status} real=${start}`);

  // ── 4. deposit funds the wallet ──────────────────────────────────────
  const funded = await fundWallet(token!, "1000", "CARD");
  const wallet1 = await api("GET", "/api/wallet", undefined, token!);
  const afterDeposit: string = wallet1.body?.real ?? "0";
  record("4. deposit credits wallet", funded && minor(afterDeposit) > minor(start), `TRY ${start} -> ${afterDeposit}`);

  // ── 5. an internal game is launchable in real mode ───────────────────
  const launch = await api("POST", "/api/games/dice/launch", { mode: "real" }, token!);
  record(
    "5. internal game launch",
    launch.status === 200 && launch.body?.internal === true,
    `HTTP ${launch.status} internal=${launch.body?.internal} url=${launch.body?.url ?? "-"}`,
  );

  // ── 6. a real bet settles against the ledger ─────────────────────────
  const stake = "10";
  const bet = await api(
    "POST",
    "/api/games/bet",
    { gameSlug: "dice", amount: stake, params: { target: 50, direction: "OVER" }, idempotencyKey: randomUUID() },
    token!,
  );
  const betOk = bet.status === 200 && bet.body?.betId;
  record(
    "6. bet settles",
    Boolean(betOk),
    betOk
      ? `betId=${bet.body.betId} multiplier=${bet.body.multiplier} payout=${bet.body.payout ?? "-"}`
      : `HTTP ${bet.status}`,
  );
  if (!betOk) console.log(`      -> ${JSON.stringify(bet.body).slice(0, 300)}`);

  // ── 7. balance moves by exactly the outcome ──────────────────────────
  const wallet2 = await api("GET", "/api/wallet", undefined, token!);
  const afterBet: string = wallet2.body?.real ?? "0";

  // stake is debited; a win is credited. So the delta must be payout - stake.
  const payout = bet.body?.payout ?? "0";
  const expected = minor(afterDeposit) - minor(stake) + minor(String(payout));
  record(
    "7. ledger matches the result",
    minor(afterBet) === expected,
    `TRY ${afterDeposit} -> ${afterBet} (expected ${Number(expected) / 100})`,
  );

  // ── 8. the bet is retrievable and provably fair ──────────────────────
  if (betOk) {
    const verify = await api("GET", `/api/games/bets/${bet.body.betId}/verify`, undefined, token!);
    record(
      "8. bet verifiable (provably fair)",
      verify.status === 200 && Boolean(verify.body?.serverSeedHash ?? verify.body?.verified !== undefined),
      `HTTP ${verify.status}`,
    );
  }

  // ── 9. an external provider game refuses cleanly when unconfigured ───
  // The lobby lists provider games even when no aggregator is wired up, so the
  // failure mode that matters is a clear error, not a 200 with a broken URL.
  const external = await api("GET", "/api/games?type=external&pageSize=1");
  const externalSlug: string | undefined = external.body?.games?.[0]?.slug;
  if (externalSlug) {
    const launchExt = await api("POST", `/api/games/${externalSlug}/launch`, { mode: "real" }, token!);
    const clean =
      launchExt.status === 200
        ? typeof launchExt.body?.launchUrl === "string" && launchExt.body.launchUrl.length > 0
        : launchExt.status >= 400;
    record(
      "9. external launch fails cleanly",
      clean,
      `HTTP ${launchExt.status} ${clean ? "(configured or clear error)" : JSON.stringify(launchExt.body).slice(0, 120)}`,
    );
  } else {
    record("9. external launch fails cleanly", true, "no external games in the lobby; skipped");
  }

  // ── 10. insufficient funds is rejected, not overdrawn ────────────────
  const huge = await api(
    "POST",
    "/api/games/bet",
    { gameSlug: "dice", amount: "99999999", params: { target: 50, direction: "OVER" } },
    token!,
  );
  const wallet3 = await api("GET", "/api/wallet", undefined, token!);
  const afterHuge: string = wallet3.body?.real ?? "0";
  record(
    "10. overdraft rejected",
    huge.status >= 400 && minor(afterHuge) === minor(afterBet),
    `HTTP ${huge.status} real unchanged=${minor(afterHuge) === minor(afterBet)}`,
  );

  finish();
}

function finish(): void {
  console.log("=".repeat(72));
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} step(s) passed`);
  for (const f of failed) console.log(`  - ${f.step}: ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("e2e crashed:", error);
  process.exit(2);
});

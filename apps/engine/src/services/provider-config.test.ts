import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret } from "../lib/secrets.js";
import { databaseAvailable, SKIP_REASON } from "../test-support/infrastructure.js";
import {
  PROVIDER_ENV_KEYS,
  isSecretKey,
  publicValues,
  saveProviderConfig,
} from "../services/provider-config.js";

const hasDatabase = await databaseAvailable();

describe("provider credential encryption", () => {
  it("round-trips a secret", () => {
    const plain = "Dfui4&gop0";
    const sealed = encryptSecret(plain);
    expect(sealed).not.toContain(plain);
    expect(decryptSecret(sealed)).toBe(plain);
  });

  it("produces a different ciphertext each time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a tampered payload", () => {
    const sealed = encryptSecret("hello");
    const tampered = `${sealed.slice(0, -2)}xy`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("masks all but the last four characters", () => {
    expect(maskSecret("abcdef1234")).toBe("••••1234");
    expect(maskSecret("abc")).toBe("••••");
  });
});

describe("provider config exposure", () => {
  it("classifies credential keys as secrets", () => {
    for (const key of ["GREG_MORN_PASSWORD", "GREG_MORN_SECRET_KEY", "BETSKILLA_CALLBACK_SECRET", "PSP_API_KEY"]) {
      expect(isSecretKey(key)).toBe(true);
    }
    for (const key of ["GREG_MORN_LOGIN", "GREG_MORN_OFFICE_URL", "GREG_MORN_USER_ID"]) {
      expect(isSecretKey(key)).toBe(false);
    }
  });

  it("never returns a secret value to the client", () => {
    const masked = publicValues({ GREG_MORN_LOGIN: "operator", GREG_MORN_SECRET_KEY: "super-secret" });
    expect(masked.GREG_MORN_LOGIN).toBe("operator");
    expect(masked.GREG_MORN_SECRET_KEY).toBe("••••••••");
  });

  it("lists the aggregator keys the panel needs to render", () => {
    const keys = PROVIDER_ENV_KEYS.gameAggregator!;
    expect(keys).toContain("GAME_AGGREGATOR");
    expect(keys).toContain("GREG_MORN_SECRET_KEY");
    expect(keys).toContain("BETSKILLA_CALLBACK_SECRET");
  });

  it("exposes the Cryptomus merchant and payout keys to the panel", () => {
    const keys = PROVIDER_ENV_KEYS.crypto!;
    expect(keys).toContain("CRYPTO_MERCHANT_ID");
    expect(keys).toContain("CRYPTO_PAYOUT_API_KEY");
    expect(isSecretKey("CRYPTO_PAYOUT_API_KEY")).toBe(true);
    expect(isSecretKey("CRYPTO_MERCHANT_ID")).toBe(false);
  });
});

/**
 * Regression guard for the credential-save path.
 *
 * `applyProviderConfigs` used to write GAME_AGGREGATOR for every enabled row, so
 * saving a PSP or KYC provider replaced the game aggregator with an unrelated
 * provider name and silently disabled external games. Only a gameAggregator row
 * may own that variable.
 */
describe.skipIf(!hasDatabase)("provider config env application", () => {
  it("does not let a non-aggregator save overwrite GAME_AGGREGATOR", async () => {
    const previous = process.env.GAME_AGGREGATOR;
    try {
      process.env.GAME_AGGREGATOR = "gregmorn";
      await saveProviderConfig({
        kind: "psp",
        provider: "payfix",
        values: { PSP_PROVIDER: "payfix", PSP_BASE_URL: "https://psp.example.com", PSP_API_KEY: "k" },
        actorId: "test",
      });
      expect(process.env.GAME_AGGREGATOR).toBe("gregmorn");
    } finally {
      if (previous === undefined) delete process.env.GAME_AGGREGATOR;
      else process.env.GAME_AGGREGATOR = previous;
    }
  });
});

if (!hasDatabase) {
  // Surfaces the skip reason in the run output instead of hiding it.
  describe("infrastructure", () => {
    it.skip(SKIP_REASON, () => {});
  });
}

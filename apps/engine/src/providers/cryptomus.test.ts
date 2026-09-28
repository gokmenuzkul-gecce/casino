/**
 * Cryptomus signature and status mapping.
 *
 * The signature is the whole integration: if it is wrong every request is
 * rejected and every webhook is refused. It is verified against the algorithm
 * published at https://doc.cryptomus.com/merchant-api/request-format —
 * `md5(base64(json) + API_KEY)` — including the PHP-compatible slash escaping
 * that plain `JSON.stringify` does not reproduce.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { CryptomusCrypto, cryptomusSign, mapCryptomusStatus, phpJson } from "./cryptomus.js";

const API_KEY = "test_payment_api_key";

/** Reference implementation, written straight from the spec. */
function expectedSign(json: string, apiKey: string): string {
  return createHash("md5").update(Buffer.from(json, "utf8").toString("base64") + apiKey).digest("hex");
}

describe("cryptomus sign", () => {
  it("matches md5(base64(body) + apiKey)", () => {
    const body = phpJson({ amount: "10", currency: "USDT", order_id: "DEP-1" });
    expect(cryptomusSign(body, API_KEY)).toBe(expectedSign(body, API_KEY));
  });

  it("escapes forward slashes the way PHP json_encode does", () => {
    const body = phpJson({ url_callback: "https://api.example.com/webhooks/crypto" });
    expect(body).toContain("https:\\/\\/api.example.com\\/webhooks\\/crypto");
    // Naive JSON.stringify would produce an unescaped body and a mismatched sign.
    expect(JSON.stringify({ url_callback: "https://api.example.com/webhooks/crypto" })).not.toContain("\\/");
  });

  it("produces a different signature once a slash is involved", () => {
    const raw = JSON.stringify({ url_callback: "https://a/b" });
    const php = phpJson({ url_callback: "https://a/b" });
    expect(cryptomusSign(raw, API_KEY)).not.toBe(cryptomusSign(php, API_KEY));
  });
});

describe("cryptomus webhook verification", () => {
  const adapter = new CryptomusCrypto({
    baseUrl: "https://api.cryptomus.com",
    apiKey: API_KEY,
    merchantId: "8b03432e-385b-4670-8d06-064591096795",
    payoutApiKey: "",
  });

  function signedBody(payload: Record<string, unknown>): string {
    const { sign: _omit, ...rest } = payload;
    return JSON.stringify({ ...rest, sign: cryptomusSign(phpJson(rest), API_KEY) }).replace(/\//g, "\\/");
  }

  it("accepts a correctly signed payload", () => {
    const body = signedBody({
      type: "payment",
      uuid: "62f88b36-a9d5-4fa6-aa26-e040c3dbf26d",
      order_id: "DEP-42",
      status: "paid",
      is_final: true,
    });
    expect(adapter.verifyWebhook(body, {})).toBe(true);
  });

  it("rejects a payload whose sign was computed without the api key", () => {
    const body = JSON.stringify({
      type: "payment",
      order_id: "DEP-42",
      status: "paid",
      sign: "deadbeef",
    });
    expect(adapter.verifyWebhook(body, {})).toBe(false);
  });

  it("rejects a tampered body that kept a valid-looking sign", () => {
    const good = JSON.parse(signedBody({ order_id: "DEP-42", status: "paid" })) as Record<string, unknown>;
    const tampered = JSON.stringify({ ...good, status: "paid", order_id: "DEP-43" });
    expect(adapter.verifyWebhook(tampered, {})).toBe(false);
  });

  it("rejects a body with no sign at all", () => {
    expect(adapter.verifyWebhook(JSON.stringify({ order_id: "DEP-42" }), {})).toBe(false);
  });

  it("rejects malformed json rather than throwing", () => {
    expect(adapter.verifyWebhook("not json", {})).toBe(false);
  });
});

describe("cryptomus webhook parsing", () => {
  const adapter = new CryptomusCrypto({
    baseUrl: "https://api.cryptomus.com",
    apiKey: API_KEY,
    merchantId: "merchant",
    payoutApiKey: "",
  });

  it("reads the reference from order_id, not uuid", () => {
    const parsed = adapter.parseWebhook({
      uuid: "62f88b36-a9d5-4fa6-aa26-e040c3dbf26d",
      order_id: "DEP-99",
      status: "paid",
      payment_amount: "3.00000000",
      payer_currency: "TRX",
    });
    expect(parsed).toMatchObject({
      reference: "DEP-99",
      status: "COMPLETED",
      amount: "3.00000000",
      currency: "TRX",
    });
  });

  it("does not credit a merely-confirmed invoice", () => {
    expect(adapter.parseWebhook({ order_id: "DEP-1", status: "confirm_check" }).status).toBe("PENDING");
  });

  it("reports a wrong amount as failed with a reason", () => {
    const parsed = adapter.parseWebhook({ order_id: "DEP-1", status: "wrong_amount" });
    expect(parsed.status).toBe("FAILED");
    expect(parsed.failureReason).toContain("wrong_amount");
  });
});

describe("cryptomus status mapping", () => {
  it("maps paid and paid_over to COMPLETED", () => {
    expect(mapCryptomusStatus("paid")).toBe("COMPLETED");
    expect(mapCryptomusStatus("paid_over")).toBe("COMPLETED");
  });

  it("maps cancel to CANCELLED and the rest of the failures to FAILED", () => {
    expect(mapCryptomusStatus("cancel")).toBe("CANCELLED");
    for (const status of ["fail", "wrong_amount", "system_fail", "refund_process", "refund_fail", "refund_paid"]) {
      expect(mapCryptomusStatus(status)).toBe("FAILED");
    }
  });

  it("treats confirm_check and unknown statuses as PENDING, never as paid", () => {
    expect(mapCryptomusStatus("confirm_check")).toBe("PENDING");
    expect(mapCryptomusStatus("")).toBe("PENDING");
    expect(mapCryptomusStatus("something-new")).toBe("PENDING");
  });
});

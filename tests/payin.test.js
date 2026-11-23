import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createPayinCollection,
  detectTanzaniaOperator,
  normalizeTanzaniaPhone,
  verifyPayinWebhook,
  PAYIN_SANDBOX_BASE_URL
} from "../src/payments/payin.js";

test("normalizes Tanzania phone numbers to international format", () => {
  assert.equal(normalizeTanzaniaPhone("0712 345 678"), "255712345678");
  assert.equal(normalizeTanzaniaPhone("+255 712-345-678"), "255712345678");
  assert.equal(normalizeTanzaniaPhone("255712345678"), "255712345678");
  assert.throws(() => normalizeTanzaniaPhone("12345"), /valid Tanzania mobile number/);
});

test("maps the currently documented Tanzania operator prefixes", () => {
  assert.equal(detectTanzaniaOperator("0741234567"), "mpesa");
  assert.equal(detectTanzaniaOperator("0681234567"), "airtel");
  assert.equal(detectTanzaniaOperator("0711234567"), "tigopesa");
  assert.equal(detectTanzaniaOperator("0621234567"), "halopesa");
  assert.equal(detectTanzaniaOperator("0671234567"), "tigopesa");
});

test("creates a sandbox collection with server-side credentials and idempotency", async () => {
  let capturedUrl = "";
  let capturedOptions;
  const result = await createPayinCollection({
    PAYIN_API_KEY: "sandbox-public-key",
    PAYIN_API_SECRET: "sandbox-secret",
    PAYIN_API_BASE_URL: PAYIN_SANDBOX_BASE_URL,
    PAYIN_CALLBACK_URL: "https://wifi.example.test/api/payments/payin/webhook"
  }, {
    phone: "0712345678",
    amount: 500,
    operator: "tigopesa",
    reference: "EWIFI_ORDER_12345"
  }, async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(JSON.stringify({
      success: true,
      request_ref: "PAYTEST123456",
      status: "processing",
      operator: "Mixx by Yas"
    }), { status: 201, headers: { "content-type": "application/json" } });
  });

  assert.equal(capturedUrl, PAYIN_SANDBOX_BASE_URL + "/collection");
  assert.equal(capturedOptions.headers["x-api-key"], "sandbox-public-key");
  assert.equal(capturedOptions.headers["x-api-secret"], "sandbox-secret");
  assert.equal(capturedOptions.headers["x-idempotency-key"], "EWIFI_ORDER_12345");
  const payload = JSON.parse(capturedOptions.body);
  assert.equal(payload.phone, "255712345678");
  assert.equal(payload.amount, 500);
  assert.equal(payload.currency, "TZS");
  assert.equal(payload.operator, "tigopesa");
  assert.equal(payload.callback_url, "https://wifi.example.test/api/payments/payin/webhook");
  assert.deepEqual(result, {
    request_ref: "PAYTEST123456",
    status: "processing",
    phone: "255712345678",
    amount: 500,
    currency: "TZS",
    operator: "Mixx by Yas"
  });
});

test("does not call the provider when credentials or payment details are invalid", async () => {
  let called = false;
  const fetchMock = async () => { called = true; };
  await assert.rejects(
    createPayinCollection({}, { phone: "0712345678", amount: 500, reference: "EWIFI_ORDER_12345" }, fetchMock),
    /not configured/
  );
  await assert.rejects(
    createPayinCollection({ PAYIN_API_KEY: "k", PAYIN_API_SECRET: "s" }, {
      phone: "0712345678", amount: 99, reference: "EWIFI_ORDER_12345"
    }, fetchMock),
    /from 100 to 10,000,000/
  );
  await assert.rejects(
    createPayinCollection({ PAYIN_API_KEY: "k", PAYIN_API_SECRET: "s", PAYIN_API_BASE_URL: "https://attacker.invalid" }, {
      phone: "0712345678", amount: 500, reference: "EWIFI_ORDER_12345"
    }, fetchMock),
    /official PayIn/
  );
  assert.equal(called, false);
});

test("verifies PayIn webhook HMAC signature and rejects tampering or stale callbacks", async () => {
  const secret = "sandbox-webhook-secret";
  const rawBody = JSON.stringify({ event: "payin.completed", request_ref: "PAYTEST123456", gross_amount: 500 });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");

  assert.equal(await verifyPayinWebhook(rawBody, timestamp, signature, secret), true);
  assert.equal(await verifyPayinWebhook(rawBody + " ", timestamp, signature, secret), false);
  assert.equal(await verifyPayinWebhook(rawBody, timestamp, signature, "wrong-secret"), false);
  assert.equal(await verifyPayinWebhook(rawBody, "1000000000", signature, secret), false);
});

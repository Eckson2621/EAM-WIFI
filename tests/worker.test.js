import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("health endpoint responds without database credentials", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.app, "EAM-WIFI");
  assert.equal(body.ok, true);
});

test("protected endpoints reject requests without a bearer token", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/organizations"), {});
  assert.equal(response.status, 401);
});

test("business registration endpoint rejects unauthenticated requests", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/register-business", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ business_name: "Test Wi-Fi" })
  }), {});
  assert.equal(response.status, 401);
});

test("voucher generation endpoint rejects unauthenticated requests", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/vouchers/generate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: "00000000-0000-0000-0000-000000000001", package_id: "00000000-0000-0000-0000-000000000002", quantity: 10 })
  }), {});
  assert.equal(response.status, 401);
});

test("paid voucher issuance endpoint rejects unauthenticated requests", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/vouchers/issue-paid", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: "00000000-0000-0000-0000-000000000001", package_id: "00000000-0000-0000-0000-000000000002", amount_paid: 1000, payment_method: "cash" })
  }), {});
  assert.equal(response.status, 401);
});

test("public customer portal validates site slug before database access", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/public/portal?site=BAD!"), {});
  assert.equal(response.status, 400);
});

test("public voucher redemption rejects malformed requests before database access", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/public/redeem", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ site: "bad!", code: "bad", mac_address: "not-a-mac" })
  }), {});
  assert.equal(response.status, 400);
});

test("platform subscription admin endpoints require authentication", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/platform/admin/accounts"), {});
  assert.equal(response.status, 401);
});

import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("health endpoint reports missing Supabase configuration as unhealthy", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health"), {});
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.app, "EAM-WIFI");
  assert.equal(body.ok, false);
  assert.equal(body.supabase_configured, false);
});

test("health endpoint reports required Supabase configuration as present", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health"), {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test"
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.supabase_configured, true);
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

test("router heartbeat rejects missing device credentials", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/router/heartbeat", {
    method: "POST"
  }), {});
  assert.equal(response.status, 401);
});

test("router pairing endpoint requires an authenticated business owner", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/router/pair", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: "00000000-0000-0000-0000-000000000001" })
  }), {});
  assert.equal(response.status, 401);
});

test("router event queue rejects missing device credentials", async () => { const response = await worker.fetch(new Request("https://example.test/api/router/events", { method: "POST" }), {}); assert.equal(response.status, 401); });

test("router event acknowledgement rejects malformed unauthenticated requests", async () => { const response = await worker.fetch(new Request("https://example.test/api/router/events/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event_id: "bad", success: true }) }), {}); assert.equal(response.status, 401); });

test("business payment settings endpoint requires authentication", async () => { const response = await worker.fetch(new Request("https://example.test/api/business/settings?organization_id=00000000-0000-0000-0000-000000000001"), {}); assert.equal(response.status, 401); });

test("Super Admin health endpoint requires authentication", async () => { const response = await worker.fetch(new Request("https://example.test/api/platform/admin/health"), {}); assert.equal(response.status, 401); });

test("router status endpoint requires authentication", async () => { const response = await worker.fetch(new Request("https://example.test/api/routers?organization_id=00000000-0000-0000-0000-000000000001"), {}); assert.equal(response.status, 401); });

test("authenticated router lookup forwards the user's JWT and scopes the query to the requested organization", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedHeaders;
  globalThis.fetch = async (url, options = {}) => {
    capturedUrl = String(url);
    capturedHeaders = new Headers(options.headers || {});
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const organizationId = "00000000-0000-0000-0000-000000000001";
    const userJwt = "user-session-jwt-test";
    const response = await worker.fetch(new Request(
      `https://example.test/api/routers?organization_id=${organizationId}`,
      { headers: { authorization: `Bearer ${userJwt}` } }
    ), {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SERVICE_ROLE_KEY: "must-not-be-used"
    });
    assert.equal(response.status, 200);
    assert.equal(capturedHeaders.get("authorization"), `Bearer ${userJwt}`);
    assert.equal(capturedHeaders.get("apikey"), "sb_publishable_test");
    assert.equal(capturedHeaders.get("apikey"), "sb_publishable_test");
    const upstreamUrl = new URL(capturedUrl);
    assert.equal(upstreamUrl.pathname, "/rest/v1/network_devices");
    assert.equal(upstreamUrl.searchParams.get("organization_id"), `eq.${organizationId}`);
    assert.equal(upstreamUrl.searchParams.get("select"), "id,organization_id,site_id,name,vendor,model,connection_status,last_seen_at,created_at,site:hotspot_sites(id,name,slug),router_subscriptions(status,expires_at,monthly_price_tzs)");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("paid voucher issuance requires an explicit router ID", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/vouchers/issue-paid", {
    method: "POST", headers: { authorization: "Bearer test-user-token", "content-type": "application/json" },
    body: JSON.stringify({ organization_id: "00000000-0000-0000-0000-000000000001", package_id: "00000000-0000-0000-0000-000000000002", amount_paid: 1000, payment_method: "cash" })
  }), { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /device_id/);
});

test("additional router registration endpoint rejects unauthenticated requests", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/routers", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ organization_id: "00000000-0000-0000-0000-000000000001", site_name: "Branch 2", router_name: "Router 2" })
  }), {});
  assert.equal(response.status, 401);
});

test("Super Admin router approval endpoint rejects unauthenticated requests", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/platform/admin/approve-router", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_id: "00000000-0000-0000-0000-000000000001", payment_method: "cash", months: 1 })
  }), {});
  assert.equal(response.status, 401);
});

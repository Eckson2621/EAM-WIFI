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
    assert.equal(upstreamUrl.searchParams.get("select"), "id,organization_id,site_id,name,vendor,model,connection_status,last_seen_at,created_at,site:hotspot_sites(id,name,slug),router_subscriptions(status,expires_at,monthly_price_tzs,trial_started_at,trial_expires_at)");
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


test("signup rejects weak passwords before contacting Supabase", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
  try {
    const response = await worker.fetch(new Request("https://example.test/api/auth/signup", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "weakpass1" })
    }), { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("MFA factor listing requires an authenticated session", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/auth/mfa/factors"), {});
  assert.equal(response.status, 401);
});

test("MFA challenge rejects malformed factor identifiers before contacting Supabase", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
  try {
    const response = await worker.fetch(new Request("https://example.test/api/auth/mfa/challenge", {
      method: "POST", headers: { authorization: "Bearer user-session-test", "content-type": "application/json" },
      body: JSON.stringify({ factor_id: "bad" })
    }), { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});


test("MFA verification rejects non-six-digit codes before contacting Supabase", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
  try {
    const response = await worker.fetch(new Request("https://example.test/api/auth/mfa/verify", {
      method: "POST", headers: { authorization: "Bearer user-session-test", "content-type": "application/json" },
      body: JSON.stringify({
        factor_id: "00000000-0000-0000-0000-000000000001",
        challenge_id: "00000000-0000-0000-0000-000000000002",
        code: "12AB56"
      })
    }), { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("MFA factor lookup forwards the signed-in user's JWT to Supabase Auth", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedAuthorization = "";
  globalThis.fetch = async (url, options = {}) => {
    capturedUrl = String(url);
    capturedAuthorization = new Headers(options.headers || {}).get("authorization");
    return new Response(JSON.stringify({ id: "user-1", factors: [] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  try {
    const token = "signed-in-user-jwt";
    const response = await worker.fetch(new Request("https://example.test/api/auth/mfa/factors", {
      headers: { authorization: "Bearer " + token }
    }), { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    assert.equal(response.status, 200);
    assert.equal(new URL(capturedUrl).pathname, "/auth/v1/user");
    assert.equal(capturedAuthorization, "Bearer " + token);
  } finally { globalThis.fetch = originalFetch; }
});


test("MFA verify forwards a valid TOTP code and the user's bearer token", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody = "";
  let capturedAuthorization = "";
  globalThis.fetch = async (url, options = {}) => {
    capturedUrl = String(url);
    capturedBody = String(options.body || "");
    capturedAuthorization = new Headers(options.headers || {}).get("authorization");
    return new Response(JSON.stringify({ access_token: "upgraded.jwt.token", refresh_token: "refresh" }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  try {
    const token = "signed-in-user-jwt";
    const response = await worker.fetch(new Request("https://example.test/api/auth/mfa/verify", {
      method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({
        factor_id: "00000000-0000-0000-0000-000000000001",
        challenge_id: "00000000-0000-0000-0000-000000000002",
        code: "123456"
      })
    }), { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    assert.equal(response.status, 200);
    assert.equal(new URL(capturedUrl).pathname, "/auth/v1/factors/00000000-0000-0000-0000-000000000001/verify");
    assert.equal(capturedAuthorization, "Bearer " + token);
    assert.equal(JSON.parse(capturedBody).code, "123456");
  } finally { globalThis.fetch = originalFetch; }
});

test("MFA challenge forwards the selected factor and user session", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody = "";
  let capturedAuthorization = "";
  globalThis.fetch = async (url, options = {}) => {
    capturedUrl = String(url);
    capturedBody = String(options.body || "");
    capturedAuthorization = new Headers(options.headers || {}).get("authorization");
    return new Response(JSON.stringify({ id: "challenge-1" }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  try {
    const token = "signed-in-user-jwt";
    const response = await worker.fetch(new Request("https://example.test/api/auth/mfa/challenge", {
      method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ factor_id: "00000000-0000-0000-0000-000000000001" })
    }), { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    assert.equal(response.status, 200);
    assert.equal(new URL(capturedUrl).pathname, "/auth/v1/factors/00000000-0000-0000-0000-000000000001/challenge");
    assert.equal(capturedAuthorization, "Bearer " + token);
    assert.equal(JSON.parse(capturedBody).factor_id, "00000000-0000-0000-0000-000000000001");
  } finally { globalThis.fetch = originalFetch; }
});


test("business approval uses the free per-router billing path, not the legacy paid business subscription", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody = "";
  globalThis.fetch = async (url, options = {}) => {
    capturedUrl = String(url);
    capturedBody = String(options.body || "");
    return new Response(JSON.stringify({
      organization_id: "00000000-0000-0000-0000-000000000001",
      status: "active",
      billing_model: "per_router"
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const organizationId = "00000000-0000-0000-0000-000000000001";
    const response = await worker.fetch(new Request("https://example.test/api/platform/admin/approve", {
      method: "POST",
      headers: { authorization: "Bearer super-admin-session", "content-type": "application/json" },
      body: JSON.stringify({ organization_id: organizationId, payment_method: "other", months: 1 })
    }), {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test"
    });
    assert.equal(response.status, 200);
    assert.equal(new URL(capturedUrl).pathname, "/rest/v1/rpc/platform_admin_approve_subscription_period");
    const payload = JSON.parse(capturedBody);
    assert.equal(payload.p_organization_id, organizationId);
    assert.equal(payload.p_months, 1);
    assert.equal(payload.p_payment_method, "other");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("signup rejects a breached password using only the five-character hash prefix", async () => {
  const originalFetch = globalThis.fetch;
  const password = "ThisIsAReallyStrong!Password2026";
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const prefix = hash.slice(0, 5), suffix = hash.slice(5);
  let checkedUrl = "";
  let supabaseCalled = false;
  globalThis.fetch = async (url) => {
    checkedUrl = String(url);
    return new Response(suffix + ":12\r\n", { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://example.test/api/auth/signup", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password })
    }), { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /data breaches/i);
    assert.equal(checkedUrl, "https://api.pwnedpasswords.com/range/" + prefix);
    assert.equal(checkedUrl.includes(password), false);
    assert.equal(supabaseCalled, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("signup fails closed when the breached-password service is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("unavailable", { status: 503 }); };
  try {
    const response = await worker.fetch(new Request("https://example.test/api/auth/signup", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "ThisIsAReallyStrong!Password2026" })
    }), { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    assert.equal(response.status, 503);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});


test("public router adapter catalogue exposes honest integration readiness without authentication", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/router-adapters"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.adapters));
  assert.ok(Array.isArray(body.vendors));
  assert.deepEqual(Object.keys(body.integrations).sort(), ["huawei", "tp_link", "ubiquiti"]);
  assert.deepEqual(body.integrations.ubiquiti.integrations.map((item) => item.id), ["unifi_controller", "radius"]);
  assert.deepEqual(body.integrations.tp_link.integrations.map((item) => item.id), ["omada_controller", "radius"]);
  assert.deepEqual(body.integrations.huawei.integrations.map((item) => item.id), ["radius", "controller_api"]);
  const mikrotik = body.adapters.find((item) => item.id === "mikrotik-routeros-agent");
  const radius = body.adapters.find((item) => item.id === "radius");
  const portal = body.adapters.find((item) => item.id === "external-portal");
  assert.equal(mikrotik.status, "pilot");
  assert.equal(radius.status, "planned");
  assert.equal(portal.status, "limited");
  assert.equal(body.vendors.find((item) => item.vendor === "tp_link").status, "planned");
  assert.equal(body.vendors.find((item) => item.vendor === "other").status, "assessment_required");
  assert.ok(!JSON.stringify(body).includes("do-not-return-this-radius-secret"));
});


test("router integration validation requires an authenticated business session", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/router/integration/validate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ vendor: "huawei", integration_id: "radius", config: {} })
  }), {});
  assert.equal(response.status, 401);
});

test("router integration validation checks config without echoing credentials or claiming it was saved", async () => {
  const secret = "never-echo-this-radius-secret";
  const response = await worker.fetch(new Request("https://example.test/api/router/integration/validate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer authenticated-test-session" },
    body: JSON.stringify({
      vendor: "huawei", integration_id: "radius",
      config: { radius_server: "10.0.0.10", radius_auth_port: 1812, radius_accounting_port: 1813, shared_secret: secret }
    })
  }), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.saved, false);
  assert.equal(JSON.stringify(body).includes(secret), false);
});

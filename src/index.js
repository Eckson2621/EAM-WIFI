const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function getToken(request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function supabaseFetch(env, path, options = {}, token = "") {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase environment is not configured.");
  }
  const headers = new Headers(options.headers || {});
  headers.set("apikey", env.SUPABASE_PUBLISHABLE_KEY);
  headers.set("accept", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}${path}`, { ...options, headers });
}

async function proxyAuth(request, env, path) {
  const body = request.method === "POST" ? await request.text() : undefined;
  const upstream = await supabaseFetch(env, path, { method: request.method, body });
  const payload = await upstream.text();
  return new Response(payload, {
    status: upstream.status,
    headers: { ...JSON_HEADERS, "cache-control": "no-store" }
  });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/health") {
    return json({ ok: true, app: "EAM-WIFI", supabase_project: "configured", timestamp: new Date().toISOString() });
  }


  if (path === "/api/register-business" && request.method === "POST") {
    const token = getToken(request);
    if (!token) return json({ error: "Authentication required." }, 401);
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const params = {
      p_owner_name: input.owner_name,
      p_business_name: input.business_name,
      p_contact_phone: input.contact_phone,
      p_country_code: input.country_code,
      p_currency_code: input.currency_code,
      p_timezone: input.timezone,
      p_site_name: input.site_name,
      p_site_address: input.site_address || null,
      p_router_name: input.router_name,
      p_router_vendor: input.router_vendor,
      p_router_model: input.router_model || null,
      p_integration_type: input.integration_type,
      p_management_address: input.management_address || null,
      p_api_port: input.api_port ? Number(input.api_port) : null
    };
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/register_wifi_business", {
      method: "POST", body: JSON.stringify(params)
    }, token);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...JSON_HEADERS, "cache-control": "no-store" }
    });
  }

  if (path === "/api/auth/signup" && request.method === "POST") {
    return proxyAuth(request, env, "/auth/v1/signup");
  }
  if (path === "/api/auth/signin" && request.method === "POST") {
    return proxyAuth(request, env, "/auth/v1/token?grant_type=password");
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    const token = getToken(request);
    if (!token) return json({ error: "Authentication required." }, 401);
    const upstream = await supabaseFetch(env, "/auth/v1/logout", { method: "POST" }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }
  if (path === "/api/auth/user" && request.method === "GET") {
    const token = getToken(request);
    if (!token) return json({ error: "Authentication required." }, 401);
    const upstream = await supabaseFetch(env, "/auth/v1/user", { method: "GET" }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  const token = getToken(request);
  if (!token) return json({ error: "Authentication required." }, 401);

  if (path === "/api/organizations" && request.method === "GET") {
    const upstream = await supabaseFetch(
      env,
      "/rest/v1/organization_members?select=organization_id,role,status,organization:organizations(id,name,status,slug)&order=created_at.asc",
      { method: "GET" },
      token
    );
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  if (path === "/api/packages" && request.method === "GET") {
    const organizationId = url.searchParams.get("organization_id");
    if (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId)) {
      return json({ error: "A valid organization_id is required." }, 400);
    }
    const query = new URLSearchParams({
      select: "id,organization_id,name,description,price_tzs,duration_seconds,validity_seconds,data_limit_bytes,speed_down_kbps,speed_up_kbps,max_devices,session_mode,is_active,display_order",
      organization_id: `eq.${organizationId}`,
      is_active: "eq.true",
      order: "display_order.asc"
    });
    const upstream = await supabaseFetch(env, `/rest/v1/wifi_packages?${query}`, { method: "GET" }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
        return await handleApi(request, env);
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("EAM-WIFI assets are not configured.", { status: 503 });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
    }
  }
};

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
  return new Response(await upstream.text(), {
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
      p_api_port: input.api_port ? Number(input.api_port) : null,
      p_payment_phone: input.payment_phone || input.contact_phone,
      p_payment_instructions: input.payment_instructions || null
    };
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/register_wifi_business_with_payment", {
      method: "POST", body: JSON.stringify(params)
    }, token);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...JSON_HEADERS, "cache-control": "no-store" }
    });
  }

  if (path === "/api/auth/signup" && request.method === "POST") return proxyAuth(request, env, "/auth/v1/signup");
  if (path === "/api/auth/signin" && request.method === "POST") return proxyAuth(request, env, "/auth/v1/token?grant_type=password");
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

  if (path === "/api/public/portal" && request.method === "GET") {
    const slug = url.searchParams.get("site") || "";
    if (!/^[a-z0-9-]{3,80}$/.test(slug)) return json({ error: "A valid Wi-Fi site is required." }, 400);
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/public_wifi_portal", {
      method: "POST", body: JSON.stringify({ p_slug: slug })
    });
    const body = await upstream.text();
    if (!upstream.ok) return new Response(body, { status: upstream.status, headers: JSON_HEADERS });
    const data = JSON.parse(body || "null");
    if (!data) return json({ error: "This Wi-Fi service is unavailable." }, 404);
    return json(data);
  }

  if (path === "/api/public/redeem" && request.method === "POST") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const slug = String(input.site || "");
    const code = String(input.code || "").trim().toUpperCase();
    const mac = String(input.mac_address || "");
    if (!/^[a-z0-9-]{3,80}$/.test(slug)) return json({ error: "A valid Wi-Fi site is required." }, 400);
    if (!/^EW[A-F0-9]{16,24}$/.test(code)) return json({ error: "Enter a valid voucher code." }, 400);
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) return json({ error: "Connect through the Wi-Fi login page so the router can identify your device." }, 400);
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/redeem_wifi_voucher", {
      method: "POST", body: JSON.stringify({ p_slug: slug, p_code: code, p_mac_address: mac })
    });
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  // MikroTik device heartbeat: the router initiates outbound HTTPS; no inbound router port is required.
  if (path === "/api/router/heartbeat" && request.method === "POST") {
    const deviceToken = getToken(request);
    if (!deviceToken || deviceToken.length < 32 || deviceToken.length > 200) {
      return json({ error: "Router authentication required." }, 401);
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceToken));
    const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/authenticate_router_device", {
      method: "POST", body: JSON.stringify({ p_token_hash: tokenHash })
    });
    if (!upstream.ok) return json({ error: "Router authentication failed." }, 401);
    const device = await upstream.json();
    if (!device?.ok) return json({ error: "Router credential is invalid or expired." }, 401);
    return json({ ok: true, device, next_poll_seconds: 15, capabilities: ["heartbeat", "event_poll", "event_ack", "mikrotik_hotspot_user"] });
  }

  // Authenticated router event queue. Routers initiate outbound HTTPS only.
  if (path === "/api/router/events" && request.method === "POST") {
    const deviceToken = getToken(request);
    if (!deviceToken || deviceToken.length < 32 || deviceToken.length > 200) return json({ error: "Router authentication required." }, 401);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceToken));
    const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/claim_router_events", {
      method: "POST", body: JSON.stringify({ p_token_hash: tokenHash, p_limit: 20 })
    });
    const body = await upstream.text();
    if (!upstream.ok) return json({ error: "Router event claim failed.", detail: body.slice(0, 500) }, upstream.status);
    return new Response(body || "[]", { status: 200, headers: JSON_HEADERS });
  }

  if (path === "/api/router/events/complete" && request.method === "POST") {
    const deviceToken = getToken(request);
    if (!deviceToken || deviceToken.length < 32 || deviceToken.length > 200) return json({ error: "Router authentication required." }, 401);
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const eventId = String(input.event_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(eventId) || typeof input.success !== "boolean") return json({ error: "A valid event_id and boolean success are required." }, 400);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceToken));
    const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const resultPayload = input.result_payload && typeof input.result_payload === "object" && !Array.isArray(input.result_payload) ? input.result_payload : {};
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/complete_router_event", {
      method: "POST",
      body: JSON.stringify({
        p_token_hash: tokenHash, p_event_id: eventId, p_success: input.success,
        p_result_payload: resultPayload, p_error: String(input.error || "").slice(0, 1000) || null
      })
    });
    const body = await upstream.text();
    return new Response(body, { status: upstream.status, headers: JSON_HEADERS });
  }

  const token = getToken(request);
  if (!token) return json({ error: "Authentication required." }, 401);

  if (path === "/api/business/settings" && ["GET", "PATCH"].includes(request.method)) {
    const input = request.method === "PATCH" ? await request.json().catch(() => null) : null;
    if (request.method === "PATCH" && !input) return json({ error: "Invalid JSON body." }, 400);
    const organizationId = String(request.method === "GET" ? url.searchParams.get("organization_id") || "" : input.organization_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return json({ error: "A valid organization_id is required." }, 400);
    if (request.method === "GET") {
      const query = new URLSearchParams({
        select: "payment_phone,payment_instructions,organization:organizations(contact_phone)",
        organization_id: `eq.${organizationId}`
      });
      const upstream = await supabaseFetch(env, `/rest/v1/organization_settings?${query}`, { method: "GET" }, token);
      return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
    }
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/update_business_contact_settings", {
      method: "POST",
      body: JSON.stringify({
        p_organization_id: organizationId,
        p_business_phone: String(input.business_phone || ""),
        p_payment_phone: String(input.payment_phone || ""),
        p_payment_instructions: String(input.payment_instructions || "")
      })
    }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  if (path === "/api/router/pair" && request.method === "POST") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const organizationId = String(input.organization_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return json({ error: "A valid organization_id is required." }, 400);
    const random = new Uint8Array(32);
    crypto.getRandomValues(random);
    const deviceToken = Array.from(random, b => b.toString(16).padStart(2, "0")).join("");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceToken));
    const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/create_router_device_credential", {
      method: "POST",
      body: JSON.stringify({ p_organization_id: organizationId, p_token_hash: tokenHash, p_expires_at: expiresAt })
    }, token);
    const body = await upstream.text();
    if (!upstream.ok) return new Response(body, { status: upstream.status, headers: JSON_HEADERS });
    const pairing = JSON.parse(body || "null");
    if (!env.ASSETS?.fetch) return json({ error: "Static router installer is not configured." }, 503);
    const installerResponse = await env.ASSETS.fetch(new Request(new URL("/downloads/eam-wifi-agent-template.rsc", request.url)));
    if (!installerResponse.ok) return json({ error: "Router installer template could not be loaded." }, 503);
    const installerTemplate = await installerResponse.text();
    if (!installerTemplate.includes("__EAM_WIFI_TOKEN__")) return json({ error: "Router installer template is invalid." }, 500);
    const installerScript = installerTemplate.replaceAll("__EAM_WIFI_TOKEN__", deviceToken);
    return json({ ok: true, device_token: deviceToken, expires_at: expiresAt, pairing, installer_script: installerScript });
  }


  if (path === "/api/support/messages" && request.method === "POST") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const subject = String(input.subject || "").trim();
    const message = String(input.message || "").trim();
    const category = String(input.category || "general");
    const organizationId = input.organization_id ? String(input.organization_id) : null;
    const allowedCategories = ["account","business_setup","router_connection","vouchers","payments","technical_issue","general"];
    if (subject.length < 3 || subject.length > 140) return json({ error: "Subject must be 3–140 characters." }, 400);
    if (message.length < 10 || message.length > 4000) return json({ error: "Message must be 10–4,000 characters." }, 400);
    if (!allowedCategories.includes(category)) return json({ error: "Select a valid support category." }, 400);
    if (organizationId && !/^[0-9a-f-]{36}$/i.test(organizationId)) return json({ error: "Invalid business reference." }, 400);
    const authResponse = await supabaseFetch(env, "/auth/v1/user", { method: "GET" }, token);
    if (!authResponse.ok) return json({ error: "Your session has expired. Sign in again." }, 401);
    const authUser = await authResponse.json();
    const senderName = String(authUser.user_metadata?.full_name || authUser.user_metadata?.name || "").slice(0,120);
    const insert = await supabaseFetch(env, "/rest/v1/support_messages?select=id,created_at,status", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: authUser.id, sender_email: authUser.email || null, sender_name: senderName || null, organization_id: organizationId, category, subject, message })
    }, token);
    const body = await insert.text();
    return new Response(body, { status: insert.status, headers: JSON_HEADERS });
  }
  if (path === "/api/support/replies" && request.method === "POST") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const messageId = String(input.support_message_id || "");
    const message = String(input.message || "").trim();
    const senderRole = String(input.sender_role || "");
    if (!/^[0-9a-f-]{36}$/i.test(messageId)) return json({ error: "A valid support message ID is required." }, 400);
    if (message.length < 1 || message.length > 4000) return json({ error: "Reply must be 1–4,000 characters." }, 400);
    if (!["user","admin"].includes(senderRole)) return json({ error: "Invalid sender role." }, 400);
    const authResponse = await supabaseFetch(env, "/auth/v1/user", { method: "GET" }, token);
    if (!authResponse.ok) return json({ error: "Your session has expired. Sign in again." }, 401);
    const authUser = await authResponse.json();
    const insert = await supabaseFetch(env, "/rest/v1/support_replies?select=id,support_message_id,author_id,sender_role,message,created_at", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ support_message_id: messageId, author_id: authUser.id, sender_role: senderRole, message })
    }, token);
    return new Response(await insert.text(), { status: insert.status, headers: JSON_HEADERS });
  }
  if (path === "/api/support/replies" && request.method === "GET") {
    const messageId = String(url.searchParams.get("message_id") || "");
    if (!/^[0-9a-f-]{36}$/i.test(messageId)) return json({ error: "A valid support message ID is required." }, 400);
    const query = new URLSearchParams({ select: "id,support_message_id,author_id,sender_role,message,created_at", support_message_id: `eq.${messageId}`, order: "created_at.asc", limit: "500" });
    const upstream = await supabaseFetch(env, `/rest/v1/support_replies?${query}`, { method: "GET" }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }
  if (path === "/api/support/messages" && request.method === "GET") {
    const requestedOffset = Number(url.searchParams.get("offset") || 0);
    const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
    const query = new URLSearchParams({ select: "id,user_id,sender_email,sender_name,organization_id,category,subject,message,status,created_at,updated_at,organization:organizations(name)", order: "created_at.desc", limit: "200", offset: String(offset) });
    const upstream = await supabaseFetch(env, `/rest/v1/support_messages?${query}`, { method: "GET" }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }
  if (path === "/api/support/messages" && request.method === "PATCH") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    if (!/^[0-9a-f-]{36}$/i.test(String(input.id || ""))) return json({ error: "A valid message ID is required." }, 400);
    if (!["new","read","closed"].includes(input.status)) return json({ error: "Invalid message status." }, 400);
    const query = new URLSearchParams({ id: `eq.${input.id}`, select: "id,status,updated_at" });
    const upstream = await supabaseFetch(env, `/rest/v1/support_messages?${query}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: input.status, updated_at: new Date().toISOString() }) }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }


  // Secure in-app chat. Supabase RLS remains the authority for every row.
  if (path === "/api/chat/members" && request.method === "GET") {
    const organizationId = url.searchParams.get("organization_id");
    if (organizationId && !/^[0-9a-f-]{36}$/i.test(organizationId)) return json({ error: "Invalid organization_id." }, 400);
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/list_chat_members", {
      method: "POST", body: JSON.stringify({ p_organization_id: organizationId || null })
    }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }
  if (path === "/api/chat/conversations" && request.method === "GET") {
    const query = new URLSearchParams({ select: "id,organization_id,conversation_type,title,created_by,created_at,updated_at", order: "updated_at.desc", limit: "100" });
    const upstream = await supabaseFetch(env, `/rest/v1/chat_conversations?${query}`, { method: "GET" }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }
  if (path === "/api/chat/conversations" && request.method === "POST") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const type = String(input.conversation_type || "");
    const organizationId = input.organization_id ? String(input.organization_id) : null;
    const title = String(input.title || "").trim().slice(0, 120) || null;
    const recipients = Array.isArray(input.user_ids) ? [...new Set(input.user_ids.map(String))] : [];
    if (!["direct", "group", "broadcast"].includes(type)) return json({ error: "Invalid conversation type." }, 400);
    if (type !== "broadcast" && !/^[0-9a-f-]{36}$/i.test(organizationId || "")) return json({ error: "Choose a valid business." }, 400);
    if (type === "broadcast" && recipients.length === 0) return json({ error: "Choose at least one broadcast recipient." }, 400);
    if (recipients.length > 100 || recipients.some(id => !/^[0-9a-f-]{36}$/i.test(id))) return json({ error: "Invalid or too many recipients (maximum 100)." }, 400);
    if (type === "direct" && recipients.length !== 1) return json({ error: "A private chat requires exactly one other participant." }, 400);
    if (type === "group" && recipients.length < 1) return json({ error: "Choose at least one group participant." }, 400);
    const authResponse = await supabaseFetch(env, "/auth/v1/user", { method: "GET" }, token);
    if (!authResponse.ok) return json({ error: "Your session has expired. Sign in again." }, 401);
    const authUser = await authResponse.json();
    const created = await supabaseFetch(env, "/rest/v1/chat_conversations?select=id,organization_id,conversation_type,title,created_by,created_at,updated_at", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ organization_id: type === "broadcast" ? null : organizationId, conversation_type: type, title, created_by: authUser.id })
    }, token);
    const createdBody = await created.text();
    if (!created.ok) return new Response(createdBody, { status: created.status, headers: JSON_HEADERS });
    const conversation = JSON.parse(createdBody || "[]")[0];
    if (!conversation?.id) return json({ error: "Conversation could not be created." }, 502);
    const rows = recipients.filter(id => id !== authUser.id).map(user_id => ({ conversation_id: conversation.id, user_id, added_by: authUser.id }));
    if (rows.length) {
      const add = await supabaseFetch(env, "/rest/v1/chat_participants", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) }, token);
      if (!add.ok) {
        const detail = await add.text();
        await supabaseFetch(env, `/rest/v1/chat_conversations?id=eq.${conversation.id}`, { method: "DELETE" }, token);
        return new Response(detail, { status: add.status, headers: JSON_HEADERS });
      }
    }
    return json(conversation, 201);
  }
  if (path === "/api/chat/messages" && request.method === "GET") {
    const conversationId = String(url.searchParams.get("conversation_id") || "");
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return json({ error: "A valid conversation is required." }, 400);
    const query = new URLSearchParams({ select: "id,conversation_id,sender_id,message_type,body,created_at,edited_at,deleted_at", conversation_id: `eq.${conversationId}`, order: "created_at.asc", limit: "200" });
    const upstream = await supabaseFetch(env, `/rest/v1/chat_messages?${query}`, { method: "GET" }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }
  if (path === "/api/chat/messages" && request.method === "POST") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const conversationId = String(input.conversation_id || "");
    const body = String(input.body || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return json({ error: "A valid conversation is required." }, 400);
    if (!body || body.length > 5000) return json({ error: "Message must contain 1–5,000 characters." }, 400);
    const authResponse = await supabaseFetch(env, "/auth/v1/user", { method: "GET" }, token);
    if (!authResponse.ok) return json({ error: "Your session has expired. Sign in again." }, 401);
    const authUser = await authResponse.json();
    const upstream = await supabaseFetch(env, "/rest/v1/chat_messages?select=id,conversation_id,sender_id,message_type,body,created_at", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ conversation_id: conversationId, sender_id: authUser.id, message_type: "text", body })
    }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }
  if (path === "/api/chat/read" && request.method === "POST") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const conversationId = String(input.conversation_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return json({ error: "A valid conversation is required." }, 400);
    const authResponse = await supabaseFetch(env, "/auth/v1/user", { method: "GET" }, token);
    if (!authResponse.ok) return json({ error: "Your session has expired. Sign in again." }, 401);
    const authUser = await authResponse.json();
    const query = new URLSearchParams({ conversation_id: `eq.${conversationId}`, user_id: `eq.${authUser.id}` });
    const upstream = await supabaseFetch(env, `/rest/v1/chat_participants?${query}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_read_at: new Date().toISOString() }) }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  if (path === "/api/platform/admin/dashboard" && request.method === "GET") {
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/platform_admin_dashboard_stats", {
      method: "POST", body: "{}"
    }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  if (path === "/api/platform/admin/accounts" && request.method === "GET") {
    const query = new URLSearchParams({
      select: "id,name,slug,contact_phone,status,created_at,platform_subscriptions(status,expires_at)",
      order: "created_at.asc"
    });
    const upstream = await supabaseFetch(env, `/rest/v1/organizations?${query}`, { method: "GET" }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  if (path === "/api/platform/admin/approve" && request.method === "POST") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    if (!/^[0-9a-f-]{36}$/i.test(String(input.organization_id || ""))) {
      return json({ error: "A valid organization_id is required." }, 400);
    }
    if (!["cash", "mobile_money", "bank_transfer", "other"].includes(input.payment_method)) {
      return json({ error: "Select a valid payment method." }, 400);
    }
    const months = Number(input.months || 1);
    if (!Number.isInteger(months) || months < 1 || months > 60) {
      return json({ error: "Subscription duration must be between 1 and 60 months." }, 400);
    }
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/platform_admin_approve_subscription_period", {
      method: "POST",
      body: JSON.stringify({
        p_organization_id: input.organization_id,
        p_payment_method: input.payment_method,
        p_payment_reference: input.payment_reference || null,
        p_months: months
      })
    }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  if (path === "/api/platform/subscription" && request.method === "GET") {
    const organizationId = url.searchParams.get("organization_id");
    if (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId)) {
      return json({ error: "A valid organization_id is required." }, 400);
    }
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/platform_subscription_status", {
      method: "POST", body: JSON.stringify({ p_organization_id: organizationId })
    }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  if (path === "/api/vouchers/issue-paid" && request.method === "POST") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const organizationId = String(input.organization_id || "");
    const packageId = String(input.package_id || "");
    const amountPaid = Number(input.amount_paid);
    const paymentMethod = String(input.payment_method || "");
    if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !/^[0-9a-f-]{36}$/i.test(packageId)) {
      return json({ error: "Valid organization_id and package_id are required." }, 400);
    }
    if (!Number.isSafeInteger(amountPaid) || amountPaid < 1) {
      return json({ error: "A valid amount paid is required." }, 400);
    }
    if (!["cash", "mobile_money", "bank_transfer", "other"].includes(paymentMethod)) {
      return json({ error: "Select a valid payment method." }, 400);
    }
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/issue_paid_wifi_voucher", {
      method: "POST",
      body: JSON.stringify({
        p_organization_id: organizationId,
        p_package_id: packageId,
        p_amount_paid: amountPaid,
        p_payment_method: paymentMethod,
        p_customer_phone: input.customer_phone || null,
        p_payment_reference: input.payment_reference || null
      })
    }, token);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...JSON_HEADERS, "cache-control": "no-store" }
    });
  }

  if (path === "/api/vouchers/generate" && request.method === "POST") {
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const organizationId = String(input.organization_id || "");
    const packageId = String(input.package_id || "");
    const quantity = Number(input.quantity);
    if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !/^[0-9a-f-]{36}$/i.test(packageId)) {
      return json({ error: "Valid organization_id and package_id are required." }, 400);
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      return json({ error: "Quantity must be an integer from 1 to 500." }, 400);
    }
    const upstream = await supabaseFetch(env, "/rest/v1/rpc/generate_wifi_vouchers", {
      method: "POST",
      body: JSON.stringify({
        p_organization_id: organizationId,
        p_package_id: packageId,
        p_quantity: quantity
      })
    }, token);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...JSON_HEADERS, "cache-control": "no-store" }
    });
  }

  if (path === "/api/organizations" && request.method === "GET") {
    const upstream = await supabaseFetch(
      env,
      "/rest/v1/organization_members?select=organization_id,role,status,organization:organizations(id,name,status,slug)&order=created_at.asc",
      { method: "GET" },
      token
    );
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  if (path === "/api/packages" && ["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    const organizationId = url.searchParams.get("organization_id");
    const packageId = url.searchParams.get("id");
    if (request.method === "GET" && (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId))) {
      return json({ error: "A valid organization_id is required." }, 400);
    }
    let input = {};
    if (["POST", "PATCH", "DELETE"].includes(request.method)) {
      try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    }
    const orgId = request.method === "GET" ? organizationId : String(input.organization_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(orgId)) return json({ error: "A valid organization_id is required." }, 400);
    if (["PATCH", "DELETE"].includes(request.method) && !/^[0-9a-f-]{36}$/i.test(packageId || "")) {
      return json({ error: "A valid package id is required." }, 400);
    }
    const subscriptionCheck = await supabaseFetch(env, "/rest/v1/rpc/platform_subscription_status", {
      method: "POST", body: JSON.stringify({ p_organization_id: orgId })
    }, token);
    if (!subscriptionCheck.ok) return new Response(await subscriptionCheck.text(), { status: subscriptionCheck.status, headers: JSON_HEADERS });
    const subscription = await subscriptionCheck.json();
    if (!subscription?.active) return json({ error: "EAM-WIFI subscription is pending or expired. Contact the platform administrator." }, 403);

    const fields = ["name","description","price_tzs","duration_seconds","validity_seconds","data_limit_bytes","speed_down_kbps","speed_up_kbps","max_devices","session_mode","is_active","display_order"];
    if (request.method === "POST") {
      const name = String(input.name || "").trim();
      const price = Number(input.price_tzs);
      const duration = Number(input.duration_seconds);
      if (name.length < 2 || name.length > 100) return json({ error: "Package name must be 2–100 characters." }, 400);
      if (!Number.isSafeInteger(price) || price < 0) return json({ error: "Enter a valid whole-number price in TZS." }, 400);
      if (!Number.isInteger(duration) || duration < 1) return json({ error: "Duration must be at least one second." }, 400);
      if (input.session_mode && !["connected_time","wall_clock"].includes(input.session_mode)) return json({ error: "Invalid session mode." }, 400);
      const payload = { organization_id: orgId, name, description: String(input.description || "").trim() || null, price_tzs: price, duration_seconds: duration, validity_seconds: input.validity_seconds ? Number(input.validity_seconds) : null, data_limit_bytes: input.data_limit_bytes ? Number(input.data_limit_bytes) : null, speed_down_kbps: input.speed_down_kbps ? Number(input.speed_down_kbps) : null, speed_up_kbps: input.speed_up_kbps ? Number(input.speed_up_kbps) : null, max_devices: Number(input.max_devices || 1), session_mode: input.session_mode || "connected_time", is_active: input.is_active !== false, display_order: Number(input.display_order || 0) };
      for (const key of ["validity_seconds","data_limit_bytes","speed_down_kbps","speed_up_kbps"]) if (payload[key] !== null && (!Number.isSafeInteger(payload[key]) || payload[key] < 1)) return json({ error: "Optional validity, data and speed limits must be positive whole numbers." }, 400);
      if (!Number.isInteger(payload.max_devices) || payload.max_devices < 1 || payload.max_devices > 50) return json({ error: "Maximum devices must be from 1 to 50." }, 400);
      const upstream = await supabaseFetch(env, "/rest/v1/wifi_packages?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) }, token);
      return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
    }
    if (request.method === "PATCH") {
      const payload = {};
      for (const key of fields) if (Object.prototype.hasOwnProperty.call(input, key)) payload[key] = input[key];
      if (payload.name !== undefined) payload.name = String(payload.name).trim();
      if (payload.name !== undefined && (payload.name.length < 2 || payload.name.length > 100)) return json({ error: "Package name must be 2–100 characters." }, 400);
      if (payload.session_mode !== undefined && !["connected_time","wall_clock"].includes(payload.session_mode)) return json({ error: "Invalid session mode." }, 400);
      const query = new URLSearchParams({ id: `eq.${packageId}`, organization_id: `eq.${orgId}`, select: "*" });
      const upstream = await supabaseFetch(env, `/rest/v1/wifi_packages?${query}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) }, token);
      return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
    }
    if (request.method === "DELETE") {
      const query = new URLSearchParams({ id: `eq.${packageId}`, organization_id: `eq.${orgId}` });
      const upstream = await supabaseFetch(env, `/rest/v1/wifi_packages?${query}`, { method: "DELETE", headers: { Prefer: "return=representation" } }, token);
      const body = await upstream.text();
      if (!upstream.ok) return new Response(body, { status: upstream.status, headers: JSON_HEADERS });
      if (body.trim() === "[]") return json({ error: "Package not found or you do not have permission to delete it." }, 404);
      return new Response(body, { status: 200, headers: JSON_HEADERS });
    }
    const query = new URLSearchParams({
      select: "id,organization_id,name,description,price_tzs,duration_seconds,validity_seconds,data_limit_bytes,speed_down_kbps,speed_up_kbps,max_devices,session_mode,is_active,display_order",
      organization_id: `eq.${orgId}`,
      order: "display_order.asc,created_at.asc"
    });
    if (url.searchParams.get("include_inactive") !== "true") query.set("is_active", "eq.true");
    const upstream = await supabaseFetch(env, `/rest/v1/wifi_packages?${query}`, { method: "GET" }, token);
    return new Response(await upstream.text(), { status: upstream.status, headers: JSON_HEADERS });
  }

  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/portal") {
        const portalUrl = new URL("/portal.html", url);
        portalUrl.search = url.search;
        return env.ASSETS ? env.ASSETS.fetch(new Request(portalUrl, request)) : new Response("Portal assets unavailable.", { status: 503 });
      }
      if (url.pathname.startsWith("/api/")) {
        if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
        return await handleApi(request, env);
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("EAM-WIFI assets are not configured.", { status: 503 });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
    }
  }
};

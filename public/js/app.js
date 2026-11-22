const $ = (id) => document.getElementById(id);
let mode = "signin";
let session = null;
let selectedOrganization = null;

$("year").textContent = new Date().getFullYear();

const GUIDE_KEY = "eamwifi_guide_completed_v1";
let helpReturnTarget = null;
function finishGuide() {
  localStorage.setItem(GUIDE_KEY, "yes");
  $("welcome-guide").classList.add("hidden");
  $("open-help").classList.remove("hidden");
  if (helpReturnTarget) {
    $(helpReturnTarget).classList.remove("hidden");
    helpReturnTarget = null;
  } else {
    $("auth-panel").classList.remove("hidden");
    $("auth-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
$("guide-understood").addEventListener("change", (event) => {
  $("guide-confirm").disabled = !event.target.checked;
});
$("guide-confirm").addEventListener("click", () => {
  if (!$("guide-understood").checked) return;
  finishGuide();
});
$("guide-skip").addEventListener("click", finishGuide);
$("open-help").addEventListener("click", () => {
  helpReturnTarget = ["platform-admin", "dashboard", "business-onboarding"].find((id) => !$(id).classList.contains("hidden")) || null;
  $("welcome-guide").classList.remove("hidden");
  $("auth-panel").classList.add("hidden");
  $("business-onboarding").classList.add("hidden");
  $("dashboard").classList.add("hidden");
  $("platform-admin").classList.add("hidden");
  $("welcome-guide").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("sim-heartbeat").addEventListener("click", () => {
  $("sim-router-indicator").classList.add("online");
  $("sim-router-status").textContent = "Simulator: heartbeat received (mock)";
  $("sim-router-detail").textContent = "Local demonstration only · no physical router contacted";
  $("sim-message").textContent = "Simulation passed: the practice screen changed state. This does NOT verify MikroTik connectivity, hotspot login or internet access.";
  $("sim-message").style.color = "#8a5a00";
});
$("sim-reset").addEventListener("click", () => {
  $("sim-router-indicator").classList.remove("online");
  $("sim-router-status").textContent = "Router simulator: not connected";
  $("sim-router-detail").textContent = "No real router connection has been tested.";
  $("sim-message").textContent = "Simulation reset. No router was contacted.";
  $("sim-message").style.color = "#66738b";
});




async function sendSupportMessage(event) {
  event.preventDefault();
  if (!session?.access_token) {
    $("support-feedback").textContent = "Please sign in first, then reopen Help to send your message.";
    $("support-feedback").style.color = "#a33b32";
    return;
  }
  const button = $("support-send");
  button.disabled = true;
  $("support-feedback").textContent = "Sending your message securely…";
  try {
    const memberships = await api("/api/organizations");
    const active = memberships.find((m) => m.status === "active" && m.role === "owner");
    await api("/api/support/messages", { method: "POST", body: JSON.stringify({
      category: $("support-category").value,
      subject: $("support-subject").value.trim(),
      message: $("support-message").value.trim(),
      organization_id: active?.organization_id || null
    }) });
    $("support-form").reset();
    $("support-feedback").textContent = "Message sent to the Super Admin. Thank you.";
    $("support-feedback").style.color = "#26734d";
    await loadMySupportMessages();
  } catch (error) {
    $("support-feedback").textContent = error.message;
    $("support-feedback").style.color = "#a33b32";
  } finally { button.disabled = false; }
}
$("support-form").addEventListener("submit", sendSupportMessage);

let supportInboxOffset = 0;
let supportInboxLoaded = 0;
async function loadSupportInbox(append = false) {
  const host = $("support-inbox");
  if (!host) return;
  if (!append) { supportInboxOffset = 0; supportInboxLoaded = 0; host.textContent = "Loading messages…"; }
  try {
    const messages = await api(`/api/support/messages?offset=${supportInboxOffset}`);
    if (!append) host.replaceChildren();
    const counts = { new: 0, read: 0, closed: 0 };
    messages.forEach((m) => {
      counts[m.status] = (counts[m.status] || 0) + 1;
      const card = document.createElement("article"); card.className = "support-message-card";
      const head = document.createElement("div"); head.className = "dashboard-head";
      const title = document.createElement("strong"); title.textContent = m.subject;
      const status = document.createElement("span"); status.className = "support-status status-" + m.status; status.textContent = m.status.toUpperCase();
      head.append(title, status);
      const org = Array.isArray(m.organization) ? m.organization[0]?.name : m.organization?.name;
      const meta = document.createElement("p"); meta.className = "muted small";
      meta.textContent = `${m.sender_name || "User"} · ${m.sender_email || m.user_id} · ${org || "No business selected"} · ${m.category.replaceAll("_"," ")} · ${new Date(m.created_at).toLocaleString()}`;
      const body = document.createElement("p"); body.className = "support-message-body"; body.textContent = m.message;
      const thread = document.createElement("div"); thread.className = "support-thread";
      const threadTitle = document.createElement("strong"); threadTitle.textContent = "Conversation";
      const threadList = document.createElement("div"); threadList.className = "support-replies stack";
      const replyForm = document.createElement("form"); replyForm.className = "support-reply-form";
      const replyInput = document.createElement("textarea"); replyInput.required = true; replyInput.maxLength = 4000; replyInput.rows = 2; replyInput.placeholder = "Write your reply to this user…";
      const replyButton = document.createElement("button"); replyButton.type = "submit"; replyButton.className = "primary"; replyButton.textContent = "Send reply";
      replyForm.append(replyInput, replyButton);
      replyForm.addEventListener("submit", async (event) => {
        event.preventDefault(); replyButton.disabled = true;
        try {
          await api("/api/support/replies", { method: "POST", body: JSON.stringify({ support_message_id: m.id, sender_role: "admin", message: replyInput.value.trim() }) });
          replyInput.value = "";
          await renderSupportReplies(m.id, threadList, "admin");
          await api("/api/support/messages", { method: "PATCH", body: JSON.stringify({ id: m.id, status: "read" }) });
          status.textContent = "READ"; status.className = "support-status status-read";
        } catch (error) { window.alert(error.message); }
        finally { replyButton.disabled = false; }
      });
      thread.append(threadTitle, threadList, replyForm);
      renderSupportReplies(m.id, threadList, "admin");
      const controls = document.createElement("div"); controls.className = "support-actions";
      [["new","Mark new"],["read","Mark read"],["closed","Close message"]].forEach(([value,label]) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "secondary"; b.textContent = label; b.disabled = m.status === value;
        b.addEventListener("click", async () => {
          b.disabled = true;
          try { await api("/api/support/messages", { method: "PATCH", body: JSON.stringify({ id: m.id, status: value }) }); await loadSupportInbox(false); }
          catch (error) { b.disabled = false; window.alert(error.message); }
        });
        controls.append(b);
      });
      card.append(head, meta, body, thread, controls); host.append(card);
    });
    supportInboxLoaded += messages.length;
    $("support-inbox-summary").textContent = `Loaded ${supportInboxLoaded} messages · This list is paginated; use “Load older messages” to continue through the inbox.`;
    supportInboxOffset += messages.length;
    $("support-load-older").hidden = messages.length < 200;
    if (!supportInboxLoaded) host.textContent = "No support messages have been received yet.";
  } catch (error) {
    host.textContent = "Could not load support inbox: " + error.message;
    $("support-inbox-summary").textContent = "";
  }
}
$("support-refresh").addEventListener("click", () => loadSupportInbox(false));
$("support-load-older").addEventListener("click", () => loadSupportInbox(true));

async function renderSupportReplies(messageId, host, viewerRole) {
  try {
    const replies = await api(`/api/support/replies?message_id=${encodeURIComponent(messageId)}`);
    host.replaceChildren();
    if (!replies.length) {
      const empty = document.createElement("p"); empty.className = "muted small"; empty.textContent = "No replies yet."; host.append(empty); return;
    }
    replies.forEach((reply) => {
      const item = document.createElement("article"); item.className = "support-reply " + (reply.sender_role === "admin" ? "reply-admin" : "reply-user");
      const label = document.createElement("strong"); label.textContent = reply.sender_role === "admin" ? "Super Admin" : "You / Customer";
      const date = document.createElement("small"); date.textContent = new Date(reply.created_at).toLocaleString();
      const content = document.createElement("p"); content.className = "support-message-body"; content.textContent = reply.message;
      item.append(label, date, content); host.append(item);
    });
  } catch (error) {
    host.textContent = "Could not load replies: " + error.message;
  }
}

async function loadMySupportMessages() {
  const host = $("support-own-list");
  if (!host) return;
  if (!session?.access_token) { host.textContent = "Sign in to view your support conversations and replies."; return; }
  host.textContent = "Loading your conversations…";
  try {
    const messages = await api("/api/support/messages?offset=0");
    host.replaceChildren();
    if (!messages.length) { host.textContent = "You have not sent a support message yet."; return; }
    messages.forEach((m) => {
      const card = document.createElement("article"); card.className = "support-message-card";
      const head = document.createElement("div"); head.className = "dashboard-head";
      const subject = document.createElement("strong"); subject.textContent = m.subject;
      const status = document.createElement("span"); status.className = "support-status status-" + m.status; status.textContent = m.status.toUpperCase();
      head.append(subject, status);
      const date = document.createElement("p"); date.className = "muted small"; date.textContent = "Sent " + new Date(m.created_at).toLocaleString();
      const original = document.createElement("p"); original.className = "support-message-body"; original.textContent = m.message;
      const replies = document.createElement("div"); replies.className = "support-replies stack";
      const form = document.createElement("form"); form.className = "support-reply-form";
      const input = document.createElement("textarea"); input.required = true; input.maxLength = 4000; input.rows = 2; input.placeholder = "Write a follow-up message…";
      const send = document.createElement("button"); send.type = "submit"; send.className = "primary"; send.textContent = "Send follow-up";
      form.append(input, send);
      form.addEventListener("submit", async (event) => {
        event.preventDefault(); send.disabled = true;
        try {
          await api("/api/support/replies", { method: "POST", body: JSON.stringify({ support_message_id: m.id, sender_role: "user", message: input.value.trim() }) });
          input.value = ""; await renderSupportReplies(m.id, replies, "user");
        } catch (error) { window.alert(error.message); }
        finally { send.disabled = false; }
      });
      card.append(head, date, original, replies, form); host.append(card);
      renderSupportReplies(m.id, replies, "user");
    });
  } catch (error) { host.textContent = "Could not load your messages: " + error.message; }
}
$("support-own-refresh").addEventListener("click", loadMySupportMessages);


async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("content-type", "application/json");
  if (session?.access_token) headers.set("authorization", `Bearer ${session.access_token}`);
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || `Request failed (${response.status})`);
  return data;
}

function showMessage(message, isError = true) {
  $("auth-message").textContent = message;
  $("auth-message").style.color = isError ? "#a33b32" : "#26734d";
}

function setMode(nextMode) {
  mode = nextMode;
  $("login-tab").classList.toggle("active", mode === "signin");
  $("signup-tab").classList.toggle("active", mode === "signup");
  $("submit-auth").textContent = mode === "signin" ? "Sign in" : "Create account";
  $("password").autocomplete = mode === "signin" ? "current-password" : "new-password";
  $("password").minLength = mode === "signup" ? 12 : 8;
  $("password").title = mode === "signup"
    ? "At least 12 characters with uppercase, lowercase, a number and a symbol."
    : "Enter your account password.";
  $("signup-details").classList.toggle("hidden", mode !== "signup");
  ["signup-owner","signup-business","signup-phone","signup-country","signup-region","signup-district","signup-address"].forEach((id) => {
    const field = $(id);
    field.required = mode === "signup";
    field.disabled = mode !== "signup";
  });
  showMessage("");
}

function saveSession(value) {
  session = value;
  if (value) sessionStorage.setItem("eamwifi_session", JSON.stringify(value));
  else sessionStorage.removeItem("eamwifi_session");
}

const PLATFORM_PHONE = "0613794448";
function createRouterPaymentNotice(router) {
  const raw = router.router_subscriptions;
  const sub = Array.isArray(raw) ? raw[0] : raw;
  const now = Date.now();
  const paid = sub && sub.status === "active" && sub.expires_at && new Date(sub.expires_at).getTime() > now;
  if (paid) return null;
  const trialExpiry = sub && sub.trial_expires_at ? new Date(sub.trial_expires_at).getTime() : 0;
  const trialStarted = Boolean(sub && sub.trial_started_at);
  const trialRunning = trialExpiry > now;
  const panel = document.createElement("div");
  panel.className = "router-payment-notice";
  panel.style.cssText = "margin:10px 0;padding:14px;border:1px solid #e4a63b;border-radius:12px;background:#fff8e8;color:#5c3b08";
  const heading = document.createElement("strong");
  heading.textContent = trialRunning ? "Router trial is running · Jaribio linaendelea" : trialStarted ? "Trial ended · Muda wa majaribio umeisha" : "5-minute router test · Jaribio la dakika 5";
  const detail = document.createElement("p");
  detail.textContent = trialRunning ? "Una muda wa kujaribu muunganisho. Baada ya hapo router itafungwa mpaka malipo yathibitishwe." : trialStarted ? "Router imefungwa. Lipa TSh 7,500/= kisha piga simu au tuma SMS kwa Super Admin." : "Dakika 5 za majaribio zitaanza router itakapounganishwa kwa mara ya kwanza. Baada ya hapo lipa TSh 7,500/= kwa router.";
  const price = document.createElement("strong"); price.textContent = "LIPA TSh 7,500/= kwa router";
  const phone = document.createElement("p"); phone.textContent = "Namba ya malipo: " + PLATFORM_PHONE + " · Piga simu au tuma SMS kuthibitisha malipo.";
  const actions = document.createElement("div"); actions.style.cssText = "display:flex;gap:14px;flex-wrap:wrap";
  const call = document.createElement("a"); call.href = "tel:" + PLATFORM_PHONE; call.textContent = "Piga simu";
  const sms = document.createElement("a"); sms.href = "sms:" + PLATFORM_PHONE + "?body=" + encodeURIComponent("Nimelipia EAM-WIFI TSh 7,500 kwa router ID " + router.id + ". Tafadhali thibitisha malipo."); sms.textContent = "Tuma SMS";
  actions.append(call, sms);
  const timer = document.createElement("small");
  if (trialRunning) { timer.dataset.trialExpires = String(trialExpiry); panel.append(heading, detail, timer, price, phone, actions); }
  else panel.append(heading, detail, price, phone, actions);
  return panel;
}
setInterval(() => {
  document.querySelectorAll("[data-trial-expires]").forEach((node) => {
    const seconds = Math.max(0, Math.ceil((Number(node.dataset.trialExpires) - Date.now()) / 1000));
    node.textContent = seconds > 0 ? "Muda uliobaki: " + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") : "Muda wa majaribio umeisha. Lipa ili kuendelea.";
  });
}, 1000);
function setPlatformCallNotice(element, message) {
  element.replaceChildren();
  const text = document.createElement("p");
  text.textContent = message + " Contact the Super Admin using the saved support number.";
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:14px;flex-wrap:wrap;margin-top:8px";
  const call = document.createElement("a");
  call.href = "tel:" + PLATFORM_PHONE;
  call.textContent = "Piga simu · Call";
  call.className = "portal-link";
  const sms = document.createElement("a");
  sms.href = "sms:" + PLATFORM_PHONE + "?body=" + encodeURIComponent("Habari Super Admin, nimejisajili EAM-WIFI. Tafadhali nisaidie kuhusu idhini ya akaunti yangu.");
  sms.textContent = "Tuma SMS";
  sms.className = "portal-link";
  const waNumber = PLATFORM_PHONE.replace(/\\D/g, "").replace(/^0/, "255");
  const whatsapp = document.createElement("a");
  whatsapp.href = "https://wa.me/" + waNumber + "?text=" + encodeURIComponent("Habari Super Admin, nimejisajili EAM-WIFI. Tafadhali nisaidie kuhusu idhini ya akaunti yangu.");
  whatsapp.target = "_blank";
  whatsapp.rel = "noopener noreferrer";
  whatsapp.textContent = "WhatsApp";
  whatsapp.className = "portal-link";
  actions.append(call, sms, whatsapp);
  element.append(text, actions);
}

const ADMIN_PENDING_KEY = "eamwifi_admin_pending_ids_v1";
let adminPendingPollTimer = null;
let adminNotificationPrimed = false;

function updateAdminPendingNotifications(accounts) {
  const pending = (Array.isArray(accounts) ? accounts : []).filter(account => account.status !== "active");
  const ids = pending.map(account => String(account.id)).filter(Boolean);
  const current = new Set(ids);
  let previous = [];
  try { previous = JSON.parse(localStorage.getItem(ADMIN_PENDING_KEY) || "[]"); } catch { previous = []; }
  if (!adminNotificationPrimed) {
    if (!localStorage.getItem(ADMIN_PENDING_KEY)) localStorage.setItem(ADMIN_PENDING_KEY, JSON.stringify(ids));
    adminNotificationPrimed = true;
  } else {
    const previousSet = new Set(previous);
    const fresh = pending.filter(account => !previousSet.has(String(account.id)));
    if (fresh.length && "Notification" in window && Notification.permission === "granted") {
      fresh.forEach(account => {
        const notice = new Notification("EAM-WIFI: Usajili mpya unasubiri idhini", {
          body: (account.name || "Biashara mpya") + " · " + (account.contact_phone || "Hakuna simu") + " — fungua Dashboard kuidhinisha.",
          tag: "eamwifi-registration-" + account.id
        });
        notice.onclick = () => { window.focus(); notice.close(); };
      });
    }
    localStorage.setItem(ADMIN_PENDING_KEY, JSON.stringify([...new Set([...previous, ...ids])]));
  }
  const count = document.getElementById("admin-pending-count");
  if (count) count.textContent = String(pending.length);
  const status = document.getElementById("admin-notification-status");
  if (status && "Notification" in window) {
    status.textContent = Notification.permission === "granted"
      ? "Arifa za simu zimewashwa. Acha dashboard/browser ikiwa wazi ili ipokee taarifa."
      : Notification.permission === "denied"
        ? "Arifa zimezuiwa kwenye browser. Ruhusu notifications kwenye mipangilio ya browser."
        : "Washa ruhusa ya notifications ili upokee taarifa mpya kwenye simu.";
  }
}

async function enableAdminPhoneNotifications() {
  const status = document.getElementById("admin-notification-status");
  if (!("Notification" in window)) {
    if (status) status.textContent = "Browser hii haitumii notifications. Tumia Chrome ya simu.";
    return;
  }
  const permission = await Notification.requestPermission();
  if (status) status.textContent = permission === "granted"
    ? "Arifa zimewashwa. Dashboard/browser inahitaji kubaki wazi ili ipokee taarifa."
    : "Hukuruhusu notifications. Badilisha ruhusa kwenye mipangilio ya browser.";
  if (permission === "granted") {
    const button = document.getElementById("enable-admin-notifications");
    if (button) button.textContent = "Arifa zimewashwa · Notifications enabled";
  }
};

$("enable-admin-notifications").addEventListener("click", enableAdminPhoneNotifications);

function startAdminPendingPolling() {
  if (adminPendingPollTimer) clearInterval(adminPendingPollTimer);
  adminPendingPollTimer = setInterval(async () => {
    if (!session?.access_token || !document.getElementById("platform-admin") || document.getElementById("platform-admin").classList.contains("hidden")) return;
    try { await loadPlatformAccounts(); } catch { /* Keep the dashboard usable if polling is temporarily offline. */ }
  }, 30000);
}

async function refreshRouterPaymentNotices() {
  const hosts = Array.from(document.querySelectorAll("[data-router-payment-host]"));
  const orgIds = [...new Set(hosts.map((host) => host.dataset.organizationId).filter(Boolean))];
  for (const orgId of orgIds) {
    try {
      const routers = await api("/api/routers?organization_id=" + encodeURIComponent(orgId));
      hosts.filter((host) => host.dataset.organizationId === orgId).forEach((host) => {
        const router = routers.find((item) => item.id === host.dataset.routerPaymentHost);
        if (!router) return;
        host.replaceChildren();
        const notice = createRouterPaymentNotice(router);
        if (notice) { host.append(notice); host.hidden = false; } else host.hidden = true;
      });
    } catch (error) { /* Retain the last known payment notice when refresh fails. */ }
  }
}
let routerPaymentRefreshTimer = null;
function startRouterPaymentRefresh() {
  if (routerPaymentRefreshTimer) clearInterval(routerPaymentRefreshTimer);
  routerPaymentRefreshTimer = setInterval(refreshRouterPaymentNotices, 15000);
}
function decodeAccessTokenClaims(token) {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return {};
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
  } catch { return {}; }
}

function showAdminMfaGate({ mode, factorId, qrCode, secret, message = "" }) {
  let host = $("security-gate");
  if (!host) {
    host = document.createElement("section");
    host.id = "security-gate";
    host.className = "panel";
    $("auth-panel").parentNode.insertBefore(host, $("auth-panel"));
  }
  ["welcome-guide","auth-panel","business-onboarding","dashboard","platform-admin","chat-panel"].forEach((id) => {
    const node = $(id);
    if (node) node.classList.add("hidden");
  });
  host.classList.remove("hidden");
  host.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = mode === "enroll" ? "Protect your Super Admin account" : mode === "error" ? "Security setup needs attention" : "Super Admin verification";
  const intro = document.createElement("p");
  intro.className = "muted";
  intro.textContent = mode === "enroll"
    ? "Scan this QR code using Google Authenticator, Microsoft Authenticator or another TOTP app. Keep the secret private."
    : "Enter the current six-digit code from your authenticator app. The Super Admin dashboard stays locked until verification succeeds.";
  host.append(heading, intro);

  if (qrCode) {
    const image = document.createElement("img");
    image.alt = "Authenticator enrollment QR code";
    image.style.cssText = "display:block;width:220px;max-width:100%;height:auto;margin:12px auto;background:#fff;padding:12px;border-radius:10px";
    image.src = qrCode.startsWith("data:") ? qrCode : "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrCode);
    host.append(image);
  }
  if (secret) {
    const label = document.createElement("p");
    label.textContent = "Manual setup key (keep private):";
    const key = document.createElement("code");
    key.style.cssText = "display:block;overflow-wrap:anywhere;padding:10px;background:#eef2f8;border-radius:8px";
    key.textContent = secret;
    host.append(label, key);
  }

  const form = document.createElement("form");
  form.className = "stack";
  const label = document.createElement("label");
  label.textContent = "Six-digit authenticator code";
  const code = document.createElement("input");
  code.type = "text";
  code.inputMode = "numeric";
  code.autocomplete = "one-time-code";
  code.pattern = "[0-9]{6}";
  code.maxLength = 6;
  code.minLength = 6;
  code.required = true;
  code.placeholder = "000000";
  code.setAttribute("aria-label", "Six-digit authenticator code");
  label.append(code);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = mode === "enroll" ? "Enable two-step protection" : "Verify and open Super Admin";
  const status = document.createElement("p");
  status.className = "message";
  status.setAttribute("role", "status");
  status.textContent = message;
  const signout = document.createElement("button");
  signout.type = "button";
  signout.className = "secondary";
  signout.textContent = "Sign out";
  signout.addEventListener("click", signOut);
  form.append(label, submit);
  if (mode === "error") form.hidden = true;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = code.value.trim();
    if (!/^\d{6}$/.test(value)) {
      status.textContent = "Enter all six digits.";
      return;
    }
    submit.disabled = true;
    status.textContent = "Checking your authenticator code…";
    try {
      const challenge = await api("/api/auth/mfa/challenge", {
        method: "POST", body: JSON.stringify({ factor_id: factorId })
      });
      const verified = await api("/api/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ factor_id: factorId, challenge_id: challenge.id, code: value })
      });
      const nextSession = verified.session || verified;
      if (!nextSession.access_token) throw new Error("Supabase did not return an upgraded secure session. Try again.");
      if (decodeAccessTokenClaims(nextSession.access_token).aal !== "aal2") {
        throw new Error("Two-step verification was not confirmed by Supabase. Access remains locked.");
      }
      saveSession({ ...session, ...nextSession });
      host.classList.add("hidden");
      await loadWorkspace();
    } catch (error) {
      status.textContent = error.message;
      status.style.color = "#a33b32";
      submit.disabled = false;
      code.focus();
    }
  });
  host.append(form, status);
  if (mode === "error") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "primary";
    retry.textContent = "Retry security setup";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      await loadWorkspace();
      retry.disabled = false;
    });
    host.append(retry);
  }
  host.append(signout);
  host.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function ensurePlatformAdminMfa(user) {
  if (String(user?.email || "").toLowerCase() !== "mwalimueckson2104@gmail.com") return true;
  const claims = decodeAccessTokenClaims(session?.access_token);
  if (claims.aal === "aal2") return true;
  try {
    const result = await api("/api/auth/mfa/factors");
    const factors = Array.isArray(result) ? result :
      Array.isArray(result.factors) ? result.factors :
      [...(Array.isArray(result.totp) ? result.totp : []), ...(Array.isArray(result.phone) ? result.phone : [])];
    const verified = factors.find((factor) => (factor.factor_type === "totp" || factor.type === "totp") && factor.status === "verified");
    if (verified) {
      showAdminMfaGate({ mode: "challenge", factorId: verified.id });
      return false;
    }
    for (const factor of factors.filter((item) => item.status === "unverified")) {
      await api("/api/auth/mfa/factors/" + encodeURIComponent(factor.id), { method: "DELETE" });
    }
    const enrollment = await api("/api/auth/mfa/enroll", { method: "POST", body: JSON.stringify({}) });
    const factorId = enrollment.id || enrollment.factor?.id;
    const qrCode = enrollment.totp?.qr_code || enrollment.totp?.qrCode || "";
    const secret = enrollment.totp?.secret || "";
    if (!factorId || !qrCode) throw new Error("Supabase did not return the authenticator QR code.");
    showAdminMfaGate({ mode: "enroll", factorId, qrCode, secret });
    return false;
  } catch (error) {
    showAdminMfaGate({ mode: "error", factorId: "", message: "Security setup could not continue: " + error.message + " Sign out and retry, or contact support." });
    return false;
  }
}

async function loadWorkspace() {
  const user = await api("/api/auth/user");
  if (!(await ensurePlatformAdminMfa(user))) return;
  const memberships = await api("/api/organizations");
  startRouterPaymentRefresh();
  if (window.EAMChat) await window.EAMChat.start(user, memberships);
  const profile = user.user_metadata || {};
  const prefill = (name, value) => {
    const field = $("business-form")?.elements.namedItem(name);
    if (field && value && !field.value) field.value = value;
  };
  prefill("owner_name", profile.full_name);
  prefill("business_name", profile.business_name);
  prefill("contact_phone", profile.contact_phone);
  prefill("country_code", profile.country_code || "TZ");
  prefill("site_address", [profile.business_address, profile.district, profile.region].filter(Boolean).join(", "));
  if (profile.business_name) prefill("site_name", profile.business_name + " Hotspot");
  $("auth-panel").classList.add("hidden");
  const isPlatformAdmin = (user.email || "").toLowerCase() === "mwalimueckson2104@gmail.com";
  const ownsBusiness = memberships.some((membership) => membership.role === "owner" && membership.status === "active");
  $("admin-open-business").classList.toggle("hidden", !(isPlatformAdmin && ownsBusiness));
  $("business-back-admin").classList.toggle("hidden", !isPlatformAdmin);
  $("onboarding-back-admin").classList.toggle("hidden", !isPlatformAdmin);
  $("platform-admin").classList.toggle("hidden", !isPlatformAdmin);
  if (isPlatformAdmin) {
    await Promise.all([loadPlatformStats(), loadPlatformHealth(), loadPlatformAccounts(), loadPlatformRouters(), loadSupportInbox()]);
    startAdminPendingPolling();
  }
  await loadMySupportMessages();
  if (!memberships.length) {
    $("dashboard").classList.add("hidden");
    $("business-onboarding").classList.toggle("hidden", isPlatformAdmin);
    return;
  }
  $("business-onboarding").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  if (isPlatformAdmin) $("dashboard").classList.add("hidden");
  $("welcome").textContent = memberships.find((membership) => membership.role === "owner")?.organization?.name || "Your Wi-Fi business";
  const notice = $("subscription-notice");
  notice.classList.add("hidden");
  const host = $("organizations");
  host.replaceChildren();
  $("packages").innerHTML = '<p class="muted">Choose an organization to view packages.</p>';
  memberships.forEach(async (membership) => {
    const card = document.createElement("div");
    card.className = "item";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = membership.organization?.name || `Organization ${membership.organization_id}`;
    const meta = document.createElement("small");
    const orgStatus = membership.organization?.status || "unknown";
    meta.textContent = `Role: ${membership.role} · Membership: ${membership.status} · Business: ${orgStatus}`;
    if (membership.role === "owner" || membership.role === "admin") notice.classList.add("hidden");
    info.append(name, meta);
    let routers = [];
    try {
      routers = await api(`/api/routers?organization_id=${encodeURIComponent(membership.organization_id)}`);
      const routerInfo = document.createElement("small");
      if (!routers.length) {
        routerInfo.textContent = "Router: not registered";
      } else {
        routerInfo.textContent = "Router: " + routers.map((router) => {
          const fresh = router.last_seen_at && Date.now() - new Date(router.last_seen_at).getTime() < 120000;
          const state = router.connection_status === "online" && fresh ? "ONLINE" :
            router.connection_status === "pairing_pending" ? "PAIRING PENDING" :
            router.connection_status === "online" ? "STALE HEARTBEAT" : String(router.connection_status || "UNKNOWN").toUpperCase();
          return (router.name || router.model || router.vendor || "MikroTik") + " — " + state;
        }).join(" | ");
      }
      info.append(routerInfo);
      if (membership.role === "owner" || membership.role === "admin") {
        routers.forEach((router) => {
          const noticeHost = document.createElement("div");
          noticeHost.dataset.routerPaymentHost = router.id;
          noticeHost.dataset.organizationId = membership.organization_id;
          const notice = createRouterPaymentNotice(router);
          if (notice) noticeHost.append(notice); else noticeHost.hidden = true;
          info.append(noticeHost);
        });
      }
      if (membership.role === "owner" || membership.role === "admin") {
        const routerSubscriptions = routers.map((router) => {
          const raw = router.router_subscriptions;
          const sub = Array.isArray(raw) ? raw[0] : raw;
          const state = sub?.status === "active" && sub.expires_at && new Date(sub.expires_at) > new Date()
            ? "ACTIVE" : (sub?.status === "active" ? "EXPIRED" : String(sub?.status || "PENDING").toUpperCase());
          return `${router.name || "Router"}: ${state} · TSh 7,500/month`;
        });
        if (routerSubscriptions.length) {
          const billing = document.createElement("small");
          billing.textContent = "Router subscriptions: " + routerSubscriptions.join(" | ");
          info.append(billing);
        }
        const addRouterButton = document.createElement("button");
        addRouterButton.type = "button";
        addRouterButton.className = "secondary";
        addRouterButton.textContent = "＋ Add New Router · Ongeza router";
        const addRouterForm = document.createElement("form");
        addRouterForm.className = "package-form";
        addRouterForm.hidden = true;
        addRouterForm.innerHTML = `
          <label>Hotspot/site name<input name="site_name" required minlength="2" maxlength="100" placeholder="Branch or location name"></label>
          <label>Site address<input name="site_address" maxlength="200" placeholder="Optional address"></label>
          <label>Router name<input name="router_name" required minlength="2" maxlength="100" placeholder="Router 2"></label>
          <label>Router brand<select name="router_vendor"><option value="mikrotik">MikroTik</option><option value="ubiquiti">Ubiquiti</option><option value="tp_link">TP-Link</option><option value="huawei">Huawei</option><option value="other">Other</option></select></label>
          <label>Router model<input name="router_model" maxlength="100" placeholder="Optional model"></label>
          <div class="package-form-actions"><button class="primary" type="submit">Register router</button><small class="muted" data-feedback>Each router costs TSh 7,500 per month. A 5-minute test starts when the router first connects.</small></div>
        `;
        addRouterButton.addEventListener("click", () => { addRouterForm.hidden = !addRouterForm.hidden; });
        addRouterForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const submit = addRouterForm.querySelector('button[type="submit"]');
          const feedback = addRouterForm.querySelector("[data-feedback]");
          submit.disabled = true; feedback.textContent = "Registering router…";
          try {
            const form = addRouterForm.elements;
            const created = await api("/api/routers", { method: "POST", body: JSON.stringify({
              organization_id: membership.organization_id, site_name: form.site_name.value.trim(),
              site_address: form.site_address.value.trim(), router_name: form.router_name.value.trim(),
              router_vendor: form.router_vendor.value, router_model: form.router_model.value.trim(),
              integration_type: form.router_vendor.value === "mikrotik" ? "mikrotik_hotspot" : "other"
            }) });
            feedback.textContent = `Router registered. Connect it to start the 5-minute test. After the test: TSh 7,500/month. Router ID: ${created.device_id}`;
            addRouterForm.reset();
            await loadWorkspace();
          } catch (error) { feedback.textContent = error.message; submit.disabled = false; }
        });
        info.append(addRouterButton, addRouterForm);
      }
    } catch (error) {
      const routerInfo = document.createElement("small");
      routerInfo.textContent = "Router status unavailable: " + error.message;
      info.append(routerInfo);
    }
    if (membership.role === "owner" || membership.role === "admin") {
      const portalLinks = document.createElement("div"); portalLinks.className = "stack";
      routers.forEach((router) => {
        const raw = router.site; const site = Array.isArray(raw) ? raw[0] : raw;
        if (!site?.slug) return;
        const portalLink = document.createElement("a");
        portalLink.href = `/portal?site=${encodeURIComponent(site.slug)}`;
        portalLink.target = "_blank"; portalLink.rel = "noopener";
        portalLink.textContent = `Open customer Wi-Fi portal · ${site.name || router.name || "Router"}`;
        portalLink.className = "portal-link"; portalLinks.append(portalLink);
      });
      if (!portalLinks.childElementCount && membership.organization?.slug) {
        const portalLink = document.createElement("a"); portalLink.href = `/portal?site=${encodeURIComponent(membership.organization.slug)}`;
        portalLink.target = "_blank"; portalLink.rel = "noopener"; portalLink.textContent = "Open customer Wi-Fi portal";
        portalLink.className = "portal-link"; portalLinks.append(portalLink);
      }
      info.append(portalLinks);
    }
    if (membership.role === "owner" || membership.role === "admin") {
      const pairRouterSelect = document.createElement("select");
      pairRouterSelect.setAttribute("aria-label", "Choose the MikroTik router to pair");
      const pairPrompt = document.createElement("option"); pairPrompt.value = ""; pairPrompt.textContent = "Choose MikroTik router to connect";
      pairRouterSelect.append(pairPrompt);
      routers.filter((router) => String(router.vendor || "").toLowerCase() === "mikrotik").forEach((router) => {
        const raw = router.site; const site = Array.isArray(raw) ? raw[0] : raw;
        const option = document.createElement("option"); option.value = router.id;
        option.textContent = `${router.name || "MikroTik"} · ${site?.name || "Hotspot"}`; pairRouterSelect.append(option);
      });
      const pairButton = document.createElement("button");
      pairButton.type = "button";
      pairButton.className = "secondary";
      pairButton.textContent = "Connect selected MikroTik router · Unganisha router";
      pairButton.disabled = pairRouterSelect.options.length < 2;
      const setupPanel = document.createElement("div");
      setupPanel.className = "form-note hidden";
      pairButton.addEventListener("click", async () => {
        if (!pairRouterSelect.value) {
          setupPanel.classList.remove("hidden");
          setupPanel.textContent = "Choose the MikroTik router you want to connect first.";
          return;
        }
        pairButton.disabled = true;
        pairButton.textContent = "Preparing secure pairing…";
        setupPanel.classList.remove("hidden");
        setupPanel.textContent = "Generating a one-time router credential…";
        try {
          const pairing = await api("/api/router/pair", {
            method: "POST",
            body: JSON.stringify({ device_id: pairRouterSelect.value })
          });
          if (!pairing.installer_script) throw new Error("The configured router installer was not returned.");
          const installerBlob = new Blob([pairing.installer_script], { type: "text/plain" });
          const installerUrl = URL.createObjectURL(installerBlob);
          const importCommand = "/import file-name=eam-wifi-agent.rsc";
          setupPanel.replaceChildren();
          const title = document.createElement("strong");
          title.textContent = "Secure MikroTik pairing is ready";
          const warning = document.createElement("p");
          warning.textContent = "This configured installer contains your one-time router credential. Download it now and keep it private. The initial pairing window ends at " + new Date(pairing.expires_at).toLocaleString() + ".";
          const download = document.createElement("a");
          download.href = installerUrl;
          download.download = "eam-wifi-agent.rsc";
          download.className = "portal-link";
          download.textContent = "Download your configured MikroTik installer";
          const command = document.createElement("textarea");
          command.readOnly = true; command.rows = 2; command.value = importCommand;
          const copy = document.createElement("button");
          copy.type = "button"; copy.className = "secondary"; copy.textContent = "Copy import command";
          copy.addEventListener("click", async () => {
            try { await navigator.clipboard.writeText(importCommand); copy.textContent = "Copied"; }
            catch { command.focus(); command.select(); copy.textContent = "Select and copy command"; }
          });
          const details = document.createElement("p");
          details.textContent = "Open Winbox or WebFig, upload the downloaded file into Files, then open Terminal and run the import command above. The router must already have working ISP internet, DNS, DHCP and a Hotspot server. The installer creates an agent and a 15-second scheduler; it does not configure the ISP/Wi-Fi/Hotspot itself. Allow outbound HTTPS port 443 and the EAM-WIFI walled garden. Configure Hotspot login-by=http-pap or HTTPS with a valid router certificate. Exclude Hotspot users from FastTrack so rate limits work. Never expose RouterOS API or Winbox to the public internet.";
          const portalTitle = document.createElement("strong");
          portalTitle.textContent = "Captive portal redirect for login.html";
          const selectedRouter = routers.find((router) => router.id === pairRouterSelect.value);
          const selectedSiteRaw = selectedRouter?.site;
          const selectedSite = Array.isArray(selectedSiteRaw) ? selectedSiteRaw[0] : selectedSiteRaw;
          const slug = selectedSite?.slug || membership.organization?.slug || "";
          const portalSnippet = `<script>
const portal = new URL("https://wifi.eckson.workers.dev/portal");
portal.searchParams.set("site", "${slug}");
portal.searchParams.set("mac", "$(mac)");
portal.searchParams.set("link-login-only", "$(link-login-only)");
portal.searchParams.set("link-orig", "$(link-orig)");
window.location.replace(portal.toString());
</script>`;
          const portalCode = document.createElement("textarea");
          portalCode.readOnly = true; portalCode.rows = 8; portalCode.value = portalSnippet;
          const copyPortal = document.createElement("button");
          copyPortal.type = "button"; copyPortal.className = "secondary"; copyPortal.textContent = "Copy captive portal redirect";
          copyPortal.addEventListener("click", async () => {
            try { await navigator.clipboard.writeText(portalSnippet); copyPortal.textContent = "Copied"; }
            catch { portalCode.focus(); portalCode.select(); copyPortal.textContent = "Select and copy snippet"; }
          });
          const gardenTitle = document.createElement("strong");
          gardenTitle.textContent = "Allow the portal before Wi-Fi login";
          const gardenCode = document.createElement("textarea");
          gardenCode.readOnly = true; gardenCode.rows = 2;
          gardenCode.value = "/ip hotspot walled-garden add dst-host=wifi.eckson.workers.dev action=allow";
          const copyGarden = document.createElement("button");
          copyGarden.type = "button"; copyGarden.className = "secondary"; copyGarden.textContent = "Copy walled-garden command";
          copyGarden.addEventListener("click", async () => {
            try { await navigator.clipboard.writeText(gardenCode.value); copyGarden.textContent = "Copied"; }
            catch { gardenCode.focus(); gardenCode.select(); copyGarden.textContent = "Select and copy command"; }
          });
          setupPanel.append(title, warning, download, command, copy, details, portalTitle, portalCode, copyPortal, gardenTitle, gardenCode, copyGarden);
          pairButton.textContent = "Generate a new pairing token";
        } catch (error) {
          setupPanel.textContent = "Pairing failed: " + error.message;
          pairButton.textContent = "Retry router pairing";
        } finally { pairButton.disabled = false; }
      });
      card.append(pairRouterSelect, pairButton, setupPanel);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "View packages";
    button.disabled = orgStatus !== "active";
    if (orgStatus !== "active") button.title = "Your business is awaiting platform approval.";
    button.addEventListener("click", () => loadPackages(membership.organization_id, membership.role));
    card.append(info, button);
    host.append(card);
  });
}

async function loadPlatformStats() {
  const ids = ["stat-businesses","stat-active","stat-pending","stat-sites","stat-routers","stat-customers","stat-vouchers","stat-sessions","stat-month-revenue","stat-total-revenue"];
  try {
    const stats = await api("/api/platform/admin/dashboard");
    const number = (value) => Number(value || 0).toLocaleString();
    $("stat-businesses").textContent = number(stats.businesses_total);
    $("stat-active").textContent = number(stats.businesses_active);
    $("stat-pending").textContent = number(stats.businesses_pending);
    $("stat-sites").textContent = number(stats.hotspot_sites);
    $("stat-routers").textContent = number(stats.routers_online) + " / " + number(stats.routers_total);
    $("stat-customers").textContent = number(stats.customers_total);
    $("stat-vouchers").textContent = number(stats.vouchers_total);
    $("stat-sessions").textContent = number(stats.sessions_active);
    $("stat-month-revenue").textContent = "TZS " + number(stats.payments_month_tzs);
    $("stat-total-revenue").textContent = "TZS " + number(stats.payments_total_tzs);
    const setBar = (id, value, max) => {
      const node = $(id);
      if (node) node.style.width = (max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0) + "%";
    };
    $("chart-active-label").textContent = number(stats.businesses_active);
    $("chart-pending-label").textContent = number(stats.businesses_pending);
    $("chart-active-value").textContent = number(stats.businesses_active);
    $("chart-pending-value").textContent = number(stats.businesses_pending);
    $("business-donut-total").textContent = number(stats.businesses_total);
    const businessTotal = Number(stats.businesses_total || 0);
    const activeShare = businessTotal ? Number(stats.businesses_active || 0) / businessTotal * 100 : 0;
    $("business-donut").style.setProperty("--active-share", activeShare + "%");
    $("router-donut-total").textContent = number(stats.routers_total);
    $("router-online-legend").textContent = number(stats.routers_online);
    $("router-offline-legend").textContent = number(Math.max(0, Number(stats.routers_total || 0) - Number(stats.routers_online || 0)));
    const routerTotal = Number(stats.routers_total || 0);
    const routerShare = routerTotal ? Number(stats.routers_online || 0) / routerTotal * 100 : 0;
    $("router-donut").style.setProperty("--active-share", routerShare + "%");
    $("chart-routers-label").textContent = number(stats.routers_online) + " / " + number(stats.routers_total);
    $("chart-sessions-label").textContent = number(stats.sessions_active);
    $("chart-customers-label").textContent = number(stats.customers_total);
    setBar("chart-active-bar", Number(stats.businesses_active || 0), Number(stats.businesses_total || 0));
    setBar("chart-pending-bar", Number(stats.businesses_pending || 0), Number(stats.businesses_total || 0));
    setBar("chart-routers-bar", Number(stats.routers_online || 0), Number(stats.routers_total || 0));
    const networkMax = Math.max(Number(stats.sessions_active || 0), Number(stats.customers_total || 0), 1);
    setBar("chart-sessions-bar", Number(stats.sessions_active || 0), networkMax);
    setBar("chart-customers-bar", Number(stats.customers_total || 0), networkMax);
  } catch (error) {
    ids.forEach((id) => { if ($(id)) $(id).textContent = "Unavailable"; });
    $("platform-admin-message").textContent = "Dashboard data could not load: " + error.message;
  }
}

async function loadPlatformHealth() {
  const host = $("platform-health");
  if (!host) return;
  host.textContent = "Checking routers, vouchers, sessions and support…";
  try {
    const s = await api("/api/platform/admin/health");
    const number = (value) => Number(value || 0).toLocaleString();
    const items = [
      ["Businesses active / pending", number(s.businesses_active) + " / " + number(s.businesses_pending)],
      ["Routers online / total", number(s.routers_online) + " / " + number(s.routers_total)],
      ["Router heartbeat stale", number(s.routers_stale)],
      ["Routers offline / error", number(s.routers_offline)],
      ["Routers not paired", number(s.routers_not_configured)],
      ["Router events pending / processing", number(s.router_events_pending) + " / " + number(s.router_events_processing)],
      ["Router events failed", number(s.router_events_failed)],
      ["Customer sessions queued / active", number(s.sessions_queued) + " / " + number(s.sessions_active)],
      ["Sessions expired / blocked", number(s.sessions_expired) + " / " + number(s.sessions_blocked)],
      ["Vouchers unused / redeemed", number(s.vouchers_unused) + " / " + number(s.vouchers_redeemed)],
      ["Router subscriptions active / pending", number(s.subscriptions_active) + " / " + number(s.subscriptions_pending)],
      ["Router subscriptions expired", number(s.subscriptions_expired)],
      ["New support messages", number(s.support_new)]
    ];
    host.replaceChildren();
    items.forEach(([label, value]) => {
      const card = document.createElement("div");
      card.className = "stat-card";
      const title = document.createElement("span"); title.textContent = label;
      const amount = document.createElement("strong"); amount.textContent = value;
      card.append(title, amount); host.append(card);
    });
    $("platform-health-message").textContent = "Last checked: " + new Date(s.checked_at).toLocaleString() + ". Stale heartbeat means no router heartbeat for more than 2 minutes.";
  } catch (error) {
    host.textContent = "System check failed: " + error.message;
    $("platform-health-message").textContent = "Refresh after checking the Worker and Supabase connection.";
  }
}

if ($("health-refresh")) $("health-refresh").addEventListener("click", loadPlatformHealth);

async function loadPlatformAccounts() {
  const host = $("platform-accounts");
  if (!host) return;
  host.textContent = "Loading business accounts…";
  try {
    const accounts = await api("/api/platform/admin/accounts");
    updateAdminPendingNotifications(accounts);
    host.replaceChildren();
    if (!accounts.length) { host.textContent = "No business registrations yet."; return; }
    accounts.forEach((account) => {
      const card = document.createElement("div"); card.className = "item";
      const info = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = account.name;
      const meta = document.createElement("small");
      meta.textContent = `${account.contact_phone || "No phone"} · Business status: ${account.status} · Router subscriptions are billed separately at TSh 7,500/month each.`;
      info.append(name,meta);
      const approve = document.createElement("button"); approve.type="button"; approve.className="secondary";
      approve.textContent = account.status === "active" ? "Business approved" : "Approve business registration";
      approve.disabled = account.status === "active";
      const message = document.createElement("small"); message.className="muted";
      approve.addEventListener("click",async()=>{
        if(!window.confirm(`Approve ${account.name} as an EAM-WIFI business? There is no business registration fee. Each router costs TSh 7,500/month after its 5-minute test.`)) return;
        approve.disabled=true; message.textContent="Approving business…";
        try {
          await api("/api/platform/admin/approve",{method:"POST",body:JSON.stringify({organization_id:account.id,payment_method:"other",payment_reference:null,months:1})});
          message.textContent="Business approved. Now review and approve payment for each router below.";
          await loadPlatformAccounts(); await loadPlatformRouters();
        } catch(error){message.textContent=error.message;approve.disabled=false;}
      });
      card.append(info,approve,message); host.append(card);
    });
  } catch(error) { host.textContent=error.message; }
}
async function loadPlatformRouters() {
  const host = $("platform-routers");
  if (!host) return;
  host.textContent = "Loading router subscriptions…";
  try {
    const routers = await api("/api/platform/admin/routers");
    host.replaceChildren();
    if (!routers.length) { host.textContent = "No routers registered yet."; return; }
    routers.forEach((router) => {
      const card = document.createElement("article"); card.className = "item";
      const info = document.createElement("div");
      const org = Array.isArray(router.organization) ? router.organization[0] : router.organization;
      const site = Array.isArray(router.site) ? router.site[0] : router.site;
      const raw = router.router_subscriptions;
      const sub = Array.isArray(raw) ? raw[0] : raw;
      const name = document.createElement("strong"); name.textContent = `${org?.name || "Business"} — ${router.name || router.model || "Router"}`;
      const meta = document.createElement("small");
      const status = sub?.status === "active" && sub.expires_at && new Date(sub.expires_at) > new Date() ? "ACTIVE" :
        (sub?.status === "active" ? "EXPIRED" : String(sub?.status || "PENDING").toUpperCase());
      const trialState = sub?.trial_expires_at && new Date(sub.trial_expires_at) > new Date()
        ? " · TRIAL until " + new Date(sub.trial_expires_at).toLocaleTimeString()
        : sub?.trial_started_at && status !== "ACTIVE" ? " · TRIAL EXPIRED" : "";
      meta.textContent = `${site?.name || "No site"} · ${router.vendor || "Unknown brand"} · ${org?.contact_phone || "No phone"} · ${status}${trialState} · ${sub?.expires_at ? "Expires " + new Date(sub.expires_at).toLocaleDateString() : "Not yet approved"} · TSh 7,500/month`;
      info.append(name, meta);
      const controls = document.createElement("div"); controls.className = "stack";
      const months = document.createElement("select"); months.setAttribute("aria-label","Router subscription months");
      [1,2,3,6,12,24,36,60].forEach((n) => { const o=document.createElement("option"); o.value=String(n); o.textContent=n===1?"1 month":n+" months"; months.append(o); });
      const method = document.createElement("select");
      [["cash","Cash"],["mobile_money","Mobile money"],["bank_transfer","Bank transfer"],["other","Other"]].forEach(([v,l])=>{const o=document.createElement("option");o.value=v;o.textContent=l;method.append(o);});
      const reference = document.createElement("input"); reference.placeholder="Payment reference (optional)"; reference.maxLength=120;
      const approve = document.createElement("button"); approve.type="button"; approve.className="secondary"; approve.textContent="Approve router payment";
      const message = document.createElement("small"); message.className="muted";
      approve.addEventListener("click",async()=>{
        const n=Number(months.value), total=n*7500;
        if(!window.confirm(`Confirm ${org?.name || "this business"} paid TSh ${total.toLocaleString()} for this router for ${n} month(s)?`)) return;
        approve.disabled=true; message.textContent="Approving router subscription…";
        try {
          const result=await api("/api/platform/admin/approve-router",{method:"POST",body:JSON.stringify({
            device_id:router.id,payment_method:method.value,payment_reference:reference.value.trim()||null,months:n
          })});
          message.textContent="Approved until "+new Date(result.expires_at).toLocaleString();
          await loadPlatformRouters(); await loadPlatformHealth();
        } catch(error){message.textContent=error.message;approve.disabled=false;}
      });
      controls.append(months,method,reference,approve,message); card.append(info,controls); host.append(card);
    });
  } catch(error) { host.textContent=error.message; }
}

async function loadPackages(organizationId, role = "operator") {
  selectedOrganization = organizationId;
  const host = $("packages");
  host.textContent = "Loading packages…";
  const canManage = ["owner", "admin"].includes(role);
  try {
    const packages = await api(`/api/packages?organization_id=${encodeURIComponent(organizationId)}${canManage ? "&include_inactive=true" : ""}`);
    host.replaceChildren();

    if (canManage) {
      const settingsCard = document.createElement("section");
      settingsCard.className = "package-manager stack";
      const settingsHeading = document.createElement("div");
      settingsHeading.innerHTML = "<h3>Customer contact and payment details · Mawasiliano na malipo</h3><p class='muted small'>These details appear on your public Wi-Fi login page. Customers pay your business directly; confirm the payment before issuing their voucher.</p>";
      const settingsForm = document.createElement("form");
      settingsForm.className = "package-form";
      settingsForm.innerHTML = `
        <label>Business contact phone · Simu ya biashara<input name="business_phone" type="tel" minlength="7" maxlength="20" required placeholder="+255..."></label>
        <label>Mobile money payment number · Namba ya malipo<input name="payment_phone" type="tel" minlength="7" maxlength="20" required placeholder="+255..."></label>
        <label class="full-span">Payment instructions · Maelekezo ya malipo<textarea name="payment_instructions" maxlength="500" rows="2" placeholder="Example: Pay the exact package price to this number, then call us with the transaction reference."></textarea></label>
        <div class="package-form-actions"><button class="primary" type="submit">Save customer payment details</button><small data-feedback class="muted"></small></div>
      `;
      settingsHeading.append(settingsForm);
      settingsCard.append(settingsHeading);
      host.append(settingsCard);
      const settingsFeedback = settingsForm.querySelector("[data-feedback]");
      try {
        const rows = await api(`/api/business/settings?organization_id=${encodeURIComponent(organizationId)}`);
        const row = rows[0] || {};
        const org = Array.isArray(row.organization) ? row.organization[0] : row.organization;
        settingsForm.elements.business_phone.value = org?.contact_phone || "";
        settingsForm.elements.payment_phone.value = row.payment_phone || org?.contact_phone || "";
        settingsForm.elements.payment_instructions.value = row.payment_instructions || "";
      } catch (error) {
        settingsFeedback.textContent = "Could not load payment details: " + error.message;
      }
      settingsForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const save = settingsForm.querySelector("button[type=submit]");
        save.disabled = true;
        settingsFeedback.textContent = "Saving…";
        try {
          await api("/api/business/settings", { method: "PATCH", body: JSON.stringify({
            organization_id: organizationId,
            business_phone: settingsForm.elements.business_phone.value.trim(),
            payment_phone: settingsForm.elements.payment_phone.value.trim(),
            payment_instructions: settingsForm.elements.payment_instructions.value.trim()
          }) });
          settingsFeedback.textContent = "Saved. Customers will see the updated numbers on your Wi-Fi portal.";
        } catch (error) {
          settingsFeedback.textContent = error.message;
        } finally { save.disabled = false; }
      });
    }

    if (canManage) {
      const manager = document.createElement("section");
      manager.className = "package-manager stack";
      const heading = document.createElement("div");
      heading.innerHTML = "<h3>Manage your Wi-Fi packages · Simamia vifurushi vyako</h3><p class='muted small'>Create packages for this business only. Other businesses cannot see or edit them.</p>";
      const form = document.createElement("form");
      form.className = "package-form";
      form.innerHTML = `
        <label>Package name · Jina<input name="name" required minlength="2" maxlength="100" placeholder="e.g. 2 Hours"></label>
        <label>Price (TZS) · Bei<input name="price_tzs" type="number" min="0" step="1" required></label>
        <label>Usage duration (hours) · Muda wa matumizi (saa)<input name="duration_hours" type="number" min="0.0003" step="0.01" required value="2"></label>
        <label>Validity (days, connected-time only) · Muda wa mwisho (siku)<input name="validity_days" type="number" min="0.0003" step="0.01" placeholder="e.g. 7"></label>
        <label>Data limit (GB, optional) · Kiasi cha data (GB)<input name="data_gb" type="number" min="0.000001" step="0.01" placeholder="Unlimited if blank"></label>
        <label>Download speed (Mbps, optional) · Kasi ya kupakua<input name="down_mbps" type="number" min="0.000001" step="0.1"></label>
        <label>Upload speed (Mbps, optional) · Kasi ya kupakia<input name="up_mbps" type="number" min="0.000001" step="0.1"></label>
        <label>Maximum devices · Idadi ya vifaa<input name="max_devices" type="number" min="1" max="50" step="1" value="1" required></label>
        <label>Time counting · Namna ya kuhesabu muda<select name="session_mode"><option value="connected_time">Connected time · Muda wa kuunganishwa</option><option value="wall_clock">Wall clock · Muda kuanzia activation</option></select></label>
        <label class="full-span">Description · Maelezo<textarea name="description" maxlength="500" rows="2" placeholder="Optional package details"></textarea></label>
        <div class="package-form-actions"><button class="primary" type="submit">Save package · Hifadhi kifurushi</button><button class="secondary" type="button" data-cancel hidden>Cancel edit · Ghairi</button><small class="muted" data-feedback></small></div>
      `;
      heading.append(form);
      manager.append(heading);
      host.append(manager);

      const feedback = form.querySelector("[data-feedback]");
      const cancel = form.querySelector("[data-cancel]");
      const updateValidityControl = () => {
        const wallClock = form.elements.session_mode.value === "wall_clock";
        form.elements.validity_days.disabled = wallClock;
        if (wallClock) form.elements.validity_days.value = "";
      };
      form.elements.session_mode.addEventListener("change", updateValidityControl);
      let editingId = null;
      const resetForm = () => {
        editingId = null;
        form.reset();
        form.elements.duration_hours.value = "2";
        form.elements.max_devices.value = "1";
        updateValidityControl();
        form.querySelector("button[type=submit]").textContent = "Save package · Hifadhi kifurushi";
        cancel.hidden = true;
        feedback.textContent = "";
      };
      cancel.addEventListener("click", resetForm);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const hours = Number(data.get("duration_hours"));
        const days = Number(data.get("validity_days"));
        const gb = Number(data.get("data_gb"));
        const down = Number(data.get("down_mbps"));
        const up = Number(data.get("up_mbps"));
        const payload = {
          organization_id: organizationId,
          name: String(data.get("name")).trim(),
          price_tzs: Number(data.get("price_tzs")),
          duration_seconds: Math.round(hours * 3600),
          validity_seconds: days > 0 ? Math.round(days * 86400) : null,
          data_limit_bytes: gb > 0 ? Math.round(gb * 1024 ** 3) : null,
          speed_down_kbps: down > 0 ? Math.round(down * 1000) : null,
          speed_up_kbps: up > 0 ? Math.round(up * 1000) : null,
          max_devices: Number(data.get("max_devices")),
          session_mode: data.get("session_mode"),
          description: String(data.get("description") || "").trim() || null
        };
        if (!Number.isFinite(hours) || hours <= 0 || !Number.isSafeInteger(payload.price_tzs) || payload.price_tzs < 0) {
          feedback.textContent = "Enter a valid price and duration.";
          return;
        }
        const save = form.querySelector("button[type=submit]");
        save.disabled = true;
        feedback.textContent = "Saving…";
        try {
          await api(editingId ? `/api/packages?id=${encodeURIComponent(editingId)}` : "/api/packages", {
            method: editingId ? "PATCH" : "POST",
            body: JSON.stringify(payload)
          });
          resetForm();
          feedback.textContent = "Package saved successfully.";
          await loadPackages(organizationId, role);
        } catch (error) {
          feedback.textContent = error.message;
        } finally { save.disabled = false; }
      });

      const listTitle = document.createElement("h3");
      listTitle.textContent = "Your packages · Vifurushi vyako";
      host.append(listTitle);
      packages.forEach((item) => {
        const card = document.createElement("div");
        card.className = "item";
        const info = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = item.name + (item.is_active ? " · Active" : " · Paused");
        const detail = document.createElement("small");
        detail.textContent = `TZS ${Number(item.price_tzs || 0).toLocaleString()} · ${(item.duration_seconds / 3600).toFixed(2)} hours${item.data_limit_bytes ? " · " + (item.data_limit_bytes / 1024 ** 3).toFixed(2) + " GB" : " · Unlimited data"}`;
        info.append(title, detail);
        const actions = document.createElement("div");
        actions.className = "package-actions";
        const edit = document.createElement("button");
        edit.type = "button"; edit.className = "secondary"; edit.textContent = "Edit · Hariri";
        edit.addEventListener("click", () => {
          editingId = item.id;
          form.elements.name.value = item.name || "";
          form.elements.price_tzs.value = item.price_tzs ?? 0;
          form.elements.duration_hours.value = (item.duration_seconds / 3600).toString();
          form.elements.validity_days.value = item.validity_seconds ? (item.validity_seconds / 86400).toString() : "";
          form.elements.data_gb.value = item.data_limit_bytes ? (item.data_limit_bytes / 1024 ** 3).toString() : "";
          form.elements.down_mbps.value = item.speed_down_kbps ? (item.speed_down_kbps / 1000).toString() : "";
          form.elements.up_mbps.value = item.speed_up_kbps ? (item.speed_up_kbps / 1000).toString() : "";
          form.elements.max_devices.value = item.max_devices || 1;
          form.elements.session_mode.value = item.session_mode || "connected_time";
          updateValidityControl();
          form.elements.description.value = item.description || "";
          form.querySelector("button[type=submit]").textContent = "Update package · Sasisha kifurushi";
          cancel.hidden = false;
          form.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        const toggle = document.createElement("button");
        toggle.type = "button"; toggle.className = "secondary";
        toggle.textContent = item.is_active ? "Pause · Sitisha" : "Activate · Washa";
        toggle.addEventListener("click", async () => {
          toggle.disabled = true;
          try {
            await api(`/api/packages?id=${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ organization_id: organizationId, is_active: !item.is_active }) });
            await loadPackages(organizationId, role);
          } catch (error) { window.alert(error.message); toggle.disabled = false; }
        });
        const remove = document.createElement("button");
        remove.type = "button"; remove.className = "secondary"; remove.textContent = "Delete · Futa";
        remove.addEventListener("click", async () => {
          if (!window.confirm("Delete this package only if it has never been used. Historical vouchers and sales are protected. Otherwise pause it instead.")) return;
          remove.disabled = true;
          try {
            await api(`/api/packages?id=${encodeURIComponent(item.id)}`, { method: "DELETE", body: JSON.stringify({ organization_id: organizationId }) });
            await loadPackages(organizationId, role);
          } catch (error) { window.alert("Could not delete this package. It may have voucher or sales history. Pause it instead. " + error.message); remove.disabled = false; }
        });
        actions.append(edit, toggle, remove);
        card.append(info, actions);
        if (item.is_active) appendVoucherIssueControls(card, item, organizationId);
        host.append(card);
      });
      if (!packages.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No packages yet. Create your first package above.";
        host.append(empty);
      }
      return;
    }

    if (!packages.length) {
      host.textContent = "No active packages are available, or your account has no permission to view them.";
      return;
    }
    packages.forEach((item) => {
      const card = document.createElement("div");
      card.className = "item";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.name;
      const detail = document.createElement("small");
      detail.textContent = `TZS ${Number(item.price_tzs || 0).toLocaleString()} · ${(item.duration_seconds / 3600).toFixed(1)} hours`;
      info.append(title, detail);
      card.append(info);
      host.append(card);
    });
  } catch (error) {
    host.textContent = error.message;
  }
}

async function appendVoucherIssueControls(card, item, organizationId) {
  const voucherPanel = document.createElement("div");
  voucherPanel.className = "stack voucher-issue";
  const routerSelect = document.createElement("select");
  routerSelect.setAttribute("aria-label", "Select the paid router for this voucher");
  const routerPrompt = document.createElement("option"); routerPrompt.value = ""; routerPrompt.textContent = "Loading paid routers…"; routerSelect.append(routerPrompt);
  const phone = document.createElement("input");
  phone.type = "tel"; phone.placeholder = "Customer phone (optional)";
  const amount = document.createElement("input");
  amount.type = "number"; amount.min = "1"; amount.step = "1"; amount.value = String(Number(item.price_tzs || 0));
  amount.setAttribute("aria-label", "Amount received in TZS");
  const method = document.createElement("select");
  [["cash","Cash"],["mobile_money","Mobile money"],["bank_transfer","Bank transfer"],["other","Other"]].forEach(([value,label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; method.append(option);
  });
  const reference = document.createElement("input"); reference.maxLength = 120; reference.placeholder = "Payment reference (optional)";
  const issue = document.createElement("button"); issue.type = "button"; issue.className = "secondary"; issue.textContent = "Confirm payment and issue ONE voucher";
  const message = document.createElement("small"); message.className = "muted";
  const code = document.createElement("input"); code.readOnly = true; code.hidden = true; code.className = "voucher-code";
  const copy = document.createElement("button"); copy.type = "button"; copy.className = "secondary"; copy.textContent = "Copy voucher code"; copy.hidden = true;
  copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(code.value); message.textContent = "Voucher copied."; } catch { code.focus(); code.select(); message.textContent = "Select and copy the voucher manually."; } });
  issue.addEventListener("click", async () => {
    const paid = Number(amount.value);
    if (!Number.isSafeInteger(paid) || paid !== Number(item.price_tzs)) { message.textContent = "Enter the exact package price received."; return; }
    if (!routerSelect.value) { message.textContent = "Select a router with an active monthly subscription first."; return; }
    if (!window.confirm("Confirm full payment received? One voucher will be issued.")) return;
    issue.disabled = true; message.textContent = "Issuing voucher…";
    try {
      const result = await api("/api/vouchers/issue-paid", { method: "POST", body: JSON.stringify({ organization_id: organizationId, device_id: routerSelect.value, package_id: item.id, amount_paid: paid, payment_method: method.value, customer_phone: phone.value.trim() || null, payment_reference: reference.value.trim() || null }) });
      if (!result.code || !/^EW[A-F0-9]{24}$/.test(result.code)) throw new Error("No valid voucher code was returned. Contact support before retrying.");
      code.value = result.code; code.hidden = false; copy.hidden = false;
      message.textContent = "Payment recorded. Give this voucher to the customer.";
      phone.value = ""; reference.value = "";
    } catch (error) { message.textContent = error.message; }
    finally { issue.disabled = false; }
  });
  voucherPanel.append(routerSelect, phone, amount, method, reference, issue, message, code, copy);
  card.append(voucherPanel);
  issue.disabled = true;
  try {
    const routers = await api(`/api/routers?organization_id=${encodeURIComponent(organizationId)}`);
    routerSelect.replaceChildren();
    const available = routers.filter((router) => {
      const raw = router.router_subscriptions; const sub = Array.isArray(raw) ? raw[0] : raw;
      return sub?.status === "active" && sub.expires_at && new Date(sub.expires_at) > new Date();
    });
    if (!available.length) {
      const option = document.createElement("option"); option.value = ""; option.textContent = "No router with an active subscription";
      routerSelect.append(option);
      message.textContent = "Voucher issuance is locked for this router until the Super Admin approves its TSh 7,500 monthly payment.";
    } else {
      const prompt = document.createElement("option"); prompt.value = ""; prompt.textContent = "Choose router for this voucher"; routerSelect.append(prompt);
      available.forEach((router) => {
        const raw = router.site; const site = Array.isArray(raw) ? raw[0] : raw;
        const option = document.createElement("option"); option.value = router.id;
        option.textContent = `${router.name || "Router"} · ${site?.name || "Hotspot"}`; routerSelect.append(option);
      });
      issue.disabled = false;
      message.textContent = "Select the router this voucher belongs to. It cannot be redeemed on another router.";
    }
  } catch (error) {
    const option = document.createElement("option"); option.value = ""; option.textContent = "Could not load routers";
    routerSelect.replaceChildren(option); message.textContent = error.message;
  }
}

$("admin-open-business").addEventListener("click", () => {
  $("platform-admin").classList.add("hidden");
  $("business-onboarding").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  $("dashboard").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("business-back-admin").addEventListener("click", async () => {
  $("dashboard").classList.add("hidden");
  $("platform-admin").classList.remove("hidden");
  $("platform-admin").scrollIntoView({ behavior: "smooth", block: "start" });
  await Promise.all([loadPlatformStats(), loadPlatformAccounts(), loadSupportInbox()]);
});

$("onboarding-back-admin").addEventListener("click", async () => {
  $("business-onboarding").classList.add("hidden");
  $("dashboard").classList.add("hidden");
  $("platform-admin").classList.remove("hidden");
  $("platform-admin").scrollIntoView({ behavior: "smooth", block: "start" });
  await Promise.all([loadPlatformStats(), loadPlatformHealth(), loadPlatformAccounts()]);
});

$("admin-register-business").addEventListener("click", () => {
  $("platform-admin").classList.add("hidden");
  $("dashboard").classList.add("hidden");
  $("business-onboarding").classList.remove("hidden");
  $("business-onboarding").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("business-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("business-submit");
  button.disabled = true;
  $("business-message").textContent = "Registering your business, hotspot site and router record…";
  $("business-message").style.color = "#26734d";
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    values.country_code = values.country_code.trim().toUpperCase();
    values.currency_code = values.currency_code.trim().toUpperCase();
    const result = await api("/api/register-business", {
      method: "POST",
      body: JSON.stringify(values)
    });
    setPlatformCallNotice($("business-message"), "Business registration is free and submitted. Connect the router to start its 5-minute test. After the test, pay TSh 7,500 for this router and contact the Super Admin for approval.");
    $("business-message").style.color = "#26734d";
    event.currentTarget.reset();
    await loadWorkspace();
  } catch (error) {
    $("business-message").textContent = error.message;
    $("business-message").style.color = "#a33b32";
  } finally {
    button.disabled = false;
  }
});

$("login-tab").addEventListener("click", () => setMode("signin"));
$("signup-tab").addEventListener("click", () => setMode("signup"));
$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("submit-auth");
  button.disabled = true;
  showMessage(mode === "signin" ? "Signing in…" : "Creating account…", false);
  try {
    const endpoint = mode === "signin" ? "/api/auth/signin" : "/api/auth/signup";
    const result = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(mode === "signin"
        ? { email: $("email").value.trim(), password: $("password").value }
        : {
            email: $("email").value.trim(),
            password: $("password").value,
            data: {
              full_name: $("signup-owner").value.trim(),
              business_name: $("signup-business").value.trim(),
              contact_phone: $("signup-phone").value.trim(),
              country_code: $("signup-country").value.trim().toUpperCase(),
              region: $("signup-region").value.trim(),
              district: $("signup-district").value.trim(),
              business_address: $("signup-address").value.trim()
            }
          })
    });
    if (!result.access_token) {
      setMode("signin");
      showMessage("Account created. If email confirmation is enabled, confirm your email, then sign in to complete business and router registration.", false);
      return;
    }
    saveSession(result);
    await loadWorkspace();
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
  }
});

async function signOut() {
  if (routerPaymentRefreshTimer) { clearInterval(routerPaymentRefreshTimer); routerPaymentRefreshTimer = null; }
  if (adminPendingPollTimer) { clearInterval(adminPendingPollTimer); adminPendingPollTimer = null; }
  try {
    if (session?.access_token) await api("/api/auth/logout", { method: "POST" });
  } catch {
    // Always clear the browser session, even if the network is unavailable.
  }
  saveSession(null);
  $("chat-panel").classList.add("hidden");
  $("business-onboarding").classList.add("hidden");
  $("dashboard").classList.add("hidden");
  $("platform-admin").classList.add("hidden");
  $("security-gate")?.classList.add("hidden");
  $("auth-panel").classList.remove("hidden");
  $("password").value = "";
  showMessage("You have signed out.", false);
}
$("signout").addEventListener("click", signOut);
$("onboarding-signout").addEventListener("click", signOut);
$("platform-signout").addEventListener("click", signOut);

(async function init() {
  // Always start in a clean signed-out state. A platform-admin panel must
  // never remain visible from a previous page/session render.
  const guideCompleted = localStorage.getItem(GUIDE_KEY) === "yes";
  $("welcome-guide").classList.toggle("hidden", guideCompleted);
  $("open-help").classList.toggle("hidden", !guideCompleted);
  $("auth-panel").classList.toggle("hidden", !guideCompleted);
  $("business-onboarding").classList.add("hidden");
  $("dashboard").classList.add("hidden");
  $("platform-admin").classList.add("hidden");
  $("chat-panel").classList.add("hidden");
  $("auth-message").textContent = "";
  const savedSession = guideCompleted ? sessionStorage.getItem("eamwifi_session") : null;
  try {
    const health = await api("/api/health");
    $("connection").textContent = health.ok ? "Service online" : "Service unavailable";
  } catch {
    $("connection").textContent = "Service unavailable";
  }
  try {
    if (savedSession) {
      saveSession(JSON.parse(savedSession));
      await loadWorkspace();
    }
  } catch {
    saveSession(null);
    $("platform-admin").classList.add("hidden");
    $("dashboard").classList.add("hidden");
    $("business-onboarding").classList.add("hidden");
    $("auth-panel").classList.toggle("hidden", localStorage.getItem(GUIDE_KEY) !== "yes");
  }
})();

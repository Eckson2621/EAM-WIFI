const $ = (id) => document.getElementById(id);
let mode = "signin";
let session = null;
let selectedOrganization = null;

$("year").textContent = new Date().getFullYear();

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
function setPlatformCallNotice(element, message) {
  element.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message + " Call: " + PLATFORM_PHONE + " ";
  const link = document.createElement("a");
  link.href = "tel:" + PLATFORM_PHONE;
  link.textContent = "Call now";
  link.className = "portal-link";
  element.append(text, link);
}

async function loadWorkspace() {
  const user = await api("/api/auth/user");
  const memberships = await api("/api/organizations");
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
  $("platform-admin").classList.toggle("hidden", !isPlatformAdmin);
  if (isPlatformAdmin) { await Promise.all([loadPlatformStats(), loadPlatformAccounts()]); }
  if (!memberships.length) {
    $("dashboard").classList.add("hidden");
    $("business-onboarding").classList.toggle("hidden", isPlatformAdmin);
    return;
  }
  $("business-onboarding").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  $("welcome").textContent = user.email || "Your workspace";
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
    if (membership.role === "owner" || membership.role === "admin") {
      try {
        const sub = await api(`/api/platform/subscription?organization_id=${encodeURIComponent(membership.organization_id)}`);
        if (!sub.active) {
          notice.classList.remove("hidden");
          setPlatformCallNotice(notice, sub.status === "expired"
            ? "Your EAM-WIFI subscription has expired. Monthly renewal is TSh 6,000. Call the platform administrator to confirm payment and reactivate your business."
            : "Your business registration is waiting for payment approval. The EAM-WIFI platform subscription is TSh 6,000 per month. Call the platform administrator; access starts after payment is confirmed.");
        } else {
          notice.classList.remove("hidden");
          notice.textContent = `Your EAM-WIFI subscription is active until ${new Date(sub.expires_at).toLocaleString()}.`;
        }
      } catch (error) {
        notice.classList.remove("hidden");
        notice.textContent = "Subscription status could not be checked. Please contact EAM-WIFI support before issuing vouchers.";
      }
    }
    info.append(name, meta);
    if (membership.role === "owner" || membership.role === "admin") {
      const portalLink = document.createElement("a");
      portalLink.href = `/portal?site=${encodeURIComponent(membership.organization?.slug || "")}`;
      portalLink.target = "_blank";
      portalLink.rel = "noopener";
      portalLink.textContent = "Open customer Wi-Fi portal";
      portalLink.className = "portal-link";
      if (!membership.organization?.slug) portalLink.hidden = true;
      info.append(portalLink);
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

async function loadPlatformAccounts() {
  const host = $("platform-accounts");
  if (!host) return;
  host.textContent = "Loading business accounts…";
  try {
    const accounts = await api("/api/platform/admin/accounts");
    host.replaceChildren();
    if (!accounts.length) {
      host.textContent = "No business registrations yet.";
      return;
    }
    accounts.forEach((account) => {
      const card = document.createElement("div");
      card.className = "item";
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = account.name;
      const rawSub = account.platform_subscriptions;
      const sub = Array.isArray(rawSub) ? rawSub[0] : rawSub;
      const state = sub?.status || account.status || "pending";
      const expiry = sub?.expires_at ? ` · Expires ${new Date(sub.expires_at).toLocaleDateString()}` : "";
      const meta = document.createElement("small");
      meta.textContent = `${account.contact_phone || "No phone"} · Business: ${account.status} · Subscription: ${state}${expiry}`;
      info.append(name, meta);
      const controls = document.createElement("div");
      controls.className = "stack";
      const method = document.createElement("select");
      [["cash","Cash"],["mobile_money","Mobile money"],["bank_transfer","Bank transfer"],["other","Other"]].forEach(([value,label]) => {
        const option = document.createElement("option");
        option.value = value; option.textContent = label; method.append(option);
      });
      const months = document.createElement("select");
      months.setAttribute("aria-label", "Subscription duration in months");
      [1,2,3,4,6,9,12,18,24,36,48,60].forEach((value) => {
        const option = document.createElement("option");
        option.value = String(value);
        option.textContent = value === 1 ? "1 month" : value + " months";
        months.append(option);
      });
      const reference = document.createElement("input");
      reference.placeholder = "Payment reference (optional)";
      reference.maxLength = 120;
      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "secondary";
      approve.textContent = "Confirm payment and grant selected period";
      const message = document.createElement("small");
      message.className = "muted";
      approve.addEventListener("click", async () => {
        const selectedMonths = Number(months.value);
        const totalDue = 6000 * selectedMonths;
        if (!window.confirm(`Confirm that ${account.name} has paid TSh ${totalDue.toLocaleString()} for ${selectedMonths} month(s)?`)) return;
        approve.disabled = true;
        message.textContent = "Approving subscription…";
        try {
          const result = await api("/api/platform/admin/approve", {
            method: "POST",
            body: JSON.stringify({ organization_id: account.id, payment_method: method.value, payment_reference: reference.value.trim() || null, months: selectedMonths })
          });
          message.textContent = `Approved. Access active until ${new Date(result.expires_at).toLocaleString()}.`;
          await loadPlatformAccounts();
        } catch (error) {
          message.textContent = error.message;
          approve.disabled = false;
        }
      });
      controls.append(months, method, reference, approve, message);
      card.append(info, controls);
      host.append(card);
    });
  } catch (error) {
    host.textContent = error.message;
  }
}

async function loadPackages(organizationId, role = "operator") {
  selectedOrganization = organizationId;
  const host = $("packages");
  host.textContent = "Loading packages…";
  try {
    const packages = await api(`/api/packages?organization_id=${encodeURIComponent(organizationId)}`);
    host.replaceChildren();
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
      const hours = item.duration_seconds ? `${(item.duration_seconds / 3600).toFixed(1)} hours` : "Duration not set";
      detail.textContent = `TZS ${Number(item.price_tzs || 0).toLocaleString()} · ${hours}`;
      info.append(title, detail);
      card.append(info);

      if (["owner", "admin"].includes(role)) {
        const voucherPanel = document.createElement("div");
        voucherPanel.className = "stack voucher-issue";
        const phone = document.createElement("input");
        phone.type = "tel";
        phone.placeholder = "Customer phone (optional)";
        phone.setAttribute("aria-label", "Customer phone number");
        const amount = document.createElement("input");
        amount.type = "number";
        amount.min = "1";
        amount.step = "1";
        amount.value = String(Number(item.price_tzs || 0));
        amount.setAttribute("aria-label", "Amount received in TZS");
        const method = document.createElement("select");
        method.setAttribute("aria-label", "Payment method");
        [
          ["cash", "Cash"],
          ["mobile_money", "Mobile money"],
          ["bank_transfer", "Bank transfer"],
          ["other", "Other"]
        ].forEach(([value, label]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          method.append(option);
        });
        const reference = document.createElement("input");
        reference.type = "text";
        reference.maxLength = 120;
        reference.placeholder = "Payment reference (optional)";
        reference.setAttribute("aria-label", "Payment reference");
        const issue = document.createElement("button");
        issue.type = "button";
        issue.className = "secondary";
        issue.textContent = "Confirm payment and issue ONE voucher";
        const message = document.createElement("small");
        message.className = "muted";
        const code = document.createElement("input");
        code.readOnly = true;
        code.hidden = true;
        code.setAttribute("aria-label", "New voucher code");
        code.className = "voucher-code";
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "secondary";
        copy.textContent = "Copy voucher code";
        copy.hidden = true;
        copy.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(code.value);
            message.textContent = "Voucher copied. Give this code to the customer.";
          } catch {
            code.focus();
            code.select();
            message.textContent = "Select and copy the voucher code manually.";
          }
        });
        issue.addEventListener("click", async () => {
          const paid = Number(amount.value);
          if (!Number.isSafeInteger(paid) || paid < 1) {
            message.textContent = "Enter the amount actually received.";
            return;
          }
          if (paid !== Number(item.price_tzs)) {
            message.textContent = "The amount must exactly match this package price.";
            return;
          }
          if (!window.confirm("Confirm that you have received the full payment for this package. A new one-time voucher will be issued.")) return;
          issue.disabled = true;
          code.hidden = true;
          copy.hidden = true;
          message.textContent = "Recording payment and issuing one unique voucher…";
          try {
            const result = await api("/api/vouchers/issue-paid", {
              method: "POST",
              body: JSON.stringify({
                organization_id: organizationId,
                package_id: item.id,
                amount_paid: paid,
                payment_method: method.value,
                customer_phone: phone.value.trim() || null,
                payment_reference: reference.value.trim() || null
              })
            });
            if (!result.code || !/^EW[A-F0-9]{24}$/.test(result.code)) {
              throw new Error("The server did not return a valid voucher code. Contact support before retrying.");
            }
            code.value = result.code;
            code.hidden = false;
            copy.hidden = false;
            message.textContent = "Payment recorded. Give this code to the customer now. The full code will not be shown again.";
            phone.value = "";
            reference.value = "";
          } catch (error) {
            message.textContent = error.message;
          } finally {
            issue.disabled = false;
          }
        });
        voucherPanel.append(phone, amount, method, reference, issue, message, code, copy);
        card.append(voucherPanel);
      }
      host.append(card);
    });
  } catch (error) {
    host.textContent = error.message;
  }
}


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
    setPlatformCallNotice($("business-message"), "Registration submitted. Call the EAM-WIFI platform administrator to discuss and confirm your TSh 6,000 monthly subscription. Your business remains locked until payment is approved. The router is registered but not connected yet.");
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
  try {
    if (session?.access_token) await api("/api/auth/logout", { method: "POST" });
  } catch {
    // Always clear the browser session, even if the network is unavailable.
  }
  saveSession(null);
  $("business-onboarding").classList.add("hidden");
  $("dashboard").classList.add("hidden");
  $("platform-admin").classList.add("hidden");
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
  $("auth-panel").classList.remove("hidden");
  $("business-onboarding").classList.add("hidden");
  $("dashboard").classList.add("hidden");
  $("platform-admin").classList.add("hidden");
  $("auth-message").textContent = "";
  const savedSession = sessionStorage.getItem("eamwifi_session");
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
    $("auth-panel").classList.remove("hidden");
  }
})();

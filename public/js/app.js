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
  showMessage("");
}

function saveSession(value) {
  session = value;
  if (value) sessionStorage.setItem("eamwifi_session", JSON.stringify(value));
  else sessionStorage.removeItem("eamwifi_session");
}

async function loadWorkspace() {
  const user = await api("/api/auth/user");
  const memberships = await api("/api/organizations");
  $("auth-panel").classList.add("hidden");
  if (!memberships.length) {
    $("dashboard").classList.add("hidden");
    $("business-onboarding").classList.remove("hidden");
    return;
  }
  $("business-onboarding").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  $("welcome").textContent = user.email || "Your workspace";
  const host = $("organizations");
  host.replaceChildren();
  $("packages").innerHTML = '<p class="muted">Choose an organization to view packages.</p>';
  memberships.forEach((membership) => {
    const card = document.createElement("div");
    card.className = "item";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = membership.organization?.name || `Organization ${membership.organization_id}`;
    const meta = document.createElement("small");
    const orgStatus = membership.organization?.status || "unknown";
    meta.textContent = `Role: ${membership.role} · Membership: ${membership.status} · Business: ${orgStatus}`;
    info.append(name, meta);
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
    $("business-message").textContent = "Registration submitted. Your business is pending approval; the router is recorded but not connected yet. Next step: secure router pairing.";
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
      body: JSON.stringify({ email: $("email").value.trim(), password: $("password").value })
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
  $("auth-panel").classList.remove("hidden");
  $("password").value = "";
  showMessage("You have signed out.", false);
}
$("signout").addEventListener("click", signOut);
$("onboarding-signout").addEventListener("click", signOut);

(async function init() {
  try {
    const health = await api("/api/health");
    $("connection").textContent = health.ok ? "Service online" : "Service unavailable";
  } catch {
    $("connection").textContent = "Service unavailable";
  }
  try {
    const saved = sessionStorage.getItem("eamwifi_session");
    if (saved) {
      saveSession(JSON.parse(saved));
      await loadWorkspace();
    }
  } catch {
    saveSession(null);
  }
})();

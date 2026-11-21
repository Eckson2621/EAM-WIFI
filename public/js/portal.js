const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const site = (params.get("site") || "").toLowerCase();
const mac = params.get("mac") || params.get("mac-address") || "";

function showMessage(text, type="error") {
  $("message").textContent = text;
  $("message").className = type;
}
function money(value) {
  return "TSh " + Number(value || 0).toLocaleString("en-TZ");
}
function safeRouterLoginUrl() {
  const raw = params.get("link-login-only") || "";
  try {
    const target = new URL(raw);
    const host = target.hostname;
    const octets = host.split(".").map(Number);
    const privateIPv4 = octets.length === 4 && octets.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
      && (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
    return (target.protocol === "http:" || target.protocol === "https:") && privateIPv4 ? target.href : "";
  } catch { return ""; }
}
async function loadPortal() {
  if (!site) throw new Error("Wi-Fi site details are missing. Please reconnect to the hotspot.");
  const response = await fetch("/api/public/portal?site=" + encodeURIComponent(site), { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Unable to load this Wi-Fi service.");
  $("business-name").textContent = data.business_name || "Wi-Fi access";
  const contact = $("business-contact");
  contact.replaceChildren();
  const phone = String(data.contact_phone || "").trim();
  if (phone) {
    const text = document.createElement("p");
    text.textContent = "Business contact: " + phone;
    const link = document.createElement("a");
    link.className = "call";
    link.href = "tel:" + phone.replace(/[^+0-9]/g, "");
    link.textContent = "Call business";
    contact.append(text, link);
  } else {
    contact.textContent = "Contact the Wi-Fi business for assistance.";
  }
  const payPhone = String(data.payment_phone || phone || "").trim();
  if (payPhone) {
    const payment = document.createElement("p");
    payment.textContent = "Pay for your selected package to this business number: " + payPhone;
    const payLink = document.createElement("a");
    payLink.className = "call";
    payLink.href = "tel:" + payPhone.replace(/[^+0-9]/g, "");
    payLink.textContent = "Call / copy payment number";
    contact.append(payment, payLink);
  }
  if (data.payment_instructions) {
    const instructions = document.createElement("p");
    instructions.textContent = "Payment instructions: " + data.payment_instructions;
    contact.append(instructions);
  }
  if (!data.router_ready) {
    $("redeem-button").disabled = true;
    showMessage("This hotspot's MikroTik router is not connected to EAM-WIFI yet. You can view packages and call the business, but voucher activation is not available yet.");
  } else if (!mac) {
    $("redeem-button").disabled = true;
    showMessage("Open this page from the Wi-Fi login screen so the router can identify your device.");
  } else if (!safeRouterLoginUrl()) {
    $("redeem-button").disabled = true;
    showMessage("The router login link is missing or invalid. Reconnect to the Wi-Fi network and open its sign-in page again.");
  }
  const host = $("packages");
  host.replaceChildren();
  if (!data.packages?.length) {
    host.textContent = "No packages are currently available.";
    return;
  }
  data.packages.forEach((pkg) => {
    const card = document.createElement("div");
    card.className = "package";
    const title = document.createElement("strong");
    title.textContent = pkg.name;
    const detail = document.createElement("div");
    const duration = pkg.duration_seconds ? (pkg.duration_seconds / 3600).toFixed(1) + " hours" : "Duration set by provider";
    const limits = [];
    limits.push(pkg.session_mode === "wall_clock" ? "Wall-clock timer" : "Connected-time timer");
    if (pkg.data_limit_bytes) limits.push((pkg.data_limit_bytes / 1024 ** 3).toFixed(2) + " GB data");
    if (pkg.speed_down_kbps || pkg.speed_up_kbps) limits.push((Number(pkg.speed_down_kbps || 0) / 1000).toFixed(1) + " Mbps down / " + (Number(pkg.speed_up_kbps || 0) / 1000).toFixed(1) + " Mbps up");
    if (pkg.max_devices) limits.push("Up to " + pkg.max_devices + " device(s)");
    if (pkg.validity_seconds && pkg.session_mode !== "wall_clock") limits.push("Use within " + (pkg.validity_seconds / 86400).toFixed(1) + " days");
    detail.textContent = (pkg.description ? pkg.description + " · " : "") + duration + " · " + limits.join(" · ");
    const price = document.createElement("div");
    price.className = "price";
    price.textContent = money(pkg.price_tzs);
    card.append(title, detail, price);
    host.append(card);
  });
}
$("redeem-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("redeem-button");
  const code = $("voucher").value.trim().toUpperCase();
  if (!mac) {
    showMessage("Your router did not provide a device address. Please reconnect using the Wi-Fi login page.");
    return;
  }
  button.disabled = true;
  button.textContent = "Checking voucher…";
  showMessage("");
  try {
    const response = await fetch("/api/public/redeem", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ site, code, mac_address: mac })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || "Voucher could not be verified.");
    showMessage("Voucher accepted. " + (data.message || "The router is activating your internet session."), "success");
    $("voucher").value = "";
    const loginTarget = safeRouterLoginUrl();
    const originalTarget = params.get("link-orig") || "http://neverssl.com/";
    if (data.username && data.password && loginTarget) {
      const form = document.createElement("form");
      form.method = "post";
      form.action = loginTarget;
      for (const [name, value] of [["username", data.username], ["password", data.password], ["dst", originalTarget]]) {
        const field = document.createElement("input");
        field.type = "hidden"; field.name = name; field.value = value; form.append(field);
      }
      document.body.append(form);
      form.submit();
    } else {
      showMessage("Voucher accepted. If the router login does not open automatically, reconnect to this Wi-Fi and contact the business owner. " + (data.message || ""), "success");
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Verify voucher";
  }
});
loadPortal().catch((error) => {
  $("business-name").textContent = "Wi-Fi unavailable";
  $("packages").textContent = error.message;
  $("business-contact").textContent = "Please contact the Wi-Fi business.";
});

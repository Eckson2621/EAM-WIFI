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
    text.textContent = "To buy a voucher, call: " + phone;
    const link = document.createElement("a");
    link.className = "call";
    link.href = "tel:" + phone.replace(/[^+0-9]/g, "");
    link.textContent = "Call business";
    contact.append(text, link);
  } else {
    contact.textContent = "Contact the Wi-Fi business to purchase a voucher.";
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
    const duration = pkg.duration_seconds ? (pkg.duration_seconds / 3600).toFixed(1) + " hours access" : "Duration set by provider";
    detail.textContent = (pkg.description ? pkg.description + " · " : "") + duration;
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
    showMessage("Voucher accepted. " + (data.message || "Waiting for the router to activate your internet session."), "success");
    $("voucher").value = "";
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

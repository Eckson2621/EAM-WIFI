/**
 * Vendor-neutral router integration contracts.
 * These definitions describe supported setup paths; they do not claim that
 * a vendor is operational until its controller/device is physically tested.
 */
const OPTIONS = Object.freeze({
  ubiquiti: Object.freeze({
    vendor: "ubiquiti",
    label: "Ubiquiti",
    integrations: Object.freeze([
      Object.freeze({ id: "unifi_controller", label: "UniFi Network Controller", transport: "controller_api", status: "configuration_ready", required: ["controller_url", "controller_version", "site_id"], credential_fields: ["api_username", "api_password_or_token"], notes: "Use a UniFi Network application/controller with an API enabled for the installed version. UniFi gateways/APs and UISP-managed devices are not interchangeable." }),
      Object.freeze({ id: "radius", label: "External RADIUS", transport: "radius", status: "configuration_ready", required: ["radius_server", "radius_auth_port", "radius_accounting_port", "shared_secret"], credential_fields: ["shared_secret"], notes: "Requires the exact UniFi model, firmware and WLAN/hotspot profile to support the required RADIUS attributes and accounting." })
    ])
  }),
  tp_link: Object.freeze({
    vendor: "tp_link",
    label: "TP-Link",
    integrations: Object.freeze([
      Object.freeze({ id: "omada_controller", label: "Omada Software/Hardware Controller", transport: "controller_api", status: "configuration_ready", required: ["controller_url", "controller_version", "site_id"], credential_fields: ["api_username", "api_password_or_token"], notes: "Requires a compatible Omada controller and supported EAP/ gateway model. Standalone home routers are not covered by this integration." }),
      Object.freeze({ id: "radius", label: "External RADIUS", transport: "radius", status: "configuration_ready", required: ["radius_server", "radius_auth_port", "radius_accounting_port", "shared_secret"], credential_fields: ["shared_secret"], notes: "Requires an Omada-compatible or other TP-Link model/firmware with external RADIUS authentication and accounting." })
    ])
  }),
  huawei: Object.freeze({
    vendor: "huawei",
    label: "Huawei",
    integrations: Object.freeze([
      Object.freeze({ id: "radius", label: "External RADIUS / AAA", transport: "radius", status: "configuration_ready", required: ["radius_server", "radius_auth_port", "radius_accounting_port", "shared_secret"], credential_fields: ["shared_secret"], notes: "Most suitable generic path where the exact Huawei WLAN/AC/ONT firmware exposes RADIUS/AAA and accounting. Vendor-specific attributes and CoA/disconnect must be verified." }),
      Object.freeze({ id: "controller_api", label: "Huawei Controller/API", transport: "controller_api", status: "model_assessment_required", required: ["controller_url", "controller_family", "controller_version"], credential_fields: ["api_username", "api_password_or_token"], notes: "Huawei controller and device APIs vary by product family; confirm exact AC, eSight/iMaster, gateway or ONT model before enabling." })
    ])
  })
});

const UUID_OR_HOST = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/;
const SAFE_PORT = (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535;

export function listVendorIntegrationOptions(vendor) {
  const entry = OPTIONS[String(vendor || "").toLowerCase()];
  return entry ? { ...entry, integrations: entry.integrations.map((item) => ({ ...item, required: [...item.required], credential_fields: [...item.credential_fields] })) } : null;
}

/**
 * Validate non-secret connection metadata before a customer submits it.
 * Credentials must be sent to a dedicated encrypted secret store; this
 * function intentionally never accepts or returns credential values.
 */
export function validateRouterIntegrationConfig(vendor, integrationId, config = {}) {
  const entry = OPTIONS[String(vendor || "").toLowerCase()];
  if (!entry) return { ok: false, errors: ["Unsupported router vendor."] };
  const integration = entry.integrations.find((item) => item.id === integrationId);
  if (!integration) return { ok: false, errors: ["Integration does not belong to the selected vendor."] };
  const errors = [];
  for (const field of integration.required) {
    const value = config[field];
    if (value === undefined || value === null || String(value).trim() === "") errors.push(field + " is required.");
  }
  if (config.controller_url) {
    try {
      const parsed = new URL(String(config.controller_url));
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) errors.push("controller_url must be an HTTPS URL without embedded credentials.");
    } catch { errors.push("controller_url must be a valid HTTPS URL."); }
  }
  if (config.radius_server && !UUID_OR_HOST.test(String(config.radius_server))) errors.push("radius_server must be a hostname or IP address.");
  for (const field of ["radius_auth_port", "radius_accounting_port"]) {
    if (config[field] !== undefined && config[field] !== null && !SAFE_PORT(config[field])) errors.push(field + " must be a port from 1 to 65535.");
  }
  if (config.controller_version && String(config.controller_version).length > 80) errors.push("controller_version is too long.");
  if (config.site_id && String(config.site_id).length > 128) errors.push("site_id is too long.");
  return { ok: errors.length === 0, errors, vendor: entry.vendor, integration_id: integration.id, transport: integration.transport, readiness: integration.status };
}

/**
 * EAM-WIFI multi-router adapter registry.
 * A vendor/model is not compatible merely because its brand is selected.
 * A driver must pass hardware acceptance tests before becoming supported.
 */
const ADAPTERS = Object.freeze([
  Object.freeze({
    id: "mikrotik-routeros-agent",
    label: "MikroTik RouterOS Agent",
    status: "pilot",
    connection: "router_initiated_https",
    capabilities: Object.freeze(["heartbeat", "event_polling", "voucher_provisioning", "session_revocation", "time_limit", "data_limit", "speed_limit", "device_limit", "captive_portal_handoff"]),
    note: "Existing RouterOS 7 agent template; physical-device acceptance testing is still required."
  }),
  Object.freeze({
    id: "radius",
    label: "RADIUS-compatible controller",
    status: "planned",
    connection: "radius_accounting_and_authentication",
    capabilities: Object.freeze(["authentication", "accounting", "session_revocation", "time_limit", "data_limit", "speed_limit"]),
    note: "Requires a reachable RADIUS server/controller and verified vendor-specific attributes."
  }),
  Object.freeze({
    id: "controller-api",
    label: "Network controller API",
    status: "planned",
    connection: "outbound_https_agent_or_secure_webhook",
    capabilities: Object.freeze(["heartbeat", "voucher_provisioning", "session_revocation", "captive_portal_handoff"]),
    note: "A separate tested driver is required for each supported controller/API family."
  }),
  Object.freeze({
    id: "external-portal",
    label: "External captive portal",
    status: "limited",
    connection: "portal_redirect",
    capabilities: Object.freeze(["captive_portal_handoff"]),
    note: "Portal display only; this mode cannot provision or revoke router sessions by itself."
  })
]);


const VENDOR_PROFILES = Object.freeze([
  Object.freeze({ vendor: "mikrotik", label: "MikroTik", adapter_id: "mikrotik-routeros-agent", status: "pilot", automatic_voucher_activation: false, requirements: "RouterOS 7 agent pairing and exact model/firmware hardware acceptance tests." }),
  Object.freeze({ vendor: "ubiquiti", label: "Ubiquiti", adapter_id: "controller-api", status: "planned", automatic_voucher_activation: false, requirements: "A supported UniFi/UISP controller API driver and model-specific acceptance tests." }),
  Object.freeze({ vendor: "tp_link", label: "TP-Link", adapter_id: "controller-api", status: "planned", automatic_voucher_activation: false, requirements: "A compatible Omada controller/API and model-specific acceptance tests; standalone consumer routers are not assumed compatible." }),
  Object.freeze({ vendor: "huawei", label: "Huawei", adapter_id: "controller-api", status: "planned", automatic_voucher_activation: false, requirements: "Exact device/controller family, firmware and supported API or RADIUS capability must be verified." }),
  Object.freeze({ vendor: "other", label: "Other", adapter_id: null, status: "assessment_required", automatic_voucher_activation: false, requirements: "Provide manufacturer, exact model, firmware and hotspot/controller details for compatibility assessment." })
]);

export function listRouterVendorProfiles() {
  return VENDOR_PROFILES.map((profile) => ({ ...profile }));
}

export function listRouterAdapters() {
  return ADAPTERS.map((adapter) => ({ ...adapter, capabilities: [...adapter.capabilities] }));
}
export function getRouterAdapter(adapterId) {
  const adapter = ADAPTERS.find((item) => item.id === adapterId);
  return adapter ? { ...adapter, capabilities: [...adapter.capabilities] } : null;
}
export function supportsRouterCapability(adapterId, capability) {
  const adapter = ADAPTERS.find((item) => item.id === adapterId);
  return Boolean(adapter && adapter.capabilities.includes(capability));
}
export function isRouterAdapterProvisioningReady(adapterId) {
  const adapter = ADAPTERS.find((item) => item.id === adapterId);
  return Boolean(adapter && adapter.status === "supported" &&
    adapter.capabilities.includes("voucher_provisioning") &&
    adapter.capabilities.includes("session_revocation"));
}

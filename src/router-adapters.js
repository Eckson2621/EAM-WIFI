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

import test from "node:test";
import assert from "node:assert/strict";
import {
  getRouterAdapter,
  isRouterAdapterProvisioningReady,
  listRouterAdapters,
  supportsRouterCapability
} from "../src/router-adapters.js";

test("adapter registry exposes vendor-neutral integration choices", () => {
  assert.deepEqual(listRouterAdapters().map((item) => item.id), [
    "mikrotik-routeros-agent", "radius", "controller-api", "external-portal"
  ]);
});
test("planned integrations are not falsely marked production-ready", () => {
  assert.equal(getRouterAdapter("radius").status, "planned");
  assert.equal(getRouterAdapter("controller-api").status, "planned");
  assert.equal(isRouterAdapterProvisioningReady("radius"), false);
  assert.equal(isRouterAdapterProvisioningReady("controller-api"), false);
});
test("external portal advertises redirect only", () => {
  assert.equal(supportsRouterCapability("external-portal", "captive_portal_handoff"), true);
  assert.equal(supportsRouterCapability("external-portal", "voucher_provisioning"), false);
  assert.equal(isRouterAdapterProvisioningReady("external-portal"), false);
});
test("MikroTik pilot does not claim production readiness", () => {
  const adapter = getRouterAdapter("mikrotik-routeros-agent");
  assert.equal(adapter.status, "pilot");
  assert.equal(supportsRouterCapability(adapter.id, "voucher_provisioning"), true);
  assert.equal(isRouterAdapterProvisioningReady(adapter.id), false);
});
test("returned adapter data cannot mutate internal capabilities", () => {
  getRouterAdapter("mikrotik-routeros-agent").capabilities.push("invented");
  assert.equal(supportsRouterCapability("mikrotik-routeros-agent", "invented"), false);
});

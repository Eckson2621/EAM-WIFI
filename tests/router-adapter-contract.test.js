import test from "node:test";
import assert from "node:assert/strict";
import { listVendorIntegrationOptions, validateRouterIntegrationConfig } from "../src/router-adapter-contract.js";

test("Ubiquiti exposes UniFi controller and RADIUS setup paths", () => {
  const options = listVendorIntegrationOptions("ubiquiti");
  assert.deepEqual(options.integrations.map((item) => item.id), ["unifi_controller", "radius"]);
  assert.equal(options.integrations[0].transport, "controller_api");
});

test("TP-Link exposes Omada controller and RADIUS setup paths", () => {
  const options = listVendorIntegrationOptions("tp_link");
  assert.deepEqual(options.integrations.map((item) => item.id), ["omada_controller", "radius"]);
  assert.match(options.integrations[0].notes, /standalone home routers are not covered/i);
});

test("Huawei defaults to RADIUS and requires model assessment for controller API", () => {
  const options = listVendorIntegrationOptions("huawei");
  assert.deepEqual(options.integrations.map((item) => item.id), ["radius", "controller_api"]);
  assert.equal(options.integrations[1].status, "model_assessment_required");
});

test("controller configuration requires HTTPS and never accepts embedded credentials", () => {
  const valid = validateRouterIntegrationConfig("ubiquiti", "unifi_controller", {
    controller_url: "https://controller.example.com",
    controller_version: "8.x",
    site_id: "default"
  });
  assert.equal(valid.ok, true);
  const invalid = validateRouterIntegrationConfig("tp_link", "omada_controller", {
    controller_url: "http://admin:password@controller.example.com",
    controller_version: "5.14",
    site_id: "Default"
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((item) => /HTTPS URL without embedded credentials/.test(item)));
});

test("RADIUS config validates required fields and port bounds", () => {
  const invalid = validateRouterIntegrationConfig("huawei", "radius", {
    radius_server: "radius.example.com",
    radius_auth_port: 1812,
    radius_accounting_port: 70000,
    shared_secret: "configured-outside-this-validator"
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((item) => /radius_accounting_port/.test(item)));
  const valid = validateRouterIntegrationConfig("tp_link", "radius", {
    radius_server: "10.0.0.10",
    radius_auth_port: 1812,
    radius_accounting_port: 1813,
    shared_secret: "present"
  });
  assert.equal(valid.ok, true);
});

test("vendor mismatch is rejected and config secrets are never echoed", () => {
  assert.equal(validateRouterIntegrationConfig("huawei", "omada_controller", {}).ok, false);
  const result = validateRouterIntegrationConfig("huawei", "radius", {
    radius_server: "radius.example.com",
    radius_auth_port: 1812,
    radius_accounting_port: 1813,
    shared_secret: "do-not-return-this"
  });
  assert.equal(JSON.stringify(result).includes("do-not-return-this"), false);
});

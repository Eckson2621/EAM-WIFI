import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("health endpoint responds without database credentials", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.app, "EAM-WIFI");
  assert.equal(body.ok, true);
});

test("protected endpoints reject requests without a bearer token", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/organizations"), {});
  assert.equal(response.status, 401);
});

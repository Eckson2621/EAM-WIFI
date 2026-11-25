import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("MikroTik RouterOS agent sends HTTP headers in the Fetch-supported string format", async () => {
  const script = await readFile(new URL("../public/downloads/eam-wifi-agent-template.rsc", import.meta.url), "utf8");
  assert.match(script, /:local jsonHeaders \("Authorization: Bearer " \. \$EAM_WIFI_TOKEN \. ",Content-Type: application\/json"\)/);
  assert.doesNotMatch(script, /:local jsonHeaders \([^\n]*,\s*"Content-Type: application\/json"\)/);
  assert.match(script, /http-header-field=\$jsonHeaders/);
  assert.match(script, /check-certificate=yes/);
  assert.match(script, /session_expiry_requested/);
  assert.match(script, /voucher_redemption_requested/);
  assert.match(script, /__EAM_WIFI_TOKEN__/);
});

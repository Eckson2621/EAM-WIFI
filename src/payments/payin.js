const SANDBOX_BASE_URL = "https://api.sandbox.payin.co.tz/api/v1";
const PRODUCTION_BASE_URL = "https://api.payin.co.tz/api/v1";
const ALLOWED_BASE_URLS = new Set([SANDBOX_BASE_URL, PRODUCTION_BASE_URL]);

const OPERATOR_CODES = new Set(["mpesa", "airtel", "tigopesa", "halopesa"]);

export function normalizeTanzaniaPhone(value) {
  let phone = String(value ?? "").replace(/[\s().-]/g, "");
  if (phone.startsWith("+")) phone = phone.slice(1);
  if (phone.startsWith("0")) phone = "255" + phone.slice(1);
  if (!/^255\d{9}$/.test(phone)) {
    throw new TypeError("Enter a valid Tanzania mobile number, for example 07XXXXXXXX or 2557XXXXXXXX.");
  }
  return phone;
}

export function detectTanzaniaOperator(phoneValue) {
  const phone = normalizeTanzaniaPhone(phoneValue);
  const prefix = phone.slice(3, 5);
  if (["74", "75", "76"].includes(prefix)) return "mpesa";
  if (["68", "69", "78", "79"].includes(prefix)) return "airtel";
  if (["65", "67", "71"].includes(prefix)) return "tigopesa";
  if (prefix === "62") return "halopesa";
  return null;
}

function resolveBaseUrl(value) {
  const baseUrl = String(value || SANDBOX_BASE_URL).replace(/\/$/, "");
  if (!ALLOWED_BASE_URLS.has(baseUrl)) {
    throw new TypeError("PAYIN_API_BASE_URL must be the official PayIn sandbox or production URL.");
  }
  return baseUrl;
}

export async function createPayinCollection(env, input, fetchImpl = fetch) {
  const apiKey = String(env.PAYIN_API_KEY || "");
  const apiSecret = String(env.PAYIN_API_SECRET || "");
  if (!apiKey || !apiSecret) {
    throw new Error("PayIn is not configured. Add PAYIN_API_KEY and PAYIN_API_SECRET as Worker secrets.");
  }

  const phone = normalizeTanzaniaPhone(input?.phone);
  const amount = Number(input?.amount);
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 10_000_000) {
    throw new RangeError("Payment amount must be a whole TSh amount from 100 to 10,000,000.");
  }

  const operator = input?.operator ? String(input.operator).toLowerCase() : detectTanzaniaOperator(phone);
  if (operator && !OPERATOR_CODES.has(operator)) {
    throw new TypeError("Unsupported Tanzania mobile-money operator.");
  }

  const reference = String(input?.reference || "");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(reference)) {
    throw new TypeError("A unique payment reference of 8–100 letters, numbers, hyphens or underscores is required.");
  }

  const baseUrl = resolveBaseUrl(env.PAYIN_API_BASE_URL);
  const payload = {
    phone,
    amount,
    currency: "TZS",
    reference,
    description: String(input?.description || "EAM-WIFI hotspot package").slice(0, 255),
    ...(operator ? { operator } : {}),
    ...(env.PAYIN_CALLBACK_URL ? { callback_url: String(env.PAYIN_CALLBACK_URL) } : {})
  };

  const response = await fetchImpl(baseUrl + "/collection", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-api-secret": apiSecret,
      "x-idempotency-key": reference
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(body.message || body.error || "PayIn collection request failed."));
    error.status = response.status;
    error.providerResponse = body;
    throw error;
  }
  if (!body.request_ref || !["pending", "processing", "waiting"].includes(String(body.status || "").toLowerCase())) {
    throw new Error("PayIn returned an unexpected collection response; do not activate customer internet.");
  }
  return {
    request_ref: String(body.request_ref),
    status: String(body.status).toLowerCase(),
    phone,
    amount,
    currency: "TZS",
    operator: body.operator || operator || null
  };
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}

export async function verifyPayinWebhook(rawBody, timestampValue, signatureValue, secret, nowMs = Date.now()) {
  const timestamp = String(timestampValue || "");
  const signature = String(signatureValue || "").toLowerCase();
  const key = String(secret || "");
  if (!/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature) || !key) return false;

  const timestampMs = timestamp.length === 13 ? Number(timestamp) : Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > 5 * 60 * 1000) return false;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(timestamp + "." + String(rawBody))
  );
  const expected = new Uint8Array(signed);
  const supplied = new Uint8Array(signature.match(/.{2}/g).map(byte => Number.parseInt(byte, 16)));
  return constantTimeEqual(expected, supplied);
}

export const PAYIN_SANDBOX_BASE_URL = SANDBOX_BASE_URL;
export const PAYIN_PRODUCTION_BASE_URL = PRODUCTION_BASE_URL;

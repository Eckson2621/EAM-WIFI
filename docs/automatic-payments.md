# EAM-WIFI automatic mobile-money payments

## Current implementation status

This branch adds a server-only PayIn adapter foundation in `src/payments/payin.js` and automated unit tests in `tests/payin.test.js`. It normalizes Tanzania phone numbers, supports the documented M-Pesa, Airtel Money, Mixx by Yas (Tigo Pesa) and HaloPesa operator codes, creates idempotent PayIn collection requests, and verifies timestamped HMAC-SHA256 webhooks.

**This is not yet an active payment flow.** The adapter is not wired into the public portal or Worker routes, no payment transaction table/RPC has been added, no PayIn credentials are configured, and no real customer access is granted by a payment callback. Do not deploy this branch as a claim of completed automatic payments.

## Low-cost development mode

Use PayIn's official sandbox first:

- Base URL: `https://api.sandbox.payin.co.tz/api/v1`
- Sandbox dashboard: `https://sandbox.payin.co.tz`
- Sandbox requests do not move real money.
- Minimum collection amount documented by PayIn: TSh 100.
- Collection endpoint: `POST /collection`
- Idempotency header: `X-Idempotency-Key`
- Callback signature headers: `X-Payin-Signature` and `X-Payin-Timestamp`

Configure secrets only in the Cloudflare Worker environment, never in GitHub source, browser JavaScript, wrangler.toml, logs or chat:

- `PAYIN_API_KEY`
- `PAYIN_API_SECRET`
- `PAYIN_WEBHOOK_SECRET`
- `PAYIN_API_BASE_URL` (sandbox URL while testing)
- `PAYIN_CALLBACK_URL` (the HTTPS Worker webhook URL)

Production base URL is `https://api.payin.co.tz/api/v1`; switch only after merchant onboarding, settlement details, charges, limits and live credentials have been confirmed with PayIn.

## Required customer flow

1. Captive portal loads the business's active packages and router readiness.
2. Customer selects a package, enters their Tanzania mobile number and explicitly selects M-Pesa, Airtel Money, Mixx by Yas or HaloPesa. Do not rely only on phone-prefix detection because numbers can be ported between networks.
3. Worker looks up the package price and ownership on the server. Never trust the amount or organization ID sent by the browser.
4. Worker creates a unique order reference and a pending payment record, then sends the collection request with that reference as the idempotency key.
5. Customer sees a waiting screen. A timeout or browser redirect must never be treated as proof of payment.
6. Worker verifies PayIn's HMAC signature against the exact raw request body and a fresh timestamp.
7. A database transaction/RPC must lock the pending order, verify provider reference, expected amount, TZS currency, operator and business/package/router relationship, and transition it once to completed.
8. Only that successful atomic transaction may create the one-time HotSpot credentials/session and queue the router activation event. A repeated webhook must not create another session or charge.
9. Portal receives a short-lived result and submits the credentials to the router's local `link-login-only` URL. If the router is offline, keep the paid order visible as paid-but-not-activated and retry the queued activation safely.
10. Failed, cancelled, expired and still-processing payments never activate internet. A status lookup is the fallback if a webhook is delayed.

## Database work required before enabling routes

The current project deliberately has no automatic-payment ledger or direct paid-session RPC. Before wiring the Worker routes, add a reviewed Supabase migration that introduces:

- A tenant-scoped customer payment order/transaction table with unique internal reference, unique provider request reference, amount, currency, selected operator, customer phone, package, site, router, MAC address, status and timestamps.
- RLS that prevents one Wi-Fi business from reading or modifying another business's payment records. Public clients must not be able to mark payments completed.
- A narrowly scoped server-side webhook RPC (or equivalent trusted database function) that accepts only a previously verified event from the Worker and performs an idempotent state transition.
- A second atomic operation that creates the paid customer session and router event exactly once after payment is verified.
- A reconciliation path for a payment marked completed by the provider but not yet activated on the router.

Do not put a Supabase service-role key in the Worker or browser. The existing Worker uses the customer's JWT for normal application operations; webhook processing needs a separate narrowly scoped trusted path, preferably a database function with strict grants and verification performed by the Worker.

## Security and acceptance tests

- Reject invalid Tanzania phone numbers, unsupported operators, non-integer amounts and amounts below TSh 100.
- Do not accept arbitrary provider base URLs; the adapter allows only the official PayIn sandbox and production hosts.
- Never expose API keys or webhook secrets to browser code.
- Verify HMAC using the raw body, reject stale timestamps, and compare signatures in constant time.
- Verify amount, currency, business, package, router, phone and provider reference server-side.
- Replay the same webhook and prove there is exactly one payment completion, one customer session and one router activation event.
- Simulate delayed, duplicate, failed, cancelled and out-of-order callbacks.
- Simulate router offline at payment completion; retain the paid state and retry activation without another charge.
- Test all four operators with sandbox test numbers and then a low-value live transaction after provider approval.

## Hardware remains separate

No physical router is currently available. The cloud-side payment adapter can be tested with mocked HTTP and PayIn sandbox credentials, but real captive-portal redirect, automatic login, expiry and internet access require a compatible physical MikroTik RouterOS 7 router and a live internet connection. Do not buy hardware until the cloud payment and router integration tests are passing.
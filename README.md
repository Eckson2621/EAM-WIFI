# EAM-WIFI

EAM-WIFI is a multi-tenant Wi-Fi hotspot management application by EAM VENTURES. It uses Cloudflare Workers for the application API and static interface, and the existing Supabase project for authentication and data.

## Current foundation

- Supabase Auth email/password sign-up, sign-in and sign-out.
- Business onboarding for owner, business name, contact number, country, currency and timezone.
- Hotspot site registration, including branch name and physical address.
- Router metadata registration: brand, model, integration mode, optional LAN address and API port.
- A transaction-safe Supabase RPC creates the organization, owner membership, user profile, hotspot site, router record and organization settings together.
- Organization membership and Wi-Fi package lookup, scoped by the authenticated user's RLS permissions.\n- Manual paid voucher issuance: an owner/admin confirms the full package amount, records payment method and optional customer phone/reference, then issues exactly one fresh globally unique voucher code. A sales ledger records who confirmed the payment.\n- Platform subscription: each Wi-Fi business pays TSh 6,000 per month; registration remains pending until the platform administrator manually confirms payment and approves one month. Package access and voucher issuance are blocked when the subscription is pending or expired.\n- Customer portal: `/portal?site=<business-slug>` displays the business contact number, active packages and voucher entry. Voucher redemption atomically consumes the voucher and queues a session/router event.
- The Worker forwards the signed-in user's JWT and does not use a service-role key.

## Existing Supabase project

- Project ref: `jrgmzajlmuqpslhhroez`
- API URL: `https://jrgmzajlmuqpslhhroez.supabase.co`

The application reuses the existing database schema; it does not create duplicate tables. The registration function is also stored in `database/register_wifi_business.sql`.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm run dev
```

## Deploy to Cloudflare Workers

1. Open Cloudflare Dashboard → Workers & Pages → Create application → Import a repository.
2. Connect GitHub and select `Eckson2621/EAM-WIFI`, branch `main`.
3. Configure the Worker using the repository's `wrangler.toml`.
4. For automated deployment, add these GitHub repository Actions secrets:
   - `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with permission to edit Workers.
   - `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
5. Push to `main` or manually run the workflow from the Actions tab. It runs tests before deployment.

Never paste Cloudflare tokens, Supabase service-role keys, router passwords or payment secrets into source files, GitHub commits, browser code or chat. A live deployment is not confirmed until the workflow succeeds.

## Router connection status

Registration creates the router record but does **not** connect to the physical router. Router secure pairing, live RouterOS control, heartbeat/status updates, and processing the queued voucher redemption event to create/enable the MikroTik Hotspot user are still to be built and tested. The customer portal and database voucher validation queue exist, but a redeemed voucher does not provide internet until the paired MikroTik connector activates its queued session. Manual payment confirmation and one-code issuance are implemented as the owner-side workflow; no online payment provider is connected.

A private router address such as `192.168.88.1` cannot be reached directly from a public Cloudflare Worker. Do not expose an unrestricted router API port to the internet. The next integration step is a short-lived pairing flow and a router-side connector that initiates outbound HTTPS. See `docs/router-connection.md`, `docs/customer-portal.md` and the selected equipment plan in `docs/hardware-deployment.md`.

## Security status

- The registration RPC is `SECURITY INVOKER`, so caller grants and RLS remain in force.
- Only authenticated users can execute it; anonymous execution is revoked.
- The registration operation is atomic: if any record insert fails, the transaction rolls back.
- The router password/API secret is deliberately not collected or stored by the registration form.
- Security Advisor returned zero lint findings after the registration RPC was added. Real authenticated cross-organization tests and router pairing tests are still required before production use.

## Repository layout

```text
src/index.js                         Cloudflare Worker API
public/index.html                    Browser application and onboarding form
public/css/style.css                 Application styles
public/js/app.js                     Authentication, subscriptions and admin approval\npublic/portal.html                   Customer captive portal\npublic/js/portal.js                  Public package list and voucher submission
database/register_wifi_business.sql  Atomic Supabase registration RPC\ndatabase/global_unique_voucher_generation.sql  Global unique voucher generator\ndatabase/protect_redeemed_voucher_history.sql  Voucher history protection\ndatabase/manual_paid_voucher_issue.sql  Manual paid-voucher issuance and sales ledger\ndatabase/platform_monthly_subscription_approval.sql  TSh 6,000 monthly business subscription\ndatabase/public_wifi_portal_and_atomic_voucher_redemption.sql  Public portal and atomic redemption queue
docs/router-connection.md            Secure router pairing plan
tests/worker.test.js                 Basic Worker tests
.github/workflows/deploy.yml         Test and deploy workflow
wrangler.toml                        Cloudflare Worker configuration
package.json                         Scripts and Wrangler dependency
.dev.vars.example                    Local environment template
```

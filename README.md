# EAM-WIFI

EAM-WIFI is a multi-tenant Wi-Fi hotspot management application by EAM VENTURES. It uses Cloudflare Workers for the application API and static interface, and the existing Supabase project for authentication and data.

## Current foundation

- Supabase Auth email/password sign-up, sign-in and sign-out.
- Business onboarding for owner, business name, separate business contact and customer mobile-money payment numbers, optional payment instructions, country, currency and timezone.
- Hotspot site registration, including branch name and physical address.
- Router metadata registration: brand, model, integration mode, optional LAN address and API port.
- A transaction-safe Supabase RPC creates the organization, owner membership, user profile, hotspot site, router record and organization settings together.
- Organization membership and Wi-Fi package lookup, scoped by the authenticated user's RLS permissions.\n- Every owner/admin creates and edits their own packages (price, connected-time or wall-clock duration, validity, data cap, speed, max devices). Manual paid voucher issuance requires the exact package amount, records payment method and optional customer phone/reference, and issues one fresh globally unique one-time voucher code.\n- Platform subscription: each Wi-Fi business pays TSh 6,000 per month; registration remains pending until the platform administrator manually confirms payment and approves one month. Package access and voucher issuance are blocked when the subscription is pending or expired.\n- Customer portal: `/portal?site=<business-slug>` displays that business's contact number, payment number, instructions and active packages. The owner manually verifies payment to their own number, records it, and issues one voucher. Voucher redemption atomically consumes the voucher, returns one-time hotspot login credentials and queues a router event.
- The Worker forwards the signed-in user's JWT and does not use a service-role key.
- Private chat attachment bucket (`chat-attachments`) is provisioned as private, with participant-scoped Storage policies and a 15 MB file limit; the browser upload UI is not yet connected.
- Chat tables are enabled in the `supabase_realtime` publication with RLS, but the current chat screen still refreshes by polling; a Realtime client subscription is not yet wired.

## Existing Supabase project

- Project ref: `jvzjzmfnxytryzpylrqj`
- API URL: `https://jvzjzmfnxytryzpylrqj.supabase.co`

The application uses this project as its active database. Database schema and security updates are tracked in the Supabase migration history. The registration function is also stored in `database/register_wifi_business.sql`.

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

Registration creates the router record but does **not** connect to the physical router. The database and Worker now support one-time owner pairing, renewable router credentials, outbound heartbeat, authenticated event polling/acknowledgement, retries, and queued session-expiry events. An owner dashboard button provides a one-time token and RouterOS 7 connector script. The script creates/removes MikroTik Hotspot users, applies uptime/data/speed/shared-device limits, and acknowledges events. This is a connector template and has not yet been validated on a physical router; test exact model/RouterOS release before production. The customer portal and database voucher validation queue exist, but a redeemed voucher does not provide internet until the paired MikroTik connector activates its queued session. Manual payment confirmation and one-code issuance are implemented as the owner-side workflow; no online payment provider is connected.

A private router address such as `192.168.88.1` cannot be reached directly from a public Cloudflare Worker. Do not expose an unrestricted router API port to the internet. MikroTik initiates outbound HTTPS; no inbound router API port is required. See `docs/router-connection.md`, `docs/customer-portal.md` and the selected equipment plan in `docs/hardware-deployment.md`.

## Security status

- The registration RPC is `SECURITY INVOKER`, so caller grants and RLS remain in force.
- Only authenticated users can execute it; anonymous execution is revoked.
- The registration operation is atomic: if any record insert fails, the transaction rolls back.
- The router password/API secret is deliberately not collected or stored by the registration form.
- RLS is enabled on all 24 public application tables and both private credential/admin tables. Direct anonymous table privileges are revoked; public captive-portal and router-auth RPCs are the only intentional anonymous database entry points.
- Admin-only SECURITY DEFINER RPCs enforce the authenticated Super Admin identity in their function bodies. The private schema has no client table policies, so direct reads are denied; trusted definer functions perform the required internal lookups.
- Security Advisor currently reports leaked-password protection disabled in Supabase Auth. Enable it in Authentication → Settings → Password Security before production.
- Real authenticated cross-organization tests, browser-based chat attachment/realtime tests, and router pairing tests are still required before production use.

## Repository layout

```text
src/index.js                         Cloudflare Worker API
public/index.html                    Browser application and onboarding form
public/css/style.css                 Application styles
public/js/app.js                     Authentication, subscriptions and admin approval\npublic/portal.html                   Customer captive portal\npublic/js/portal.js                  Public package list and voucher submission
database/register_wifi_business.sql  Atomic Supabase registration RPC\ndatabase/supabase_completion_patch.sql  Database defaults, status and router heartbeat fixes\ndatabase/router_event_queue_rpc.sql  Secure router event claim/retry/acknowledgement RPCs\ndatabase/customer_payment_router_runtime.sql  Customer payment settings and router voucher/session runtime\ndatabase/business_registration_payment_details.sql  Atomic registration with separate customer payment number\npublic/downloads/eam-wifi-agent.rsc  MikroTik RouterOS 7 outbound event connector\ndatabase/global_unique_voucher_generation.sql  Global unique voucher generator\ndatabase/protect_redeemed_voucher_history.sql  Voucher history protection\ndatabase/manual_paid_voucher_issue.sql  Manual paid-voucher issuance and sales ledger\ndatabase/platform_monthly_subscription_approval.sql  TSh 6,000 monthly business subscription\ndatabase/public_wifi_portal_and_atomic_voucher_redemption.sql  Public portal and atomic redemption queue
docs/router-connection.md            Secure router pairing plan
tests/worker.test.js                 Basic Worker tests
.github/workflows/deploy.yml         Test and deploy workflow
wrangler.toml                        Cloudflare Worker configuration
package.json                         Scripts and Wrangler dependency
.dev.vars.example                    Local environment template
```


## Business payment, customer access and communication

- Each new business registration must enter a business contact phone and a separate customer payment phone. Payment phone and optional instructions are saved atomically with the business.
- Owners/admins can update those public details from the business package dashboard. Customers see the pay-to number and instructions on that business's captive portal.
- Customers pay the business directly. The owner must verify receipt, select the package, record amount/method/reference, and issue the voucher. Automatic confirmation from M-Pesa/Airtel Money/Tigo Pesa is not configured.
- Registered owners communicate with Super Admin through Help → Support messages. Messages are delivered to the Super Admin inbox, replies return to the owner, and owners can follow up. Platform subscription contact is 0613794448; it is not the business owner's customer payment number.
- Router pairing and customer voucher flow are implemented in code, but physical RouterOS, hotspot redirect, walled-garden, time/data exhaustion and reboot/outage tests remain required before production.

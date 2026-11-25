# EAM-WIFI

EAM-WIFI is a multi-tenant Wi-Fi hotspot management application by EAM VENTURES. It uses Cloudflare Workers for the application API and static interface, and Supabase for authentication and data.

## Current foundation

- Supabase Auth email/password sign-up, sign-in and sign-out.
- Business onboarding for owner, business name, separate business contact and customer mobile-money payment numbers, optional payment instructions, country, currency and timezone.
- Hotspot site registration, including branch name and physical address.
- Router metadata registration: brand, model, integration mode, optional LAN address and API port.
- A transaction-safe Supabase RPC creates the organization, owner membership, user profile, hotspot site, router record and organization settings together.
- Organization membership and Wi-Fi package lookup, scoped by the authenticated user's RLS permissions.
- Every owner/admin creates and edits their own packages (price, connected-time or wall-clock duration, validity, data cap, speed, max devices). Manual paid voucher issuance requires the exact package amount, records payment method and optional customer phone/reference, and issues one fresh globally unique one-time voucher code.
- Platform access: business registration is free and remains pending until the Super Admin approves the account. Each router is billed independently at TSh 7,500 per month after its five-minute first-connection trial; approval of one router does not activate another. Voucher issuance is blocked for a router whose own subscription is pending or expired.
- Customer portal: `/portal?site=<business-slug>` displays that business's contact number, payment number, instructions and active packages. The owner manually verifies payment to their own number, records it, and issues one voucher. Voucher redemption atomically consumes the voucher, returns one-time hotspot login credentials and queues a router event.
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

The GitHub Actions workflow deploys the existing Worker named `wifi` using `wrangler.toml`.

1. In Cloudflare Dashboard, open **Manage Account → API Tokens** and create an account-owned API token.
2. Give it **Workers → Editor** permission scoped to the existing Worker named `wifi`, or to the Workers product if that resource scope is unavailable. If `wifi` does not yet exist in the selected account, creating it requires Workers product-level **Admin**.
3. Make sure the token belongs to the Cloudflare account whose ID is `03295d1fe8b8e4fef8ce9c2cb32a2534`.
4. In GitHub, open **Settings → Secrets and variables → Actions** for this repository and replace the value of `WIFI_BUILD_TOKEN` with the new token. Do not paste the token into chat, source files, commits, screenshots or support messages.
5. Commit and push a change to `main`. The production workflow is automatic-only (push to `main`); it runs `npm test` before deploying. There is no manual deployment trigger.

The workflow already contains the account ID; a separate `CLOUDFLARE_ACCOUNT_ID` GitHub secret is not used. A token merely existing in GitHub is not proof that it has the correct account or permissions. A live deployment is not confirmed until the workflow succeeds.

## Router connection status

Registration creates the router record but does **not** connect to the physical router. The database and Worker support one-time owner pairing, renewable router credentials, outbound heartbeat, authenticated event polling/acknowledgement, retries, and queued session-expiry events. An owner dashboard button generates a one-time credential and a personalized RouterOS 7 installer with the token stored in the router script so it survives reboot. The script creates/removes MikroTik Hotspot users, applies uptime/data/speed/shared-device limits, and acknowledges events.

This is a connector template and has not yet been validated on a physical router; test the exact model and RouterOS release before production. The customer portal and database voucher validation queue exist, but a redeemed voucher does not provide internet until the paired MikroTik connector activates its queued session. Manual payment confirmation and one-code issuance are implemented as the owner-side workflow; no online payment provider is connected.

A private router address such as `192.168.88.1` cannot be reached directly from a public Cloudflare Worker. Do not expose an unrestricted router API port to the internet. MikroTik initiates outbound HTTPS; no inbound router API port is required. See `docs/router-connection.md`, `docs/customer-portal.md` and `docs/hardware-deployment.md`.

## Security status

- The registration RPC is `SECURITY INVOKER`, so caller grants and RLS remain in force.
- Only authenticated users can execute it; anonymous execution is revoked.
- The registration operation is atomic: if any record insert fails, the transaction rolls back.
- The router password/API secret is deliberately not collected or stored by the registration form.
- RLS is enabled on all 24 public application tables. Direct anonymous table privileges are revoked; public captive-portal and router-auth RPCs are intentional anonymous entry points.
- Admin-only `SECURITY DEFINER` RPCs enforce the authenticated Super Admin identity in their function bodies. The private schema has no client table policies, so direct reads are denied; trusted definer functions perform the required internal lookups.
- Super Admin access now requires a verified TOTP authenticator session (`aal2`). The database checks this in `private.is_platform_admin()`; the dashboard is held behind an enrollment/challenge screen until verification succeeds. Privileged router RPC implementations live in the non-exposed `private` schema with public `SECURITY INVOKER` wrappers.
- New account passwords are validated server-side: at least 12 characters, with uppercase, lowercase, a number and a symbol. This is not the same as checking against leaked passwords.
- Router subscription price validation is aligned to the current TSh 7,500/month price; the former database check incorrectly required TSh 6,000 and could block new router registration.
- Security Advisor no longer reports exposed public `SECURITY DEFINER` admin RPCs. The Worker signup route now checks new passwords against the Have I Been Pwned Pwned Passwords range API using k-anonymity (only the first five SHA-1 hash characters are sent); signup fails closed if the check service is unavailable. Supabase Auth's native leaked-password setting remains disabled on the current plan and still requires the supported paid plan to enable globally: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- All 24 public application tables have RLS enabled. A temporary two-business test (rolled back after execution) confirmed cross-business reads are isolated for organizations, routers, packages and router subscriptions; cross-business package insertion and approval-status changes were rejected.
- Automated Worker tests now cover MFA endpoint authentication, malformed factor/code rejection, weak-password rejection, and the existing public/protected API guards. Physical MikroTik pairing, captive-portal redirects, session expiry and real internet access still require hardware testing before production.

## Repository layout

```text
src/index.js                         Cloudflare Worker API
public/index.html                    Browser application and onboarding form
public/css/style.css                 Application styles
public/js/app.js                     Authentication, subscriptions and admin approval
public/portal.html                   Customer captive portal
public/js/portal.js                  Public package list and voucher submission
database/register_wifi_business.sql  Atomic Supabase registration RPC
database/supabase_completion_patch.sql  Database defaults, status and router heartbeat fixes
database/router_event_queue_rpc.sql  Secure router event claim/retry/acknowledgement RPCs
database/customer_payment_router_runtime.sql  Customer payment settings and router voucher/session runtime
database/business_registration_payment_details.sql  Atomic registration with separate customer payment number
database/platform_admin_system_health.sql  Super Admin system health diagnostics
database/router_heartbeat_freshness_guard.sql  Require fresh heartbeat before voucher redemption
database/network_device_member_status_read.sql  Let each business member inspect its router status
public/downloads/eam-wifi-agent-template.rsc  Unconfigured template personalized at router pairing
database/global_unique_voucher_generation.sql  Global unique voucher generator
database/protect_redeemed_voucher_history.sql  Voucher history protection
database/manual_paid_voucher_issue.sql  Manual paid-voucher issuance and sales ledger
database/platform_monthly_subscription_approval.sql  legacy business-subscription workflow (not the current per-router billing flow)
database/public_wifi_portal_and_atomic_voucher_redemption.sql  Public portal and atomic redemption
docs/router-connection.md            Secure router pairing and operational checklist
tests/worker.test.js                 Basic Worker request-validation tests
.github/workflows/deploy.yml         Test and deploy workflow
wrangler.toml                        Cloudflare Worker configuration
package.json                         Scripts and Wrangler dependency
.dev.vars.example                    Local environment template
```

## Business payment, customer access and communication

- Each new business registration must enter a business contact phone and a separate customer payment phone. Payment phone and optional instructions are saved atomically with the business.
- Owners/admins can update those public details from the business package dashboard. Customers see the pay-to number and instructions on that business's captive portal.
- Customers pay the business directly. The owner must verify receipt, select the package, record amount/method/reference, and issue the voucher. Automatic confirmation from M-Pesa/Airtel Money/Tigo Pesa is not configured.
- Registered owners communicate with Super Admin through Help → Support messages. Messages are delivered to the Super Admin inbox, replies return to the owner, and owners can follow up. Platform router subscription payment is manual via Airtel Lipa 653740570, recipient ECKSON AMULIKE MWAMPAJA; owners retain the TxID for Super Admin verification. Support calls/SMS/WhatsApp only: 0613794448. The support number is not the payment destination.
- Router pairing and customer voucher flow are implemented in code, but physical RouterOS, hotspot redirect, walled-garden, time/data exhaustion and reboot/outage tests remain required before production.

## Super Admin operational checks

Each business dashboard shows its own router heartbeat/pairing status. The Super Admin dashboard includes a System Health panel that queries the database for active/pending businesses, recent router heartbeats, stale/offline/unpaired routers, pending/processing/failed router events, queued/active/expired/blocked customer sessions, unused/redeemed vouchers, active/pending/expired subscriptions and new support messages. A router is counted online only when its last heartbeat is within two minutes. This is a cloud/database diagnostic; a real customer internet test still requires a phone connected to the physical hotspot.

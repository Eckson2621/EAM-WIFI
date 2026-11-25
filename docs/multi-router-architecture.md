# EAM-WIFI multi-router architecture

## Product decision
EAM-WIFI is a multi-tenant, multi-router platform. Business, package, payment, voucher, customer portal, session and reporting workflows must not depend on a specific router vendor. Router-specific behaviour belongs behind an adapter.

Selecting a vendor or entering a model name is not proof of compatibility. Only a model/firmware combination that passes the hardware acceptance suite may be advertised as fully supported.

## Shared platform responsibilities
The shared platform owns organizations, hotspot sites, members and router inventory; packages, prices, customer payment instructions and manual payment review; one-time voucher issuance and atomic redemption; customer portal pages and dashboards; router pairing identity, health, event delivery, retries and audit history; and a normalized access-session model.

The shared platform must never contain vendor-specific command strings in voucher, payment or customer-portal business logic.

## Adapter contract
Each adapter translates normalized platform operations to one router/controller integration. The minimum contract is:
- validateConfiguration(config): reject incomplete or unsafe setup.
- testConnection(config): report authenticated reachability and capabilities.
- provisionSession(session): create or update router-side access.
- revokeSession(session): remove/disable access and disconnect active clients when supported.
- getHealth(): report last contact, firmware/controller version and status.
- normalizeEvent(event): translate vendor events into platform events.

Adapters must declare capabilities explicitly. The platform must block an operation when the selected adapter does not advertise that capability. Retries must be idempotent; repeated events must not create duplicate accounts or sessions.

## Connection patterns
1. **Outbound agent:** a router or local gateway initiates HTTPS to EAM-WIFI. Preferred where inbound access to customer networks is unavailable. Pairing credentials are revocable and never placed in browser code.
2. **RADIUS:** a customer-owned RADIUS server/controller handles authentication and accounting. EAM-WIFI integrates through a dedicated, tested adapter and vendor-specific attribute profiles.
3. **Controller API:** a controller with a supported API is integrated through an adapter. Use outbound HTTPS/webhooks or a customer-side agent; do not expose management ports directly to the public internet.
4. **External portal handoff:** a router redirects unauthenticated clients to the hosted EAM-WIFI portal. This alone does not create accounts, enforce quotas or disconnect users; a provisioning/accounting integration is still required for full service.

## Initial adapter registry status
| Adapter | Current status | Important limitation |
|---|---|---|
| MikroTik RouterOS agent | Pilot | Existing RouterOS script and event flow; physical hardware tests still required |
| RADIUS-compatible controller | Planned | Requires a RADIUS server and verified attributes |
| Network controller API | Planned | Separate driver and model/firmware tests required |
| External captive portal | Limited | Redirect/display only; no independent voucher provisioning |

Planned adapters must not be labelled supported in customer-facing screens.

## Vendor integration setup contracts (implemented catalogue)

The public `/api/router-adapters` catalogue now exposes explicit setup paths for:
- **Ubiquiti:** UniFi Network Controller API or external RADIUS.
- **TP-Link:** Omada Software/Hardware Controller API or external RADIUS. Standalone consumer routers are excluded from the Omada path.
- **Huawei:** external RADIUS/AAA as the generic route; a Huawei controller/API path remains model-family assessment required.

The onboarding form loads these choices from the catalogue instead of presenting a generic MikroTik integration for every brand. The Worker also provides a metadata validator for required controller/RADIUS fields, HTTPS-only controller URLs, and valid RADIUS ports. It deliberately does not store or echo secrets.

Important release boundary: these are implemented configuration contracts and onboarding choices, **not live vendor drivers**. No vendor is marked production-supported and automatic voucher activation remains disabled until a real controller/device, credentials, firmware, RADIUS attributes, accounting, disconnect/CoA and captive-portal flow pass hardware acceptance tests. The application currently has no secure controller-credential vault or outbound controller agent; do not enter controller passwords into public fields or browser storage.

## Customer purchase and access flow
1. The client joins the Wi-Fi network.
2. The router/controller redirects the client to the business-specific portal.
3. The portal displays packages, duration, price and the business payment instructions.
4. The customer pays the business through an ordinary mobile-money channel.
5. The business owner independently checks the payment and approves the request in EAM-WIFI.
6. EAM-WIFI issues one unique voucher and creates a normalized access request.
7. The selected router adapter provisions the session.
8. Only after the adapter confirms provisioning does the portal show successful access/login instructions. Failed provisioning must be visible and retryable; it must not silently consume a customer's purchase.

Payment provider APIs are not required for this manual-confirmation workflow. EAM-WIFI must not claim automatic payment confirmation unless a provider integration is separately configured and tested.

## Security and reliability
- Never port-forward Winbox, RouterOS API, controller admin ports or RADIUS management interfaces to the public internet as a shortcut.
- Keep router/controller secrets out of browser JavaScript, logs and URLs. Encrypt recoverable credentials; hash bearer pairing tokens.
- Scope every router, package, voucher, event and session to the owning organization and site.
- Use unique event IDs, idempotency keys, bounded retries and explicit acknowledgements.
- Record who approved a manual payment, when, amount, reference and which voucher/session was issued.
- If a router is offline, show a pending state. Do not claim internet access until provisioning is confirmed and a real client test succeeds.

## Delivery phases
1. Extract the current MikroTik-specific runtime behind the adapter boundary without changing existing voucher/payment rules.
2. Add adapter selection, capability display and connection diagnostics to the owner dashboard.
3. Complete MikroTik hardware acceptance tests: pairing, redirect, redemption, quotas, expiry, duplicate events, reboot and WAN outage.
4. Add a RADIUS adapter and test it against a known RADIUS server/controller.
5. Add controller-specific adapters only after obtaining a test device/API and completing the same acceptance suite.
6. Add a compatibility catalogue recording exact tested models, firmware versions, capabilities and limitations.

## Release gate
The platform is multi-router-ready at the architecture level, but a vendor is not production-supported until its adapter and exact hardware/firmware profile pass release acceptance tests. The existing MikroTik integration remains a pilot until physical tests are completed.

# Router connection and operational plan

## What business registration captures

The business onboarding form records:
- Router brand and model.
- Hotspot site and physical address.
- Router display name.
- Integration mode.
- Optional LAN management address and API port as setup references only.

No router password, API secret, or shared key is collected or written to the public database by this registration flow.

## Network security

A router LAN address such as `192.168.88.1` is private and cannot be reached directly from a public Cloudflare Worker. A public router API port should not be exposed to the internet. The supported connector uses router-initiated outbound HTTPS.

## Implemented pairing and connector foundation

1. An authenticated business owner requests a one-time pairing challenge from EAM-WIFI.
2. The Worker generates a 256-bit random credential with a 10-minute initial pairing window.
3. Only the SHA-256 credential hash is stored in restricted `private.router_device_credentials`.
4. The router-side RouterOS script initiates outbound HTTPS heartbeat and event polling to the Worker.
5. The Worker authenticates the router by credential hash, queues events and accepts authenticated acknowledgements.
6. After first successful pairing, the database renews the device credential for one year. A fresh pairing can rotate/revoke a credential.

The owner dashboard returns a personalized installer containing the one-time token. Keep that installer private: it contains the router credential. Do not paste it into support messages, screenshots or GitHub.

## MikroTik RouterOS connector

The connector template is stored at `public/downloads/eam-wifi-agent-template.rsc`; the Worker personalizes it for each owner pairing. The configured file is downloaded from the owner dashboard, uploaded through Winbox/WebFig Files, then imported with:

```routeros
/import file-name=eam-wifi-agent.rsc
```

The script is designed for RouterOS 7.13+ and:
- Sends outbound HTTPS heartbeat to `https://wifi.eckson.workers.dev/api/router/heartbeat`.
- Polls `/api/router/events` every 15 seconds.
- Creates the Hotspot user/profile for voucher-redemption events.
- Removes the Hotspot user for session-expiry events.
- Acknowledges each event through `/api/router/events/complete`.
- Does not open an inbound RouterOS API port.

Allow DNS and outbound TCP 443 from the router. MikroTik Hotspot is the first supported integration; arbitrary router brands are not remotely provisioned yet.

## What the connector does not configure

The router must already have a working WAN/ISP internet connection, DNS, DHCP and a HotSpot server on the customer-facing bridge/interface. The connector does not configure the ISP uplink, Wi-Fi radio, DHCP pool, NAT or create the HotSpot server.

Before allowing customer use:
- Add the EAM-WIFI hostname to the HotSpot walled garden so unauthenticated clients can reach the HTTPS portal.
- Configure the HotSpot login profile to use `http-pap` for the external login form, or HTTPS login with a valid certificate. CHAP-only login does not accept the external portal's plain username/password form.
- Ensure HotSpot `login.html` redirects with the business slug, client MAC, `link-login-only` and `link-orig` values. Use the URLSearchParams snippet shown by the owner dashboard so the router URL is encoded safely.
- MikroTik rate-limit creates simple queues. FastTracked traffic can bypass simple queue limits; exclude HotSpot client traffic from FastTrack or disable FastTrack for that traffic, then test actual speeds.

## Required physical-router acceptance tests

Do not declare production-ready until these tests pass on the exact router model and RouterOS release:

1. Confirm the router appears Online in the business dashboard after pairing.
2. Confirm the router event queue is empty after test events are acknowledged.
3. Create a low-value test package and issue a test voucher after recording test payment.
4. Redeem from a phone on the hotspot; confirm automatic router login and actual internet access.
5. Confirm `/ip hotspot user print` shows the EAM-WIFI user with expected uptime/data/profile limits.
6. Test duplicate redemption, wrong code, wrong business, disabled package, expired voucher and offline router; all must be rejected.
7. Test connected-time exhaustion, data-cap exhaustion and wall-clock expiry. Confirm the active user is disconnected/removed and the database session reaches the expected status.
8. Repeat after router reboot and temporary internet outage.

A database heartbeat or simulator is not proof that customer internet access works. A real router and a connected phone are required for acceptance testing.

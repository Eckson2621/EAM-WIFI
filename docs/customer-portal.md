# EAM-WIFI customer Wi-Fi portal

Each business has its own public captive portal:
https://wifi.eckson.workers.dev/portal?site=<organization-slug>

Owners can edit the business contact number, mobile-money payment number and payment instructions. These are shown to customers.

## Customer purchase and access flow

1. Customer connects to the business Wi-Fi network; MikroTik Hotspot redirects the phone to the business portal.
2. Portal displays the business packages, prices, duration, limits, contact phone and payment number.
3. Customer pays the exact package price directly to the business using the displayed mobile-money number or another payment method accepted by the owner.
4. Owner verifies the money arrived, records payment method/reference in EAM-WIFI, then issues one unique voucher from the package card.
5. Owner gives the voucher to the customer.
6. Customer enters the voucher on the same captive portal. Database checks business subscription, active router, package and unused voucher; it consumes the voucher once and queues a router event.
7. Portal receives one-time Hotspot username/password and submits them to the router's local link-login-only endpoint.
8. Router applies package limits. Connected-time uses RouterOS limit-uptime; data caps use limit-bytes-total; speed and shared-device limits use a dedicated Hotspot profile. Wall-clock expiry is queued by the database and the connector removes the Hotspot user when that event is polled.

Payment automation note: Customers pay the business, not EAM-WIFI. EAM-WIFI is not currently connected to M-Pesa, Airtel Money, Tigo Pesa or bank payment APIs. The owner manually verifies incoming money before issuing a voucher. Do not claim automatic mobile-money confirmation until a provider and authorized API credentials are configured.

## Captive portal configuration

The MikroTik Hotspot login page must redirect to EAM-WIFI and preserve the router login URL, original destination and client MAC. In a copy of the router's Hotspot login.html, use a redirect block like this and replace the business slug with the slug shown in the owner dashboard:

```html
<script>
  const portal = new URL("https://wifi.eckson.workers.dev/portal");
  portal.searchParams.set("site", "YOUR-ORGANIZATION-SLUG");
  portal.searchParams.set("mac", "$(mac)");
  portal.searchParams.set("link-login-only", "$(link-login-only)");
  portal.searchParams.set("link-orig", "$(link-orig)");
  window.location.replace(portal.toString());
</script>
```

Using URLSearchParams safely encodes the router's login URL even when that URL contains its own query parameters. The hosted portal auto-posts credentials only to a private IPv4 router address (10/8, 172.16/12 or 192.168/16), preventing a modified portal URL from sending generated hotspot credentials to an arbitrary external host.

Allow the EAM-WIFI hostname before login. On the MikroTik, add it to the Hotspot walled garden:

```routeros
/ip hotspot walled-garden add dst-host=wifi.eckson.workers.dev action=allow
```

Confirm the actual RouterOS version's login-page variables and test the redirect from a phone before replacing the production login page.

## Voucher and timer enforcement

- Voucher codes are globally unique, one-time-use, and stored as hashes; plaintext codes are shown only at issuance.
- A voucher cannot be redeemed without an active business subscription and an online paired MikroTik router.
- Database creates one access session and router event for successful redemption.
- RouterOS connector polls the event queue over outbound HTTPS every 15 seconds and acknowledges success/failure.
- Connected-time is enforced by RouterOS limit-uptime; data caps by limit-bytes-total; profile speed and shared-user limits are applied per session.
- Wall-clock/validity expiry is queued by the database and the router removes the active user on its next successful poll (normally within one polling interval while connected).
- If the router loses internet connectivity, cloud-side expiry events cannot reach it until it reconnects. RouterOS connected-time and data limits remain local; wall-clock expiry removal is delayed until connectivity returns. Do not advertise offline wall-clock enforcement as instantaneous.

## Platform subscription and support

Every Wi-Fi business pays EAM-WIFI TSh 6,000 per month. New registrations remain pending until Super Admin confirms payment and activates the subscription. Platform billing contact: 0613794448. This is separate from each business's own customer payment number.

Registered owners can send support messages and reply to Super Admin from the in-app Help/Support section. Super Admin can view the support inbox and reply in the platform dashboard.

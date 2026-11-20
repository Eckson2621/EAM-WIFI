# EAM-WIFI customer portal

Each business has a public portal URL:

`https://<your-worker-domain>/portal?site=<organization-slug>`

The owner dashboard includes an **Open customer Wi-Fi portal** link. The portal reads only public business details: business name, business contact number and active packages.

## Captive portal behavior

1. A customer connects to the business Wi-Fi and is redirected to the EAM-WIFI portal.
2. The portal displays the business phone number and packages.
3. The customer calls the business and purchases a voucher.
4. The owner issues one voucher from the authenticated dashboard after manually confirming payment.
5. The customer enters the voucher code on the portal.
6. The database checks the voucher once, marks it redeemed and queues an access session/router event.

For a MikroTik Hotspot, the final captive-portal redirect must pass the organization slug and the client MAC address to the portal. The intended URL shape is:

`https://<your-worker-domain>/portal?site=<organization-slug>&mac=$(mac)`

This is a template reference, not a completed MikroTik configuration. Confirm the exact Hotspot login-page behavior against the router's RouterOS version before replacing the production login page.

## Router activation status

The database refuses to consume a voucher unless the organization has an active platform subscription and a MikroTik device marked `connection_status = 'connected'`. Redemption then queues a session and a `voucher_redemption_requested` router event.

The secure MikroTik pairing agent that authenticates to EAM-WIFI, receives this event, creates/enables the Hotspot user and reports session activation is not yet implemented. Therefore the portal and one-time voucher validation queue are built, but internet access is not yet granted by a live router. Do not advertise the portal as fully operational until pairing and live RouterOS tests pass.

## Platform subscription

Every Wi-Fi business pays TSh 6,000 for one month. Registration remains pending until the platform administrator manually confirms payment. The subscription approval screen records the payment method/reference and activates access for one month. Expired subscriptions cannot load packages or issue vouchers.

# EAM-WIFI customer portal

Each business has a public portal URL:

`https://<your-worker-domain>/portal?site=<organization-slug>`

The owner dashboard includes an **Open customer Wi-Fi portal** link. The portal reads only public business details: business name, business contact number and active packages.

## Captive portal behavior

1. A customer selects the business Wi-Fi network on their phone.
2. MikroTik Hotspot automatically redirects the phone to the EAM-WIFI captive portal; Android/iPhone should show the built-in "Sign in to Wi-Fi network" prompt. The customer must not search Google or manually type a website address.
3. The portal displays the business phone number and packages.
3. The customer calls the business and purchases a voucher.
4. The owner issues one voucher from the authenticated dashboard after manually confirming payment.
5. The customer enters the voucher code on the portal.
6. The database checks the voucher once, marks it redeemed and queues an access session/router event.

The customer-facing flow is intended to happen inside the Wi-Fi sign-in screen, not through Google search. Phones commonly display a system captive-portal pop-up/webview to render the login page; this is part of joining Wi-Fi, not asking the customer to browse Google.

For a MikroTik Hotspot, the final captive-portal redirect must pass the organization slug and the client MAC address to the portal. The business owner must configure the router's Hotspot login page and walled-garden access so the phone can reach the portal before authentication. The intended URL shape is:

`https://<your-worker-domain>/portal?site=<organization-slug>&mac=$(mac)`

This is a template reference, not a completed MikroTik configuration. Confirm the exact Hotspot login-page behavior against the router's RouterOS version before replacing the production login page.

## Router activation status

The database refuses to consume a voucher unless the organization has an active platform subscription and a MikroTik device marked `connection_status = 'connected'`. Redemption then queues a session and a `voucher_redemption_requested` router event.

The secure MikroTik pairing agent that authenticates to EAM-WIFI, receives this event, creates/enables the Hotspot user and reports session activation is not yet implemented. Therefore the portal and one-time voucher validation queue are built, but internet access is not yet granted by a live router. Do not advertise the portal as fully operational until pairing and live RouterOS tests pass.

## Platform subscription

Every Wi-Fi business pays TSh 6,000 for one month. Registration remains pending until the platform administrator manually confirms payment. The subscription approval screen records the payment method/reference and activates access for one month. Expired subscriptions cannot load packages or issue vouchers.


## EAM-WIFI platform contact

Business owners who register and need to pay the platform subscription should call **0613794448**. The app displays this number with a tap-to-call link when the business is waiting for approval or renewal. This is the EAM-WIFI platform billing contact, not the phone number each Wi-Fi business displays to its own customers.

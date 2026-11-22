# EAM-WIFI reference hardware deployment

## Selected reference topology

This is the default design target for the first small outdoor hotspot installation:

- **Gateway / hotspot controller:** MikroTik hAP ax² (C52iG-5HaxD2HaxD), running RouterOS v7.
- **Outdoor Wi-Fi radio:** TP-Link Omada EAP650-Outdoor (AX3000).
- **Mode:** EAP650-Outdoor operates as an access point/bridge. MikroTik remains the single Hotspot gateway and source of truth for voucher authentication, time limits, data limits and session termination.
- **Target coverage:** 50–100 metres from the outdoor AP in a suitable open installation. This is a design target, not a guaranteed radius. Walls, trees, interference, client phone antenna and legal transmit-power limits can reduce coverage. A site survey and real phone tests are required.
- **Power:** use the EAP's supported PoE injector/switch and cable length/power arrangement from the current product manual. Protect outdoor cable runs and provide proper surge/lightning protection and grounding as required by local installation practice.

## Logical wiring

```text
ISP modem / ONT
      |
      | Ethernet
      v
MikroTik hAP ax² (WAN)
MikroTik Hotspot + DHCP + firewall
      |
      | LAN / PoE injector or PoE switch (correct power standard)
      v
TP-Link EAP650-Outdoor (AP/bridge mode)
      |
      | 2.4 GHz / 5 GHz Wi-Fi
      v
Customer phones and laptops
```

The EAP is not a second router and must not run a separate DHCP server or NAT for this hotspot. Keep customer traffic on the MikroTik-controlled hotspot network/VLAN. Do not connect the EAP's PoE port directly to a MikroTik port unless the power standard and port capability are confirmed; use the supplied/compatible injector or switch.

## Voucher behavior

Each Wi-Fi package maps to RouterOS Hotspot user/session attributes, for example:

- Package price: payment/business ledger only; RouterOS does not infer price from the code.
- Duration: RouterOS session timeout / limit.
- Data allowance: RouterOS byte quota, when configured.
- Speed: RouterOS rate limit / queue.
- Device limit: enforced by the EAM-WIFI session policy and RouterOS user profile where supported.

EAM-WIFI must send the package's actual attributes to the router connector. A TSh 500 voucher is not automatically one hour: the business owner defines the package duration, speed and data allowance in EAM-WIFI, and the connector applies those values.

## Implemented cloud-side integration foundation (physical validation pending)

The current application includes authenticated owner pairing, hashed router credentials, router-initiated HTTPS heartbeat, event polling and acknowledgement, queued voucher redemption, and a RouterOS 7 agent template. The database now requires an active TSh 6,000/month router subscription before accepting voucher redemption or router events. The agent template has not yet passed a real-router test, so do not treat this as production-ready.

Remaining work before customer production use:

1. Update and validate the RouterOS agent so an inactive/expired router subscription disables EAM-WIFI hotspot access on the physical router, including existing active sessions.
2. Pair each MikroTik using the owner dashboard and verify the token is never exposed in ordinary logs or support messages.
3. Configure MikroTik Hotspot login redirect and walled garden so the captive portal is reachable before authentication. Validate the portal's MAC parameter and HTTPS redirect behavior on actual Android and iOS devices.
4. Confirm event retries are idempotent and a failed RouterOS apply cannot result in a paid voucher being silently lost.
5. Report connected-time usage, data counters and disconnection/expiry status back to EAM-WIFI.
6. Run security tests, replay tests, duplicate-event tests, router-offline tests, reboot tests and real customer-session tests.

## Safe rollout checklist

- [ ] Confirm exact hardware revisions and current vendor manuals before purchase.
- [ ] Install RouterOS updates and secure the MikroTik admin account.
- [ ] Keep router management on a private management LAN; disable WAN management.
- [ ] Configure WAN, firewall, DHCP, Hotspot and customer isolation.
- [ ] Configure EAP650-Outdoor in AP/bridge mode with DHCP/NAT disabled.
- [ ] Confirm PoE voltage/standard and use suitable outdoor-rated cabling and protection.
- [ ] Pair the router using the EAM-WIFI secure pairing workflow.
- [ ] Confirm a test voucher creates a RouterOS user with the exact configured package limits.
- [ ] Confirm session expiry disconnects the customer automatically.
- [ ] Test captive portal pop-up and coverage at 50 m and 100 m with several phones.
- [ ] Confirm router failure does not falsely mark a customer as online or lose a paid voucher.

## Current status

The cloud-side pairing, heartbeat, queue and acknowledgement foundation exists, and router subscription checks are enforced in Supabase. No physical router has yet been paired or tested. In particular, local RouterOS access revocation after a router subscription expires, connected-time/data usage synchronization, captive-portal redirect behavior and real internet access remain unverified. No live 50–100 m coverage has been measured. Do not treat this as production-ready until the physical acceptance checklist passes.

# EAM-WIFI Router Connector API (initial secure pairing layer)

## Endpoints

### Create a one-time router credential
`POST /api/router/pair`

Requires a valid Supabase user access token belonging to an active organization owner/admin. JSON:

```json
{ "organization_id": "YOUR-ORGANIZATION-UUID" }
```

The Worker generates 256 bits of random entropy, stores only its SHA-256 hash in the restricted `private.router_device_credentials` table, revokes prior credentials for that router, and returns the plaintext token once. The token expires after 10 minutes if not used. Do not log or share it. The business dashboard does not yet expose a pairing button; this endpoint is the current integration interface.

### Router heartbeat
`POST /api/router/heartbeat`

The MikroTik initiates outbound HTTPS and sends `Authorization: Bearer <device-token>`. The Worker hashes the token and asks the database to authenticate it. A valid heartbeat updates device last-seen and connected status. No inbound port or public RouterOS API is needed.

## RouterOS v7 starter

See `mikrotik/eam-wifi-heartbeat.rsc`. Replace the Worker URL and one-time token privately on the router. This script only verifies outbound authenticated heartbeat connectivity. It does not provision hotspot users or apply voucher limits.

## Security

- Device tokens are generated with Web Crypto and only SHA-256 hashes are stored in the restricted private schema.
- Credentials expire if not activated within 10 minutes and can be revoked by issuing a replacement.
- Router management/API ports must remain private; do not port-forward Winbox or RouterOS API.
- Do not paste device tokens into chat, tickets, GitHub, or public dashboard fields.
- Use HTTPS only.

## Not implemented yet

The job-polling/acknowledgement protocol, RouterOS Hotspot user creation, session timeout/quota/rate-limit enforcement, captive portal redirect and safe voucher rollback on router activation failure are still outstanding. A successful heartbeat is NOT proof that voucher redemption works.

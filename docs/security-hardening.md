# EAM-WIFI security hardening

## Enforced controls

- Super Admin authorization requires a verified TOTP session with JWT assurance level `aal2`.
- The active platform administrator is resolved by the server-side `private.platform_admins` table, not by a client-supplied role.
- The browser app enrolls an authenticator on first Super Admin login, then challenges the code on subsequent logins and restored sessions.
- Database authorization checks `private.is_platform_admin()`; privileged dashboard and approval functions therefore reject AAL1 sessions even if the UI is bypassed.
- Router subscription approval/list implementations are stored in the non-exposed `private` schema. REST-facing wrappers are `SECURITY INVOKER`.
- Organization owners can update only the business contact phone directly. They cannot change the organization approval status or owner ID.
- Signup password checks run in the Worker, not only in browser validation: minimum 12 characters with uppercase, lowercase, digit and symbol.
- Router subscription price check, default and approval code all use TSh 7,500/month.
- Business approval uses the free per-router billing path; the obsolete organization-wide approval RPC that wrote a TSh 6,000 business payment was revoked from `authenticated` and `anon`.
- Router credentials are hashed before database lookup; router connections initiate outbound HTTPS and no router management port should be exposed publicly.

## Verification performed

- Supabase Security Advisor no longer flags the two public admin router RPCs as exposed `SECURITY DEFINER` functions.
- Simulated database checks returned false for the active administrator at `aal1` and true at `aal2`.
- A temporary two-business fixture tested RLS isolation for organizations, network devices, Wi-Fi packages and router subscriptions. Cross-organization package insertion and attempts to change another business's approval status were rejected. All fixture rows were rolled back.
- GitHub Actions completed the Worker test suite and Cloudflare deployment successfully after the MFA changes.

## Remaining limits

- Supabase leaked-password protection remains disabled because Supabase documents it as available on Pro Plan and above. The Worker password-strength rule is not a replacement for the HaveIBeenPwned check.
- No physical MikroTik router has been connected for end-to-end testing. Pairing, hotspot redirect, walled-garden, uptime/data limits, reboot recovery and internet access must be tested with the actual router and RouterOS version.
- No security claim can guarantee that the application is impossible to compromise. Continue monitoring logs, rotate secrets if exposed, patch dependencies, and review Supabase Security Advisor regularly.

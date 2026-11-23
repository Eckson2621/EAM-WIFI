-- The old organization-wide approval RPC creates a TSh 6,000 business payment.
-- Current EAM-WIFI billing is free business registration plus per-router subscriptions.
-- The active dashboard uses platform_admin_approve_subscription_period instead.
REVOKE EXECUTE ON FUNCTION public.platform_admin_approve_subscription(uuid, text, text)
FROM PUBLIC, anon, authenticated;

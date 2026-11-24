-- EAM-WIFI: business registration is free; only routers are billed.
-- The legacy TZS 6,000 organization subscription is not an access gate or a fee.

CREATE OR REPLACE FUNCTION public.platform_subscription_status(p_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'active', true,
    'status', 'free',
    'billing_model', 'per_router',
    'monthly_price_tzs', 0,
    'router_monthly_price_tzs', 7500,
    'expires_at', NULL
  )
  WHERE EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
      AND (
        o.owner_user_id = (SELECT auth.uid())
        OR public.is_org_admin(o.id)
        OR public.is_org_member(o.id)
        OR lower(coalesce((SELECT auth.jwt())->>'email','')) = 'mwalimueckson2104@gmail.com'
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_approve_subscription(
  p_organization_id uuid,
  p_payment_method text,
  p_payment_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.platform_admin_approve_subscription_period(
    p_organization_id, p_payment_method, p_payment_reference, 1
  );
$function$;

REVOKE ALL ON FUNCTION public.platform_subscription_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_subscription_status(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_approve_subscription(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_approve_subscription(uuid,text,text) TO authenticated;

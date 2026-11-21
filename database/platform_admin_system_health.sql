-- Super Admin system health and router/customer access diagnostics.
CREATE OR REPLACE FUNCTION private.platform_admin_system_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_platform_admin() THEN
  RAISE EXCEPTION 'Platform administrator permission required' USING errcode='42501';
 END IF;
 SELECT jsonb_build_object(
  'checked_at',now(),
  'businesses_total',(SELECT count(*) FROM public.organizations),
  'businesses_active',(SELECT count(*) FROM public.organizations WHERE status='active'),
  'businesses_pending',(SELECT count(*) FROM public.organizations WHERE status='pending'),
  'routers_total',(SELECT count(*) FROM public.network_devices),
  'routers_online',(SELECT count(*) FROM public.network_devices WHERE connection_status='online' AND last_seen_at>now()-interval '2 minutes'),
  'routers_stale',(SELECT count(*) FROM public.network_devices WHERE connection_status='online' AND (last_seen_at IS NULL OR last_seen_at<=now()-interval '2 minutes')),
  'routers_offline',(SELECT count(*) FROM public.network_devices WHERE connection_status IN ('offline','error')),
  'routers_not_configured',(SELECT count(*) FROM public.network_devices WHERE connection_status IN ('not_configured','pairing_pending')),
  'router_events_pending',(SELECT count(*) FROM public.router_events WHERE processing_status='pending'),
  'router_events_processing',(SELECT count(*) FROM public.router_events WHERE processing_status='processing'),
  'router_events_failed',(SELECT count(*) FROM public.router_events WHERE processing_status='failed'),
  'sessions_queued',(SELECT count(*) FROM public.access_sessions WHERE session_status='queued'),
  'sessions_active',(SELECT count(*) FROM public.access_sessions WHERE session_status='active'),
  'sessions_expired',(SELECT count(*) FROM public.access_sessions WHERE session_status='expired'),
  'sessions_blocked',(SELECT count(*) FROM public.access_sessions WHERE session_status='blocked'),
  'vouchers_unused',(SELECT count(*) FROM public.vouchers WHERE status='unused'),
  'vouchers_redeemed',(SELECT count(*) FROM public.vouchers WHERE status='redeemed'),
  'support_new',(SELECT count(*) FROM public.support_messages WHERE status='new'),
  'subscriptions_active',(SELECT count(*) FROM public.platform_subscriptions WHERE status='active' AND expires_at>now()),
  'subscriptions_expired',(SELECT count(*) FROM public.platform_subscriptions WHERE status='active' AND expires_at<=now()),
  'subscriptions_pending',(SELECT count(*) FROM public.platform_subscriptions WHERE status<>'active')
 ) INTO v_result;
 RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.platform_admin_system_health()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 SELECT private.platform_admin_system_health();
$function$
;

REVOKE ALL ON FUNCTION private.platform_admin_system_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.platform_admin_system_health() TO authenticated;
REVOKE ALL ON FUNCTION public.platform_admin_system_health() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_system_health() TO authenticated;

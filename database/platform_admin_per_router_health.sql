create or replace function private.platform_admin_system_health()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not private.is_platform_admin() then
  raise exception 'Platform administrator permission required' using errcode='42501';
 end if;
 select jsonb_build_object(
  'checked_at',now(),
  'businesses_total',(select count(*) from public.organizations),
  'businesses_active',(select count(*) from public.organizations where status='active'),
  'businesses_pending',(select count(*) from public.organizations where status='pending'),
  'routers_total',(select count(*) from public.network_devices),
  'routers_online',(select count(*) from public.network_devices where connection_status='online' and last_seen_at>now()-interval '2 minutes'),
  'routers_stale',(select count(*) from public.network_devices where connection_status='online' and (last_seen_at is null or last_seen_at<=now()-interval '2 minutes')),
  'routers_offline',(select count(*) from public.network_devices where connection_status in ('offline','error')),
  'routers_not_configured',(select count(*) from public.network_devices where connection_status in ('not_configured','pairing_pending')),
  'router_events_pending',(select count(*) from public.router_events where processing_status='pending'),
  'router_events_processing',(select count(*) from public.router_events where processing_status='processing'),
  'router_events_failed',(select count(*) from public.router_events where processing_status='failed'),
  'sessions_queued',(select count(*) from public.access_sessions where session_status='queued'),
  'sessions_active',(select count(*) from public.access_sessions where session_status='active'),
  'sessions_expired',(select count(*) from public.access_sessions where session_status='expired'),
  'sessions_blocked',(select count(*) from public.access_sessions where session_status='blocked'),
  'vouchers_unused',(select count(*) from public.vouchers where status='unused'),
  'vouchers_redeemed',(select count(*) from public.vouchers where status='redeemed'),
  'support_new',(select count(*) from public.support_messages where status='new'),
  'subscriptions_active',(select count(*) from public.router_subscriptions where status='active' and expires_at>now()),
  'subscriptions_expired',(select count(*) from public.router_subscriptions where status='active' and expires_at<=now()),
  'subscriptions_pending',(select count(*) from public.router_subscriptions where status in ('pending','suspended'))
 ) into v_result;
 return v_result;
end $$;

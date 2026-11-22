create or replace function public.platform_admin_list_router_subscriptions()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not private.is_platform_admin() then
  raise exception 'Platform administrator permission required' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',d.id,'organization_id',d.organization_id,'name',d.name,'vendor',d.vendor,'model',d.model,
  'connection_status',d.connection_status,'last_seen_at',d.last_seen_at,'created_at',d.created_at,
  'organization',jsonb_build_object('name',o.name,'contact_phone',o.contact_phone),
  'site',jsonb_build_object('name',hs.name,'slug',hs.slug),
  'router_subscriptions',jsonb_build_object('status',rs.status,'expires_at',rs.expires_at,'monthly_price_tzs',rs.monthly_price_tzs)
 ) order by d.created_at desc),'[]'::jsonb)
 into v_result
 from public.network_devices d
 join public.organizations o on o.id=d.organization_id
 left join public.hotspot_sites hs on hs.id=d.site_id
 left join public.router_subscriptions rs on rs.device_id=d.id;
 return v_result;
end $$;
revoke all on function public.platform_admin_list_router_subscriptions() from public,anon;
grant execute on function public.platform_admin_list_router_subscriptions() to authenticated;

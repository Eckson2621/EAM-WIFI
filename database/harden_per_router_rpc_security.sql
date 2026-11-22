create or replace function public.create_additional_router(
 p_organization_id uuid,p_site_name text,p_site_address text,p_router_name text,
 p_router_vendor text,p_router_model text,p_integration_type text
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_site_id uuid; v_device_id uuid; v_slug text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
  and m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin')) then
  raise exception 'Business owner or administrator permission required' using errcode='42501'; end if;
 if not exists(select 1 from public.organizations o where o.id=p_organization_id and o.status='active') then
  raise exception 'Business must be approved before adding another router' using errcode='23514'; end if;
 if length(trim(coalesce(p_site_name,'')))<2 or length(trim(coalesce(p_router_name,'')))<2 then
  raise exception 'Site and router names are required' using errcode='22023'; end if;
 if p_router_vendor not in ('mikrotik','ubiquiti','tp_link','huawei','other') then raise exception 'Unsupported router vendor' using errcode='22023'; end if;
 if p_integration_type not in ('mikrotik_hotspot','routeros_api','manual','other') then raise exception 'Unsupported integration type' using errcode='22023'; end if;
 insert into public.hotspot_sites(organization_id,name,address,status)
 values(p_organization_id,trim(p_site_name),nullif(trim(coalesce(p_site_address,'')),'') ,'active') returning id into v_site_id;
 insert into public.network_devices(organization_id,site_id,name,vendor,model,integration_type,connection_status,config)
 values(p_organization_id,v_site_id,trim(p_router_name),p_router_vendor,nullif(trim(coalesce(p_router_model,'')), ''),
 p_integration_type,'not_configured',jsonb_build_object('setup_state','awaiting_secure_pairing','credentials_provisioned',false))
 returning id into v_device_id;
 select slug into v_slug from public.hotspot_sites where id=v_site_id;
 return jsonb_build_object('site_id',v_site_id,'device_id',v_device_id,'site_slug',v_slug,'subscription_status','pending','monthly_price_tzs',6000);
end $$;

create or replace function public.router_subscription_status(p_device_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare v_sub public.router_subscriptions%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if not exists(select 1 from public.network_devices d where d.id=p_device_id and
  (public.is_org_member(d.organization_id) or (select private.is_platform_admin()))) then
  raise exception 'Router access denied' using errcode='42501'; end if;
 select * into v_sub from public.router_subscriptions where device_id=p_device_id;
 if not found then return jsonb_build_object('active',false,'status','pending','monthly_price_tzs',6000); end if;
 return jsonb_build_object('device_id',v_sub.device_id,'active',v_sub.status='active' and v_sub.expires_at>now(),
  'status',case when v_sub.status='active' and v_sub.expires_at<=now() then 'expired' else v_sub.status end,
  'monthly_price_tzs',v_sub.monthly_price_tzs,'expires_at',v_sub.expires_at);
end $$;

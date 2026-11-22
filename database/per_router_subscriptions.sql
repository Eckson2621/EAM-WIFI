-- Per-router platform subscriptions. Each network device is billed independently at TZS 6,000/month.
-- Existing organization subscriptions are copied to each existing router for a safe transition.
alter table public.hotspot_sites add column if not exists slug text;
create unique index if not exists hotspot_sites_slug_unique on public.hotspot_sites(slug) where slug is not null;

create table if not exists public.router_subscriptions (
  device_id uuid primary key references public.network_devices(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  monthly_price_tzs bigint not null default 6000 check (monthly_price_tzs = 6000),
  status text not null default 'pending' check (status in ('pending','active','expired','suspended')),
  started_at timestamptz,
  expires_at timestamptz,
  payment_method text check (payment_method is null or payment_method in ('cash','mobile_money','bank_transfer','other')),
  payment_reference text,
  last_approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint router_subscriptions_active_expiry_check check (status <> 'active' or expires_at is not null)
);
create index if not exists router_subscriptions_org_status_idx on public.router_subscriptions(organization_id,status,expires_at);
alter table public.router_subscriptions enable row level security;
alter table public.router_subscriptions force row level security;
revoke all on public.router_subscriptions from public, anon, authenticated;
grant select on public.router_subscriptions to authenticated;
drop policy if exists "owners and platform admin read router subscriptions" on public.router_subscriptions;
create policy "owners and platform admin read router subscriptions"
on public.router_subscriptions for select to authenticated
using (
  exists (select 1 from public.organization_members m
    where m.organization_id=router_subscriptions.organization_id and m.user_id=(select auth.uid())
      and m.status='active' and m.role in ('owner','admin'))
  or (select private.is_platform_admin())
);
insert into public.router_subscriptions(device_id,organization_id,status,started_at,expires_at,last_approved_by,created_at,updated_at)
select d.id,d.organization_id,
  case when s.status='active' and s.expires_at>now() then 'active'
       when s.status='active' then 'expired' else 'pending' end,
  s.started_at,s.expires_at,s.last_approved_by,now(),now()
from public.network_devices d left join public.platform_subscriptions s on s.organization_id=d.organization_id
on conflict(device_id) do nothing;

create or replace function private.ensure_router_subscription()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_org_slug text; v_site_name text;
begin
  select o.slug,hs.name into v_org_slug,v_site_name from public.hotspot_sites hs
  join public.organizations o on o.id=hs.organization_id
  where hs.id=new.site_id and hs.organization_id=new.organization_id;
  if new.site_id is not null then
    update public.hotspot_sites set slug=coalesce(slug,
      case when not exists(select 1 from public.hotspot_sites x where x.slug=v_org_slug and x.id<>new.site_id)
        then v_org_slug
        else left(regexp_replace(lower(coalesce(v_site_name,'wifi-site')),'[^a-z0-9]+','-','g'),42)
          || '-' || substr(replace(new.id::text,'-',''),1,8) end),updated_at=now()
    where id=new.site_id;
  end if;
  insert into public.router_subscriptions(device_id,organization_id,status)
  values(new.id,new.organization_id,'pending') on conflict(device_id) do nothing;
  return new;
end;
$function$;
drop trigger if exists network_devices_create_router_subscription on public.network_devices;
create trigger network_devices_create_router_subscription after insert on public.network_devices
for each row execute function private.ensure_router_subscription();
insert into public.router_subscriptions(device_id,organization_id,status)
select d.id,d.organization_id,'pending' from public.network_devices d on conflict(device_id) do nothing;
update public.hotspot_sites hs set slug=coalesce(hs.slug,o.slug || '-' || substr(replace(hs.id::text,'-',''),1,8)),updated_at=now()
from public.organizations o where o.id=hs.organization_id and hs.slug is null;

create or replace function public.create_additional_router(
 p_organization_id uuid,p_site_name text,p_site_address text,p_router_name text,
 p_router_vendor text,p_router_model text,p_integration_type text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
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
 values(p_organization_id,trim(p_site_name),nullif(trim(coalesce(p_site_address,'')),''),'active') returning id into v_site_id;
 insert into public.network_devices(organization_id,site_id,name,vendor,model,integration_type,connection_status,config)
 values(p_organization_id,v_site_id,trim(p_router_name),p_router_vendor,nullif(trim(coalesce(p_router_model,'')), ''),
  p_integration_type,'not_configured',jsonb_build_object('setup_state','awaiting_secure_pairing','credentials_provisioned',false))
 returning id into v_device_id;
 select slug into v_slug from public.hotspot_sites where id=v_site_id;
 return jsonb_build_object('site_id',v_site_id,'device_id',v_device_id,'site_slug',v_slug,
  'subscription_status','pending','monthly_price_tzs',6000);
end;
$function$;
revoke all on function public.create_additional_router(uuid,text,text,text,text,text,text) from public,anon;
grant execute on function public.create_additional_router(uuid,text,text,text,text,text,text) to authenticated;

create or replace function public.router_subscription_status(p_device_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_sub public.router_subscriptions%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if not exists(select 1 from public.network_devices d where d.id=p_device_id
   and (public.is_org_member(d.organization_id) or (select private.is_platform_admin()))) then
  raise exception 'Router access denied' using errcode='42501'; end if;
 select * into v_sub from public.router_subscriptions where device_id=p_device_id;
 if not found then return jsonb_build_object('active',false,'status','pending','monthly_price_tzs',6000); end if;
 return jsonb_build_object('device_id',v_sub.device_id,'active',v_sub.status='active' and v_sub.expires_at>now(),
  'status',case when v_sub.status='active' and v_sub.expires_at<=now() then 'expired' else v_sub.status end,
  'monthly_price_tzs',v_sub.monthly_price_tzs,'expires_at',v_sub.expires_at);
end;
$function$;
revoke all on function public.router_subscription_status(uuid) from public,anon;
grant execute on function public.router_subscription_status(uuid) to authenticated;

create or replace function public.platform_admin_approve_router_subscription(
 p_device_id uuid,p_payment_method text,p_payment_reference text default null,p_months integer default 1
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_org uuid; v_start timestamptz; v_expiry timestamptz;
begin
 if auth.uid() is null or not (select private.is_platform_admin()) then raise exception 'Platform administrator permission required' using errcode='42501'; end if;
 if p_payment_method not in ('cash','mobile_money','bank_transfer','other') then raise exception 'Unsupported payment method' using errcode='22023'; end if;
 if p_months is null or p_months<1 or p_months>60 then raise exception 'Months must be from 1 to 60' using errcode='22023'; end if;
 if p_payment_reference is not null and length(trim(p_payment_reference))>120 then raise exception 'Payment reference is too long' using errcode='22023'; end if;
 select organization_id into v_org from public.network_devices where id=p_device_id for update;
 if not found then raise exception 'Router not found' using errcode='P0002'; end if;
 insert into public.router_subscriptions(device_id,organization_id,status,monthly_price_tzs)
 values(p_device_id,v_org,'pending',6000) on conflict(device_id) do nothing;
 select case when status='active' and expires_at>now() then expires_at else now() end
 into v_start from public.router_subscriptions where device_id=p_device_id for update;
 v_expiry:=v_start+make_interval(months=>p_months);
 update public.router_subscriptions set status='active',started_at=coalesce(started_at,v_start),expires_at=v_expiry,
  payment_method=p_payment_method,payment_reference=nullif(trim(coalesce(p_payment_reference,'')),''),
  last_approved_by=auth.uid(),updated_at=now() where device_id=p_device_id;
 return jsonb_build_object('ok',true,'device_id',p_device_id,'organization_id',v_org,'status','active',
  'expires_at',v_expiry,'monthly_price_tzs',6000);
end;
$function$;
revoke all on function public.platform_admin_approve_router_subscription(uuid,text,text,integer) from public,anon;
grant execute on function public.platform_admin_approve_router_subscription(uuid,text,text,integer) to authenticated;

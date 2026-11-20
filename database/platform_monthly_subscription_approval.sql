-- Applied subscription schema for EAM-WIFI platform billing.
-- Platform owner/admin is the single configured account below.
create table if not exists public.platform_subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  monthly_price_tzs bigint not null default 6000 check (monthly_price_tzs = 6000),
  status text not null default 'pending' check (status in ('pending','active','expired','suspended')),
  started_at timestamptz, expires_at timestamptz, last_approved_by uuid,
  updated_at timestamptz not null default now(), created_at timestamptz not null default now(),
  check ((status = 'active' and expires_at is not null) or status <> 'active')
);
create table if not exists public.platform_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  amount_tzs bigint not null check (amount_tzs = 6000),
  months integer not null default 1 check (months = 1),
  payment_method text not null check (payment_method in ('cash','mobile_money','bank_transfer','other')),
  payment_reference text, confirmed_by uuid not null,
  period_start timestamptz not null, period_end timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.platform_subscriptions enable row level security;
alter table public.platform_subscriptions force row level security;
alter table public.platform_subscription_payments enable row level security;
alter table public.platform_subscription_payments force row level security;
revoke all on public.platform_subscriptions,public.platform_subscription_payments from anon,public;
grant select,insert,update on public.platform_subscriptions to authenticated;
grant select,insert on public.platform_subscription_payments to authenticated;
grant select,update on public.organizations to authenticated;

create policy "owners and platform admin read subscriptions" on public.platform_subscriptions
for select to authenticated using (
 exists(select 1 from public.organizations o where o.id=organization_id and o.owner_user_id=(select auth.uid()))
 or lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com'
);
create policy "platform admin inserts subscription" on public.platform_subscriptions
for insert to authenticated with check(lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com');
create policy "platform admin updates subscription" on public.platform_subscriptions
for update to authenticated using(lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com')
with check(lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com');
create policy "platform admin reads subscription payments" on public.platform_subscription_payments
for select to authenticated using(lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com');
create policy "platform admin inserts subscription payments" on public.platform_subscription_payments
for insert to authenticated with check(lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com');
create policy "platform admin reads all organizations" on public.organizations
for select to authenticated using(lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com');
create policy "platform admin updates organizations" on public.organizations
for update to authenticated using(lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com')
with check(lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com');
create index if not exists platform_subscription_payments_org_created_idx
 on public.platform_subscription_payments(organization_id,created_at desc);

create or replace function public.platform_admin_approve_subscription(p_organization_id uuid,p_payment_method text,p_payment_reference text default null)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_email text:=lower(coalesce((select auth.jwt())->>'email','')); v_user uuid:=(select auth.uid()); v_start timestamptz; v_end timestamptz;
begin
 if v_user is null or v_email<>'mwalimueckson2104@gmail.com' then raise exception 'Platform administrator permission required' using errcode='42501'; end if;
 if p_payment_method not in ('cash','mobile_money','bank_transfer','other') then raise exception 'Invalid payment method' using errcode='22023'; end if;
 if p_payment_reference is not null and length(trim(p_payment_reference))>120 then raise exception 'Payment reference too long' using errcode='22023'; end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 if not found then raise exception 'Organization not found' using errcode='P0002'; end if;
 insert into public.platform_subscriptions(organization_id,status) values(p_organization_id,'pending') on conflict(organization_id) do nothing;
 select greatest(now(),coalesce(expires_at,now())) into v_start from public.platform_subscriptions where organization_id=p_organization_id for update;
 v_end:=v_start+interval '1 month';
 update public.platform_subscriptions set status='active',started_at=coalesce(started_at,v_start),expires_at=v_end,last_approved_by=v_user,updated_at=now() where organization_id=p_organization_id;
 insert into public.platform_subscription_payments(organization_id,amount_tzs,months,payment_method,payment_reference,confirmed_by,period_start,period_end)
 values(p_organization_id,6000,1,p_payment_method,nullif(trim(coalesce(p_payment_reference,'')),''),v_user,v_start,v_end);
 update public.organizations set status='active',updated_at=now() where id=p_organization_id;
 return jsonb_build_object('organization_id',p_organization_id,'status','active','monthly_price_tzs',6000,'expires_at',v_end);
end $$;
revoke all on function public.platform_admin_approve_subscription(uuid,text,text) from public,anon;
grant execute on function public.platform_admin_approve_subscription(uuid,text,text) to authenticated;

create or replace function public.platform_subscription_status(p_organization_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$
 select jsonb_build_object('active',coalesce(s.status='active' and s.expires_at>now(),false),
 'status',coalesce(case when s.status='active' and s.expires_at<=now() then 'expired' else s.status end,'pending'),
 'monthly_price_tzs',6000,'expires_at',s.expires_at)
 from (select 1) seed left join public.platform_subscriptions s on s.organization_id=p_organization_id
 where exists(select 1 from public.organizations o where o.id=p_organization_id
 and (o.owner_user_id=(select auth.uid()) or public.is_org_admin(o.id)
 or lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com'));
$$;
revoke all on function public.platform_subscription_status(uuid) from public,anon;
grant execute on function public.platform_subscription_status(uuid) to authenticated;

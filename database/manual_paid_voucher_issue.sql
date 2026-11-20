-- Manual paid-voucher issue: owner confirms payment, selects package, issues one fresh code.
create table if not exists public.voucher_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  voucher_id uuid not null unique references public.vouchers(id) on delete restrict,
  package_id uuid not null references public.wifi_packages(id) on delete restrict,
  customer_phone text,
  amount_paid bigint not null check (amount_paid > 0),
  payment_method text not null check (payment_method in ('cash','mobile_money','bank_transfer','other')),
  payment_reference text,
  confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.voucher_sales enable row level security;
alter table public.voucher_sales force row level security;
revoke all on public.voucher_sales from anon, public;
grant select, insert on public.voucher_sales to authenticated;
drop policy if exists "admins read voucher sales" on public.voucher_sales;
create policy "admins read voucher sales" on public.voucher_sales for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists "admins record voucher sales" on public.voucher_sales;
create policy "admins record voucher sales" on public.voucher_sales for insert to authenticated with check (public.is_org_admin(organization_id) and confirmed_by = (select auth.uid()));
create index if not exists voucher_sales_org_created_idx on public.voucher_sales (organization_id, created_at desc);

create or replace function public.issue_paid_wifi_voucher(
  p_organization_id uuid, p_package_id uuid, p_amount_paid bigint,
  p_payment_method text, p_customer_phone text default null, p_payment_reference text default null
)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_package public.wifi_packages%rowtype;
  v_code text;
  v_hash text;
  v_voucher_id uuid;
  v_sale_id uuid;
  v_attempt integer;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not public.is_org_admin(p_organization_id) then raise exception 'Organization administrator permission required' using errcode = '42501'; end if;
  if p_payment_method not in ('cash','mobile_money','bank_transfer','other') then raise exception 'Unsupported payment method' using errcode = '22023'; end if;
  if p_customer_phone is not null and length(trim(p_customer_phone)) > 30 then raise exception 'Customer phone is too long' using errcode = '22023'; end if;
  if p_payment_reference is not null and length(trim(p_payment_reference)) > 120 then raise exception 'Payment reference is too long' using errcode = '22023'; end if;
  if not exists (select 1 from public.organizations o where o.id = p_organization_id and o.status = 'active') then raise exception 'Organization is not active' using errcode = '23514'; end if;
  select * into v_package from public.wifi_packages p
  where p.id = p_package_id and p.organization_id = p_organization_id and p.is_active = true
  for share;
  if not found then raise exception 'Active package not found in this organization' using errcode = '23503'; end if;
  if p_amount_paid is distinct from v_package.price_tzs then raise exception 'Amount paid must exactly match the selected package price' using errcode = '23514'; end if;

  for v_attempt in 1..10 loop
    v_code := 'EW' || upper(substr(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 1, 24));
    v_hash := md5(v_code);
    insert into public.vouchers (organization_id, package_id, code_hash, code_hint, status, created_by)
    values (p_organization_id, p_package_id, v_hash, right(v_code, 4), 'unused', v_user_id)
    on conflict (code_hash) do nothing returning id into v_voucher_id;
    if v_voucher_id is not null then exit; end if;
  end loop;
  if v_voucher_id is null then raise exception 'Could not generate a unique voucher code; please retry'; end if;

  insert into public.voucher_sales
    (organization_id, voucher_id, package_id, customer_phone, amount_paid, payment_method, payment_reference, confirmed_by)
  values
    (p_organization_id, v_voucher_id, p_package_id, nullif(trim(p_customer_phone), ''),
     p_amount_paid, p_payment_method, nullif(trim(p_payment_reference), ''), v_user_id)
  returning id into v_sale_id;

  return jsonb_build_object('sale_id',v_sale_id,'voucher_id',v_voucher_id,'code',v_code,
    'package_name',v_package.name,'amount_paid',p_amount_paid,'payment_method',p_payment_method,
    'status','unused','message','Payment recorded manually and one unique voucher issued.');
end;
$function$;
revoke all on function public.issue_paid_wifi_voucher(uuid,uuid,bigint,text,text,text) from public, anon;
grant execute on function public.issue_paid_wifi_voucher(uuid,uuid,bigint,text,text,text) to authenticated;

-- Subscription enforcement for owner operations.
create or replace function public.issue_paid_wifi_voucher(
 p_organization_id uuid,p_package_id uuid,p_amount_paid bigint,p_payment_method text,
 p_customer_phone text default null,p_payment_reference text default null
) returns jsonb language plpgsql set search_path=''
as $$
declare v_user_id uuid:=(select auth.uid()); v_package public.wifi_packages%rowtype;
 v_code text; v_hash text; v_voucher_id uuid; v_sale_id uuid; v_attempt integer;
begin
 if v_user_id is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if not public.is_org_admin(p_organization_id) then raise exception 'Organization administrator permission required' using errcode='42501'; end if;
 if p_payment_method not in ('cash','mobile_money','bank_transfer','other') then raise exception 'Unsupported payment method' using errcode='22023'; end if;
 if p_customer_phone is not null and length(trim(p_customer_phone))>30 then raise exception 'Customer phone is too long' using errcode='22023'; end if;
 if p_payment_reference is not null and length(trim(p_payment_reference))>120 then raise exception 'Payment reference is too long' using errcode='22023'; end if;
 if not exists(select 1 from public.organizations o where o.id=p_organization_id and o.status='active') then raise exception 'Organization is not active' using errcode='23514'; end if;
 if not exists(select 1 from public.platform_subscriptions s where s.organization_id=p_organization_id and s.status='active' and s.expires_at>now()) then
  raise exception 'EAM-WIFI subscription is pending or expired. Contact the platform administrator.' using errcode='23514';
 end if;
 select * into v_package from public.wifi_packages p where p.id=p_package_id and p.organization_id=p_organization_id and p.is_active=true for share;
 if not found then raise exception 'Active package not found in this organization' using errcode='22023'; end if;
 if p_amount_paid is distinct from v_package.price_tzs then raise exception 'Amount paid must exactly match the selected package price' using errcode='23514'; end if;
 for v_attempt in 1..10 loop
  v_code:='EW'||upper(substr(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),1,24));
  v_hash:=md5(v_code);
  insert into public.vouchers(organization_id,package_id,code_hash,code_hint,status,created_by)
  values(p_organization_id,p_package_id,v_hash,right(v_code,4),'unused',v_user_id)
  on conflict(code_hash) do nothing returning id into v_voucher_id;
  if v_voucher_id is not null then exit; end if;
 end loop;
 if v_voucher_id is null then raise exception 'Could not generate a unique voucher code; please retry'; end if;
 insert into public.voucher_sales(organization_id,voucher_id,package_id,customer_phone,amount_paid,payment_method,payment_reference,confirmed_by)
 values(p_organization_id,v_voucher_id,p_package_id,nullif(trim(p_customer_phone),''),p_amount_paid,p_payment_method,nullif(trim(p_payment_reference),''),v_user_id)
 returning id into v_sale_id;
 return jsonb_build_object('sale_id',v_sale_id,'voucher_id',v_voucher_id,'code',v_code,'package_name',v_package.name,
 'amount_paid',p_amount_paid,'payment_method',p_payment_method,'status','unused');
end $$;
revoke execute on function public.generate_wifi_vouchers(uuid,uuid,integer) from public,anon,authenticated;

alter table public.vouchers add column if not exists device_id uuid references public.network_devices(id) on delete set null;
alter table public.voucher_sales add column if not exists device_id uuid references public.network_devices(id) on delete set null;
create index if not exists vouchers_device_status_idx on public.vouchers(device_id,status);
create index if not exists voucher_sales_device_created_idx on public.voucher_sales(device_id,created_at desc);

create or replace function public.issue_paid_wifi_voucher_for_router(
 p_organization_id uuid,p_device_id uuid,p_package_id uuid,p_amount_paid bigint,p_payment_method text,
 p_customer_phone text default null,p_payment_reference text default null
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_user_id uuid:=auth.uid(); v_package public.wifi_packages%rowtype; v_code text; v_hash text;
 v_voucher_id uuid; v_sale_id uuid; v_attempt integer;
begin
 if v_user_id is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if not public.is_org_admin(p_organization_id) then raise exception 'Organization administrator permission required' using errcode='42501'; end if;
 if p_payment_method not in ('cash','mobile_money','bank_transfer','other') then raise exception 'Unsupported payment method' using errcode='22023'; end if;
 if not exists(select 1 from public.organizations where id=p_organization_id and status='active') then raise exception 'Business is not active' using errcode='23514'; end if;
 if not exists(select 1 from public.network_devices d join public.router_subscriptions rs on rs.device_id=d.id
  where d.id=p_device_id and d.organization_id=p_organization_id and rs.status='active' and rs.expires_at>now()) then
  raise exception 'Router subscription is pending or expired. Monthly fee is TSh 6,000.' using errcode='23514'; end if;
 select * into v_package from public.wifi_packages where id=p_package_id and organization_id=p_organization_id and is_active=true for share;
 if not found then raise exception 'Active package not found' using errcode='22023'; end if;
 if p_amount_paid is distinct from v_package.price_tzs then raise exception 'Amount paid must match package price' using errcode='23514'; end if;
 if p_customer_phone is not null and length(trim(p_customer_phone))>30 then raise exception 'Customer phone is too long' using errcode='22023'; end if;
 if p_payment_reference is not null and length(trim(p_payment_reference))>120 then raise exception 'Payment reference is too long' using errcode='22023'; end if;
 for v_attempt in 1..10 loop
  v_code:='EW'||upper(substr(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),1,24));
  v_hash:=md5(v_code);
  insert into public.vouchers(organization_id,device_id,package_id,code_hash,code_hint,status,created_by)
  values(p_organization_id,p_device_id,p_package_id,v_hash,right(v_code,4),'unused',v_user_id)
  on conflict(code_hash) do nothing returning id into v_voucher_id;
  if v_voucher_id is not null then exit; end if;
 end loop;
 if v_voucher_id is null then raise exception 'Could not generate unique voucher code'; end if;
 insert into public.voucher_sales(organization_id,device_id,voucher_id,package_id,customer_phone,amount_paid,payment_method,payment_reference,confirmed_by)
 values(p_organization_id,p_device_id,v_voucher_id,p_package_id,nullif(trim(p_customer_phone),''),p_amount_paid,p_payment_method,
 nullif(trim(p_payment_reference),''),v_user_id) returning id into v_sale_id;
 return jsonb_build_object('sale_id',v_sale_id,'voucher_id',v_voucher_id,'device_id',p_device_id,'code',v_code,
 'package_name',v_package.name,'amount_paid',p_amount_paid,'payment_method',p_payment_method,'status','unused');
end $$;
revoke all on function public.issue_paid_wifi_voucher_for_router(uuid,uuid,uuid,bigint,text,text,text) from public,anon;
grant execute on function public.issue_paid_wifi_voucher_for_router(uuid,uuid,uuid,bigint,text,text,text) to authenticated;

create or replace function private.public_wifi_portal(p_slug text)
returns jsonb language sql stable security definer set search_path=''
as $$
 select jsonb_build_object('ok',true,'organization_id',o.id,'site_id',hs.id,'device_id',d.id,'site_slug',hs.slug,
  'business_name',o.name,'site_name',hs.name,'contact_phone',o.contact_phone,
  'payment_phone',coalesce(os.payment_phone,o.contact_phone),'payment_instructions',os.payment_instructions,
  'router_ready',d.vendor='mikrotik' and d.connection_status='online' and d.last_seen_at>now()-interval '2 minutes',
  'packages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,
   'price_tzs',p.price_tzs,'duration_seconds',p.duration_seconds,'validity_seconds',p.validity_seconds,
   'data_limit_bytes',p.data_limit_bytes,'speed_down_kbps',p.speed_down_kbps,'speed_up_kbps',p.speed_up_kbps,
   'max_devices',p.max_devices,'session_mode',p.session_mode) order by p.display_order,p.created_at)
   from public.wifi_packages p where p.organization_id=o.id and p.is_active=true),'[]'::jsonb))
 from public.hotspot_sites hs join public.network_devices d on d.site_id=hs.id and d.organization_id=hs.organization_id
 join public.router_subscriptions rs on rs.device_id=d.id and rs.status='active' and rs.expires_at>now()
 join public.organizations o on o.id=hs.organization_id left join public.organization_settings os on os.organization_id=o.id
 where hs.slug=p_slug and hs.status='active' and o.status='active' order by d.created_at limit 1;
$$;

create or replace function private.redeem_wifi_voucher(p_slug text,p_code text,p_mac_address text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_org public.organizations%rowtype; v_voucher public.vouchers%rowtype; v_package public.wifi_packages%rowtype;
 v_customer_id uuid; v_session_id uuid; v_device_id uuid; v_username text; v_attempts integer; v_mac macaddr; v_expires_at timestamptz;
begin
 if coalesce(p_slug,'') !~ '^[a-z0-9-]{3,80}$' then return jsonb_build_object('ok',false,'error','Wi-Fi site not found.'); end if;
 if coalesce(p_code,'') !~ '^EW[A-F0-9]{16,24}$' then return jsonb_build_object('ok',false,'error','Voucher code is not valid.'); end if;
 if coalesce(p_mac_address,'') !~* '^([0-9a-f]{2}:){5}[0-9a-f]{2}$' then return jsonb_build_object('ok',false,'error','Router client MAC address is required.'); end if;
 v_mac:=lower(p_mac_address)::macaddr;
 insert into public.voucher_redemption_limits(mac_address,attempts,window_started_at) values(v_mac,1,now())
 on conflict(mac_address) do update set
 attempts=case when public.voucher_redemption_limits.window_started_at<now()-interval '10 minutes' then 1 else public.voucher_redemption_limits.attempts+1 end,
 window_started_at=case when public.voucher_redemption_limits.window_started_at<now()-interval '10 minutes' then now() else public.voucher_redemption_limits.window_started_at end,
 updated_at=now() returning attempts into v_attempts;
 if v_attempts>5 then return jsonb_build_object('ok',false,'error','Too many attempts. Wait 10 minutes and try again.'); end if;
 select o.* into v_org from public.hotspot_sites hs join public.organizations o on o.id=hs.organization_id
 join public.network_devices d on d.site_id=hs.id and d.organization_id=o.id
 join public.router_subscriptions rs on rs.device_id=d.id and rs.status='active' and rs.expires_at>now()
 where hs.slug=p_slug and hs.status='active' and o.status='active'
 and d.vendor='mikrotik' and d.connection_status='online' and d.last_seen_at>now()-interval '2 minutes'
 order by d.created_at limit 1 for share of o;
 if not found then return jsonb_build_object('ok',false,'error','This router is offline or its TSh 6,000 monthly subscription is pending or expired.'); end if;
 select d.id into v_device_id from public.hotspot_sites hs join public.network_devices d on d.site_id=hs.id
 join public.router_subscriptions rs on rs.device_id=d.id and rs.status='active' and rs.expires_at>now()
 where hs.slug=p_slug and hs.organization_id=v_org.id and d.vendor='mikrotik' and d.connection_status='online'
 and d.last_seen_at>now()-interval '2 minutes' order by d.created_at limit 1;
 select * into v_voucher from public.vouchers v where v.organization_id=v_org.id and v.code_hash=md5(upper(p_code))
 and (v.device_id is null or v.device_id=v_device_id) for update;
 if not found or v_voucher.status<>'unused' or (v_voucher.expires_at is not null and v_voucher.expires_at<=now()) then
  return jsonb_build_object('ok',false,'error','Voucher is invalid, expired, already used, or belongs to another router.'); end if;
 select * into v_package from public.wifi_packages p where p.id=v_voucher.package_id and p.organization_id=v_org.id and p.is_active=true;
 if not found then return jsonb_build_object('ok',false,'error','This voucher package is no longer available.'); end if;
 insert into public.wifi_customers(organization_id,mac_address,status) values(v_org.id,v_mac,'active')
 on conflict(organization_id,mac_address) where mac_address is not null
 do update set status='active',updated_at=now() returning id into v_customer_id;
 v_username:='EW'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
 v_expires_at:=case when v_package.session_mode='wall_clock' then now()+make_interval(secs=>v_package.duration_seconds)
 when v_package.validity_seconds is not null then now()+make_interval(secs=>v_package.validity_seconds) else null end;
 insert into public.access_sessions(organization_id,customer_id,package_id,device_id,username,session_status,remaining_seconds,expires_at,mac_address)
 values(v_org.id,v_customer_id,v_package.id,v_device_id,v_username,'queued',v_package.duration_seconds,v_expires_at,v_mac)
 returning id into v_session_id;
 update public.vouchers set status='redeemed',redeemed_by_customer_id=v_customer_id,redeemed_at=now() where id=v_voucher.id and status='unused';
 if not found then return jsonb_build_object('ok',false,'error','Voucher has already been used.'); end if;
 insert into public.router_events(organization_id,device_id,session_id,event_type,event_payload)
 values(v_org.id,v_device_id,v_session_id,'voucher_redemption_requested',
 jsonb_build_object('username',v_username,'password',v_username,'mac_address',v_mac::text,'duration_seconds',v_package.duration_seconds,
 'validity_seconds',v_package.validity_seconds,'valid_until',v_expires_at,'session_mode',v_package.session_mode,
 'data_limit_bytes',v_package.data_limit_bytes,'speed_down_kbps',v_package.speed_down_kbps,'speed_up_kbps',v_package.speed_up_kbps,
 'max_devices',v_package.max_devices,'package_name',v_package.name));
 return jsonb_build_object('ok',true,'session_id',v_session_id,'status','queued','username',v_username,'password',v_username,
 'valid_until',v_expires_at,'message','Voucher accepted. Connecting you to the Wi-Fi network now.');
end $$;

create or replace function private.claim_router_events(p_token_hash text,p_limit integer default 20)
returns table(id uuid,session_id uuid,event_type text,event_payload jsonb,occurred_at timestamptz,attempt_count integer)
language plpgsql security definer set search_path=''
as $$
declare v_device_id uuid;
begin
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'Event batch size must be between 1 and 50' using errcode='22023'; end if;
 select c.device_id into v_device_id from private.router_device_credentials c
 where c.token_hash=p_token_hash and c.revoked_at is null and c.expires_at>now() order by c.created_at desc limit 1;
 if v_device_id is null then raise exception 'Router credential is invalid or expired' using errcode='28000'; end if;
 if not exists(select 1 from public.router_subscriptions rs where rs.device_id=v_device_id and rs.status='active' and rs.expires_at>now()) then
  raise exception 'Router subscription is pending or expired. Contact EAM-WIFI administrator.' using errcode='42501'; end if;
 perform private.authenticate_router_device(p_token_hash);
 insert into public.router_events(organization_id,device_id,session_id,event_type,event_payload)
 select s.organization_id,s.device_id,s.id,'session_expiry_requested',jsonb_build_object('username',s.username,'reason','package_expiry')
 from public.access_sessions s where s.device_id=v_device_id and s.session_status in ('queued','active')
 and s.expires_at is not null and s.expires_at<=now()
 and not exists(select 1 from public.router_events e where e.session_id=s.id and e.event_type='session_expiry_requested'
 and e.processing_status in ('pending','processing','processed'));
 return query with claimable as (
  select e.id from public.router_events e where e.device_id=v_device_id
  and (e.processing_status='pending' or (e.processing_status='processing' and e.claimed_at<now()-interval '2 minutes'))
  and e.attempt_count<5 order by e.occurred_at for update skip locked limit p_limit
 ) update public.router_events e set processing_status='processing',claimed_at=now(),attempt_count=e.attempt_count+1
 from claimable c where e.id=c.id returning e.id,e.session_id,e.event_type,e.event_payload,e.occurred_at,e.attempt_count;
end $$;

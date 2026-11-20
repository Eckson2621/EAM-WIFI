-- Public customer portal and single-use voucher redemption queue.
create table if not exists public.voucher_redemption_limits (
 mac_address macaddr primary key, attempts integer not null default 0 check(attempts>=0),
 window_started_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.voucher_redemption_limits enable row level security;
alter table public.voucher_redemption_limits force row level security;
revoke all on public.voucher_redemption_limits from public,anon,authenticated;

create or replace function public.public_wifi_portal(p_slug text)
returns jsonb language sql stable security definer set search_path=''
as $$
 select jsonb_build_object('ok',true,'organization_id',o.id,'business_name',o.name,
 'contact_phone',coalesce(os.payment_phone,o.contact_phone),
 'packages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,
 'price_tzs',p.price_tzs,'duration_seconds',p.duration_seconds,'validity_seconds',p.validity_seconds,
 'data_limit_bytes',p.data_limit_bytes,'speed_down_kbps',p.speed_down_kbps,'speed_up_kbps',p.speed_up_kbps)
 order by p.display_order,p.created_at) from public.wifi_packages p where p.organization_id=o.id and p.is_active=true),'[]'::jsonb))
 from public.organizations o join public.platform_subscriptions s on s.organization_id=o.id and s.status='active' and s.expires_at>now()
 left join public.organization_settings os on os.organization_id=o.id
 where o.slug=p_slug and o.status='active' limit 1;
$$;
revoke all on function public.public_wifi_portal(text) from public;
grant execute on function public.public_wifi_portal(text) to anon,authenticated;

create or replace function public.redeem_wifi_voucher(p_slug text,p_code text,p_mac_address text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_org public.organizations%rowtype; v_voucher public.vouchers%rowtype; v_package public.wifi_packages%rowtype;
 v_customer_id uuid; v_session_id uuid; v_device_id uuid; v_username text; v_attempts integer; v_mac macaddr;
begin
 if coalesce(p_slug,'') !~ '^[a-z0-9-]{3,80}$' then return jsonb_build_object('ok',false,'error','Wi-Fi site not found.'); end if;
 if coalesce(p_code,'') !~ '^EW[A-F0-9]{16,24}$' then return jsonb_build_object('ok',false,'error','Voucher code is not valid.'); end if;
 if coalesce(p_mac_address,'') !~* '^([0-9a-f]{2}:){5}[0-9a-f]{2}$' then return jsonb_build_object('ok',false,'error','Router client MAC address is required.'); end if;
 v_mac:=lower(p_mac_address)::macaddr;
 insert into public.voucher_redemption_limits(mac_address,attempts,window_started_at) values(v_mac,1,now())
 on conflict(mac_address) do update set attempts=case when public.voucher_redemption_limits.window_started_at<now()-interval '10 minutes' then 1 else public.voucher_redemption_limits.attempts+1 end,
 window_started_at=case when public.voucher_redemption_limits.window_started_at<now()-interval '10 minutes' then now() else public.voucher_redemption_limits.window_started_at end,
 updated_at=now() returning attempts into v_attempts;
 if v_attempts>5 then return jsonb_build_object('ok',false,'error','Too many attempts. Wait 10 minutes and try again.'); end if;
 select o.* into v_org from public.organizations o join public.platform_subscriptions s on s.organization_id=o.id
 where o.slug=p_slug and o.status='active' and s.status='active' and s.expires_at>now() for share of o;
 if not found then return jsonb_build_object('ok',false,'error','This Wi-Fi service is temporarily unavailable.'); end if;
 select * into v_voucher from public.vouchers v where v.organization_id=v_org.id and v.code_hash=md5(upper(p_code)) for update;
 if not found or v_voucher.status<>'unused' or (v_voucher.expires_at is not null and v_voucher.expires_at<=now()) then return jsonb_build_object('ok',false,'error','Voucher is invalid, expired, or already used.'); end if;
 select * into v_package from public.wifi_packages p where p.id=v_voucher.package_id and p.organization_id=v_org.id and p.is_active=true;
 if not found then return jsonb_build_object('ok',false,'error','This voucher package is no longer available.'); end if;
 select id into v_customer_id from public.wifi_customers where organization_id=v_org.id and mac_address=v_mac and status='active' order by created_at limit 1 for update;
 if v_customer_id is null then insert into public.wifi_customers(organization_id,mac_address,status) values(v_org.id,v_mac,'active') returning id into v_customer_id; end if;
 select id into v_device_id from public.network_devices where organization_id=v_org.id and vendor='mikrotik' order by created_at limit 1;
 v_username:='EW'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 insert into public.access_sessions(organization_id,customer_id,package_id,device_id,username,session_status,remaining_seconds,expires_at,mac_address)
 values(v_org.id,v_customer_id,v_package.id,v_device_id,v_username,'queued',v_package.duration_seconds,
 case when v_package.validity_seconds is null then null else now()+make_interval(secs=>v_package.validity_seconds) end,v_mac)
 returning id into v_session_id;
 update public.vouchers set status='redeemed',redeemed_by_customer_id=v_customer_id,redeemed_at=now() where id=v_voucher.id and status='unused';
 if not found then return jsonb_build_object('ok',false,'error','Voucher has already been used.'); end if;
 insert into public.router_events(organization_id,device_id,session_id,event_type,event_payload)
 values(v_org.id,v_device_id,v_session_id,'voucher_redemption_requested',
 jsonb_build_object('username',v_username,'mac_address',v_mac::text,'duration_seconds',v_package.duration_seconds,
 'validity_seconds',v_package.validity_seconds,'data_limit_bytes',v_package.data_limit_bytes,
 'speed_down_kbps',v_package.speed_down_kbps,'speed_up_kbps',v_package.speed_up_kbps,'max_devices',v_package.max_devices));
 return jsonb_build_object('ok',true,'session_id',v_session_id,'status','queued','message','Voucher accepted. Access is waiting for MikroTik router activation.');
end $$;
revoke all on function public.redeem_wifi_voucher(text,text,text) from public;
grant execute on function public.redeem_wifi_voucher(text,text,text) to anon,authenticated;

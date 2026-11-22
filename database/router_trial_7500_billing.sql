-- EAM-WIFI router billing and five-minute connection trial.
-- Apply to the EAM-WIFI Supabase project only.
-- Business registration has no platform fee. Each router is TZS 7,500/month.
-- Trial starts on the first authenticated router heartbeat, not on business signup.

ALTER TABLE public.router_subscriptions
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz;
ALTER TABLE public.router_subscriptions
  ALTER COLUMN monthly_price_tzs SET DEFAULT 7500;
UPDATE public.router_subscriptions SET monthly_price_tzs=7500
WHERE monthly_price_tzs<>7500;

CREATE OR REPLACE FUNCTION private.router_subscription_is_active(p_device_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.router_subscriptions rs
  WHERE rs.device_id=p_device_id
   AND ((rs.status='active' AND rs.expires_at>now())
     OR (rs.status<>'active' AND rs.trial_expires_at>now()))
 );
$$;
REVOKE ALL ON FUNCTION private.router_subscription_is_active(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_additional_router(
 p_organization_id uuid,p_site_name text,p_site_address text,p_router_name text,
 p_router_vendor text,p_router_model text,p_integration_type text
)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO ''
AS $function$
DECLARE v_site_id uuid; v_device_id uuid; v_slug text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_organization_id
  AND m.user_id=auth.uid() AND m.status='active' AND m.role IN ('owner','admin')) THEN
  RAISE EXCEPTION 'Business owner or administrator permission required' USING errcode='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=p_organization_id AND o.status='active') THEN
  RAISE EXCEPTION 'Business registration must be approved before adding a router' USING errcode='23514';
 END IF;
 IF length(trim(coalesce(p_site_name,'')))<2 OR length(trim(coalesce(p_router_name,'')))<2 THEN
  RAISE EXCEPTION 'Site and router names are required' USING errcode='22023';
 END IF;
 IF p_router_vendor NOT IN ('mikrotik','ubiquiti','tp_link','huawei','other') THEN RAISE EXCEPTION 'Unsupported router vendor' USING errcode='22023'; END IF;
 IF p_integration_type NOT IN ('mikrotik_hotspot','routeros_api','manual','other') THEN RAISE EXCEPTION 'Unsupported integration type' USING errcode='22023'; END IF;
 INSERT INTO public.hotspot_sites(organization_id,name,address,status)
 VALUES(p_organization_id,trim(p_site_name),nullif(trim(coalesce(p_site_address,'')),''),'active') RETURNING id INTO v_site_id;
 INSERT INTO public.network_devices(organization_id,site_id,name,vendor,model,integration_type,connection_status,config)
 VALUES(p_organization_id,v_site_id,trim(p_router_name),p_router_vendor,nullif(trim(coalesce(p_router_model,'')), ''),
  p_integration_type,'not_configured',jsonb_build_object('setup_state','awaiting_secure_pairing','credentials_provisioned',false))
 RETURNING id INTO v_device_id;
 INSERT INTO public.router_subscriptions(device_id,organization_id,status,monthly_price_tzs)
 VALUES(v_device_id,p_organization_id,'pending',7500) ON CONFLICT(device_id) DO NOTHING;
 SELECT slug INTO v_slug FROM public.hotspot_sites WHERE id=v_site_id;
 RETURN jsonb_build_object('site_id',v_site_id,'device_id',v_device_id,'site_slug',v_slug,
  'subscription_status','trial_not_started','trial_minutes',5,'monthly_price_tzs',7500,
  'payment_phone','0613794448');
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_approve_router_subscription(
 p_device_id uuid,p_payment_method text,p_payment_reference text DEFAULT NULL,p_months integer DEFAULT 1
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_org uuid; v_start timestamptz; v_expiry timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_platform_admin() THEN
  RAISE EXCEPTION 'Platform administrator permission required' USING errcode='42501';
 END IF;
 IF p_payment_method NOT IN ('cash','mobile_money','bank_transfer','other') THEN
  RAISE EXCEPTION 'Unsupported payment method' USING errcode='22023';
 END IF;
 IF p_months IS NULL OR p_months<1 OR p_months>60 THEN RAISE EXCEPTION 'Months must be from 1 to 60' USING errcode='22023'; END IF;
 IF p_payment_reference IS NOT NULL AND length(trim(p_payment_reference))>120 THEN RAISE EXCEPTION 'Payment reference is too long' USING errcode='22023'; END IF;
 SELECT organization_id INTO v_org FROM public.network_devices WHERE id=p_device_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Router not found' USING errcode='P0002'; END IF;
 INSERT INTO public.router_subscriptions(device_id,organization_id,status,monthly_price_tzs)
 VALUES(p_device_id,v_org,'pending',7500) ON CONFLICT(device_id) DO NOTHING;
 SELECT CASE WHEN status='active' AND expires_at>now() THEN expires_at ELSE now() END
 INTO v_start FROM public.router_subscriptions WHERE device_id=p_device_id FOR UPDATE;
 v_expiry:=v_start+make_interval(months=>p_months);
 UPDATE public.router_subscriptions SET status='active',monthly_price_tzs=7500,
  started_at=CASE WHEN started_at IS NULL THEN v_start ELSE started_at END,
  expires_at=v_expiry,payment_method=p_payment_method,
  payment_reference=nullif(trim(coalesce(p_payment_reference,'')),''),
  last_approved_by=auth.uid(),updated_at=now()
 WHERE device_id=p_device_id;
 RETURN jsonb_build_object('ok',true,'device_id',p_device_id,'organization_id',v_org,
  'status','active','expires_at',v_expiry,'monthly_price_tzs',7500,'amount_tzs',7500*p_months);
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_list_router_subscriptions()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_platform_admin() THEN
  RAISE EXCEPTION 'Platform administrator permission required' USING errcode='42501';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',d.id,'organization_id',d.organization_id,'name',d.name,'vendor',d.vendor,'model',d.model,
  'connection_status',d.connection_status,'last_seen_at',d.last_seen_at,'created_at',d.created_at,
  'organization',jsonb_build_object('name',o.name,'contact_phone',o.contact_phone),
  'site',jsonb_build_object('name',hs.name,'slug',hs.slug),
  'router_subscriptions',jsonb_build_object('status',rs.status,'expires_at',rs.expires_at,
   'monthly_price_tzs',rs.monthly_price_tzs,'trial_started_at',rs.trial_started_at,'trial_expires_at',rs.trial_expires_at)
 ) ORDER BY d.created_at DESC),'[]'::jsonb)
 INTO v_result
 FROM public.network_devices d JOIN public.organizations o ON o.id=d.organization_id
 LEFT JOIN public.hotspot_sites hs ON hs.id=d.site_id
 LEFT JOIN public.router_subscriptions rs ON rs.device_id=d.id;
 RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.router_subscription_status(p_device_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO ''
AS $function$
DECLARE v_sub public.router_subscriptions%rowtype;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.network_devices d WHERE d.id=p_device_id
  AND (public.is_org_member(d.organization_id) OR private.is_platform_admin())) THEN
  RAISE EXCEPTION 'Router access denied' USING errcode='42501';
 END IF;
 SELECT * INTO v_sub FROM public.router_subscriptions WHERE device_id=p_device_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('active',false,'status','pending','monthly_price_tzs',7500); END IF;
 RETURN jsonb_build_object('device_id',p_device_id,
  'active',(v_sub.status='active' AND v_sub.expires_at>now()) OR (v_sub.status<>'active' AND v_sub.trial_expires_at>now()),
  'status',CASE WHEN v_sub.status='active' AND v_sub.expires_at>now() THEN 'active'
   WHEN v_sub.trial_expires_at>now() THEN 'trial'
   WHEN v_sub.trial_started_at IS NOT NULL THEN 'trial_expired' ELSE 'pending' END,
  'monthly_price_tzs',7500,'expires_at',v_sub.expires_at,
  'trial_started_at',v_sub.trial_started_at,'trial_expires_at',v_sub.trial_expires_at);
END;
$function$;

CREATE OR REPLACE FUNCTION private.authenticate_router_device(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_row record; v_sub public.router_subscriptions%rowtype; v_allowed boolean;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT c.id AS credential_id,c.organization_id,c.device_id,d.name,d.model INTO v_row
 FROM private.router_device_credentials c JOIN public.network_devices d ON d.id=c.device_id
 WHERE c.token_hash=p_token_hash AND c.revoked_at IS NULL AND c.expires_at>now()
 ORDER BY c.created_at DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO public.router_subscriptions(device_id,organization_id,status,monthly_price_tzs)
 VALUES(v_row.device_id,v_row.organization_id,'pending',7500) ON CONFLICT(device_id) DO NOTHING;
 SELECT * INTO v_sub FROM public.router_subscriptions WHERE device_id=v_row.device_id FOR UPDATE;
 IF v_sub.status<>'active' AND v_sub.trial_started_at IS NULL THEN
  UPDATE public.router_subscriptions SET trial_started_at=now(),trial_expires_at=now()+interval '5 minutes',
   monthly_price_tzs=7500,updated_at=now() WHERE device_id=v_row.device_id
  RETURNING * INTO v_sub;
 END IF;
 v_allowed:=(v_sub.status='active' AND v_sub.expires_at>now()) OR
  (v_sub.status<>'active' AND v_sub.trial_expires_at>now());
 UPDATE private.router_device_credentials SET last_seen_at=now(),expires_at=now()+interval '365 days'
 WHERE id=v_row.credential_id;
 UPDATE public.network_devices SET connection_status=CASE WHEN v_allowed THEN 'online' ELSE 'offline' END,
  last_seen_at=now(),updated_at=now() WHERE id=v_row.device_id;
 RETURN jsonb_build_object('ok',true,'subscription_active',v_allowed,
  'subscription_status',CASE WHEN v_sub.status='active' AND v_sub.expires_at>now() THEN 'active'
   WHEN v_sub.trial_expires_at>now() THEN 'trial'
   WHEN v_sub.trial_started_at IS NOT NULL THEN 'trial_expired' ELSE 'pending' END,
  'trial_started_at',v_sub.trial_started_at,'trial_expires_at',v_sub.trial_expires_at,
  'amount_due_tzs',7500,'payment_phone','0613794448',
  'device_id',v_row.device_id,'organization_id',v_row.organization_id,
  'device_name',v_row.name,'model',v_row.model,'server_time',now(),
  'credential_expires_at',now()+interval '365 days');
END;
$function$;

DO $do$
DECLARE v_definition text;
BEGIN
 SELECT pg_get_functiondef('public.issue_paid_wifi_voucher_for_router(uuid,uuid,uuid,bigint,text,text,text)'::regprocedure) INTO v_definition;
 v_definition:=replace(v_definition,'Monthly fee is TSh 6,000.','Monthly fee is TSh 7,500.');
 EXECUTE v_definition;
END
$do$;
REVOKE EXECUTE ON FUNCTION public.issue_paid_wifi_voucher(uuid,uuid,bigint,text,text,text) FROM PUBLIC,anon,authenticated;

-- Business registration remains free; this is an admin-only approval of the
-- organization account. The organization-wide subscription is suspended and
-- is not used as an access gate.
DO $do$
DECLARE v_definition text;
BEGIN
 SELECT pg_get_functiondef('private.platform_admin_approve_subscription_period(uuid,text,text,integer)'::regprocedure) INTO v_definition;
 v_definition:=replace(v_definition,'TZS 6,000 monthly subscription.','TZS 7,500 monthly subscription.');
 v_definition:=replace(v_definition,'TZS 6,000 per router.','TZS 7,500 per router.');
 EXECUTE v_definition;
END
$do$;
CREATE OR REPLACE FUNCTION private.claim_router_events(p_token_hash text,p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid,session_id uuid,event_type text,event_payload jsonb,occurred_at timestamptz,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_device_id uuid; v_subscription_active boolean;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'Event batch size must be between 1 and 50' USING errcode='22023'; END IF;
 SELECT c.device_id INTO v_device_id FROM private.router_device_credentials c
 WHERE c.token_hash=p_token_hash AND c.revoked_at IS NULL AND c.expires_at>now()
 ORDER BY c.created_at DESC LIMIT 1;
 IF v_device_id IS NULL THEN RAISE EXCEPTION 'Router credential is invalid or expired' USING errcode='28000'; END IF;
 PERFORM private.authenticate_router_device(p_token_hash);
 v_subscription_active:=private.router_subscription_is_active(v_device_id);
 IF v_subscription_active THEN
  INSERT INTO public.router_events(organization_id,device_id,session_id,event_type,event_payload)
  SELECT s.organization_id,s.device_id,s.id,'session_expiry_requested',jsonb_build_object('username',s.username,'reason','package_expiry')
  FROM public.access_sessions s WHERE s.device_id=v_device_id AND s.session_status IN ('queued','active')
   AND s.expires_at IS NOT NULL AND s.expires_at<=now()
   AND NOT EXISTS(SELECT 1 FROM public.router_events e WHERE e.session_id=s.id
    AND e.event_type='session_expiry_requested' AND e.processing_status IN ('pending','processing','processed'));
 ELSE
  INSERT INTO public.router_events(organization_id,device_id,session_id,event_type,event_payload)
  SELECT s.organization_id,s.device_id,s.id,'session_expiry_requested',
   jsonb_build_object('username',s.username,'reason','router_subscription_expired')
  FROM public.access_sessions s WHERE s.device_id=v_device_id AND s.session_status IN ('queued','active','paused')
   AND NOT EXISTS(SELECT 1 FROM public.router_events e WHERE e.session_id=s.id
    AND e.event_type='session_expiry_requested' AND e.event_payload->>'reason'='router_subscription_expired'
    AND e.processing_status IN ('pending','processing','processed'));
 END IF;
 RETURN QUERY
 WITH claimable AS (
  SELECT e.id FROM public.router_events e WHERE e.device_id=v_device_id
   AND (e.processing_status='pending' OR (e.processing_status='processing' AND e.claimed_at<now()-interval '2 minutes'))
   AND e.attempt_count<5 ORDER BY e.occurred_at FOR UPDATE SKIP LOCKED LIMIT p_limit
 )
 UPDATE public.router_events e SET processing_status='processing',claimed_at=now(),attempt_count=e.attempt_count+1
 FROM claimable c WHERE e.id=c.id
 RETURNING e.id,e.session_id,e.event_type,e.event_payload,e.occurred_at,e.attempt_count;
END;
$function$;

CREATE OR REPLACE FUNCTION private.complete_router_event(
 p_token_hash text,p_event_id uuid,p_success boolean,p_result_payload jsonb DEFAULT '{}'::jsonb,p_error text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_device_id uuid; v_attempts integer; v_type text; v_session uuid; v_active boolean;
BEGIN
 SELECT c.device_id INTO v_device_id FROM private.router_device_credentials c
 WHERE c.token_hash=p_token_hash AND c.revoked_at IS NULL AND c.expires_at>now()
 ORDER BY c.created_at DESC LIMIT 1;
 IF v_device_id IS NULL THEN RAISE EXCEPTION 'Router credential is invalid or expired' USING errcode='28000'; END IF;
 PERFORM private.authenticate_router_device(p_token_hash);
 v_active:=private.router_subscription_is_active(v_device_id);
 UPDATE public.router_events e SET
  processing_status=CASE WHEN p_success THEN 'processed' WHEN e.attempt_count>=5 THEN 'failed' ELSE 'pending' END,
  processed_at=CASE WHEN p_success OR e.attempt_count>=5 THEN now() ELSE NULL END,
  claimed_at=NULL,
  last_error=CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error,'Router failed to apply event'),1000) END,
  result_payload=coalesce(p_result_payload,'{}'::jsonb)
 WHERE e.id=p_event_id AND e.device_id=v_device_id AND e.processing_status='processing'
  AND (v_active OR e.event_type='session_expiry_requested')
 RETURNING e.attempt_count,e.event_type,e.session_id INTO v_attempts,v_type,v_session;
 IF NOT FOUND THEN RETURN false; END IF;
 IF v_session IS NOT NULL AND p_success AND v_type='voucher_redemption_requested' THEN
  UPDATE public.access_sessions SET session_status='active',connected_at=coalesce(connected_at,now()),
   last_accounted_at=now(),updated_at=now()
  WHERE id=v_session AND device_id=v_device_id AND session_status='queued';
 ELSIF v_session IS NOT NULL AND p_success AND v_type='session_expiry_requested' THEN
  UPDATE public.access_sessions SET session_status='blocked',remaining_seconds=0,
   disconnected_at=coalesce(disconnected_at,now()),updated_at=now()
  WHERE id=v_session AND device_id=v_device_id AND session_status IN ('queued','active','paused');
 ELSIF v_session IS NOT NULL AND NOT p_success AND v_attempts>=5 THEN
  UPDATE public.access_sessions SET session_status='blocked',disconnected_at=now(),updated_at=now()
  WHERE id=v_session AND device_id=v_device_id AND session_status='queued';
 END IF;
 RETURN true;
END;
$function$;

-- Voucher redemption is scoped to the exact hotspot site and router ID assigned
-- to the voucher. It also removes the legacy organization-wide billing gate.
CREATE OR REPLACE FUNCTION private.redeem_wifi_voucher(p_slug text,p_code text,p_mac_address text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_org public.organizations%rowtype; v_voucher public.vouchers%rowtype; v_package public.wifi_packages%rowtype;
 v_customer_id uuid; v_session_id uuid; v_device_id uuid; v_site_id uuid;
 v_username text; v_attempts integer; v_mac macaddr; v_expires_at timestamptz;
BEGIN
 IF coalesce(p_slug,'') !~ '^[a-z0-9-]{3,80}$' THEN RETURN jsonb_build_object('ok',false,'error','Wi-Fi site not found.'); END IF;
 IF coalesce(p_code,'') !~ '^EW[A-F0-9]{16,24}$' THEN RETURN jsonb_build_object('ok',false,'error','Voucher code is not valid.'); END IF;
 IF coalesce(p_mac_address,'') !~* '^([0-9a-f]{2}:){5}[0-9a-f]{2}$' THEN RETURN jsonb_build_object('ok',false,'error','Router client MAC address is required.'); END IF;
 v_mac:=lower(p_mac_address)::macaddr;
 INSERT INTO public.voucher_redemption_limits(mac_address,attempts,window_started_at) VALUES(v_mac,1,now())
 ON CONFLICT(mac_address) DO UPDATE SET
  attempts=CASE WHEN public.voucher_redemption_limits.window_started_at<now()-interval '10 minutes' THEN 1 ELSE public.voucher_redemption_limits.attempts+1 END,
  window_started_at=CASE WHEN public.voucher_redemption_limits.window_started_at<now()-interval '10 minutes' THEN now() ELSE public.voucher_redemption_limits.window_started_at END,
  updated_at=now() RETURNING attempts INTO v_attempts;
 IF v_attempts>5 THEN RETURN jsonb_build_object('ok',false,'error','Too many attempts. Wait 10 minutes and try again.'); END IF;
 SELECT o.* INTO v_org FROM public.organizations o JOIN public.hotspot_sites hs ON hs.organization_id=o.id
 WHERE hs.slug=p_slug AND hs.status='active' AND o.status='active' FOR SHARE OF o;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','This Wi-Fi service is temporarily unavailable.'); END IF;
 SELECT hs.id INTO v_site_id FROM public.hotspot_sites hs
 WHERE hs.organization_id=v_org.id AND hs.slug=p_slug AND hs.status='active';
 IF v_site_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Wi-Fi site not found.'); END IF;
 SELECT * INTO v_voucher FROM public.vouchers v
 WHERE v.organization_id=v_org.id AND v.code_hash=md5(upper(p_code)) FOR UPDATE;
 IF NOT FOUND OR v_voucher.status<>'unused' OR (v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at<=now()) THEN
  RETURN jsonb_build_object('ok',false,'error','Voucher is invalid, expired, or already used.');
 END IF;
 IF v_voucher.device_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','This voucher is not assigned to a router. Contact the Wi-Fi business.'); END IF;
 v_device_id:=v_voucher.device_id;
 IF NOT EXISTS(SELECT 1 FROM public.network_devices d JOIN public.router_subscriptions rs ON rs.device_id=d.id
  WHERE d.id=v_device_id AND d.organization_id=v_org.id AND d.site_id=v_site_id AND d.vendor='mikrotik'
   AND d.connection_status='online' AND d.last_seen_at>now()-interval '2 minutes'
   AND ((rs.status='active' AND rs.expires_at>now()) OR (rs.status<>'active' AND rs.trial_expires_at>now()))) THEN
  RETURN jsonb_build_object('ok',false,'error','The router assigned to this voucher is offline or its trial/subscription has expired.');
 END IF;
 SELECT * INTO v_package FROM public.wifi_packages p
 WHERE p.id=v_voucher.package_id AND p.organization_id=v_org.id AND p.is_active=true;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','This voucher package is no longer available.'); END IF;
 INSERT INTO public.wifi_customers(organization_id,mac_address,status) VALUES(v_org.id,v_mac,'active')
 ON CONFLICT(organization_id,mac_address) WHERE mac_address IS NOT NULL
 DO UPDATE SET status='active',updated_at=now() RETURNING id INTO v_customer_id;
 v_username:='EW'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
 v_expires_at:=CASE WHEN v_package.session_mode='wall_clock' THEN now()+make_interval(secs=>v_package.duration_seconds)
  WHEN v_package.validity_seconds IS NOT NULL THEN now()+make_interval(secs=>v_package.validity_seconds) ELSE NULL END;
 INSERT INTO public.access_sessions(organization_id,customer_id,package_id,device_id,username,session_status,remaining_seconds,expires_at,mac_address)
 VALUES(v_org.id,v_customer_id,v_package.id,v_device_id,v_username,'queued',v_package.duration_seconds,v_expires_at,v_mac)
 RETURNING id INTO v_session_id;
 UPDATE public.vouchers SET status='redeemed',redeemed_by_customer_id=v_customer_id,redeemed_at=now()
 WHERE id=v_voucher.id AND status='unused';
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Voucher has already been used.'); END IF;
 INSERT INTO public.router_events(organization_id,device_id,session_id,event_type,event_payload)
 VALUES(v_org.id,v_device_id,v_session_id,'voucher_redemption_requested',
  jsonb_build_object('username',v_username,'password',v_username,'mac_address',v_mac::text,
   'duration_seconds',v_package.duration_seconds,'validity_seconds',v_package.validity_seconds,
   'valid_until',v_expires_at,'session_mode',v_package.session_mode,'data_limit_bytes',v_package.data_limit_bytes,
   'speed_down_kbps',v_package.speed_down_kbps,'speed_up_kbps',v_package.speed_up_kbps,
   'max_devices',v_package.max_devices,'package_name',v_package.name));
 RETURN jsonb_build_object('ok',true,'session_id',v_session_id,'status','queued','username',v_username,
  'password',v_username,'valid_until',v_expires_at,'message','Voucher accepted. Connecting you to the Wi-Fi network now.');
END;
$function$;

DO $do$
DECLARE v_definition text;
BEGIN
 SELECT pg_get_functiondef('public.issue_paid_wifi_voucher_for_router(uuid,uuid,uuid,bigint,text,text,text)'::regprocedure) INTO v_definition;
 v_definition:=replace(v_definition,'Monthly fee is TSh 6,000.','Monthly fee is TSh 7,500.');
 EXECUTE v_definition;
END
$do$;
REVOKE EXECUTE ON FUNCTION public.issue_paid_wifi_voucher(uuid,uuid,bigint,text,text,text) FROM PUBLIC,anon,authenticated;

-- Business registration remains free; this is an admin-only approval of the
-- organization account. The organization-wide subscription is suspended and
-- is not used as an access gate.
DO $do$
DECLARE v_definition text;
BEGIN
 SELECT pg_get_functiondef('private.platform_admin_approve_subscription_period(uuid,text,text,integer)'::regprocedure) INTO v_definition;
 v_definition:=replace(v_definition,'TZS 6,000 monthly subscription.','TZS 7,500 monthly subscription.');
 v_definition:=replace(v_definition,'TZS 6,000 per router.','TZS 7,500 per router.');
 EXECUTE v_definition;
END
$do$;

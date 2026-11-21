-- EAM-WIFI customer payment settings and end-to-end router voucher runtime.

CREATE OR REPLACE FUNCTION private.claim_router_events(p_token_hash text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, session_id uuid, event_type text, event_payload jsonb, occurred_at timestamp with time zone, attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_device_id uuid;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'Event batch size must be between 1 and 50' USING errcode='22023'; END IF;
 SELECT c.device_id INTO v_device_id FROM private.router_device_credentials c
 WHERE c.token_hash=p_token_hash AND c.revoked_at IS NULL AND c.expires_at>now() ORDER BY c.created_at DESC LIMIT 1;
 IF v_device_id IS NULL THEN RAISE EXCEPTION 'Router credential is invalid or expired' USING errcode='28000'; END IF;
 PERFORM private.authenticate_router_device(p_token_hash);

 INSERT INTO public.router_events(organization_id,device_id,session_id,event_type,event_payload)
 SELECT s.organization_id,s.device_id,s.id,'session_expiry_requested',
  jsonb_build_object('username',s.username,'reason','package_expiry')
 FROM public.access_sessions s
 WHERE s.device_id=v_device_id AND s.session_status IN ('queued','active')
   AND s.expires_at IS NOT NULL AND s.expires_at<=now()
   AND NOT EXISTS (SELECT 1 FROM public.router_events e WHERE e.session_id=s.id
     AND e.event_type='session_expiry_requested' AND e.processing_status IN ('pending','processing','processed'));

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
$function$
;

CREATE OR REPLACE FUNCTION private.complete_router_event(p_token_hash text, p_event_id uuid, p_success boolean, p_result_payload jsonb DEFAULT '{}'::jsonb, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_device_id uuid; v_attempts integer; v_type text; v_session uuid;
BEGIN
 SELECT c.device_id INTO v_device_id FROM private.router_device_credentials c
 WHERE c.token_hash=p_token_hash AND c.revoked_at IS NULL AND c.expires_at>now() ORDER BY c.created_at DESC LIMIT 1;
 IF v_device_id IS NULL THEN RAISE EXCEPTION 'Router credential is invalid or expired' USING errcode='28000'; END IF;
 UPDATE public.router_events e SET
  processing_status=CASE WHEN p_success THEN 'processed' WHEN e.attempt_count>=5 THEN 'failed' ELSE 'pending' END,
  processed_at=CASE WHEN p_success OR e.attempt_count>=5 THEN now() ELSE NULL END,
  claimed_at=NULL,
  last_error=CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error,'Router failed to apply event'),1000) END,
  result_payload=coalesce(p_result_payload,'{}'::jsonb)
 WHERE e.id=p_event_id AND e.device_id=v_device_id AND e.processing_status='processing'
 RETURNING e.attempt_count,e.event_type,e.session_id INTO v_attempts,v_type,v_session;
 IF NOT FOUND THEN RETURN false; END IF;
 IF v_session IS NOT NULL AND p_success AND v_type='voucher_redemption_requested' THEN
  UPDATE public.access_sessions SET session_status='active',connected_at=coalesce(connected_at,now()),
   last_accounted_at=now(),updated_at=now()
  WHERE id=v_session AND device_id=v_device_id AND session_status='queued';
 ELSIF v_session IS NOT NULL AND p_success AND v_type='session_expiry_requested' THEN
  UPDATE public.access_sessions SET session_status='expired',remaining_seconds=0,disconnected_at=now(),updated_at=now()
  WHERE id=v_session AND device_id=v_device_id AND session_status IN ('queued','active','paused');
 ELSIF v_session IS NOT NULL AND NOT p_success AND v_attempts>=5 THEN
  UPDATE public.access_sessions SET session_status='blocked',disconnected_at=now(),updated_at=now()
  WHERE id=v_session AND device_id=v_device_id AND session_status='queued';
 END IF;
 RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.public_wifi_portal(p_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object('ok',true,'organization_id',o.id,'business_name',o.name,
  'contact_phone',o.contact_phone,'payment_phone',coalesce(os.payment_phone,o.contact_phone),
  'payment_instructions',os.payment_instructions,
  'router_ready',exists(select 1 from public.network_devices d where d.organization_id=o.id and d.vendor='mikrotik' and d.connection_status='online'),
  'packages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,
   'price_tzs',p.price_tzs,'duration_seconds',p.duration_seconds,'validity_seconds',p.validity_seconds,
   'data_limit_bytes',p.data_limit_bytes,'speed_down_kbps',p.speed_down_kbps,'speed_up_kbps',p.speed_up_kbps,
   'max_devices',p.max_devices,'session_mode',p.session_mode) order by p.display_order,p.created_at)
   from public.wifi_packages p where p.organization_id=o.id and p.is_active=true),'[]'::jsonb))
 FROM public.organizations o JOIN public.platform_subscriptions s ON s.organization_id=o.id AND s.status='active' AND s.expires_at>now()
 LEFT JOIN public.organization_settings os ON os.organization_id=o.id
 WHERE o.slug=p_slug AND o.status='active' LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION private.redeem_wifi_voucher(p_slug text, p_code text, p_mac_address text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_org public.organizations%rowtype; v_voucher public.vouchers%rowtype; v_package public.wifi_packages%rowtype;
 v_customer_id uuid; v_session_id uuid; v_device_id uuid; v_username text; v_attempts integer; v_mac macaddr; v_expires_at timestamptz;
BEGIN
 IF coalesce(p_slug,'') !~ '^[a-z0-9-]{3,80}$' THEN RETURN jsonb_build_object('ok',false,'error','Wi-Fi site not found.'); END IF;
 IF coalesce(p_code,'') !~ '^EW[A-F0-9]{16,24}$' THEN RETURN jsonb_build_object('ok',false,'error','Voucher code is not valid.'); END IF;
 IF coalesce(p_mac_address,'') !~* '^([0-9a-f]{2}:){5}[0-9a-f]{2}$' THEN RETURN jsonb_build_object('ok',false,'error','Router client MAC address is required.'); END IF;
 v_mac:=lower(p_mac_address)::macaddr;
 INSERT INTO public.voucher_redemption_limits(mac_address,attempts,window_started_at) VALUES(v_mac,1,now())
 ON CONFLICT(mac_address) DO UPDATE SET
  attempts=case when public.voucher_redemption_limits.window_started_at<now()-interval '10 minutes' then 1 else public.voucher_redemption_limits.attempts+1 end,
  window_started_at=case when public.voucher_redemption_limits.window_started_at<now()-interval '10 minutes' then now() else public.voucher_redemption_limits.window_started_at end,
  updated_at=now() RETURNING attempts INTO v_attempts;
 IF v_attempts>5 THEN RETURN jsonb_build_object('ok',false,'error','Too many attempts. Wait 10 minutes and try again.'); END IF;

 SELECT o.* INTO v_org FROM public.organizations o JOIN public.platform_subscriptions s ON s.organization_id=o.id
 WHERE o.slug=p_slug AND o.status='active' AND s.status='active' AND s.expires_at>now() FOR SHARE OF o;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','This Wi-Fi service is temporarily unavailable.'); END IF;

 SELECT id INTO v_device_id FROM public.network_devices
 WHERE organization_id=v_org.id AND vendor='mikrotik' AND connection_status='online' ORDER BY created_at LIMIT 1;
 IF v_device_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','The MikroTik router is not connected to EAM-WIFI yet. Please contact the Wi-Fi business.'); END IF;

 SELECT * INTO v_voucher FROM public.vouchers v
 WHERE v.organization_id=v_org.id AND v.code_hash=md5(upper(p_code)) FOR UPDATE;
 IF NOT FOUND OR v_voucher.status<>'unused' OR (v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at<=now()) THEN
  RETURN jsonb_build_object('ok',false,'error','Voucher is invalid, expired, or already used.');
 END IF;
 SELECT * INTO v_package FROM public.wifi_packages p
 WHERE p.id=v_voucher.package_id AND p.organization_id=v_org.id AND p.is_active=true;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','This voucher package is no longer available.'); END IF;

 INSERT INTO public.wifi_customers(organization_id,mac_address,status) VALUES(v_org.id,v_mac,'active')
 ON CONFLICT(organization_id,mac_address) WHERE mac_address IS NOT NULL
 DO UPDATE SET status='active',updated_at=now() RETURNING id INTO v_customer_id;

 v_username:='EW'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
 -- wall_clock packages expire after duration_seconds from activation request;
 -- connected_time packages count actual authenticated uptime on the MikroTik.
 v_expires_at:=CASE WHEN v_package.session_mode='wall_clock'
   THEN now()+make_interval(secs=>v_package.duration_seconds)
   WHEN v_package.validity_seconds IS NOT NULL
   THEN now()+make_interval(secs=>v_package.validity_seconds)
   ELSE NULL END;

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
   'valid_until',v_expires_at,'session_mode',v_package.session_mode,
   'data_limit_bytes',v_package.data_limit_bytes,'speed_down_kbps',v_package.speed_down_kbps,
   'speed_up_kbps',v_package.speed_up_kbps,'max_devices',v_package.max_devices,'package_name',v_package.name));

 RETURN jsonb_build_object('ok',true,'session_id',v_session_id,'status','queued',
  'username',v_username,'password',v_username,'valid_until',v_expires_at,
  'message','Voucher accepted. Connecting you to the Wi-Fi network now.');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_business_contact_settings(p_organization_id uuid, p_business_phone text, p_payment_phone text, p_payment_instructions text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 IF NOT public.is_org_admin(p_organization_id) THEN RAISE EXCEPTION 'Business owner or administrator permission required' USING errcode='42501'; END IF;
 IF length(regexp_replace(coalesce(p_business_phone,''),'[^0-9+]','','g'))<7 OR length(regexp_replace(coalesce(p_business_phone,''),'[^0-9+]','','g'))>20 THEN RAISE EXCEPTION 'Enter a valid business contact phone number' USING errcode='22023'; END IF;
 IF length(regexp_replace(coalesce(p_payment_phone,''),'[^0-9+]','','g'))<7 OR length(regexp_replace(coalesce(p_payment_phone,''),'[^0-9+]','','g'))>20 THEN RAISE EXCEPTION 'Enter a valid mobile money payment phone number' USING errcode='22023'; END IF;
 IF length(coalesce(p_payment_instructions,''))>500 THEN RAISE EXCEPTION 'Payment instructions are too long' USING errcode='22023'; END IF;
 UPDATE public.organizations SET contact_phone=trim(p_business_phone),updated_at=now() WHERE id=p_organization_id;
 UPDATE public.organization_settings SET payment_phone=trim(p_payment_phone),payment_instructions=nullif(trim(coalesce(p_payment_instructions,'')),''),updated_at=now() WHERE organization_id=p_organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Business settings were not found' USING errcode='P0002'; END IF;
 RETURN jsonb_build_object('ok',true,'organization_id',p_organization_id,'business_phone',trim(p_business_phone),'payment_phone',trim(p_payment_phone));
END;
$function$
;

REVOKE ALL ON FUNCTION public.update_business_contact_settings(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_business_contact_settings(uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION private.redeem_wifi_voucher(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.redeem_wifi_voucher(text,text,text) TO anon,authenticated;
REVOKE ALL ON FUNCTION private.claim_router_events(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.claim_router_events(text,integer) TO anon,authenticated;
REVOKE ALL ON FUNCTION private.complete_router_event(text,uuid,boolean,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.complete_router_event(text,uuid,boolean,jsonb,text) TO anon,authenticated;

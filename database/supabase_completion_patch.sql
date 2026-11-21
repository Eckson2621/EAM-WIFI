-- EAM-WIFI Supabase completion patch
-- Applied to project jvzjzmfnxytryzpylrqj on 2026-11-21.
-- This patch is idempotent and records the database fixes made after the project migration.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname,c.relname,a.attname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    JOIN pg_constraint pk ON pk.conrelid=c.oid AND pk.contype='p'
    WHERE n.nspname IN ('public','private') AND c.relkind='r'
      AND a.attname='id' AND a.atttypid='uuid'::regtype
      AND array_length(pk.conkey,1)=1 AND pk.conkey[1]=a.attnum
      AND NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid=c.oid AND d.adnum=a.attnum)
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT gen_random_uuid()',r.nspname,r.relname,r.attname);
  END LOOP;

  FOR r IN
    SELECT table_schema,table_name,column_name
    FROM information_schema.columns
    WHERE table_schema IN ('public','private')
      AND column_name IN ('created_at','updated_at')
      AND data_type='timestamp with time zone' AND column_default IS NULL
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT now()',r.table_schema,r.table_name,r.column_name);
  END LOOP;
END $$;

ALTER TABLE public.chat_message_reads ALTER COLUMN read_at SET DEFAULT now();
ALTER TABLE public.chat_participants ALTER COLUMN joined_at SET DEFAULT now();
ALTER TABLE public.chat_participants ALTER COLUMN muted SET DEFAULT false;
ALTER TABLE public.voucher_redemption_limits ALTER COLUMN attempts SET DEFAULT 0;
ALTER TABLE public.voucher_redemption_limits ALTER COLUMN window_started_at SET DEFAULT now();
ALTER TABLE public.access_sessions ALTER COLUMN data_used_bytes SET DEFAULT 0;
ALTER TABLE public.chat_messages ALTER COLUMN message_type SET DEFAULT 'text';
ALTER TABLE public.hotspot_sites ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE public.network_devices ALTER COLUMN connection_status SET DEFAULT 'not_configured';
ALTER TABLE public.network_devices ALTER COLUMN config SET DEFAULT '{}'::jsonb;
ALTER TABLE public.organizations ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.organization_members ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE public.organization_settings ALTER COLUMN allow_manual_payment SET DEFAULT true;
ALTER TABLE public.organization_settings ALTER COLUMN default_language SET DEFAULT 'en';
ALTER TABLE public.organization_settings ALTER COLUMN customer_portal_enabled SET DEFAULT true;
ALTER TABLE public.organization_settings ALTER COLUMN require_payment_approval SET DEFAULT true;
ALTER TABLE public.payment_requests ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.platform_subscriptions ALTER COLUMN monthly_price_tzs SET DEFAULT 6000;
ALTER TABLE public.platform_subscriptions ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.router_events ALTER COLUMN event_payload SET DEFAULT '{}'::jsonb;
ALTER TABLE public.router_events ALTER COLUMN processing_status SET DEFAULT 'pending';
ALTER TABLE public.router_events ALTER COLUMN occurred_at SET DEFAULT now();
ALTER TABLE public.support_messages ALTER COLUMN status SET DEFAULT 'new';
ALTER TABLE public.user_profiles ALTER COLUMN preferred_language SET DEFAULT 'en';
ALTER TABLE public.vouchers ALTER COLUMN status SET DEFAULT 'unused';
ALTER TABLE public.wifi_customers ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE public.wifi_packages ALTER COLUMN max_devices SET DEFAULT 1;
ALTER TABLE public.wifi_packages ALTER COLUMN session_mode SET DEFAULT 'connected_time';
ALTER TABLE public.wifi_packages ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE public.wifi_packages ALTER COLUMN display_order SET DEFAULT 0;

ALTER TABLE public.network_devices DROP CONSTRAINT IF EXISTS network_devices_connection_status_check;
ALTER TABLE public.network_devices ADD CONSTRAINT network_devices_connection_status_check
  CHECK (connection_status IN ('not_configured','pairing_pending','online','offline','error'));

ALTER TABLE public.platform_subscription_payments
  DROP CONSTRAINT IF EXISTS platform_subscription_payments_amount_tzs_check;
ALTER TABLE public.platform_subscription_payments
  DROP CONSTRAINT IF EXISTS platform_subscription_payments_months_check;
ALTER TABLE public.platform_subscription_payments
  ADD CONSTRAINT platform_subscription_payments_months_check CHECK (months BETWEEN 1 AND 60);
ALTER TABLE public.platform_subscription_payments
  ADD CONSTRAINT platform_subscription_payments_amount_tzs_check CHECK (amount_tzs = 6000 * months);

CREATE OR REPLACE FUNCTION private.authenticate_router_device(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_row record;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
  SELECT c.id AS credential_id,c.organization_id,c.device_id,d.name,d.model INTO v_row
  FROM private.router_device_credentials c
  JOIN public.network_devices d ON d.id=c.device_id
  WHERE c.token_hash=p_token_hash AND c.revoked_at IS NULL AND c.expires_at>now()
  ORDER BY c.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE private.router_device_credentials
    SET last_seen_at=now(),expires_at=now()+interval '365 days'
    WHERE id=v_row.credential_id;
  UPDATE public.network_devices
    SET connection_status='online',last_seen_at=now(),updated_at=now()
    WHERE id=v_row.device_id;
  RETURN jsonb_build_object('ok',true,'device_id',v_row.device_id,
    'organization_id',v_row.organization_id,'device_name',v_row.name,
    'model',v_row.model,'server_time',now(),
    'credential_expires_at',now()+interval '365 days');
END;
$function$;

CREATE OR REPLACE FUNCTION private.public_wifi_portal(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
  'ok',true,'organization_id',o.id,'business_name',o.name,
  'contact_phone',coalesce(os.payment_phone,o.contact_phone),
  'router_ready',exists(select 1 from public.network_devices d
    where d.organization_id=o.id and d.vendor='mikrotik' and d.connection_status='online'),
  'packages',coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'description',p.description,'price_tzs',p.price_tzs,
    'duration_seconds',p.duration_seconds,'validity_seconds',p.validity_seconds,
    'data_limit_bytes',p.data_limit_bytes,'speed_down_kbps',p.speed_down_kbps,
    'speed_up_kbps',p.speed_up_kbps) order by p.display_order,p.created_at)
    from public.wifi_packages p where p.organization_id=o.id and p.is_active=true),'[]'::jsonb))
 FROM public.organizations o
 JOIN public.platform_subscriptions s ON s.organization_id=o.id AND s.status='active' AND s.expires_at>now()
 LEFT JOIN public.organization_settings os ON os.organization_id=o.id
 WHERE o.slug=p_slug AND o.status='active' LIMIT 1;
$function$;

-- Voucher redemption now uses the same canonical router state ('online') as
-- the router heartbeat and public captive portal.
CREATE OR REPLACE FUNCTION private.redeem_wifi_voucher(p_slug text,p_code text,p_mac_address text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_org public.organizations%rowtype;
 v_voucher public.vouchers%rowtype;
 v_package public.wifi_packages%rowtype;
 v_customer_id uuid;
 v_session_id uuid;
 v_device_id uuid;
 v_username text;
 v_attempts integer;
 v_mac macaddr;
BEGIN
 IF coalesce(p_slug,'') !~ '^[a-z0-9-]{3,80}$' THEN RETURN jsonb_build_object('ok',false,'error','Wi-Fi site not found.'); END IF;
 IF coalesce(p_code,'') !~ '^EW[A-F0-9]{16,24}$' THEN RETURN jsonb_build_object('ok',false,'error','Voucher code is not valid.'); END IF;
 IF coalesce(p_mac_address,'') !~* '^([0-9a-f]{2}:){5}[0-9a-f]{2}$' THEN RETURN jsonb_build_object('ok',false,'error','Router client MAC address is required.'); END IF;
 v_mac:=lower(p_mac_address)::macaddr;
 INSERT INTO public.voucher_redemption_limits(mac_address,attempts,window_started_at)
 VALUES(v_mac,1,now())
 ON CONFLICT(mac_address) DO UPDATE SET
  attempts=case when public.voucher_redemption_limits.window_started_at<now()-interval '10 minutes' then 1 else public.voucher_redemption_limits.attempts+1 end,
  window_started_at=case when public.voucher_redemption_limits.window_started_at<now()-interval '10 minutes' then now() else public.voucher_redemption_limits.window_started_at end,
  updated_at=now()
 RETURNING attempts INTO v_attempts;
 IF v_attempts>5 THEN RETURN jsonb_build_object('ok',false,'error','Too many attempts. Wait 10 minutes and try again.'); END IF;
 SELECT o.* INTO v_org FROM public.organizations o
 JOIN public.platform_subscriptions s ON s.organization_id=o.id
 WHERE o.slug=p_slug AND o.status='active' AND s.status='active' AND s.expires_at>now()
 FOR SHARE OF o;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','This Wi-Fi service is temporarily unavailable.'); END IF;
 SELECT id INTO v_device_id FROM public.network_devices
 WHERE organization_id=v_org.id AND vendor='mikrotik' AND connection_status='online'
 ORDER BY created_at LIMIT 1;
 IF v_device_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','The MikroTik router is not connected to EAM-WIFI yet. Please contact the Wi-Fi business.'); END IF;
 SELECT * INTO v_voucher FROM public.vouchers v
 WHERE v.organization_id=v_org.id AND v.code_hash=md5(upper(p_code)) FOR UPDATE;
 IF NOT FOUND OR v_voucher.status<>'unused' OR (v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at<=now()) THEN
  RETURN jsonb_build_object('ok',false,'error','Voucher is invalid, expired, or already used.');
 END IF;
 SELECT * INTO v_package FROM public.wifi_packages p
 WHERE p.id=v_voucher.package_id AND p.organization_id=v_org.id AND p.is_active=true;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','This voucher package is no longer available.'); END IF;
 INSERT INTO public.wifi_customers(organization_id,mac_address,status)
 VALUES(v_org.id,v_mac,'active')
 ON CONFLICT(organization_id,mac_address) WHERE mac_address IS NOT NULL
 DO UPDATE SET status='active',updated_at=now()
 RETURNING id INTO v_customer_id;
 v_username:='EW'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 INSERT INTO public.access_sessions(
  organization_id,customer_id,package_id,device_id,username,session_status,remaining_seconds,expires_at,mac_address
 ) VALUES(v_org.id,v_customer_id,v_package.id,v_device_id,v_username,'queued',v_package.duration_seconds,
  case when v_package.validity_seconds is null then null else now()+make_interval(secs=>v_package.validity_seconds) end,v_mac)
 RETURNING id INTO v_session_id;
 UPDATE public.vouchers SET status='redeemed',redeemed_by_customer_id=v_customer_id,redeemed_at=now()
 WHERE id=v_voucher.id AND status='unused';
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Voucher has already been used.'); END IF;
 INSERT INTO public.router_events(organization_id,device_id,session_id,event_type,event_payload)
 VALUES(v_org.id,v_device_id,v_session_id,'voucher_redemption_requested',
  jsonb_build_object('username',v_username,'mac_address',v_mac::text,
   'duration_seconds',v_package.duration_seconds,'validity_seconds',v_package.validity_seconds,
   'data_limit_bytes',v_package.data_limit_bytes,'speed_down_kbps',v_package.speed_down_kbps,
   'max_devices',v_package.max_devices,'speed_up_kbps',v_package.speed_up_kbps));
 RETURN jsonb_build_object('ok',true,'session_id',v_session_id,'status','queued',
  'message','Voucher accepted. MikroTik is activating your internet session.');
END;
$function$;

REVOKE ALL ON FUNCTION private.authenticate_router_device(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.authenticate_router_device(text) TO anon,authenticated;

-- Each approved router payment covers exactly one month at TSh 7,500.
CREATE OR REPLACE FUNCTION private.platform_admin_approve_router_subscription(
 p_device_id uuid,
 p_payment_method text,
 p_payment_reference text DEFAULT NULL::text,
 p_months integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_org uuid; v_start timestamptz; v_expiry timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_platform_admin() THEN
  RAISE EXCEPTION 'Platform administrator permission required' USING errcode='42501';
 END IF;
 IF p_payment_method NOT IN ('cash','mobile_money','bank_transfer','other') THEN
  RAISE EXCEPTION 'Unsupported payment method' USING errcode='22023';
 END IF;
 IF p_months IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'Router subscriptions are approved one month at a time: TSh 7,500 per router.' USING errcode='22023';
 END IF;
 IF p_payment_reference IS NOT NULL AND length(trim(p_payment_reference))>120 THEN
  RAISE EXCEPTION 'Payment reference is too long' USING errcode='22023';
 END IF;
 SELECT organization_id INTO v_org FROM public.network_devices WHERE id=p_device_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Router not found' USING errcode='P0002'; END IF;
 INSERT INTO public.router_subscriptions(device_id,organization_id,status,monthly_price_tzs)
 VALUES(p_device_id,v_org,'pending',7500) ON CONFLICT(device_id) DO NOTHING;
 SELECT CASE WHEN status='active' AND expires_at>now() THEN expires_at ELSE now() END
 INTO v_start FROM public.router_subscriptions WHERE device_id=p_device_id FOR UPDATE;
 v_expiry:=v_start+interval '1 month';
 UPDATE public.router_subscriptions SET status='active',monthly_price_tzs=7500,
  started_at=coalesce(started_at,v_start),expires_at=v_expiry,payment_method=p_payment_method,
  payment_reference=nullif(trim(coalesce(p_payment_reference,'')),''),
  last_approved_by=auth.uid(),updated_at=now()
 WHERE device_id=p_device_id;
 RETURN jsonb_build_object('ok',true,'device_id',p_device_id,'organization_id',v_org,
  'status','active','expires_at',v_expiry,'monthly_price_tzs',7500,'amount_tzs',7500);
END;
$function$;

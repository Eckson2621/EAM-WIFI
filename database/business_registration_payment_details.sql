-- Atomic business registration including the owner's customer payment number.
CREATE OR REPLACE FUNCTION public.register_wifi_business_with_payment(p_owner_name text, p_business_name text, p_contact_phone text, p_country_code text, p_currency_code text, p_timezone text, p_site_name text, p_site_address text, p_router_name text, p_router_vendor text, p_router_model text, p_integration_type text, p_management_address text, p_api_port integer, p_payment_phone text, p_payment_instructions text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb; v_org uuid; v_phone text;
BEGIN
 v_phone:=trim(coalesce(nullif(p_payment_phone,''),p_contact_phone,''));
 IF length(regexp_replace(v_phone,'[^0-9+]','','g'))<7 OR length(regexp_replace(v_phone,'[^0-9+]','','g'))>20 THEN
  RAISE EXCEPTION 'A valid customer payment phone number is required' USING errcode='22023';
 END IF;
 IF length(coalesce(p_payment_instructions,''))>500 THEN
  RAISE EXCEPTION 'Payment instructions are too long' USING errcode='22023';
 END IF;
 v_result:=public.register_wifi_business(
  p_owner_name,p_business_name,p_contact_phone,p_country_code,p_currency_code,p_timezone,
  p_site_name,p_site_address,p_router_name,p_router_vendor,p_router_model,p_integration_type,
  p_management_address,p_api_port
 );
 v_org:=(v_result->>'organization_id')::uuid;
 UPDATE public.organization_settings
 SET payment_phone=v_phone,payment_instructions=nullif(trim(coalesce(p_payment_instructions,'')),''),
  updated_at=now()
 WHERE organization_id=v_org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Business payment settings could not be created' USING errcode='P0002'; END IF;
 RETURN v_result || jsonb_build_object('payment_phone',v_phone);
END;
$function$
;
REVOKE ALL ON FUNCTION public.register_wifi_business_with_payment(text,text,text,text,text,text,text,text,text,text,text,text,text,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_wifi_business_with_payment(text,text,text,text,text,text,text,text,text,text,text,text,text,integer,text,text) TO authenticated;

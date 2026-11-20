-- Register a Wi-Fi business, its first hotspot site, and its router record atomically.
-- SECURITY INVOKER is intentional: caller JWT, grants and RLS policies remain in force.
create or replace function public.register_wifi_business(
  p_owner_name text,
  p_business_name text,
  p_contact_phone text,
  p_country_code text,
  p_currency_code text,
  p_timezone text,
  p_site_name text,
  p_site_address text,
  p_router_name text,
  p_router_vendor text,
  p_router_model text,
  p_integration_type text,
  p_management_address text,
  p_api_port integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_org_id uuid;
  v_site_id uuid;
  v_device_id uuid;
  v_slug text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_owner_name, ''))) < 2 then raise exception 'Owner name is required'; end if;
  if length(trim(coalesce(p_business_name, ''))) < 2 or length(trim(p_business_name)) > 120 then raise exception 'Business name must be between 2 and 120 characters'; end if;
  if length(trim(coalesce(p_contact_phone, ''))) < 7 then raise exception 'A valid business contact phone is required'; end if;
  if length(trim(coalesce(p_site_name, ''))) < 2 then raise exception 'Hotspot site name is required'; end if;
  if coalesce(p_router_vendor, '') not in ('mikrotik','ubiquiti','tp_link','huawei','other') then raise exception 'Unsupported router vendor'; end if;
  if coalesce(p_integration_type, '') not in ('mikrotik_hotspot','routeros_api','manual','other') then raise exception 'Unsupported integration type'; end if;
  if p_api_port is not null and (p_api_port < 1 or p_api_port > 65535) then raise exception 'Router API port must be between 1 and 65535'; end if;
  if coalesce(p_country_code, '') !~ '^[A-Z]{2}$' then raise exception 'Country code must contain two uppercase letters'; end if;
  if coalesce(p_currency_code, '') !~ '^[A-Z]{3}$' then raise exception 'Currency code must contain three uppercase letters'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then raise exception 'Invalid timezone'; end if;

  v_slug := left(coalesce(nullif(trim(both '-' from regexp_replace(lower(trim(p_business_name)), '[^a-z0-9]+', '-', 'g')), ''), 'wifi-business'), 52)
            || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.organizations (name, slug, owner_user_id, status, country_code, currency_code, timezone, contact_phone)
  values (trim(p_business_name), v_slug, v_user_id, 'pending', p_country_code, p_currency_code, p_timezone, trim(p_contact_phone))
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (v_org_id, v_user_id, 'owner', 'active');

  insert into public.user_profiles (user_id, display_name, phone)
  values (v_user_id, trim(p_owner_name), trim(p_contact_phone))
  on conflict (user_id) do update
    set display_name = excluded.display_name, phone = excluded.phone, updated_at = now();

  insert into public.hotspot_sites (organization_id, name, address, status)
  values (v_org_id, trim(p_site_name), nullif(trim(coalesce(p_site_address, '')), ''), 'active')
  returning id into v_site_id;

  insert into public.network_devices (organization_id, site_id, name, vendor, model, integration_type, connection_status, config)
  values (
    v_org_id, v_site_id, trim(p_router_name), p_router_vendor,
    nullif(trim(coalesce(p_router_model, '')), ''), p_integration_type, 'not_configured',
    jsonb_strip_nulls(jsonb_build_object(
      'management_address', nullif(trim(coalesce(p_management_address, '')), ''),
      'api_port', p_api_port,
      'setup_state', 'awaiting_secure_pairing',
      'credentials_provisioned', false
    ))
  )
  returning id into v_device_id;

  insert into public.organization_settings (organization_id, payment_phone, default_language, allow_manual_payment, customer_portal_enabled, require_payment_approval)
  values (v_org_id, trim(p_contact_phone), 'en', true, true, true);

  return jsonb_build_object(
    'organization_id', v_org_id, 'organization_slug', v_slug,
    'site_id', v_site_id, 'device_id', v_device_id,
    'organization_status', 'pending', 'device_status', 'not_configured',
    'next_step', 'secure_router_pairing'
  );
end;
$function$;

revoke all on function public.register_wifi_business(text,text,text,text,text,text,text,text,text,text,text,text,text,integer) from public, anon;
grant execute on function public.register_wifi_business(text,text,text,text,text,text,text,text,text,text,text,text,text,integer) to authenticated;

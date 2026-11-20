-- Keep narrowly scoped SECURITY DEFINER implementation functions outside the exposed public schema.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon,authenticated;
alter function public.public_wifi_portal(text) set schema private;
alter function public.redeem_wifi_voucher(text,text,text) set schema private;
grant execute on function private.public_wifi_portal(text) to anon,authenticated;
grant execute on function private.redeem_wifi_voucher(text,text,text) to anon,authenticated;
create or replace function public.public_wifi_portal(p_slug text)
returns jsonb language sql stable security invoker set search_path=''
as $$ select private.public_wifi_portal(p_slug); $$;
revoke all on function public.public_wifi_portal(text) from public;
grant execute on function public.public_wifi_portal(text) to anon,authenticated;
create or replace function public.redeem_wifi_voucher(p_slug text,p_code text,p_mac_address text)
returns jsonb language sql security invoker set search_path=''
as $$ select private.redeem_wifi_voucher(p_slug,p_code,p_mac_address); $$;
revoke all on function public.redeem_wifi_voucher(text,text,text) from public;
grant execute on function public.redeem_wifi_voucher(text,text,text) to anon,authenticated;

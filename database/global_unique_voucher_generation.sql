-- Source copy of the applied Supabase migration: global_unique_voucher_generation.
-- See Supabase migration history for the live applied version.
alter table public.vouchers
  drop constraint if exists vouchers_organization_id_code_hash_key;
create unique index if not exists vouchers_code_hash_global_uidx
  on public.vouchers (code_hash);
create index if not exists vouchers_org_status_created_idx
  on public.vouchers (organization_id, status, created_at desc);

create or replace function public.generate_wifi_vouchers(
  p_organization_id uuid, p_package_id uuid, p_quantity integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_code text;
  v_hash text;
  v_id uuid;
  v_codes jsonb := '[]'::jsonb;
  v_inserted integer;
  v_attempt integer;
  v_i integer;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 500 then raise exception 'Quantity must be between 1 and 500' using errcode = '22023'; end if;
  if not public.is_org_admin(p_organization_id) then raise exception 'Organization administrator permission required' using errcode = '42501'; end if;
  if not exists (select 1 from public.organizations o where o.id = p_organization_id and o.status = 'active') then raise exception 'Organization is not active' using errcode = '23514'; end if;
  if not exists (select 1 from public.wifi_packages p where p.id = p_package_id and p.organization_id = p_organization_id and p.is_active = true) then raise exception 'Active package not found in this organization' using errcode = '23503'; end if;
  for v_i in 1..p_quantity loop
    v_inserted := 0;
    for v_attempt in 1..10 loop
      v_code := 'EW' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
      v_hash := md5(v_code);
      insert into public.vouchers (organization_id, package_id, code_hash, code_hint, status, created_by)
      values (p_organization_id, p_package_id, v_hash, right(v_code, 4), 'unused', v_user_id)
      on conflict (code_hash) do nothing
      returning id into v_id;
      if v_id is not null then
        v_codes := v_codes || jsonb_build_array(jsonb_build_object('id', v_id, 'code', v_code, 'hint', right(v_code, 4)));
        v_inserted := 1;
        v_id := null;
        exit;
      end if;
    end loop;
    if v_inserted = 0 then raise exception 'Could not generate a unique voucher code; retry the batch'; end if;
  end loop;
  return jsonb_build_object('organization_id', p_organization_id, 'package_id', p_package_id, 'generated_count', p_quantity, 'codes', v_codes, 'warning', 'Save or print these codes now. Plaintext codes are not stored and cannot be retrieved later.');
end;
$function$;
revoke all on function public.generate_wifi_vouchers(uuid, uuid, integer) from public, anon;
grant execute on function public.generate_wifi_vouchers(uuid, uuid, integer) to authenticated;

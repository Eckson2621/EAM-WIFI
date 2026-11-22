create or replace function private.create_router_device_credential_for_device(
 p_user_id uuid,p_device_id uuid,p_token_hash text,p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_org uuid;
begin
 if p_user_id is null or p_device_id is null or p_token_hash !~ '^[a-f0-9]{64}$'
  or p_expires_at<=now() or p_expires_at>now()+interval '15 minutes' then
  raise exception 'Invalid router pairing request' using errcode='22023'; end if;
 select organization_id into v_org from public.network_devices
 where id=p_device_id and lower(vendor)='mikrotik';
 if not found then raise exception 'MikroTik router not found' using errcode='P0002'; end if;
 if not exists(select 1 from public.organization_members m where m.organization_id=v_org
  and m.user_id=p_user_id and m.status='active' and m.role in ('owner','admin')) then
  raise exception 'Organization owner or admin access required' using errcode='42501'; end if;
 update private.router_device_credentials set revoked_at=now()
 where device_id=p_device_id and revoked_at is null;
 insert into private.router_device_credentials(organization_id,device_id,token_hash,expires_at,created_by)
 values(v_org,p_device_id,p_token_hash,p_expires_at,p_user_id);
 update public.network_devices set connection_status='pairing_pending',updated_at=now() where id=p_device_id;
 return jsonb_build_object('device_id',p_device_id,'organization_id',v_org,'expires_at',p_expires_at);
end $$;

create or replace function public.create_router_device_credential_for_device(
 p_device_id uuid,p_token_hash text,p_expires_at timestamptz
) returns jsonb language sql security invoker set search_path=''
as $$ select private.create_router_device_credential_for_device(auth.uid(),p_device_id,p_token_hash,p_expires_at) $$;
revoke all on function public.create_router_device_credential_for_device(uuid,text,timestamptz) from public,anon;
grant execute on function public.create_router_device_credential_for_device(uuid,text,timestamptz) to authenticated;

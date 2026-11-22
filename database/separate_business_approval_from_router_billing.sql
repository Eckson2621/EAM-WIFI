-- The business account is approved once; the TZS 6,000 recurring charge belongs to each router only.
create or replace function private.platform_admin_approve_subscription_period(
 p_organization_id uuid,p_payment_method text,p_payment_reference text default null,p_months integer default 1
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid();
begin
 if v_user is null or not private.is_platform_admin() then
  raise exception 'Platform administrator permission required' using errcode='42501'; end if;
 if p_organization_id is null then raise exception 'Organization is required' using errcode='22023'; end if;
 update public.organizations set status='active',updated_at=now() where id=p_organization_id;
 if not found then raise exception 'Organization not found' using errcode='P0002'; end if;
 -- Legacy organization-wide billing is no longer used for access decisions.
 update public.platform_subscriptions set status='suspended',updated_at=now()
 where organization_id=p_organization_id;
 return jsonb_build_object('organization_id',p_organization_id,'status','active',
  'billing_model','per_router','message','Business approved. Each router requires its own TZS 6,000 monthly subscription.');
end $$;

-- Prevent legacy organization-scoped voucher issuance from bypassing router selection.
revoke all on function public.issue_paid_wifi_voucher(uuid,uuid,bigint,text,text,text) from public,anon,authenticated;
create index if not exists router_subscriptions_last_approved_by_idx on public.router_subscriptions(last_approved_by);

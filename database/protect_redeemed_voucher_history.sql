-- Source copy of the applied Supabase migration: protect_redeemed_voucher_history.
-- Voucher rows are historical records: revoke, never delete or recycle.
create or replace function public.guard_wifi_voucher_history()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Vouchers cannot be deleted. Revoke them instead so their codes are never recycled.';
  end if;
  if old.code_hash is distinct from new.code_hash then
    raise exception 'A voucher code identity cannot be changed.';
  end if;
  if old.status = 'redeemed' and new.status <> 'redeemed' then
    raise exception 'A redeemed voucher can never be reactivated or reused.';
  end if;
  if old.status = 'redeemed' and (
    old.organization_id is distinct from new.organization_id
    or old.package_id is distinct from new.package_id
    or old.redeemed_by_customer_id is distinct from new.redeemed_by_customer_id
    or old.redeemed_at is distinct from new.redeemed_at
  ) then
    raise exception 'The ownership and redemption history of a used voucher is immutable.';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_wifi_voucher_history() from public, anon, authenticated;
drop trigger if exists protect_wifi_voucher_history on public.vouchers;
create trigger protect_wifi_voucher_history
before update or delete on public.vouchers
for each row execute function public.guard_wifi_voucher_history();

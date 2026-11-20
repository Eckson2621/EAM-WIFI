-- Merge organization access rules and explicitly deny direct access to redemption counters.
create policy "deny direct voucher redemption rate limit access" on public.voucher_redemption_limits
for all to anon,authenticated using(false) with check(false);
drop policy if exists "owners and members read organizations" on public.organizations;
drop policy if exists "platform admin reads all organizations" on public.organizations;
create policy "organization owners members and platform admin read" on public.organizations
for select to authenticated using (
 owner_user_id=(select auth.uid())
 or exists(select 1 from public.organization_members m where m.organization_id=organizations.id and m.user_id=(select auth.uid()) and m.status='active')
 or lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com'
);
drop policy if exists "owners update organizations" on public.organizations;
drop policy if exists "platform admin updates organizations" on public.organizations;
create policy "owners and platform admin update organizations" on public.organizations
for update to authenticated using (
 owner_user_id=(select auth.uid()) or lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com'
) with check (
 owner_user_id=(select auth.uid()) or lower(coalesce((select auth.jwt())->>'email',''))='mwalimueckson2104@gmail.com'
);

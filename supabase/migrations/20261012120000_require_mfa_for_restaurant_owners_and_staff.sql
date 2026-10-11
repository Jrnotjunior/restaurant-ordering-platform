-- Enforce MFA at the database boundary for authenticated restaurant owners and staff.
-- Customers and public storefront reads remain exempt. System Admin access is
-- handled by the existing System Admin AAL2 helpers and restrictive policy.
--
-- SECURITY DEFINER avoids RLS recursion when checking membership. The function
-- only returns a boolean and does not expose restaurant or staff records.

create or replace function public.privileged_restaurant_mfa_verified()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    -- System Admin requests must have an AAL2 session.
    case
      when coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'system_admin'
        then coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      -- Restaurant owners and staff must also have an AAL2 session.
      when exists (
        select 1
        from public.restaurants r
        where r.owner_id = auth.uid()
      ) or exists (
        select 1
        from public.restaurant_staff s
        where s.auth_user_id = auth.uid()
          and s.is_active = true
      )
        then coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      -- Customers and other authenticated users are not subject to this gate.
      else true
    end;
$$;

revoke all on function public.privileged_restaurant_mfa_verified() from public, anon;
grant execute on function public.privileged_restaurant_mfa_verified() to authenticated;

drop policy if exists "Require MFA for privileged restaurant staff records" on public.restaurant_staff;
create policy "Require MFA for privileged restaurant staff records"
on public.restaurant_staff
as restrictive
for all
to authenticated
using (public.privileged_restaurant_mfa_verified())
with check (public.privileged_restaurant_mfa_verified());

drop policy if exists "Require MFA for privileged order access" on public.orders;
create policy "Require MFA for privileged order access"
on public.orders
as restrictive
for all
to authenticated
using (public.privileged_restaurant_mfa_verified())
with check (public.privileged_restaurant_mfa_verified());

drop policy if exists "Require MFA for privileged delivery access" on public.delivery_assignments;
create policy "Require MFA for privileged delivery access"
on public.delivery_assignments
as restrictive
for all
to authenticated
using (public.privileged_restaurant_mfa_verified())
with check (public.privileged_restaurant_mfa_verified());

drop policy if exists "Require MFA for privileged PayMongo access" on public.restaurant_paymongo_accounts;
create policy "Require MFA for privileged PayMongo access"
on public.restaurant_paymongo_accounts
as restrictive
for all
to authenticated
using (public.privileged_restaurant_mfa_verified())
with check (public.privileged_restaurant_mfa_verified());

drop policy if exists "Require MFA for privileged website customization access" on public.restaurant_website_customizations;
create policy "Require MFA for privileged website customization access"
on public.restaurant_website_customizations
as restrictive
for all
to authenticated
using (public.privileged_restaurant_mfa_verified())
with check (public.privileged_restaurant_mfa_verified());

comment on function public.privileged_restaurant_mfa_verified() is
  'Restrictive RLS predicate requiring AAL2 for authenticated System Admin, restaurant owners, and active restaurant staff while exempting customers and public requests.';

-- Enforce MFA assurance for direct System Administrator access to restaurants.
-- This is intentionally a restrictive policy: existing owner/public policies remain
-- intact, while any request authenticated as a System Administrator must have AAL2.
-- SECURITY DEFINER RPCs need their own in-function checks and are audited separately.

create or replace function public.system_admin_mfa_verified()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'system_admin'
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

revoke all on function public.system_admin_mfa_verified() from public, anon;
grant execute on function public.system_admin_mfa_verified() to authenticated;

drop policy if exists "Require MFA for System Admin restaurant access" on public.restaurants;
create policy "Require MFA for System Admin restaurant access"
on public.restaurants
as restrictive
for all
to authenticated
using (public.system_admin_mfa_verified())
with check (public.system_admin_mfa_verified());

comment on function public.system_admin_mfa_verified() is
  'Restrictive RLS predicate: System Admin JWTs must have aal2; non-System Admin requests pass through to existing role/tenant policies.';

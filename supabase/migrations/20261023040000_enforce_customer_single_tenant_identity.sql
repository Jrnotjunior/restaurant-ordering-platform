-- Enforce one customer identity per restaurant tenant. The browser may forge
-- x-restaurant-domain / x-restaurant-slug headers, so those headers must never
-- be sufficient to move an existing authenticated customer identity to another
-- restaurant. Guest checkout is unaffected because auth_user_id is NULL.
--
-- This guard protects both direct writes and SECURITY DEFINER signup RPCs.
create or replace function public.enforce_customer_single_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.auth_user_id is not null and exists (
    select 1
    from public.customer_profiles cp
    where cp.auth_user_id = new.auth_user_id
      and cp.restaurant_id <> new.restaurant_id
      and cp.id is distinct from new.id
  ) then
    raise exception 'This customer account is already registered with another restaurant'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_customer_single_tenant() from public, anon, authenticated;

drop trigger if exists customer_profiles_single_tenant_guard on public.customer_profiles;
create trigger customer_profiles_single_tenant_guard
before insert or update of auth_user_id, restaurant_id
on public.customer_profiles
for each row
execute function public.enforce_customer_single_tenant();

create or replace function public.customer_identity_is_single_tenant(
  p_auth_user_id uuid,
  p_restaurant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $
  select p_auth_user_id = auth.uid()
    and exists (
      select 1 from public.customer_profiles cp
      where cp.auth_user_id = p_auth_user_id
        and cp.restaurant_id = p_restaurant_id
    )
    and not exists (
      select 1 from public.customer_profiles cp
      where cp.auth_user_id = p_auth_user_id
        and cp.restaurant_id <> p_restaurant_id
    );
$;

revoke all on function public.customer_identity_is_single_tenant(uuid, uuid) from public, anon;
grant execute on function public.customer_identity_is_single_tenant(uuid, uuid) to authenticated;

-- Existing cross-tenant duplicates must not remain readable if present before
-- this migration. A profile is visible only when the identity has exactly one
-- tenant profile, and that profile belongs to the active request tenant.
drop policy if exists "Customers can read own profile" on public.customer_profiles;
create policy "Customers can read own profile"
on public.customer_profiles
for select
to authenticated
using (
  auth_user_id = auth.uid()
  and restaurant_id = public.get_request_restaurant_id()
  and public.customer_identity_is_single_tenant(auth.uid(), customer_profiles.restaurant_id)
);

drop policy if exists "Customers can update own profile" on public.customer_profiles;
create policy "Customers can update own profile"
on public.customer_profiles
for update
to authenticated
using (
  auth_user_id = auth.uid()
  and restaurant_id = public.get_request_restaurant_id()
  and public.customer_identity_is_single_tenant(auth.uid(), customer_profiles.restaurant_id)
)
with check (
  auth_user_id = auth.uid()
  and restaurant_id = public.get_request_restaurant_id()
  and public.customer_identity_is_single_tenant(auth.uid(), customer_profiles.restaurant_id)
);

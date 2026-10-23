-- Authenticated customer rows are scoped by the database-owned profile relationship.
-- Do not use request headers as a second authorization gate in customer RLS policies.

drop policy if exists "Customers can read own profile" on public.customer_profiles;
create policy "Customers can read own profile"
on public.customer_profiles
for select
to authenticated
using (
  auth_user_id = auth.uid()
  and public.customer_identity_is_single_tenant(auth.uid(), customer_profiles.restaurant_id)
);

drop policy if exists "Customers can update own profile" on public.customer_profiles;
create policy "Customers can update own profile"
on public.customer_profiles
for update
to authenticated
using (
  auth_user_id = auth.uid()
  and public.customer_identity_is_single_tenant(auth.uid(), customer_profiles.restaurant_id)
)
with check (
  auth_user_id = auth.uid()
  and public.customer_identity_is_single_tenant(auth.uid(), customer_profiles.restaurant_id)
);

drop policy if exists customer_addresses_select_own on public.customer_addresses;
create policy customer_addresses_select_own
on public.customer_addresses
for select
to authenticated
using (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = customer_addresses.restaurant_id
  )
  and public.customer_identity_is_single_tenant(auth.uid(), customer_addresses.restaurant_id)
);

drop policy if exists customer_addresses_insert_own on public.customer_addresses;
create policy customer_addresses_insert_own
on public.customer_addresses
for insert
to authenticated
with check (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = customer_addresses.restaurant_id
  )
  and public.customer_identity_is_single_tenant(auth.uid(), customer_addresses.restaurant_id)
);

drop policy if exists customer_addresses_update_own on public.customer_addresses;
create policy customer_addresses_update_own
on public.customer_addresses
for update
to authenticated
using (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = customer_addresses.restaurant_id
  )
  and public.customer_identity_is_single_tenant(auth.uid(), customer_addresses.restaurant_id)
)
with check (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = customer_addresses.restaurant_id
  )
  and public.customer_identity_is_single_tenant(auth.uid(), customer_addresses.restaurant_id)
);

drop policy if exists customer_addresses_delete_own on public.customer_addresses;
create policy customer_addresses_delete_own
on public.customer_addresses
for delete
to authenticated
using (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = customer_addresses.restaurant_id
  )
  and public.customer_identity_is_single_tenant(auth.uid(), customer_addresses.restaurant_id)
);

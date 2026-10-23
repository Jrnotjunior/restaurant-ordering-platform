-- Close the legacy saved-address update RPC and table-policy tenant gaps.
-- Existing duplicate customer identities fail closed; guest checkout is unaffected.

create or replace function public.update_my_customer_address(
  p_restaurant_id uuid,
  p_address_id uuid,
  p_label text,
  p_city text,
  p_barangay text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_place_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id()
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception 'An exact map location is required';
  end if;

  select cp.id into v_customer_id
  from public.customer_profiles cp
  where cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id
  limit 1;

  if v_customer_id is null then
    raise exception 'Customer profile not found';
  end if;

  if not exists (
    select 1
    from public.customer_addresses ca
    where ca.id = p_address_id
      and ca.customer_id = v_customer_id
      and ca.restaurant_id = p_restaurant_id
  ) then
    raise exception 'Address not found';
  end if;

  if length(trim(coalesce(p_city, ''))) = 0
     or length(trim(coalesce(p_barangay, ''))) = 0
     or length(trim(coalesce(p_address, ''))) = 0 then
    raise exception 'City, barangay, and address are required';
  end if;

  update public.customer_addresses
  set
    label = coalesce(nullif(trim(p_label), ''), 'Address'),
    city = trim(p_city),
    barangay = trim(p_barangay),
    address = trim(p_address),
    latitude = p_latitude,
    longitude = p_longitude,
    place_id = nullif(trim(coalesce(p_place_id, '')), ''),
    updated_at = now()
  where id = p_address_id
    and customer_id = v_customer_id
    and restaurant_id = p_restaurant_id;

  update public.customer_profiles cp
  set
    default_delivery_city = ca.city,
    default_delivery_barangay = ca.barangay,
    default_delivery_address = ca.address,
    updated_at = now()
  from public.customer_addresses ca
  where cp.id = v_customer_id
    and ca.id = p_address_id
    and ca.is_default = true
    and ca.restaurant_id = p_restaurant_id;

  return true;
end;
$$;

revoke all on function public.update_my_customer_address(uuid, uuid, text, text, text, text, double precision, double precision, text)
from public, anon;

grant execute on function public.update_my_customer_address(uuid, uuid, text, text, text, text, double precision, double precision, text)
to authenticated;

drop policy if exists customer_addresses_select_own on public.customer_addresses;
create policy customer_addresses_select_own
on public.customer_addresses
for select
to authenticated
using (
  restaurant_id = public.get_request_restaurant_id()
  and exists (
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
  restaurant_id = public.get_request_restaurant_id()
  and exists (
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
  restaurant_id = public.get_request_restaurant_id()
  and exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = customer_addresses.restaurant_id
  )
  and public.customer_identity_is_single_tenant(auth.uid(), customer_addresses.restaurant_id)
)
with check (
  restaurant_id = public.get_request_restaurant_id()
  and exists (
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
  restaurant_id = public.get_request_restaurant_id()
  and exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = customer_addresses.restaurant_id
  )
  and public.customer_identity_is_single_tenant(auth.uid(), customer_addresses.restaurant_id)
);

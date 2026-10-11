-- Keep the customer profile RPC compatible while removing its dependency on the legacy name column.
drop function if exists public.get_my_customer_profile(uuid);

create function public.get_my_customer_profile(
  p_restaurant_id uuid
)
returns table (
  customer_id uuid,
  name text,
  phone text,
  default_delivery_city text,
  default_delivery_barangay text,
  default_delivery_address text,
  default_delivery_latitude double precision,
  default_delivery_longitude double precision,
  default_delivery_place_id text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer profile does not belong to the current restaurant';
  end if;

  return query
  select
    cp.id,
    nullif(trim(concat_ws(' ', nullif(trim(cp.first_name), ''), nullif(trim(cp.last_name), ''))), ''),
    cp.phone,
    ca.city,
    ca.barangay,
    ca.address,
    ca.latitude,
    ca.longitude,
    ca.place_id
  from public.customer_profiles cp
  left join lateral (
    select ca.city, ca.barangay, ca.address, ca.latitude, ca.longitude, ca.place_id
    from public.customer_addresses ca
    where ca.customer_id = cp.id
      and ca.restaurant_id = p_restaurant_id
      and ca.is_default = true
    limit 1
  ) ca on true
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id = auth.uid()
  limit 1;
end;
$$;

revoke all on function public.get_my_customer_profile(uuid) from public;
grant execute on function public.get_my_customer_profile(uuid) to authenticated;

-- Customer profile reads are scoped by the signed-in user's database-owned profile.
create or replace function public.get_my_customer_profile(
  p_restaurant_id uuid
)
returns table (
  customer_id uuid,
  name text,
  phone text,
  default_delivery_city text,
  default_delivery_barangay text,
  default_delivery_address text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id is null
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
  end if;

  return query
  select
    cp.id,
    cp.name,
    cp.phone,
    ca.city,
    ca.barangay,
    ca.address
  from public.customer_profiles cp
  left join lateral (
    select ca.city, ca.barangay, ca.address
    from public.customer_addresses ca
    where ca.customer_id = cp.id
      and ca.restaurant_id = p_restaurant_id
      and ca.is_default = true
    order by ca.created_at desc
    limit 1
  ) ca on true
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id = auth.uid()
  limit 1;
end;
$$;

revoke all on function public.get_my_customer_profile(uuid) from public, anon;
grant execute on function public.get_my_customer_profile(uuid) to authenticated;

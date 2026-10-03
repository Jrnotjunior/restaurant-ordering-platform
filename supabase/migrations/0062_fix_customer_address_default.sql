create or replace function public.set_my_customer_address_default(
  p_restaurant_id uuid,
  p_address_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_city text;
  v_barangay text;
  v_address text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select cp.id into v_customer_id
  from public.customer_profiles cp
  where cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id
  limit 1;

  if v_customer_id is null then
    raise exception 'Customer profile not found';
  end if;

  select ca.city, ca.barangay, ca.address
  into v_city, v_barangay, v_address
  from public.customer_addresses ca
  where ca.id = p_address_id
    and ca.customer_id = v_customer_id
    and ca.restaurant_id = p_restaurant_id
  limit 1;

  if v_city is null then
    raise exception 'Address not found';
  end if;

  update public.customer_addresses
  set is_default = false, updated_at = now()
  where customer_id = v_customer_id
    and restaurant_id = p_restaurant_id
    and is_default = true;

  update public.customer_addresses
  set is_default = true, updated_at = now()
  where id = p_address_id
    and customer_id = v_customer_id
    and restaurant_id = p_restaurant_id;

  update public.customer_profiles
  set
    default_delivery_city = v_city,
    default_delivery_barangay = v_barangay,
    default_delivery_address = v_address,
    updated_at = now()
  where id = v_customer_id;

  return true;
end;
$$;

revoke all on function public.set_my_customer_address_default(uuid, uuid) from public;
grant execute on function public.set_my_customer_address_default(uuid, uuid) to authenticated;

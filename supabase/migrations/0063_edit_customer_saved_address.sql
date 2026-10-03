create or replace function public.update_my_customer_address(
  p_restaurant_id uuid,
  p_address_id uuid,
  p_label text,
  p_city text,
  p_barangay text,
  p_address text
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
    updated_at = now()
  where id = p_address_id
    and customer_id = v_customer_id
    and restaurant_id = p_restaurant_id;

  -- Keep checkout synchronized when the edited address is the default.
  update public.customer_profiles cp
  set
    default_delivery_city = ca.city,
    default_delivery_barangay = ca.barangay,
    default_delivery_address = ca.address,
    updated_at = now()
  from public.customer_addresses ca
  where cp.id = v_customer_id
    and ca.id = p_address_id
    and ca.is_default = true;

  return true;
end;
$$;

revoke all on function public.update_my_customer_address(uuid, uuid, text, text, text, text)
from public;

grant execute on function public.update_my_customer_address(uuid, uuid, text, text, text, text)
to authenticated;

-- Store one default delivery address per customer profile.
alter table public.customer_profiles
  add column if not exists default_delivery_city text,
  add column if not exists default_delivery_barangay text,
  add column if not exists default_delivery_address text;

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

  return query
  select
    cp.id,
    cp.name,
    cp.phone,
    cp.default_delivery_city,
    cp.default_delivery_barangay,
    cp.default_delivery_address
  from public.customer_profiles cp
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id = auth.uid()
  limit 1;
end;
$$;

revoke all on function public.get_my_customer_profile(uuid) from public;
grant execute on function public.get_my_customer_profile(uuid) to authenticated;

create or replace function public.save_my_default_delivery_address(
  p_restaurant_id uuid,
  p_city text,
  p_barangay text,
  p_address text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if length(trim(coalesce(p_city, ''))) = 0 then
    raise exception 'City is required';
  end if;

  if length(trim(coalesce(p_barangay, ''))) = 0 then
    raise exception 'Barangay is required';
  end if;

  if length(trim(coalesce(p_address, ''))) = 0 then
    raise exception 'Complete delivery address is required';
  end if;

  update public.customer_profiles
  set
    default_delivery_city = trim(p_city),
    default_delivery_barangay = trim(p_barangay),
    default_delivery_address = trim(p_address),
    updated_at = now()
  where restaurant_id = p_restaurant_id
    and auth_user_id = auth.uid();

  if not found then
    raise exception 'Customer profile not found';
  end if;
end;
$$;

revoke all on function public.save_my_default_delivery_address(uuid, text, text, text)
from public;

grant execute on function public.save_my_default_delivery_address(uuid, text, text, text)
to authenticated;

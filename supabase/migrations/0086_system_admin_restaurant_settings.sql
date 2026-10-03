-- 0086_system_admin_restaurant_settings.sql
--
-- System Admin controls for existing restaurant-level operational settings.
-- This does not create a second settings system.

create or replace function public.system_admin_get_restaurant_settings(
  p_restaurant_id uuid
)
returns table (
  shipping_fee numeric,
  cash_on_delivery_enabled boolean,
  automatic_rider_assignment_enabled boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.shipping_fee,
    r.cash_on_delivery_enabled,
    r.automatic_rider_assignment_enabled
  from public.restaurants r
  where r.id = p_restaurant_id
    and public.is_system_admin();
$$;

revoke all on function public.system_admin_get_restaurant_settings(uuid)
from public, anon;

grant execute on function public.system_admin_get_restaurant_settings(uuid)
to authenticated;


create or replace function public.system_admin_update_restaurant_settings(
  p_restaurant_id uuid,
  p_shipping_fee numeric,
  p_cash_on_delivery_enabled boolean,
  p_automatic_rider_assignment_enabled boolean
)
returns table (
  shipping_fee numeric,
  cash_on_delivery_enabled boolean,
  automatic_rider_assignment_enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception 'System Administrator access required.';
  end if;

  if p_shipping_fee is null or p_shipping_fee < 0 then
    raise exception 'Shipping fee must be zero or greater.';
  end if;

  if not exists (
    select 1
    from public.restaurants
    where id = p_restaurant_id
  ) then
    raise exception 'Restaurant not found.';
  end if;

  update public.restaurants
  set
    shipping_fee = round(p_shipping_fee, 2),
    cash_on_delivery_enabled = coalesce(p_cash_on_delivery_enabled, false),
    automatic_rider_assignment_enabled = coalesce(p_automatic_rider_assignment_enabled, false)
  where id = p_restaurant_id;

  return query
  select
    r.shipping_fee,
    r.cash_on_delivery_enabled,
    r.automatic_rider_assignment_enabled
  from public.restaurants r
  where r.id = p_restaurant_id;
end;
$$;

revoke all on function public.system_admin_update_restaurant_settings(uuid, numeric, boolean, boolean)
from public, anon;

grant execute on function public.system_admin_update_restaurant_settings(uuid, numeric, boolean, boolean)
to authenticated;

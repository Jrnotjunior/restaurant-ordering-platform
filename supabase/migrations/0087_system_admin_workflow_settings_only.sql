-- 0087_system_admin_workflow_settings_only.sql
--
-- System Admin controls only the workflow switches that are intentionally
-- locked in the Restaurant Owner Store Settings page.
-- Owner-managed settings such as logo, address, store status, VAT/receipt
-- settings, and operating hours remain owner-controlled.

drop function if exists public.system_admin_get_restaurant_settings(uuid);
drop function if exists public.system_admin_update_restaurant_settings(uuid, numeric, boolean, boolean);

create or replace function public.system_admin_get_restaurant_settings(
  p_restaurant_id uuid
)
returns table (
  cash_on_delivery_enabled boolean,
  automatic_rider_assignment_enabled boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
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
  p_cash_on_delivery_enabled boolean,
  p_automatic_rider_assignment_enabled boolean
)
returns table (
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

  if not exists (
    select 1
    from public.restaurants
    where id = p_restaurant_id
  ) then
    raise exception 'Restaurant not found.';
  end if;

  update public.restaurants
  set
    cash_on_delivery_enabled = coalesce(p_cash_on_delivery_enabled, false),
    automatic_rider_assignment_enabled = coalesce(p_automatic_rider_assignment_enabled, false)
  where id = p_restaurant_id;

  return query
  select
    r.cash_on_delivery_enabled,
    r.automatic_rider_assignment_enabled
  from public.restaurants r
  where r.id = p_restaurant_id;
end;
$$;

revoke all on function public.system_admin_update_restaurant_settings(uuid, boolean, boolean)
from public, anon;

grant execute on function public.system_admin_update_restaurant_settings(uuid, boolean, boolean)
to authenticated;

-- 0088_system_admin_tax_controls.sql
--
-- VAT/receipt tax configuration is a platform-controlled financial setting.
-- Restaurant owners may view it but cannot change it.

create or replace function public.system_admin_get_restaurant_settings(
  p_restaurant_id uuid
)
returns table (
  cash_on_delivery_enabled boolean,
  automatic_rider_assignment_enabled boolean,
  tax_vat_registered boolean,
  tax_prices_vat_inclusive boolean,
  tax_vat_rate numeric
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.cash_on_delivery_enabled,
    r.automatic_rider_assignment_enabled,
    r.tax_vat_registered,
    r.tax_prices_vat_inclusive,
    r.tax_vat_rate
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
  p_automatic_rider_assignment_enabled boolean,
  p_tax_vat_registered boolean,
  p_tax_prices_vat_inclusive boolean,
  p_tax_vat_rate numeric
)
returns table (
  cash_on_delivery_enabled boolean,
  automatic_rider_assignment_enabled boolean,
  tax_vat_registered boolean,
  tax_prices_vat_inclusive boolean,
  tax_vat_rate numeric
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
    select 1 from public.restaurants where id = p_restaurant_id
  ) then
    raise exception 'Restaurant not found.';
  end if;

  if p_tax_vat_rate is null or p_tax_vat_rate < 0 or p_tax_vat_rate > 100 then
    raise exception 'VAT rate must be between 0 and 100.';
  end if;

  update public.restaurants
  set
    cash_on_delivery_enabled = coalesce(p_cash_on_delivery_enabled, false),
    automatic_rider_assignment_enabled = coalesce(p_automatic_rider_assignment_enabled, false),
    tax_vat_registered = coalesce(p_tax_vat_registered, false),
    tax_prices_vat_inclusive = case
      when coalesce(p_tax_vat_registered, false)
        then coalesce(p_tax_prices_vat_inclusive, false)
      else false
    end,
    tax_vat_rate = case
      when coalesce(p_tax_vat_registered, false)
        then round(p_tax_vat_rate, 2)
      else 0
    end
  where id = p_restaurant_id;

  return query
  select
    r.cash_on_delivery_enabled,
    r.automatic_rider_assignment_enabled,
    r.tax_vat_registered,
    r.tax_prices_vat_inclusive,
    r.tax_vat_rate
  from public.restaurants r
  where r.id = p_restaurant_id;
end;
$$;

revoke all on function public.system_admin_update_restaurant_settings(
  uuid, boolean, boolean, boolean, boolean, numeric
)
from public, anon;

grant execute on function public.system_admin_update_restaurant_settings(
  uuid, boolean, boolean, boolean, boolean, numeric
)
to authenticated;


create or replace function public.protect_system_admin_restaurant_tax_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    if new.tax_vat_registered is distinct from old.tax_vat_registered
       or new.tax_prices_vat_inclusive is distinct from old.tax_prices_vat_inclusive
       or new.tax_vat_rate is distinct from old.tax_vat_rate
    then
      raise exception 'VAT and tax receipt settings are controlled by the System Administrator.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_system_admin_restaurant_tax_settings
on public.restaurants;

create trigger protect_system_admin_restaurant_tax_settings
before update on public.restaurants
for each row
execute function public.protect_system_admin_restaurant_tax_settings();

-- Separate cash payment availability for Pickup and Take-out orders.
alter table public.restaurants
  add column if not exists cash_on_take_out_enabled boolean not null default true;

-- Keep the legacy Pickup setting for regular Pickup orders only.
create or replace function public.enforce_cash_on_pickup_setting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash_enabled boolean;
begin
  if new.payment_method = 'cash' and new.order_type in ('pickup', 'take_out') then
    if new.order_type = 'pickup' then
      select r.cash_on_pickup_enabled into v_cash_enabled
      from public.restaurants r
      where r.id = new.restaurant_id and r.is_active = true;
    else
      select r.cash_on_take_out_enabled into v_cash_enabled
      from public.restaurants r
      where r.id = new.restaurant_id and r.is_active = true;
    end if;

    if not found then
      raise exception 'Restaurant is not available';
    end if;

    if not coalesce(v_cash_enabled, false) then
      if new.order_type = 'pickup' then
        raise exception 'Cash payment is disabled for Pickup. Please choose Online Payment.';
      else
        raise exception 'Cash payment is disabled for Take-out. Please choose Online Payment.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- System-admin settings RPCs expose and update both independent switches.
drop function if exists public.system_admin_get_restaurant_settings(uuid);
create function public.system_admin_get_restaurant_settings(p_restaurant_id uuid)
returns table (
  cash_on_delivery_enabled boolean,
  cash_on_pickup_enabled boolean,
  cash_on_take_out_enabled boolean,
  automatic_rider_assignment_enabled boolean,
  tax_vat_registered boolean,
  tax_prices_vat_inclusive boolean,
  tax_vat_rate numeric
)
language sql security definer stable set search_path = public
as $$
  select r.cash_on_delivery_enabled, r.cash_on_pickup_enabled, r.cash_on_take_out_enabled,
         r.automatic_rider_assignment_enabled, r.tax_vat_registered,
         r.tax_prices_vat_inclusive, r.tax_vat_rate
  from public.restaurants r
  where r.id = p_restaurant_id and public.is_system_admin();
$$;
revoke all on function public.system_admin_get_restaurant_settings(uuid) from public, anon;
grant execute on function public.system_admin_get_restaurant_settings(uuid) to authenticated;

drop function if exists public.system_admin_update_restaurant_settings(uuid, boolean, boolean, boolean, boolean, numeric);
create function public.system_admin_update_restaurant_settings(
  p_restaurant_id uuid,
  p_cash_on_delivery_enabled boolean,
  p_cash_on_pickup_enabled boolean,
  p_cash_on_take_out_enabled boolean,
  p_automatic_rider_assignment_enabled boolean,
  p_tax_vat_registered boolean,
  p_tax_prices_vat_inclusive boolean,
  p_tax_vat_rate numeric
)
returns table (
  cash_on_delivery_enabled boolean,
  cash_on_pickup_enabled boolean,
  cash_on_take_out_enabled boolean,
  automatic_rider_assignment_enabled boolean,
  tax_vat_registered boolean,
  tax_prices_vat_inclusive boolean,
  tax_vat_rate numeric
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_system_admin() then raise exception 'System Administrator access required.'; end if;
  if not exists(select 1 from public.restaurants where id = p_restaurant_id) then raise exception 'Restaurant not found.'; end if;
  if p_tax_vat_rate is null or p_tax_vat_rate < 0 or p_tax_vat_rate > 100 then raise exception 'VAT rate must be between 0 and 100.'; end if;

  update public.restaurants
  set cash_on_delivery_enabled = coalesce(p_cash_on_delivery_enabled, false),
      cash_on_pickup_enabled = coalesce(p_cash_on_pickup_enabled, false),
      cash_on_take_out_enabled = coalesce(p_cash_on_take_out_enabled, false),
      automatic_rider_assignment_enabled = coalesce(p_automatic_rider_assignment_enabled, false),
      tax_vat_registered = coalesce(p_tax_vat_registered, false),
      tax_prices_vat_inclusive = case when coalesce(p_tax_vat_registered, false) then coalesce(p_tax_prices_vat_inclusive, false) else false end,
      tax_vat_rate = case when coalesce(p_tax_vat_registered, false) then round(p_tax_vat_rate, 2) else 0 end
  where id = p_restaurant_id;

  return query select r.cash_on_delivery_enabled, r.cash_on_pickup_enabled, r.cash_on_take_out_enabled,
    r.automatic_rider_assignment_enabled, r.tax_vat_registered, r.tax_prices_vat_inclusive, r.tax_vat_rate
  from public.restaurants r where r.id = p_restaurant_id;
end;
$$;
revoke all on function public.system_admin_update_restaurant_settings(uuid, boolean, boolean, boolean, boolean, boolean, boolean, numeric) from public, anon;
grant execute on function public.system_admin_update_restaurant_settings(uuid, boolean, boolean, boolean, boolean, boolean, boolean, numeric) to authenticated;

create or replace function public.protect_system_admin_restaurant_tax_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_system_admin() and (
    new.tax_vat_registered is distinct from old.tax_vat_registered
    or new.tax_prices_vat_inclusive is distinct from old.tax_prices_vat_inclusive
    or new.tax_vat_rate is distinct from old.tax_vat_rate
    or new.cash_on_pickup_enabled is distinct from old.cash_on_pickup_enabled
    or new.cash_on_take_out_enabled is distinct from old.cash_on_take_out_enabled
  ) then
    raise exception 'VAT, tax receipt, and Pickup/Take-out cash settings are controlled by the System Administrator.';
  end if;
  return new;
end;
$$;

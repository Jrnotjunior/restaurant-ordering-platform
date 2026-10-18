-- Let each restaurant owner disable cash payment for collection orders.
alter table public.restaurants
  add column if not exists cash_on_pickup_enabled boolean not null default true;

create or replace function public.enforce_cash_on_pickup_setting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash_enabled boolean;
begin
  if new.payment_method = 'cash'
     and new.order_type in ('pickup', 'take_out') then
    select r.cash_on_pickup_enabled
      into v_cash_enabled
    from public.restaurants r
    where r.id = new.restaurant_id
      and r.is_active = true;

    if not found then
      raise exception 'Restaurant is not available';
    end if;

    if not coalesce(v_cash_enabled, false) then
      raise exception 'Cash payment is disabled for Pickup and Take-out. Please choose Online Payment.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_cash_on_pickup_setting on public.orders;
create trigger enforce_cash_on_pickup_setting
before insert or update of restaurant_id, order_type, payment_method
on public.orders
for each row
execute function public.enforce_cash_on_pickup_setting();

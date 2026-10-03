-- Manual store open/closed control for customer ordering.
-- When closed, the customer app is visually blocked and the database
-- also rejects new orders so the closed state cannot be bypassed.

alter table public.restaurants
  add column if not exists ordering_enabled boolean not null default true;

create or replace function public.prevent_orders_when_store_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ordering_enabled boolean;
begin
  select r.ordering_enabled
    into v_ordering_enabled
  from public.restaurants r
  where r.id = new.restaurant_id
    and r.is_active = true;

  if not found then
    raise exception 'Restaurant is not available';
  end if;

  if not coalesce(v_ordering_enabled, false) then
    raise exception 'The store is currently closed and is not accepting new orders.';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_orders_when_store_closed()
from public, anon, authenticated;

drop trigger if exists orders_block_when_store_closed
on public.orders;

create trigger orders_block_when_store_closed
before insert on public.orders
for each row
execute function public.prevent_orders_when_store_closed();

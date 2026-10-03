-- Manual store closure overrides the automatic operating-hours schedule.
-- ordering_enabled = true  -> follow operating hours normally.
-- ordering_enabled = false -> force the customer store closed until reopened.

create or replace function public.prevent_orders_when_store_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ordering_enabled boolean;
  v_operating_hours jsonb;
  v_day_key text;
  v_day jsonb;
  v_open text;
  v_close text;
  v_now_minutes integer;
  v_open_minutes integer;
  v_close_minutes integer;
  v_is_open boolean;
begin
  select r.ordering_enabled, r.operating_hours
    into v_ordering_enabled, v_operating_hours
  from public.restaurants r
  where r.id = new.restaurant_id
    and r.is_active = true;

  if not found then
    raise exception 'Restaurant is not available';
  end if;

  -- Manual closure always wins over the automatic schedule.
  if not coalesce(v_ordering_enabled, true) then
    raise exception 'The store is currently closed and is not accepting new orders.';
  end if;

  -- No configured schedule means normal ordering remains available.
  if v_operating_hours is null then
    return new;
  end if;

  v_day_key := lower(to_char(now() at time zone 'Asia/Manila', 'FMDay'));
  v_day := v_operating_hours -> v_day_key;

  if v_day is null or coalesce((v_day ->> 'isOpen')::boolean, true) = false then
    raise exception 'The store is currently closed and is not accepting new orders.';
  end if;

  v_open := v_day ->> 'open';
  v_close := v_day ->> 'close';

  if v_open is null or v_close is null then
    raise exception 'The store is currently closed and is not accepting new orders.';
  end if;

  v_now_minutes :=
    extract(hour from (now() at time zone 'Asia/Manila'))::integer * 60
    + extract(minute from (now() at time zone 'Asia/Manila'))::integer;

  v_open_minutes :=
    split_part(v_open, ':', 1)::integer * 60
    + split_part(v_open, ':', 2)::integer;

  v_close_minutes :=
    split_part(v_close, ':', 1)::integer * 60
    + split_part(v_close, ':', 2)::integer;

  v_is_open := case
    when v_open_minutes = v_close_minutes then true
    when v_close_minutes > v_open_minutes
      then v_now_minutes >= v_open_minutes and v_now_minutes < v_close_minutes
    else v_now_minutes >= v_open_minutes or v_now_minutes < v_close_minutes
  end;

  if not v_is_open then
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

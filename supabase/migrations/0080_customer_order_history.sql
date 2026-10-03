-- Customer order history
-- Authenticated customers can only see orders linked to their own customer profile.

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
  v_customer_id uuid;
begin
  select r.ordering_enabled, r.operating_hours
    into v_ordering_enabled, v_operating_hours
  from public.restaurants r
  where r.id = new.restaurant_id
    and r.is_active = true;

  if not found then
    raise exception 'Restaurant is not available';
  end if;

  -- Link authenticated customer orders to the signed-in customer profile.
  -- Guest orders remain unlinked.
  if auth.uid() is not null and new.customer_id is null then
    select cp.id
      into v_customer_id
    from public.customer_profiles cp
    where cp.restaurant_id = new.restaurant_id
      and cp.auth_user_id = auth.uid()
    limit 1;

    if v_customer_id is not null then
      new.customer_id := v_customer_id;
    end if;
  end if;

  -- Manual closure always overrides the operating hours.
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


create or replace function public.link_authenticated_customer_to_pending_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if auth.uid() is null or new.customer_id is not null then
    return new;
  end if;

  select cp.id
    into v_customer_id
  from public.customer_profiles cp
  where cp.restaurant_id = new.restaurant_id
    and cp.auth_user_id = auth.uid()
  limit 1;

  if v_customer_id is not null then
    new.customer_id := v_customer_id;
  end if;

  return new;
end;
$$;

revoke all on function public.link_authenticated_customer_to_pending_payment()
from public, anon, authenticated;

drop trigger if exists pending_online_payment_link_authenticated_customer
on public.pending_online_payments;

create trigger pending_online_payment_link_authenticated_customer
before insert on public.pending_online_payments
for each row
execute function public.link_authenticated_customer_to_pending_payment();


create or replace function public.get_my_order_history(
  p_restaurant_id uuid
)
returns table (
  order_id uuid,
  order_number text,
  order_type text,
  payment_method text,
  payment_status text,
  status text,
  delivery_status text,
  total numeric,
  created_at timestamptz,
  items jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.id,
    o.order_number,
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.status,
    o.delivery_status,
    o.total,
    o.created_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'productName', oi.product_name,
          'quantity', oi.quantity,
          'unitPrice', oi.unit_price,
          'lineTotal', oi.line_total
        )
        order by oi.created_at, oi.id
      ) filter (where oi.id is not null),
      '[]'::jsonb
    )
  from public.orders o
  left join public.order_items oi on oi.order_id = o.id
  where o.restaurant_id = p_restaurant_id
    and o.customer_id in (
      select cp.id
      from public.customer_profiles cp
      where cp.restaurant_id = p_restaurant_id
        and cp.auth_user_id = auth.uid()
    )
  group by
    o.id,
    o.order_number,
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.status,
    o.delivery_status,
    o.total,
    o.created_at
  order by o.created_at desc;
$$;

revoke all on function public.get_my_order_history(uuid)
from public, anon;

grant execute on function public.get_my_order_history(uuid)
to authenticated;

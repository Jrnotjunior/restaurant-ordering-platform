-- Keep the customer-facing restaurant address separate from the delivery map origin.
alter table public.restaurants
  add column if not exists restaurant_address text;

-- Customer tracking continues exposing the field as store_address for API compatibility,
-- but it now returns the owner-configured customer-facing address first.
create or replace function public.get_order_status(p_order_number text)
returns table (
  order_id uuid,
  order_number text,
  restaurant_id uuid,
  restaurant_name text,
  store_address text,
  operating_hours jsonb,
  order_type text,
  pickup_method text,
  payment_method text,
  status text,
  payment_status text,
  total numeric,
  delivery_status text,
  rider_name text,
  rider_phone text,
  delivery_failure_reason text
)
language sql
security definer
set search_path = public
as $$
  select
    o.id,
    o.order_number,
    o.restaurant_id,
    r.name,
    coalesce(nullif(trim(r.restaurant_address), ''), nullif(trim(r.store_address), ''), nullif(trim(r.location_text), '')),
    r.operating_hours,
    o.order_type,
    o.pickup_method,
    o.payment_method,
    o.status,
    o.payment_status,
    o.total,
    o.delivery_status,
    rr.name,
    rr.mobile_number,
    o.delivery_failure_reason
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.restaurant_riders rr on rr.id = o.rider_id
  where o.order_number = p_order_number
  limit 1;
$$;

revoke all on function public.get_order_status(text) from public;
grant execute on function public.get_order_status(text) to anon, authenticated;

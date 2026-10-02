-- Restaurant store details for reusable multi-restaurant pickup flows.
-- Store owners can configure the pickup address and weekly operating hours.
-- Customers can see the configured store address when a pickup order is completed.

alter table public.restaurants
  add column if not exists store_address text;

alter table public.restaurants
  add column if not exists operating_hours jsonb
  not null default '{
    "monday": {"isOpen": true, "open": "09:00", "close": "21:00"},
    "tuesday": {"isOpen": true, "open": "09:00", "close": "21:00"},
    "wednesday": {"isOpen": true, "open": "09:00", "close": "21:00"},
    "thursday": {"isOpen": true, "open": "09:00", "close": "21:00"},
    "friday": {"isOpen": true, "open": "09:00", "close": "21:00"},
    "saturday": {"isOpen": true, "open": "09:00", "close": "21:00"},
    "sunday": {"isOpen": true, "open": "09:00", "close": "21:00"}
  }'::jsonb;

-- Preserve any existing location_text value when the new explicit store address is empty.
update public.restaurants
set store_address = nullif(trim(location_text), '')
where store_address is null
  and nullif(trim(location_text), '') is not null;

drop policy if exists "Restaurant owners can update restaurant profile" on public.restaurants;

create policy "Restaurant owners can update restaurant profile"
on public.restaurants
for update
to authenticated
using (
  owner_id = auth.uid()
  and is_active = true
)
with check (
  owner_id = auth.uid()
  and is_active = true
);

-- Return the restaurant pickup details with customer order tracking.
drop function if exists public.get_order_status(text);

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
    coalesce(nullif(trim(r.store_address), ''), nullif(trim(r.location_text), '')),
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

-- Customer courier pickup support
-- Orders outside the restaurant's in-house delivery scope are stored as pickup
-- orders with pickup_method = third_party_courier.

alter table public.orders
  add column if not exists pickup_method text;

update public.orders
set pickup_method = 'customer'
where order_type = 'pickup'
  and pickup_method is null;

alter table public.orders
  drop constraint if exists orders_pickup_method_check;

alter table public.orders
  add constraint orders_pickup_method_check
  check (
    pickup_method is null
    or pickup_method in ('customer', 'third_party_courier')
  );

alter table public.pending_online_payments
  add column if not exists pickup_method text;

update public.pending_online_payments
set pickup_method = 'customer'
where order_type = 'pickup'
  and pickup_method is null;

alter table public.pending_online_payments
  drop constraint if exists pending_online_payments_pickup_method_check;

alter table public.pending_online_payments
  add constraint pending_online_payments_pickup_method_check
  check (
    pickup_method is null
    or pickup_method in ('customer', 'third_party_courier')
  );

-- Allow create_order to receive the fulfillment method.
drop function if exists public.create_order(uuid, text, text, text, text, text, text, text, text, jsonb);

create or replace function public.create_order(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_order_type text,
  p_table_number text,
  p_delivery_barangay text,
  p_delivery_address text,
  p_notes text,
  p_payment_method text,
  p_is_third_party_courier boolean,
  p_items jsonb
)
returns table (
  order_id uuid,
  order_number text,
  subtotal numeric,
  delivery_fee numeric,
  total numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(12,2) := 0;
  v_delivery_fee numeric(12,2) := 0;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_product_name text;
  v_unit_price numeric(12,2);
  v_line_total numeric(12,2);
  v_delivery_zone public.restaurant_delivery_zones%rowtype;
  v_pickup_method text;
begin
  if p_restaurant_id is null then raise exception 'Restaurant is required'; end if;
  if length(trim(coalesce(p_customer_name, ''))) = 0 then raise exception 'Customer name is required'; end if;
  if p_order_type not in ('delivery', 'pickup', 'dine_in') then raise exception 'Invalid order type'; end if;
  if p_payment_method not in ('cash', 'gcash') then raise exception 'Invalid payment method'; end if;

  v_pickup_method := case
    when p_order_type = 'pickup' and coalesce(p_is_third_party_courier, false) then 'third_party_courier'
    when p_order_type = 'pickup' then 'customer'
    else null
  end;

  if p_order_type = 'delivery' then
    if length(trim(coalesce(p_delivery_barangay, ''))) = 0 then raise exception 'Delivery barangay is required'; end if;
    if length(trim(coalesce(p_delivery_address, ''))) = 0 then raise exception 'Delivery address is required'; end if;

    select * into v_delivery_zone
    from public.restaurant_delivery_zones z
    where z.restaurant_id = p_restaurant_id
      and lower(trim(z.barangay)) = lower(trim(p_delivery_barangay));

    if not found then raise exception 'Please select a barangay within the restaurant''s delivery areas'; end if;
    if not v_delivery_zone.is_supported then
      raise exception '%', coalesce(nullif(trim(v_delivery_zone.out_of_scope_message), ''), 'This area is outside our delivery coverage.');
    end if;

    v_delivery_fee := round(v_delivery_zone.shipping_fee, 2);
  end if;

  if p_order_type = 'dine_in' and length(trim(coalesce(p_table_number, ''))) = 0 then
    raise exception 'Table number is required';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item is required';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then raise exception 'Invalid item quantity'; end if;

    select p.name, p.price into v_product_name, v_unit_price
    from public.products p
    where p.id = v_product_id and p.restaurant_id = p_restaurant_id and p.is_available = true;

    if not found then raise exception 'One or more selected products are no longer available'; end if;

    v_line_total := round(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders (
    restaurant_id, order_number, customer_name, mobile_number, order_type,
    table_number, delivery_address, notes, payment_method, payment_status,
    status, subtotal, delivery_fee, total, pickup_method
  )
  values (
    p_restaurant_id, v_order_number, trim(p_customer_name), trim(coalesce(p_mobile_number, '')),
    p_order_type, nullif(trim(coalesce(p_table_number, '')), ''),
    nullif(trim(coalesce(p_delivery_address, '')), ''), trim(coalesce(p_notes, '')),
    p_payment_method, 'pending', 'pending', v_subtotal, v_delivery_fee,
    v_subtotal + v_delivery_fee, v_pickup_method
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;

    select p.name, p.price into v_product_name, v_unit_price
    from public.products p
    where p.id = v_product_id and p.restaurant_id = p_restaurant_id and p.is_available = true;

    v_line_total := round(v_unit_price * v_quantity, 2);

    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
    values (v_order_id, v_product_id, v_product_name, v_unit_price, v_quantity, v_line_total);
  end loop;

  return query select v_order_id, v_order_number, v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee;
end;
$$;

grant execute on function public.create_order(uuid, text, text, text, text, text, text, text, boolean, jsonb)
to anon, authenticated;

-- Update the pending-online-payment function so customer courier orders
-- are staged as pickup orders and preserve the courier fulfillment method.
drop function if exists public.create_pending_online_payment(uuid, text, text, text, text, text, text, text, boolean, jsonb);

create or replace function public.create_pending_online_payment(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_order_type text,
  p_delivery_barangay text,
  p_delivery_address text,
  p_notes text,
  p_is_third_party_courier boolean,
  p_items jsonb
)
returns table (
  payment_id uuid,
  reference_number text,
  subtotal numeric,
  delivery_fee numeric,
  total numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_reference_number text;
  v_subtotal numeric(12,2) := 0;
  v_delivery_fee numeric(12,2) := 0;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_product_name text;
  v_unit_price numeric(12,2);
  v_line_total numeric(12,2);
  v_delivery_zone public.restaurant_delivery_zones%rowtype;
  v_pickup_point text;
  v_items jsonb := '[]'::jsonb;
  v_pickup_method text;
begin
  if p_restaurant_id is null then raise exception 'Restaurant is required'; end if;
  if length(trim(coalesce(p_customer_name, ''))) = 0 then raise exception 'Customer name is required'; end if;
  if p_order_type not in ('delivery', 'pickup', 'dine_in') then raise exception 'Invalid order type'; end if;
  if p_order_type <> 'dine_in' and length(trim(coalesce(p_mobile_number, ''))) = 0 then raise exception 'Mobile number is required'; end if;

  if p_is_third_party_courier and p_order_type <> 'pickup' then
    raise exception 'Third-party courier orders must use pickup fulfillment';
  end if;

  v_pickup_method := case
    when p_order_type = 'pickup' and coalesce(p_is_third_party_courier, false) then 'third_party_courier'
    when p_order_type = 'pickup' then 'customer'
    else null
  end;

  if p_order_type = 'delivery' then
    if length(trim(coalesce(p_delivery_barangay, ''))) = 0 then raise exception 'Delivery barangay is required'; end if;
    if length(trim(coalesce(p_delivery_address, ''))) = 0 then raise exception 'Delivery address is required'; end if;

    select * into v_delivery_zone
    from public.restaurant_delivery_zones z
    where z.restaurant_id = p_restaurant_id
      and lower(trim(z.barangay)) = lower(trim(p_delivery_barangay));

    if not found then raise exception 'Please select a barangay within the restaurant''s delivery areas'; end if;
    if not v_delivery_zone.is_supported then
      raise exception '%', coalesce(nullif(trim(v_delivery_zone.out_of_scope_message), ''), 'This area is outside our delivery coverage.');
    end if;

    v_delivery_fee := round(v_delivery_zone.shipping_fee, 2);
  elsif p_order_type = 'pickup' and p_is_third_party_courier then
    select trim(coalesce(r.location_text, '')) into v_pickup_point
    from public.restaurants r
    where r.id = p_restaurant_id and r.is_active = true;

    if length(coalesce(v_pickup_point, '')) = 0 then raise exception 'The restaurant pickup address is not configured yet'; end if;
    p_delivery_address := v_pickup_point;
    p_delivery_barangay := null;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one item is required'; end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then raise exception 'Invalid item quantity'; end if;

    select p.name, p.price into v_product_name, v_unit_price
    from public.products p
    where p.id = v_product_id and p.restaurant_id = p_restaurant_id and p.is_available = true;

    if not found then raise exception 'One or more selected products are no longer available'; end if;

    v_line_total := round(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id, 'product_name', v_product_name,
      'unit_price', v_unit_price, 'quantity', v_quantity, 'line_total', v_line_total
    ));
  end loop;

  v_reference_number := 'PAY-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.pending_online_payments (
    restaurant_id, reference_number, customer_name, mobile_number, order_type,
    delivery_barangay, delivery_address, notes, is_third_party_courier,
    pickup_method, items, subtotal, delivery_fee, total
  )
  values (
    p_restaurant_id, v_reference_number, trim(p_customer_name), trim(coalesce(p_mobile_number, '')),
    p_order_type, nullif(trim(coalesce(p_delivery_barangay, '')), ''),
    nullif(trim(coalesce(p_delivery_address, '')), ''), trim(coalesce(p_notes, '')),
    coalesce(p_is_third_party_courier, false), v_pickup_method, v_items,
    v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee
  )
  returning id into v_payment_id;

  return query select v_payment_id, v_reference_number, v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee;
end;
$$;

grant execute on function public.create_pending_online_payment(uuid, text, text, text, text, text, text, boolean, jsonb)
to anon, authenticated;

-- Finalize online payment into the same fulfillment model.
drop function if exists public.finalize_online_payment(text);

create or replace function public.finalize_online_payment(p_reference_number text)
returns table (order_id uuid, order_number text, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.pending_online_payments%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
begin
  select * into v_payment
  from public.pending_online_payments
  where reference_number = trim(p_reference_number)
  for update;

  if not found then raise exception 'Pending online payment not found'; end if;

  if v_payment.status = 'paid' and v_payment.order_id is not null then
    select o.id, o.order_number, o.total into v_order_id, v_order_number, total
    from public.orders o where o.id = v_payment.order_id;
    return query select v_order_id, v_order_number, total;
    return;
  end if;

  if v_payment.status <> 'pending' then raise exception 'Online payment is not pending'; end if;

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders (
    restaurant_id, order_number, customer_name, mobile_number, order_type,
    table_number, delivery_address, notes, payment_method, payment_status,
    status, subtotal, delivery_fee, total, pickup_method
  )
  values (
    v_payment.restaurant_id, v_order_number, v_payment.customer_name, v_payment.mobile_number,
    v_payment.order_type, null, v_payment.delivery_address, v_payment.notes,
    'gcash', 'paid', 'pending', v_payment.subtotal, v_payment.delivery_fee,
    v_payment.total, v_payment.pickup_method
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_payment.items)
  loop
    insert into public.order_items (
      order_id, product_id, product_name, unit_price, quantity, line_total
    )
    values (
      v_order_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      (v_item->>'unit_price')::numeric,
      (v_item->>'quantity')::integer,
      (v_item->>'line_total')::numeric
    );
  end loop;

  update public.pending_online_payments
  set status = 'paid', order_id = v_order_id, updated_at = now()
  where id = v_payment.id;

  return query select v_order_id, v_order_number, v_payment.total;
end;
$$;

revoke execute on function public.finalize_online_payment(text) from public, anon, authenticated;
grant execute on function public.finalize_online_payment(text) to service_role;

-- Include pickup method in restaurant order retrieval.
drop function if exists public.get_restaurant_orders(uuid);

create or replace function public.get_restaurant_orders(p_restaurant_id uuid)
returns table (
  order_id uuid,
  order_number text,
  order_type text,
  pickup_method text,
  payment_method text,
  payment_status text,
  status text,
  total numeric,
  shipping_fee numeric,
  created_at timestamptz,
  items jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    o.id, o.order_number, o.order_type, o.pickup_method,
    o.payment_method, o.payment_status, o.status, o.total,
    o.delivery_fee,
    o.created_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
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
    and exists (
      select 1 from public.restaurants r
      where r.id = o.restaurant_id
        and r.owner_id = auth.uid()
        and r.is_active = true
    )
  group by o.id
  order by o.created_at desc;
$$;

revoke all on function public.get_restaurant_orders(uuid) from public;
grant execute on function public.get_restaurant_orders(uuid) to authenticated;

-- Add pickup method to customer tracking.
drop function if exists public.get_order_status(text);

create or replace function public.get_order_status(p_order_number text)
returns table (
  order_id uuid,
  order_number text,
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
    o.id, o.order_number, o.order_type, o.pickup_method,
    o.payment_method, o.status, o.payment_status, o.total,
    o.delivery_status, rr.name, rr.mobile_number, o.delivery_failure_reason
  from public.orders o
  left join public.restaurant_riders rr on rr.id = o.rider_id
  where o.order_number = p_order_number
  limit 1;
$$;

revoke all on function public.get_order_status(text) from public;
grant execute on function public.get_order_status(text) to anon, authenticated;

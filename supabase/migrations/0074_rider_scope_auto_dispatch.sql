-- Store the normalized delivery barangay on each order so rider
-- delivery scopes can be enforced by automatic dispatch.

alter table public.orders
  add column if not exists delivery_barangay text;

create or replace function public.create_order(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_order_type text,
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
  v_cash_on_delivery_enabled boolean;
begin
  if p_restaurant_id is null then
    raise exception 'Restaurant is required';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'Customer name is required';
  end if;

  if p_order_type not in ('delivery', 'pickup', 'dine_in') then
    raise exception 'Invalid order type';
  end if;

  if p_order_type <> 'dine_in'
    and length(trim(coalesce(p_mobile_number, ''))) = 0 then
    raise exception 'Mobile number is required';
  end if;

  if p_payment_method not in ('cash', 'gcash') then
    raise exception 'Invalid payment method';
  end if;

  select r.cash_on_delivery_enabled
    into v_cash_on_delivery_enabled
  from public.restaurants r
  where r.id = p_restaurant_id
    and r.is_active = true;

  if not found then
    raise exception 'Restaurant is not available';
  end if;

  if p_order_type = 'delivery'
     and p_payment_method = 'cash'
     and not coalesce(v_cash_on_delivery_enabled, false) then
    raise exception 'Cash on Delivery is currently unavailable. Please choose Online Payment.';
  end if;

  if coalesce(p_is_third_party_courier, false) and p_order_type <> 'pickup' then
    raise exception 'Third-party courier orders must use pickup order type';
  end if;

  v_pickup_method := case
    when p_order_type = 'pickup' and coalesce(p_is_third_party_courier, false)
      then 'third_party_courier'
    when p_order_type = 'pickup'
      then 'customer'
    else null
  end;

  if p_order_type = 'delivery' then
    if length(trim(coalesce(p_delivery_barangay, ''))) = 0 then
      raise exception 'Delivery barangay is required';
    end if;

    if length(trim(coalesce(p_delivery_address, ''))) = 0 then
      raise exception 'Delivery address is required';
    end if;

    select *
      into v_delivery_zone
    from public.restaurant_delivery_zones z
    where z.restaurant_id = p_restaurant_id
      and lower(trim(z.barangay)) = lower(trim(p_delivery_barangay));

    if not found then
      raise exception 'Please select a barangay within the restaurant''s delivery areas';
    end if;

    if not v_delivery_zone.is_supported then
      raise exception '%',
        coalesce(
          nullif(trim(v_delivery_zone.out_of_scope_message), ''),
          'This area is outside our delivery coverage.'
        );
    end if;

    v_delivery_fee := round(v_delivery_zone.shipping_fee, 2);
  end if;

  if jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item is required';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;

    if v_quantity is null or v_quantity < 1 or v_quantity > 99 then
      raise exception 'Invalid item quantity';
    end if;

    select p.name, p.price
      into v_product_name, v_unit_price
    from public.products p
    where p.id = v_product_id
      and p.restaurant_id = p_restaurant_id
      and p.is_available = true;

    if not found then
      raise exception 'One or more selected products are no longer available';
    end if;

    v_line_total := round(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_order_number :=
    'ORD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders (
    restaurant_id, order_number, customer_name, mobile_number, order_type,
    delivery_barangay, delivery_address, notes, payment_method, payment_status, status,
    subtotal, delivery_fee, total, pickup_method
  )
  values (
    p_restaurant_id, v_order_number, trim(p_customer_name),
    trim(coalesce(p_mobile_number, '')), p_order_type,
    nullif(trim(coalesce(p_delivery_barangay, '')), ''),
    nullif(trim(coalesce(p_delivery_address, '')), ''),
    trim(coalesce(p_notes, '')), p_payment_method, 'pending', 'pending',
    v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee, v_pickup_method
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;

    select p.name, p.price
      into v_product_name, v_unit_price
    from public.products p
    where p.id = v_product_id
      and p.restaurant_id = p_restaurant_id
      and p.is_available = true;

    v_line_total := round(v_unit_price * v_quantity, 2);

    insert into public.order_items (
      order_id, product_id, product_name, unit_price, quantity, line_total
    )
    values (
      v_order_id, v_product_id, v_product_name, v_unit_price, v_quantity, v_line_total
    );
  end loop;

  return query
  select v_order_id, v_order_number, v_subtotal,
         v_delivery_fee, v_subtotal + v_delivery_fee;
end;
$$;

revoke all on function public.create_order(
  uuid, text, text, text, text, text, text, text, boolean, jsonb
) from public;

grant execute on function public.create_order(
  uuid, text, text, text, text, text, text, text, boolean, jsonb
) to anon, authenticated;

-- Automatic assignment may only select a rider whose configured delivery
-- scope contains the order's delivery barangay.
create or replace function public.auto_assign_ready_delivery_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_rider_id uuid;
  v_order_id uuid;
  v_today_start timestamptz;
begin
  if new.order_type <> 'delivery'
     or new.status <> 'ready'
     or coalesce(new.delivery_status, 'unassigned') <> 'unassigned'
     or new.rider_id is not null
     or nullif(trim(coalesce(new.delivery_barangay, '')), '') is null then
    return new;
  end if;

  select r.id
    into v_restaurant_id
  from public.restaurants r
  where r.id = new.restaurant_id
    and r.is_active = true
    and r.automatic_rider_assignment_enabled = true
  for update;

  if v_restaurant_id is null then
    return new;
  end if;

  v_today_start := date_trunc('day', now());

  select s.id
    into v_rider_id
  from public.restaurant_staff s
  where s.restaurant_id = new.restaurant_id
    and s.role = 'rider'
    and s.is_active = true
    and exists (
      select 1
      from public.rider_delivery_zones rdz
      join public.restaurant_delivery_zones z
        on z.id = rdz.delivery_zone_id
      where rdz.restaurant_id = new.restaurant_id
        and rdz.rider_id = s.id
        and z.restaurant_id = new.restaurant_id
        and z.is_supported = true
        and lower(trim(z.barangay)) = lower(trim(new.delivery_barangay))
    )
    and not exists (
      select 1
      from public.delivery_assignments active_da
      where active_da.restaurant_id = new.restaurant_id
        and active_da.rider_id = s.id
        and active_da.status in ('assigned', 'delivering')
    )
  order by
    (
      select count(*)
      from public.delivery_assignments da
      where da.restaurant_id = new.restaurant_id
        and da.rider_id = s.id
        and da.status in ('assigned', 'delivering')
    ) asc,
    (
      select count(*)
      from public.delivery_assignments da
      where da.restaurant_id = new.restaurant_id
        and da.rider_id = s.id
        and da.status = 'delivered'
        and da.delivered_at >= v_today_start
    ) asc,
    s.created_at asc,
    s.id asc
  limit 1;

  if v_rider_id is null then
    return new;
  end if;

  insert into public.delivery_assignments (
    order_id,
    rider_id,
    restaurant_id,
    status
  )
  values (
    new.id,
    v_rider_id,
    new.restaurant_id,
    'assigned'
  )
  on conflict (order_id) where status in ('assigned', 'delivering')
  do nothing
  returning order_id into v_order_id;

  if v_order_id is not null then
    update public.orders
    set rider_id = v_rider_id,
        delivery_status = 'assigned',
        rider_assigned_at = now()
    where id = new.id
      and rider_id is null
      and coalesce(delivery_status, 'unassigned') = 'unassigned';
  end if;

  return new;
end;
$$;

revoke all on function public.auto_assign_ready_delivery_order() from public, anon, authenticated;

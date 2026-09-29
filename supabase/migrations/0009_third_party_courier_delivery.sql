-- Third-party courier delivery for customers outside Valenzuela.
-- The customer does not provide a destination address to the restaurant platform.
-- The server stores the restaurant pickup point in orders.delivery_address and
-- records the courier responsibility in orders.notes.

alter table public.orders
  add column if not exists third_party_courier boolean not null default false;

-- Replace the delivery-fee RPC with a version that supports third-party courier
-- delivery while keeping normal Valenzuela delivery validation unchanged.
drop function if exists public.create_order(uuid, text, text, text, text, text, text, text, text, jsonb);

drop function if exists public.create_order(uuid, text, text, text, text, text, text, text, text, boolean, jsonb);

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
  v_restaurant_pickup_point text;
  v_final_notes text;
begin
  if p_restaurant_id is null then
    raise exception 'Restaurant is required';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'Customer name is required';
  end if;

  if length(trim(coalesce(p_mobile_number, ''))) = 0 then
    raise exception 'Mobile number is required';
  end if;

  if p_order_type not in ('delivery', 'pickup', 'dine_in') then
    raise exception 'Invalid order type';
  end if;

  if p_payment_method not in ('cash', 'gcash') then
    raise exception 'Invalid payment method';
  end if;

  if coalesce(p_is_third_party_courier, false) and p_order_type <> 'delivery' then
    raise exception 'Third-party courier delivery is only available for delivery orders';
  end if;

  if p_order_type = 'delivery' then
    if coalesce(p_is_third_party_courier, false) then
      select nullif(trim(r.location_text), '')
        into v_restaurant_pickup_point
      from public.restaurants r
      where r.id = p_restaurant_id
        and r.is_active = true;

      if v_restaurant_pickup_point is null then
        raise exception 'The restaurant pickup address is not configured yet';
      end if;

      -- The restaurant pickup point is the only address stored for an
      -- external-courier order. The customer destination is handled by the
      -- courier app and is intentionally not collected here.
      v_delivery_fee := 0;
    else
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
        raise exception '%', coalesce(
          nullif(trim(v_delivery_zone.out_of_scope_message), ''),
          'This area is outside our delivery coverage.'
        );
      end if;

      v_delivery_fee := round(v_delivery_zone.shipping_fee, 2);
    end if;
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

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  v_final_notes := trim(coalesce(p_notes, ''));

  if coalesce(p_is_third_party_courier, false) then
    v_final_notes := concat_ws(
      E'\n\n',
      nullif(v_final_notes, ''),
      'THIRD-PARTY COURIER: Customer is responsible for booking and paying the delivery courier (such as Lalamove or Grab Express). The restaurant will prepare the food for courier pickup at the restaurant pickup point. The customer destination address is not collected by the restaurant platform.'
    );
  end if;

  insert into public.orders (
    restaurant_id,
    order_number,
    customer_name,
    mobile_number,
    order_type,
    table_number,
    delivery_address,
    notes,
    payment_method,
    payment_status,
    status,
    subtotal,
    delivery_fee,
    total,
    third_party_courier
  ) values (
    p_restaurant_id,
    v_order_number,
    trim(p_customer_name),
    trim(p_mobile_number),
    p_order_type,
    nullif(trim(coalesce(p_table_number, '')), ''),
    case
      when coalesce(p_is_third_party_courier, false) then v_restaurant_pickup_point
      else nullif(trim(coalesce(p_delivery_address, '')), '')
    end,
    v_final_notes,
    p_payment_method,
    'pending',
    'pending',
    v_subtotal,
    v_delivery_fee,
    v_subtotal + v_delivery_fee,
    coalesce(p_is_third_party_courier, false)
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
      order_id,
      product_id,
      product_name,
      unit_price,
      quantity,
      line_total
    ) values (
      v_order_id,
      v_product_id,
      v_product_name,
      v_unit_price,
      v_quantity,
      v_line_total
    );
  end loop;

  return query
  select v_order_id, v_order_number, v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee;
end;
$$;

grant execute on function public.create_order(uuid, text, text, text, text, text, text, text, text, boolean, jsonb) to anon, authenticated;

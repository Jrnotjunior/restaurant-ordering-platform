-- Remove the legacy table-number field and all application-level dependencies.
-- Dine-in orders use the customer name only; no table number is collected or stored.

-- Recreate create_order without the legacy p_table_number argument.
drop function if exists public.create_order(uuid, text, text, text, text, text, text, text, text, jsonb);

create or replace function public.create_order(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_order_type text,
  p_delivery_barangay text,
  p_delivery_address text,
  p_notes text,
  p_payment_method text,
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
      raise exception '%', coalesce(
        nullif(trim(v_delivery_zone.out_of_scope_message), ''),
        'This area is outside our delivery coverage.'
      );
    end if;

    v_delivery_fee := round(v_delivery_zone.shipping_fee, 2);
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

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders (
    restaurant_id,
    order_number,
    customer_name,
    mobile_number,
    order_type,
    delivery_address,
    notes,
    payment_method,
    payment_status,
    status,
    subtotal,
    delivery_fee,
    total
  ) values (
    p_restaurant_id,
    v_order_number,
    trim(p_customer_name),
    trim(p_mobile_number),
    p_order_type,
    nullif(trim(coalesce(p_delivery_address, '')), ''),
    trim(coalesce(p_notes, '')),
    p_payment_method,
    'pending',
    'pending',
    v_subtotal,
    v_delivery_fee,
    v_subtotal + v_delivery_fee
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

revoke all on function public.create_order(uuid, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.create_order(uuid, text, text, text, text, text, text, text, jsonb) to anon, authenticated;

-- Recreate finalize_online_payment without inserting the removed table_number column.
create or replace function public.finalize_online_payment(
  p_reference_number text
)
returns table (
  order_id uuid,
  order_number text,
  total numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.pending_online_payments%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_account public.customer_loyalty_accounts%rowtype;
begin
  select *
    into v_payment
  from public.pending_online_payments
  where reference_number = trim(p_reference_number)
  for update;

  if not found then
    raise exception 'Pending online payment not found';
  end if;

  if v_payment.status = 'paid' and v_payment.order_id is not null then
    select o.id, o.order_number, o.total
      into v_order_id, v_order_number, total
    from public.orders o
    where o.id = v_payment.order_id;

    return query select v_order_id, v_order_number, total;
    return;
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'Online payment is not pending';
  end if;

  if v_payment.loyalty_points_redeemed > 0 then
    select *
      into v_account
    from public.customer_loyalty_accounts
    where customer_id = v_payment.customer_id
    for update;

    if not found or v_account.points_balance < v_payment.loyalty_points_redeemed then
      raise exception 'Customer does not have enough loyalty points';
    end if;
  end if;

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders (
    restaurant_id,
    order_number,
    customer_name,
    mobile_number,
    order_type,
    delivery_address,
    notes,
    payment_method,
    payment_status,
    status,
    subtotal,
    delivery_fee,
    discount_amount,
    total,
    customer_id
  ) values (
    v_payment.restaurant_id,
    v_order_number,
    v_payment.customer_name,
    v_payment.mobile_number,
    v_payment.order_type,
    v_payment.delivery_address,
    v_payment.notes,
    'gcash',
    'paid',
    'pending',
    v_payment.subtotal,
    v_payment.delivery_fee,
    v_payment.loyalty_discount_amount,
    v_payment.total,
    v_payment.customer_id
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_payment.items)
  loop
    insert into public.order_items (
      order_id,
      product_id,
      product_name,
      unit_price,
      quantity,
      line_total
    ) values (
      v_order_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      (v_item->>'unit_price')::numeric,
      (v_item->>'quantity')::integer,
      (v_item->>'line_total')::numeric
    );
  end loop;

  if v_payment.loyalty_points_redeemed > 0 then
    update public.customer_loyalty_accounts
    set points_balance = points_balance - v_payment.loyalty_points_redeemed,
        updated_at = now()
    where customer_id = v_payment.customer_id;

    insert into public.loyalty_transactions (
      restaurant_id,
      customer_id,
      order_id,
      transaction_type,
      points,
      eligible_amount,
      rule_amount_threshold,
      rule_points_awarded,
      description
    ) values (
      v_payment.restaurant_id,
      v_payment.customer_id,
      v_order_id,
      'redeem',
      -v_payment.loyalty_points_redeemed,
      v_payment.loyalty_discount_amount,
      v_payment.loyalty_points_redeemed,
      v_payment.loyalty_discount_amount::integer,
      'Redeemed loyalty reward on order ' || v_order_number
    );
  end if;

  update public.pending_online_payments
  set status = 'paid',
      order_id = v_order_id,
      updated_at = now()
  where id = v_payment.id;

  return query
  select v_order_id, v_order_number, v_payment.total;
end;
$$;

revoke execute on function public.finalize_online_payment(text) from public, anon, authenticated;
grant execute on function public.finalize_online_payment(text) to service_role;

-- The physical column is removed only after all dependent application RPCs
-- have been recreated without it.
alter table public.orders
  drop column if exists table_number;

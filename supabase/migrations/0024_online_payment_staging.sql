-- Online payment staging
-- Do not create a restaurant order until PayMongo confirms payment.

alter table public.orders
  alter column mobile_number drop not null;

alter table public.orders
  drop constraint if exists orders_table_number_check;

create table if not exists public.pending_online_payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  reference_number text not null unique,
  customer_name text not null,
  mobile_number text not null default '',
  order_type text not null,
  delivery_barangay text,
  delivery_address text,
  notes text not null default '',
  is_third_party_courier boolean not null default false,
  items jsonb not null,
  subtotal numeric(12,2) not null,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  status text not null default 'pending',
  checkout_session_id text,
  checkout_url text,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pending_online_payments_order_type_check
    check (order_type in ('delivery', 'pickup', 'dine_in')),
  constraint pending_online_payments_status_check
    check (status in ('pending', 'paid', 'failed', 'expired', 'cancelled')),
  constraint pending_online_payments_amounts_check
    check (subtotal >= 0 and delivery_fee >= 0 and total >= 0),
  constraint pending_online_payments_items_check
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0)
);

create index if not exists pending_online_payments_status_idx
  on public.pending_online_payments(status, created_at desc);

create index if not exists pending_online_payments_reference_idx
  on public.pending_online_payments(reference_number);

alter table public.pending_online_payments enable row level security;

drop trigger if exists pending_online_payments_set_updated_at on public.pending_online_payments;
create trigger pending_online_payments_set_updated_at
before update on public.pending_online_payments
for each row
execute function public.set_updated_at();

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

  if p_order_type <> 'dine_in' and length(trim(coalesce(p_mobile_number, ''))) = 0 then
    raise exception 'Mobile number is required';
  end if;

  if p_is_third_party_courier and p_order_type <> 'delivery' then
    raise exception 'Third-party courier delivery requires delivery order type';
  end if;

  if p_order_type = 'delivery' then
    if p_is_third_party_courier then
      select trim(coalesce(r.location_text, ''))
        into v_pickup_point
      from public.restaurants r
      where r.id = p_restaurant_id
        and r.is_active = true;

      if length(coalesce(v_pickup_point, '')) = 0 then
        raise exception 'The restaurant pickup address is not configured yet';
      end if;

      p_delivery_address := v_pickup_point;
      p_delivery_barangay := null;
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

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'product_name', v_product_name,
      'unit_price', v_unit_price,
      'quantity', v_quantity,
      'line_total', v_line_total
    ));
  end loop;

  v_reference_number := 'PAY-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.pending_online_payments (
    restaurant_id,
    reference_number,
    customer_name,
    mobile_number,
    order_type,
    delivery_barangay,
    delivery_address,
    notes,
    is_third_party_courier,
    items,
    subtotal,
    delivery_fee,
    total
  ) values (
    p_restaurant_id,
    v_reference_number,
    trim(p_customer_name),
    trim(coalesce(p_mobile_number, '')),
    p_order_type,
    nullif(trim(coalesce(p_delivery_barangay, '')), ''),
    nullif(trim(coalesce(p_delivery_address, '')), ''),
    trim(coalesce(p_notes, '')),
    coalesce(p_is_third_party_courier, false),
    v_items,
    v_subtotal,
    v_delivery_fee,
    v_subtotal + v_delivery_fee
  )
  returning id into v_payment_id;

  return query
  select v_payment_id, v_reference_number, v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee;
end;
$$;

grant execute on function public.create_pending_online_payment(uuid, text, text, text, text, text, text, boolean, jsonb)
  to anon, authenticated;

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

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

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
    total
  ) values (
    v_payment.restaurant_id,
    v_order_number,
    v_payment.customer_name,
    v_payment.mobile_number,
    v_payment.order_type,
    null,
    v_payment.delivery_address,
    v_payment.notes,
    'gcash',
    'paid',
    'confirmed',
    v_payment.subtotal,
    v_payment.delivery_fee,
    v_payment.total
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

  update public.pending_online_payments
  set status = 'paid',
      order_id = v_order_id,
      updated_at = now()
  where id = v_payment.id;

  return query select v_order_id, v_order_number, v_payment.total;
end;
$$;

revoke execute on function public.finalize_online_payment(text) from public, anon, authenticated;
grant execute on function public.finalize_online_payment(text) to service_role;

create or replace function public.get_online_payment_status(
  p_reference_number text
)
returns table (
  status text,
  order_number text,
  total numeric
)
language sql
security definer
set search_path = public
as $$
  select p.status, o.order_number, p.total
  from public.pending_online_payments p
  left join public.orders o on o.id = p.order_id
  where p.reference_number = trim(p_reference_number);
$$;

grant execute on function public.get_online_payment_status(text) to anon, authenticated;

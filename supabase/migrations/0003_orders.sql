-- Order creation foundation
-- Creates a safe public checkout entry point without trusting client-side prices.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  order_number text not null unique,
  customer_name text not null,
  mobile_number text not null,
  order_type text not null,
  table_number text,
  delivery_address text,
  notes text not null default '',
  payment_method text not null,
  payment_status text not null default 'pending',
  status text not null default 'pending',
  subtotal numeric(12,2) not null,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_order_type_check
    check (order_type in ('delivery', 'pickup', 'dine_in')),
  constraint orders_payment_method_check
    check (payment_method in ('cash', 'gcash')),
  constraint orders_payment_status_check
    check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  constraint orders_status_check
    check (status in ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled')),
  constraint orders_amounts_non_negative
    check (subtotal >= 0 and delivery_fee >= 0 and total >= 0),
  constraint orders_delivery_address_check
    check (order_type <> 'delivery' or length(trim(coalesce(delivery_address, ''))) > 0),
  constraint orders_table_number_check
    check (order_type <> 'dine_in' or length(trim(coalesce(table_number, ''))) > 0)
);

create index if not exists orders_restaurant_created_idx
  on public.orders (restaurant_id, created_at desc);

create index if not exists orders_status_idx
  on public.orders (restaurant_id, status, created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price numeric(12,2) not null,
  quantity integer not null,
  line_total numeric(12,2) not null,
  created_at timestamptz not null default now(),

  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_prices_non_negative check (unit_price >= 0 and line_total >= 0)
);

create index if not exists order_items_order_idx
  on public.order_items (order_id);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Customers do not receive direct table insert/update access.
-- Checkout uses the controlled create_order RPC below.

create or replace function public.create_order(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_order_type text,
  p_table_number text,
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

  if p_order_type = 'delivery' and length(trim(coalesce(p_delivery_address, ''))) = 0 then
    raise exception 'Delivery address is required';
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
    p_restaurant_id,
    v_order_number,
    trim(p_customer_name),
    trim(p_mobile_number),
    p_order_type,
    nullif(trim(coalesce(p_table_number, '')), ''),
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

grant execute on function public.create_order(uuid, text, text, text, text, text, text, text, jsonb) to anon, authenticated;

create trigger orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

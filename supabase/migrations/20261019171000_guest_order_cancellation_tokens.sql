-- Guest orders receive a separately generated cancellation capability.
-- Store only its SHA-256 hash, never the raw token.
alter table public.orders
  add column if not exists guest_cancel_token_hash text;

alter table public.orders
  drop constraint if exists orders_guest_cancel_token_hash_format_check;
alter table public.orders
  add constraint orders_guest_cancel_token_hash_format_check
  check (guest_cancel_token_hash is null or guest_cancel_token_hash ~ '^[0-9a-f]{64}$');

create or replace function public.create_order_with_guest_cancel_token(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_order_type text,
  p_delivery_city text,
  p_delivery_barangay text,
  p_delivery_address text,
  p_notes text,
  p_payment_method text,
  p_is_third_party_courier boolean,
  p_items jsonb,
  p_customer_delivery_address text,
  p_customer_delivery_city text,
  p_customer_delivery_barangay text,
  p_customer_delivery_latitude double precision,
  p_customer_delivery_longitude double precision,
  p_customer_delivery_place_id text,
  p_guest_cancel_token_hash text
)
returns table(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_created record;
begin
  if p_guest_cancel_token_hash is null or p_guest_cancel_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid guest cancellation token hash is required';
  end if;

  select * into v_created
  from public.create_order(
    p_restaurant_id, p_customer_name, p_mobile_number, p_order_type,
    p_delivery_city, p_delivery_barangay, p_delivery_address, p_notes,
    p_payment_method, p_is_third_party_courier, p_items,
    p_customer_delivery_address, p_customer_delivery_city,
    p_customer_delivery_barangay, p_customer_delivery_latitude,
    p_customer_delivery_longitude, p_customer_delivery_place_id
  );

  update public.orders
     set guest_cancel_token_hash = p_guest_cancel_token_hash
   where id = v_created.order_id
     and customer_id is null;

  return query select v_created.order_id, v_created.order_number,
                       v_created.subtotal, v_created.delivery_fee, v_created.total;
end;
$function$;

create or replace function public.create_order_from_delivery_quote_with_guest_cancel_token(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_delivery_city text,
  p_delivery_barangay text,
  p_delivery_address text,
  p_notes text,
  p_payment_method text,
  p_items jsonb,
  p_customer_delivery_address text,
  p_customer_delivery_city text,
  p_customer_delivery_barangay text,
  p_customer_delivery_latitude double precision,
  p_customer_delivery_longitude double precision,
  p_customer_delivery_place_id text,
  p_delivery_quote_id uuid,
  p_guest_cancel_token_hash text
)
returns table(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_created record;
begin
  if p_guest_cancel_token_hash is null or p_guest_cancel_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid guest cancellation token hash is required';
  end if;

  select * into v_created
  from public.create_order_from_delivery_quote(
    p_restaurant_id, p_customer_name, p_mobile_number,
    p_delivery_city, p_delivery_barangay, p_delivery_address, p_notes,
    p_payment_method, p_items, p_customer_delivery_address,
    p_customer_delivery_city, p_customer_delivery_barangay,
    p_customer_delivery_latitude, p_customer_delivery_longitude,
    p_customer_delivery_place_id, p_delivery_quote_id
  );

  update public.orders
     set guest_cancel_token_hash = p_guest_cancel_token_hash
   where id = v_created.order_id
     and customer_id is null;

  return query select v_created.order_id, v_created.order_number,
                       v_created.subtotal, v_created.delivery_fee, v_created.total;
end;
$function$;

revoke all on function public.create_order_with_guest_cancel_token(
  uuid,text,text,text,text,text,text,text,text,boolean,jsonb,text,text,text,double precision,double precision,text,text
) from public;
grant execute on function public.create_order_with_guest_cancel_token(
  uuid,text,text,text,text,text,text,text,text,boolean,jsonb,text,text,text,double precision,double precision,text,text
) to anon, authenticated;

revoke all on function public.create_order_from_delivery_quote_with_guest_cancel_token(
  uuid,text,text,text,text,text,text,text,jsonb,text,text,text,double precision,double precision,text,uuid,text
) from public;
grant execute on function public.create_order_from_delivery_quote_with_guest_cancel_token(
  uuid,text,text,text,text,text,text,text,jsonb,text,text,text,double precision,double precision,text,uuid,text
) to anon, authenticated;

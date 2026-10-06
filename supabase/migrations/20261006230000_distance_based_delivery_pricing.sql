-- Distance-based delivery pricing and server-verified delivery quotes.
alter table public.restaurants
  add column if not exists delivery_base_fee numeric(12,2) not null default 0,
  add column if not exists delivery_distance_increment_meters integer not null default 500,
  add column if not exists delivery_fee_per_increment numeric(12,2) not null default 10,
  add column if not exists delivery_max_distance_meters integer not null default 10000,
  add column if not exists delivery_location_latitude double precision,
  add column if not exists delivery_location_longitude double precision;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='restaurants_delivery_base_fee_check' and conrelid='public.restaurants'::regclass) then alter table public.restaurants add constraint restaurants_delivery_base_fee_check check (delivery_base_fee >= 0); end if;
  if not exists (select 1 from pg_constraint where conname='restaurants_delivery_distance_increment_check' and conrelid='public.restaurants'::regclass) then alter table public.restaurants add constraint restaurants_delivery_distance_increment_check check (delivery_distance_increment_meters > 0); end if;
  if not exists (select 1 from pg_constraint where conname='restaurants_delivery_fee_per_increment_check' and conrelid='public.restaurants'::regclass) then alter table public.restaurants add constraint restaurants_delivery_fee_per_increment_check check (delivery_fee_per_increment >= 0); end if;
  if not exists (select 1 from pg_constraint where conname='restaurants_delivery_max_distance_check' and conrelid='public.restaurants'::regclass) then alter table public.restaurants add constraint restaurants_delivery_max_distance_check check (delivery_max_distance_meters > 0); end if;
  if not exists (select 1 from pg_constraint where conname='restaurants_delivery_latitude_check' and conrelid='public.restaurants'::regclass) then alter table public.restaurants add constraint restaurants_delivery_latitude_check check (delivery_location_latitude is null or delivery_location_latitude between -90 and 90); end if;
  if not exists (select 1 from pg_constraint where conname='restaurants_delivery_longitude_check' and conrelid='public.restaurants'::regclass) then alter table public.restaurants add constraint restaurants_delivery_longitude_check check (delivery_location_longitude is null or delivery_location_longitude between -180 and 180); end if;
end $$;

alter table public.orders add column if not exists delivery_distance_meters integer, add column if not exists delivery_quote_id uuid;
alter table public.pending_online_payments add column if not exists delivery_distance_meters integer, add column if not exists delivery_quote_id uuid;

create table if not exists public.delivery_quotes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_latitude double precision not null,
  customer_longitude double precision not null,
  distance_meters integer not null,
  delivery_fee numeric(12,2) not null,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint delivery_quotes_latitude_check check (customer_latitude between -90 and 90),
  constraint delivery_quotes_longitude_check check (customer_longitude between -180 and 180),
  constraint delivery_quotes_distance_check check (distance_meters >= 0),
  constraint delivery_quotes_fee_check check (delivery_fee >= 0)
);
create index if not exists delivery_quotes_restaurant_created_idx on public.delivery_quotes(restaurant_id, created_at desc);
create index if not exists delivery_quotes_expires_idx on public.delivery_quotes(expires_at);
alter table public.delivery_quotes enable row level security;
revoke all on table public.delivery_quotes from anon, authenticated;

create or replace function public.consume_delivery_quote(p_quote_id uuid,p_restaurant_id uuid,p_customer_latitude double precision,p_customer_longitude double precision)
returns table(distance_meters integer,delivery_fee numeric)
language plpgsql security definer set search_path=public as $$
declare v_quote public.delivery_quotes%rowtype;
begin
  if p_quote_id is null then raise exception 'Delivery location must be confirmed before checkout'; end if;
  select * into v_quote from public.delivery_quotes where id=p_quote_id and restaurant_id=p_restaurant_id for update;
  if not found or v_quote.consumed_at is not null or v_quote.expires_at <= now() then raise exception 'Delivery location confirmation expired. Please confirm your location again.'; end if;
  if abs(v_quote.customer_latitude-p_customer_latitude)>0.00001 or abs(v_quote.customer_longitude-p_customer_longitude)>0.00001 then raise exception 'The delivery location changed. Please confirm the location again.'; end if;
  update public.delivery_quotes set consumed_at=now() where id=v_quote.id;
  return query select v_quote.distance_meters,v_quote.delivery_fee;
end; $$;
revoke all on function public.consume_delivery_quote(uuid,uuid,double precision,double precision) from public,anon,authenticated;

create or replace function public.create_order_from_delivery_quote(
  p_restaurant_id uuid,p_customer_name text,p_mobile_number text,p_delivery_city text,p_delivery_barangay text,p_delivery_address text,p_notes text,p_payment_method text,p_items jsonb,
  p_customer_delivery_address text,p_customer_delivery_city text,p_customer_delivery_barangay text,p_customer_delivery_latitude double precision,p_customer_delivery_longitude double precision,p_customer_delivery_place_id text,p_delivery_quote_id uuid
)
returns table(order_id uuid,order_number text,subtotal numeric,delivery_fee numeric,total numeric)
language plpgsql security definer set search_path=public as $$
declare v_order_id uuid;v_order_number text;v_subtotal numeric(12,2):=0;v_delivery_fee numeric(12,2);v_distance integer;v_item jsonb;v_product_id uuid;v_quantity integer;v_product_name text;v_unit_price numeric;v_quote public.delivery_quotes%rowtype;v_cash_on_delivery_enabled boolean;
begin
  if p_restaurant_id is null then raise exception 'Restaurant is required'; end if;
  if length(trim(coalesce(p_customer_name,'')))=0 then raise exception 'Customer name is required'; end if;
  if length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required'; end if;
  if p_payment_method not in ('cash','gcash') then raise exception 'Invalid payment method'; end if;
  if length(trim(coalesce(p_delivery_city,'')))=0 or length(trim(coalesce(p_delivery_barangay,'')))=0 or length(trim(coalesce(p_delivery_address,'')))=0 then raise exception 'Complete delivery address is required'; end if;
  if p_customer_delivery_latitude is null or p_customer_delivery_longitude is null then raise exception 'A confirmed delivery map location is required'; end if;
  select cash_on_delivery_enabled into v_cash_on_delivery_enabled from public.restaurants where id=p_restaurant_id and is_active=true;
  if not found then raise exception 'Restaurant is not available'; end if;
  if p_payment_method='cash' and not coalesce(v_cash_on_delivery_enabled,false) then raise exception 'Cash on Delivery is currently unavailable. Please choose Online Payment.'; end if;
  select * into v_quote from public.delivery_quotes where id=p_delivery_quote_id and restaurant_id=p_restaurant_id for update;
  if not found or v_quote.consumed_at is not null or v_quote.expires_at <= now() then raise exception 'Delivery location confirmation expired. Please confirm your location again.'; end if;
  if abs(v_quote.customer_latitude-p_customer_delivery_latitude)>0.00001 or abs(v_quote.customer_longitude-p_customer_delivery_longitude)>0.00001 then raise exception 'The delivery location changed. Please confirm the location again.'; end if;
  v_distance:=v_quote.distance_meters;v_delivery_fee:=v_quote.delivery_fee;
  update public.delivery_quotes set consumed_at=now() where id=v_quote.id;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one item is required'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id:=(v_item->>'product_id')::uuid;v_quantity:=(v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity<1 or v_quantity>99 then raise exception 'Invalid item quantity'; end if;
    select name,price into v_product_name,v_unit_price from public.products where id=v_product_id and restaurant_id=p_restaurant_id and is_available=true;
    if not found then raise exception 'One or more selected products are no longer available'; end if;
    v_subtotal:=v_subtotal+round(v_unit_price*v_quantity,2);
  end loop;
  v_order_number:='ORD-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.orders(restaurant_id,order_number,customer_name,mobile_number,order_type,delivery_city,delivery_barangay,delivery_address,customer_delivery_address,customer_delivery_city,customer_delivery_barangay,customer_delivery_latitude,customer_delivery_longitude,customer_delivery_place_id,delivery_distance_meters,delivery_quote_id,notes,payment_method,payment_status,status,subtotal,delivery_fee,total,pickup_method)
  values(p_restaurant_id,v_order_number,trim(p_customer_name),trim(p_mobile_number),'delivery',nullif(trim(p_delivery_city),''),nullif(trim(p_delivery_barangay),''),nullif(trim(p_delivery_address),''),nullif(trim(p_customer_delivery_address),''),nullif(trim(p_customer_delivery_city),''),nullif(trim(p_customer_delivery_barangay),''),p_customer_delivery_latitude,p_customer_delivery_longitude,nullif(trim(p_customer_delivery_place_id),''),v_distance,v_quote.id,trim(coalesce(p_notes,'')),p_payment_method,'pending','pending',v_subtotal,v_delivery_fee,v_subtotal+v_delivery_fee,null) returning id into v_order_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id:=(v_item->>'product_id')::uuid;v_quantity:=(v_item->>'quantity')::integer;
    select name,price into v_product_name,v_unit_price from public.products where id=v_product_id and restaurant_id=p_restaurant_id and is_available=true;
    insert into public.order_items(order_id,product_id,product_name,unit_price,quantity,line_total) values(v_order_id,v_product_id,v_product_name,v_unit_price,v_quantity,round(v_unit_price*v_quantity,2));
  end loop;
  return query select v_order_id,v_order_number,v_subtotal,v_delivery_fee,v_subtotal+v_delivery_fee;
end; $$;
grant execute on function public.create_order_from_delivery_quote(uuid,text,text,text,text,text,text,text,jsonb,text,text,text,double precision,double precision,text,uuid) to anon,authenticated;

create or replace function public.create_pending_online_payment_from_delivery_quote(
  p_restaurant_id uuid,p_customer_name text,p_mobile_number text,p_delivery_city text,p_delivery_barangay text,p_delivery_address text,p_notes text,p_items jsonb,p_redeem_loyalty boolean,
  p_customer_delivery_address text,p_customer_delivery_city text,p_customer_delivery_barangay text,p_customer_delivery_latitude double precision,p_customer_delivery_longitude double precision,p_customer_delivery_place_id text,p_delivery_quote_id uuid
)
returns table(payment_id uuid,reference_number text,subtotal numeric,delivery_fee numeric,total numeric)
language plpgsql security definer set search_path=public as $$
declare v_payment_id uuid;v_reference_number text;v_subtotal numeric(12,2):=0;v_delivery_fee numeric(12,2);v_distance integer;v_item jsonb;v_product_id uuid;v_quantity integer;v_product_name text;v_unit_price numeric;v_items jsonb:='[]'::jsonb;v_customer public.customer_profiles%rowtype;v_restaurant public.restaurants%rowtype;v_account public.customer_loyalty_accounts%rowtype;v_discount numeric(12,2):=0;v_quote public.delivery_quotes%rowtype;
begin
  if p_restaurant_id is null then raise exception 'Restaurant is required'; end if;
  if length(trim(coalesce(p_customer_name,'')))=0 then raise exception 'Customer name is required'; end if;
  if length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required'; end if;
  if length(trim(coalesce(p_delivery_city,'')))=0 or length(trim(coalesce(p_delivery_barangay,'')))=0 or length(trim(coalesce(p_delivery_address,'')))=0 then raise exception 'Complete delivery address is required'; end if;
  if p_customer_delivery_latitude is null or p_customer_delivery_longitude is null then raise exception 'A confirmed delivery map location is required'; end if;
  select * into v_restaurant from public.restaurants where id=p_restaurant_id and is_active=true;
  if not found then raise exception 'Restaurant is not available'; end if;
  select * into v_quote from public.delivery_quotes where id=p_delivery_quote_id and restaurant_id=p_restaurant_id for update;
  if not found or v_quote.consumed_at is not null or v_quote.expires_at <= now() then raise exception 'Delivery location confirmation expired. Please confirm your location again.'; end if;
  if abs(v_quote.customer_latitude-p_customer_delivery_latitude)>0.00001 or abs(v_quote.customer_longitude-p_customer_delivery_longitude)>0.00001 then raise exception 'The delivery location changed. Please confirm the location again.'; end if;
  v_distance:=v_quote.distance_meters;v_delivery_fee:=v_quote.delivery_fee;
  update public.delivery_quotes set consumed_at=now() where id=v_quote.id;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one item is required'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id:=(v_item->>'product_id')::uuid;v_quantity:=(v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity<1 or v_quantity>99 then raise exception 'Invalid item quantity'; end if;
    select name,price into v_product_name,v_unit_price from public.products where id=v_product_id and restaurant_id=p_restaurant_id and is_available=true;
    if not found then raise exception 'One or more selected products are no longer available'; end if;
    v_subtotal:=v_subtotal+round(v_unit_price*v_quantity,2);
    v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',v_product_id,'product_name',v_product_name,'unit_price',v_unit_price,'quantity',v_quantity,'line_total',round(v_unit_price*v_quantity,2)));
  end loop;
  if p_redeem_loyalty then
    if auth.uid() is null then raise exception 'You must be signed in to redeem loyalty points'; end if;
    select * into v_customer from public.customer_profiles where restaurant_id=p_restaurant_id and auth_user_id=auth.uid() limit 1;
    if not found then raise exception 'Customer account not found for this restaurant'; end if;
    select * into v_account from public.customer_loyalty_accounts where customer_id=v_customer.id for update;
    if not found then raise exception 'Customer loyalty account not found'; end if;
    if v_account.points_balance<v_restaurant.loyalty_redemption_points then raise exception 'Customer does not have enough loyalty points'; end if;
    if not v_restaurant.loyalty_redemption_enabled then raise exception 'Loyalty redemption is disabled'; end if;
    v_discount:=least(round(v_restaurant.loyalty_redemption_amount,2),greatest(round(v_subtotal,2),0));
    if v_discount<=0 then raise exception 'This order has no amount available for redemption'; end if;
  end if;
  v_reference_number:='PAY-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.pending_online_payments(restaurant_id,reference_number,customer_name,mobile_number,order_type,delivery_city,delivery_barangay,delivery_address,customer_delivery_address,customer_delivery_city,customer_delivery_barangay,customer_delivery_latitude,customer_delivery_longitude,customer_delivery_place_id,delivery_distance_meters,delivery_quote_id,notes,is_third_party_courier,items,subtotal,delivery_fee,total,customer_id,loyalty_points_redeemed,loyalty_discount_amount)
  values(p_restaurant_id,v_reference_number,trim(p_customer_name),trim(p_mobile_number),'delivery',nullif(trim(p_delivery_city),''),nullif(trim(p_delivery_barangay),''),nullif(trim(p_delivery_address),''),nullif(trim(p_customer_delivery_address),''),nullif(trim(p_customer_delivery_city),''),nullif(trim(p_customer_delivery_barangay),''),p_customer_delivery_latitude,p_customer_delivery_longitude,nullif(trim(p_customer_delivery_place_id),''),v_distance,v_quote.id,trim(coalesce(p_notes,'')),false,v_items,v_subtotal,v_delivery_fee,greatest(round(v_subtotal+v_delivery_fee-v_discount,2),0),case when p_redeem_loyalty then v_customer.id else null end,case when p_redeem_loyalty then v_restaurant.loyalty_redemption_points else 0 end,v_discount) returning id into v_payment_id;
  return query select v_payment_id,v_reference_number,v_subtotal,v_delivery_fee,greatest(round(v_subtotal+v_delivery_fee-v_discount,2),0);
end; $$;
grant execute on function public.create_pending_online_payment_from_delivery_quote(uuid,text,text,text,text,text,text,jsonb,boolean,text,text,text,double precision,double precision,text,uuid) to anon,authenticated;

-- Delivery radius experiment.
-- This migration is intentionally isolated on the delivery-radius-map-experiment branch.
-- Existing city/barangay zones remain as a fallback until a restaurant configures coordinates.

alter table public.restaurants
  add column if not exists delivery_enabled boolean not null default true,
  add column if not exists delivery_latitude numeric(9,6),
  add column if not exists delivery_longitude numeric(9,6),
  add column if not exists delivery_radius_km numeric(8,2) not null default 5,
  add column if not exists delivery_fee numeric(12,2) not null default 0,
  add column if not exists allow_third_party_courier boolean not null default true;

alter table public.orders
  add column if not exists delivery_latitude numeric(9,6),
  add column if not exists delivery_longitude numeric(9,6);

alter table public.pending_online_payments
  add column if not exists delivery_latitude numeric(9,6),
  add column if not exists delivery_longitude numeric(9,6);

alter table public.restaurants
  drop constraint if exists restaurants_delivery_latitude_check;
alter table public.restaurants
  add constraint restaurants_delivery_latitude_check
  check (delivery_latitude is null or delivery_latitude between -90 and 90);

alter table public.restaurants
  drop constraint if exists restaurants_delivery_longitude_check;
alter table public.restaurants
  add constraint restaurants_delivery_longitude_check
  check (delivery_longitude is null or delivery_longitude between -180 and 180);

alter table public.restaurants
  drop constraint if exists restaurants_delivery_radius_km_check;
alter table public.restaurants
  add constraint restaurants_delivery_radius_km_check
  check (delivery_radius_km > 0 and delivery_radius_km <= 100);

alter table public.restaurants
  drop constraint if exists restaurants_delivery_fee_check;
alter table public.restaurants
  add constraint restaurants_delivery_fee_check
  check (delivery_fee >= 0);

alter table public.orders
  drop constraint if exists orders_delivery_coordinates_check;
alter table public.orders
  add constraint orders_delivery_coordinates_check
  check (
    delivery_latitude is null
    or delivery_longitude is not null
  );

alter table public.pending_online_payments
  drop constraint if exists pending_online_payments_delivery_coordinates_check;
alter table public.pending_online_payments
  add constraint pending_online_payments_delivery_coordinates_check
  check (
    delivery_latitude is null
    or delivery_longitude is not null
  );

create or replace function public.update_restaurant_delivery_settings(
  p_restaurant_id uuid,
  p_delivery_enabled boolean,
  p_delivery_latitude numeric,
  p_delivery_longitude numeric,
  p_delivery_radius_km numeric,
  p_delivery_fee numeric,
  p_allow_third_party_courier boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if not exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.is_active = true
      and (
        r.owner_id = auth.uid()
        or public.is_system_admin()
      )
  ) then
    raise exception 'You are not authorized to update this restaurant';
  end if;

  if p_delivery_latitude is null or p_delivery_longitude is null then
    raise exception 'Pin the restaurant location on the map';
  end if;

  if p_delivery_latitude not between -90 and 90
    or p_delivery_longitude not between -180 and 180 then
    raise exception 'Restaurant location is invalid';
  end if;

  if p_delivery_radius_km <= 0 or p_delivery_radius_km > 100 then
    raise exception 'Delivery radius must be between 0.1 and 100 km';
  end if;

  if p_delivery_fee < 0 then
    raise exception 'Delivery fee cannot be negative';
  end if;

  update public.restaurants
  set
    delivery_enabled = coalesce(p_delivery_enabled, true),
    delivery_latitude = round(p_delivery_latitude, 6),
    delivery_longitude = round(p_delivery_longitude, 6),
    delivery_radius_km = round(p_delivery_radius_km, 2),
    delivery_fee = round(p_delivery_fee, 2),
    allow_third_party_courier = coalesce(p_allow_third_party_courier, true),
    updated_at = now()
  where id = p_restaurant_id;
end;
$function$;

revoke all on function public.update_restaurant_delivery_settings(uuid,boolean,numeric,numeric,numeric,numeric,boolean) from public, anon;
grant execute on function public.update_restaurant_delivery_settings(uuid,boolean,numeric,numeric,numeric,numeric,boolean) to authenticated;

-- Server-side distance calculation. This is the security boundary; the browser
-- may provide coordinates for UX, but it cannot decide whether an address is in range.
create or replace function public.delivery_distance_km(
  p_latitude numeric,
  p_longitude numeric,
  p_restaurant_latitude numeric,
  p_restaurant_longitude numeric
)
returns numeric
language sql
immutable
as $function$
  select round((
    6371.0088 * acos(
      least(1, greatest(-1,
        sin(radians(p_latitude::double precision))
        * sin(radians(p_restaurant_latitude::double precision))
        + cos(radians(p_latitude::double precision))
        * cos(radians(p_restaurant_latitude::double precision))
        * cos(radians((p_longitude - p_restaurant_longitude)::double precision))
      ))
    )
  )::numeric, 2);
$function$;

revoke all on function public.delivery_distance_km(numeric,numeric,numeric,numeric) from public, anon, authenticated;

-- Recreate public checkout RPC with radius validation. If a restaurant has not
-- configured coordinates yet, the existing city/barangay model remains active.
drop function if exists public.create_order(uuid,text,text,text,text,text,text,text,text,boolean,jsonb);
drop function if exists public.create_order(uuid,text,text,text,text,text,text,boolean,jsonb);

create or replace function public.create_order(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_order_type text,
  p_delivery_city text,
  p_delivery_barangay text,
  p_delivery_address text,
  p_delivery_latitude numeric,
  p_delivery_longitude numeric,
  p_notes text,
  p_payment_method text,
  p_is_third_party_courier boolean,
  p_items jsonb
)
returns table(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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
  v_delivery_zone public.restaurant_delivery_zones%rowtype;
  v_pickup_method text;
  v_cash_on_delivery_enabled boolean;
  v_restaurant public.restaurants%rowtype;
  v_distance_km numeric;
begin
  select * into v_restaurant
  from public.restaurants
  where id = p_restaurant_id and is_active = true;

  if not found then raise exception 'Restaurant is not available'; end if;
  if length(trim(coalesce(p_customer_name,'')))=0 then raise exception 'Customer name is required'; end if;
  if p_order_type not in ('delivery','pickup','dine_in') then raise exception 'Invalid order type'; end if;
  if p_order_type<>'dine_in' and length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required'; end if;
  if p_payment_method not in ('cash','gcash') then raise exception 'Invalid payment method'; end if;

  v_cash_on_delivery_enabled := v_restaurant.cash_on_delivery_enabled;
  if p_order_type='delivery' and p_payment_method='cash' and not coalesce(v_cash_on_delivery_enabled,false) then
    raise exception 'Cash on Delivery is currently unavailable. Please choose Online Payment.';
  end if;

  if coalesce(p_is_third_party_courier,false) and p_order_type<>'pickup' then
    raise exception 'Third-party courier orders must use pickup order type';
  end if;

  v_pickup_method := case
    when p_order_type='pickup' and coalesce(p_is_third_party_courier,false) then 'third_party_courier'
    when p_order_type='pickup' then 'customer'
    else null
  end;

  if p_order_type='delivery' then
    if not coalesce(v_restaurant.delivery_enabled, true) then raise exception 'Restaurant delivery is currently unavailable'; end if;
    if length(trim(coalesce(p_delivery_address,'')))=0 then raise exception 'Delivery address is required'; end if;

    if v_restaurant.delivery_latitude is not null and v_restaurant.delivery_longitude is not null then
      if p_delivery_latitude is null or p_delivery_longitude is null then
        raise exception 'Please pin your delivery location on the map';
      end if;

      v_distance_km := public.delivery_distance_km(
        p_delivery_latitude, p_delivery_longitude,
        v_restaurant.delivery_latitude, v_restaurant.delivery_longitude
      );

      if v_distance_km > v_restaurant.delivery_radius_km then
        raise exception 'This address is outside the store delivery area';
      end if;

      v_delivery_fee := round(v_restaurant.delivery_fee, 2);
    else
      if length(trim(coalesce(p_delivery_city,'')))=0 then raise exception 'Delivery city is required'; end if;
      if length(trim(coalesce(p_delivery_barangay,'')))=0 then raise exception 'Delivery barangay is required'; end if;

      select * into v_delivery_zone
      from public.restaurant_delivery_zones
      where restaurant_id=p_restaurant_id
        and lower(trim(city))=lower(trim(p_delivery_city))
        and lower(trim(barangay))=lower(trim(p_delivery_barangay));

      if not found then raise exception 'Please select a delivery area within the restaurant''s delivery areas'; end if;
      if not v_delivery_zone.is_supported then
        raise exception '%', coalesce(nullif(trim(v_delivery_zone.out_of_scope_message),''),'This area is outside our delivery coverage.');
      end if;
      v_delivery_fee := round(v_delivery_zone.shipping_fee,2);
    end if;
  end if;

  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one item is required'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity<1 or v_quantity>99 then raise exception 'Invalid item quantity'; end if;

    select name,price into v_product_name,v_unit_price
    from public.products
    where id=v_product_id and restaurant_id=p_restaurant_id and is_available=true;

    if not found then raise exception 'One or more selected products are no longer available'; end if;
    v_subtotal := v_subtotal + round(v_unit_price*v_quantity,2);
  end loop;

  v_order_number := public.next_restaurant_order_number(p_restaurant_id);

  insert into public.orders(
    restaurant_id,order_number,customer_name,mobile_number,order_type,
    delivery_city,delivery_barangay,delivery_address,delivery_latitude,delivery_longitude,
    notes,payment_method,payment_status,status,subtotal,delivery_fee,total,pickup_method
  )
  values(
    p_restaurant_id,v_order_number,trim(p_customer_name),trim(coalesce(p_mobile_number,'')),p_order_type,
    nullif(trim(coalesce(p_delivery_city,'')),''),nullif(trim(coalesce(p_delivery_barangay,'')),''),nullif(trim(coalesce(p_delivery_address,'')),''),
    p_delivery_latitude,p_delivery_longitude,trim(coalesce(p_notes,'')),p_payment_method,'pending','pending',
    v_subtotal,v_delivery_fee,v_subtotal+v_delivery_fee,v_pickup_method
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    select name,price into v_product_name,v_unit_price from public.products
    where id=v_product_id and restaurant_id=p_restaurant_id and is_available=true;
    insert into public.order_items(order_id,product_id,product_name,unit_price,quantity,line_total)
    values(v_order_id,v_product_id,v_product_name,v_unit_price,v_quantity,round(v_unit_price*v_quantity,2));
  end loop;

  return query select v_order_id,v_order_number,v_subtotal,v_delivery_fee,v_subtotal+v_delivery_fee;
end;
$function$;

grant execute on function public.create_order(uuid,text,text,text,text,text,text,numeric,numeric,text,text,boolean,jsonb) to anon, authenticated;

drop function if exists public.create_pending_online_payment(uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean);

create or replace function public.create_pending_online_payment(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_order_type text,
  p_delivery_city text,
  p_delivery_barangay text,
  p_delivery_address text,
  p_delivery_latitude numeric,
  p_delivery_longitude numeric,
  p_notes text,
  p_is_third_party_courier boolean,
  p_items jsonb,
  p_redeem_loyalty boolean default false
)
returns table(payment_id uuid, reference_number text, subtotal numeric, delivery_fee numeric, total numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_payment_id uuid;
  v_reference_number text;
  v_subtotal numeric(12,2):=0;
  v_delivery_fee numeric(12,2):=0;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_product_name text;
  v_unit_price numeric(12,2);
  v_delivery_zone public.restaurant_delivery_zones%rowtype;
  v_pickup_point text;
  v_items jsonb:='[]'::jsonb;
  v_customer public.customer_profiles%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_account public.customer_loyalty_accounts%rowtype;
  v_discount numeric(12,2):=0;
  v_distance_km numeric;
begin
  select * into v_restaurant from public.restaurants where id=p_restaurant_id and is_active=true;
  if not found then raise exception 'Restaurant is not available'; end if;
  if length(trim(coalesce(p_customer_name,'')))=0 then raise exception 'Customer name is required'; end if;
  if p_order_type not in ('delivery','pickup','dine_in') then raise exception 'Invalid order type'; end if;
  if p_order_type<>'dine_in' and length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required'; end if;
  if p_is_third_party_courier and p_order_type<>'delivery' then raise exception 'Third-party courier delivery requires delivery order type'; end if;

  if p_order_type='delivery' then
    if p_is_third_party_courier then
      if not coalesce(v_restaurant.allow_third_party_courier,true) then raise exception 'Own courier pickup is currently unavailable'; end if;
      select trim(coalesce(location_text,'')) into v_pickup_point from public.restaurants where id=p_restaurant_id and is_active=true;
      if length(coalesce(v_pickup_point,''))=0 then raise exception 'The restaurant pickup address is not configured yet'; end if;
      p_delivery_address:=v_pickup_point;
      p_delivery_city:=null;
      p_delivery_barangay:=null;
      p_delivery_latitude:=null;
      p_delivery_longitude:=null;
    else
      if not coalesce(v_restaurant.delivery_enabled,true) then raise exception 'Restaurant delivery is currently unavailable'; end if;
      if length(trim(coalesce(p_delivery_address,'')))=0 then raise exception 'Delivery address is required'; end if;

      if v_restaurant.delivery_latitude is not null and v_restaurant.delivery_longitude is not null then
        if p_delivery_latitude is null or p_delivery_longitude is null then raise exception 'Please pin your delivery location on the map'; end if;
        v_distance_km:=public.delivery_distance_km(p_delivery_latitude,p_delivery_longitude,v_restaurant.delivery_latitude,v_restaurant.delivery_longitude);
        if v_distance_km > v_restaurant.delivery_radius_km then raise exception 'This address is outside the store delivery area'; end if;
        v_delivery_fee:=round(v_restaurant.delivery_fee,2);
      else
        if length(trim(coalesce(p_delivery_city,'')))=0 then raise exception 'Delivery city is required'; end if;
        if length(trim(coalesce(p_delivery_barangay,'')))=0 then raise exception 'Delivery barangay is required'; end if;
        select * into v_delivery_zone from public.restaurant_delivery_zones
        where restaurant_id=p_restaurant_id and lower(trim(city))=lower(trim(p_delivery_city)) and lower(trim(barangay))=lower(trim(p_delivery_barangay));
        if not found then raise exception 'Please select a delivery area within the restaurant''s delivery areas'; end if;
        if not v_delivery_zone.is_supported then raise exception '%',coalesce(nullif(trim(v_delivery_zone.out_of_scope_message),''),'This area is outside our delivery coverage.'); end if;
        v_delivery_fee:=round(v_delivery_zone.shipping_fee,2);
      end if;
    end if;
  end if;

  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one item is required'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id:=(v_item->>'product_id')::uuid;
    v_quantity:=(v_item->>'quantity')::integer;
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
    if v_account.points_balance < v_restaurant.loyalty_redemption_points then raise exception 'Customer does not have enough loyalty points'; end if;
    if not v_restaurant.loyalty_redemption_enabled then raise exception 'Loyalty redemption is disabled'; end if;
    v_discount:=least(round(v_restaurant.loyalty_redemption_amount,2),greatest(round(v_subtotal,2),0));
    if v_discount<=0 then raise exception 'This order has no amount available for redemption'; end if;
  end if;

  v_reference_number:='PAY-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));

  insert into public.pending_online_payments(
    restaurant_id,reference_number,customer_name,mobile_number,order_type,
    delivery_city,delivery_barangay,delivery_address,delivery_latitude,delivery_longitude,
    notes,is_third_party_courier,items,subtotal,delivery_fee,total,customer_id,loyalty_points_redeemed,loyalty_discount_amount
  )
  values(
    p_restaurant_id,v_reference_number,trim(p_customer_name),trim(coalesce(p_mobile_number,'')),p_order_type,
    nullif(trim(coalesce(p_delivery_city,'')),''),nullif(trim(coalesce(p_delivery_barangay,'')),''),nullif(trim(coalesce(p_delivery_address,'')),''),
    p_delivery_latitude,p_delivery_longitude,trim(coalesce(p_notes,'')),coalesce(p_is_third_party_courier,false),v_items,v_subtotal,v_delivery_fee,
    greatest(round(v_subtotal+v_delivery_fee-v_discount,2),0),
    case when p_redeem_loyalty then v_customer.id else null end,
    case when p_redeem_loyalty then v_restaurant.loyalty_redemption_points else 0 end,
    v_discount
  )
  returning id into v_payment_id;

  return query select v_payment_id,v_reference_number,v_subtotal,v_delivery_fee,greatest(round(v_subtotal+v_delivery_fee-v_discount,2),0);
end;
$function$;

grant execute on function public.create_pending_online_payment(uuid,text,text,text,text,text,text,numeric,numeric,text,boolean,jsonb,boolean) to anon, authenticated;

-- Keep online-payment finalization consistent with the same stored delivery data.
create or replace function public.finalize_online_payment(p_reference_number text)
returns table(order_id uuid,order_number text,total numeric)
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_payment public.pending_online_payments%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
begin
  select * into v_payment from public.pending_online_payments where reference_number=trim(p_reference_number) for update;
  if not found then raise exception 'Pending online payment not found'; end if;
  if v_payment.status='paid' and v_payment.order_id is not null then
    select o.id,o.order_number,o.total into v_order_id,v_order_number,total from public.orders o where o.id=v_payment.order_id;
    return query select v_order_id,v_order_number,total;
    return;
  end if;
  if v_payment.status<>'pending' then raise exception 'Online payment is not pending'; end if;

  v_order_number:=public.next_restaurant_order_number(v_payment.restaurant_id);

  insert into public.orders(
    restaurant_id,order_number,customer_name,mobile_number,order_type,delivery_city,delivery_barangay,delivery_address,
    delivery_latitude,delivery_longitude,notes,payment_method,payment_status,status,subtotal,delivery_fee,total,pickup_method
  )
  values(
    v_payment.restaurant_id,v_order_number,v_payment.customer_name,v_payment.mobile_number,v_payment.order_type,
    v_payment.delivery_city,v_payment.delivery_barangay,v_payment.delivery_address,v_payment.delivery_latitude,v_payment.delivery_longitude,
    v_payment.notes,'gcash','paid','confirmed',v_payment.subtotal,v_payment.delivery_fee,v_payment.total,
    case when v_payment.is_third_party_courier then 'third_party_courier' when v_payment.order_type='pickup' then 'customer' else null end
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_payment.items) loop
    insert into public.order_items(order_id,product_id,product_name,unit_price,quantity,line_total)
    values(v_order_id,nullif(v_item->>'product_id','')::uuid,v_item->>'product_name',(v_item->>'unit_price')::numeric,(v_item->>'quantity')::integer,(v_item->>'line_total')::numeric);
  end loop;

  update public.pending_online_payments set status='paid',order_id=v_order_id,updated_at=now() where id=v_payment.id;
  return query select v_order_id,v_order_number,v_payment.total;
end;
$function$;

revoke execute on function public.finalize_online_payment(text) from public,anon,authenticated;
grant execute on function public.finalize_online_payment(text) to service_role;

-- Automatic rider assignment uses the radius as the delivery boundary when configured.
-- Legacy rider delivery-zone matching remains active for restaurants still using zones.
create or replace function public.auto_assign_ready_delivery_order()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_rider_id uuid;
  v_order_id uuid;
  v_today_start timestamptz;
begin
  if new.order_type<>'delivery'
    or new.status<>'ready'
    or coalesce(new.delivery_status,'unassigned')<>'unassigned'
    or new.rider_id is not null then
    return new;
  end if;

  select * into v_restaurant
  from public.restaurants
  where id=new.restaurant_id
    and is_active=true
    and automatic_rider_assignment_enabled=true
  for update;

  if not found then return new; end if;

  v_today_start:=date_trunc('day',now());

  select s.id into v_rider_id
  from public.restaurant_staff s
  where s.restaurant_id=new.restaurant_id
    and s.role='rider'
    and s.is_active=true
    and (
      (
        v_restaurant.delivery_latitude is not null
        and v_restaurant.delivery_longitude is not null
      )
      or exists(
        select 1
        from public.rider_delivery_zones rdz
        join public.restaurant_delivery_zones z on z.id=rdz.delivery_zone_id
        where rdz.restaurant_id=new.restaurant_id
          and rdz.rider_id=s.id
          and z.restaurant_id=new.restaurant_id
          and z.is_supported=true
          and lower(trim(z.city))=lower(trim(new.delivery_city))
          and lower(trim(z.barangay))=lower(trim(new.delivery_barangay))
      )
    )
    and not exists(
      select 1 from public.delivery_assignments da
      where da.restaurant_id=new.restaurant_id
        and da.rider_id=s.id
        and da.status in('assigned','delivering')
    )
  order by
    (select count(*) from public.delivery_assignments da where da.restaurant_id=new.restaurant_id and da.rider_id=s.id and da.status in('assigned','delivering')) asc,
    (select count(*) from public.delivery_assignments da where da.restaurant_id=new.restaurant_id and da.rider_id=s.id and da.status='delivered' and da.delivered_at>=v_today_start) asc,
    s.created_at asc,
    s.id asc
  limit 1;

  if v_rider_id is null then return new; end if;

  insert into public.delivery_assignments(order_id,rider_id,restaurant_id,status)
  values(new.id,v_rider_id,new.restaurant_id,'assigned')
  on conflict(order_id) where status in('assigned','delivering') do nothing
  returning order_id into v_order_id;

  if v_order_id is not null then
    update public.orders
    set rider_id=v_rider_id,delivery_status='assigned',rider_assigned_at=now()
    where id=new.id and rider_id is null and coalesce(delivery_status,'unassigned')='unassigned';
  end if;

  return new;
end;
$$;

revoke all on function public.auto_assign_ready_delivery_order() from public,anon,authenticated;

-- Keep a signed-in customer's default map pin with the saved address.
alter table public.customer_profiles
  add column if not exists default_delivery_latitude numeric(9,6),
  add column if not exists default_delivery_longitude numeric(9,6);

drop function if exists public.get_my_customer_profile(uuid);

create or replace function public.get_my_customer_profile(p_restaurant_id uuid)
returns table(
  customer_id uuid,
  name text,
  phone text,
  default_delivery_city text,
  default_delivery_barangay text,
  default_delivery_address text,
  default_delivery_latitude numeric,
  default_delivery_longitude numeric
)
language plpgsql security definer set search_path=public,pg_temp as $function$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  return query
  select cp.id,cp.name,cp.phone,cp.default_delivery_city,cp.default_delivery_barangay,cp.default_delivery_address,
         cp.default_delivery_latitude,cp.default_delivery_longitude
  from public.customer_profiles cp
  where cp.restaurant_id=p_restaurant_id
    and cp.auth_user_id=auth.uid()
  limit 1;
end;
$function$;

revoke all on function public.get_my_customer_profile(uuid) from public,anon;
grant execute on function public.get_my_customer_profile(uuid) to authenticated;

drop function if exists public.save_my_default_delivery_address(uuid,text,text,text);

create or replace function public.save_my_default_delivery_address(
  p_restaurant_id uuid,
  p_city text,
  p_barangay text,
  p_address text,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns void
language plpgsql security definer set search_path=public,pg_temp as $function$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if length(trim(coalesce(p_city,'')))=0 then raise exception 'City is required'; end if;
  if length(trim(coalesce(p_address,'')))=0 then raise exception 'Complete delivery address is required'; end if;
  if (p_latitude is null) <> (p_longitude is null) then raise exception 'Delivery coordinates must include both latitude and longitude'; end if;
  if p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then raise exception 'Delivery coordinates are invalid'; end if;

  update public.customer_profiles
  set default_delivery_city=trim(p_city),
      default_delivery_barangay=nullif(trim(coalesce(p_barangay,'')),''),
      default_delivery_address=trim(p_address),
      default_delivery_latitude=p_latitude,
      default_delivery_longitude=p_longitude,
      updated_at=now()
  where restaurant_id=p_restaurant_id
    and auth_user_id=auth.uid();

  if not found then raise exception 'Customer profile not found'; end if;
end;
$function$;

revoke all on function public.save_my_default_delivery_address(uuid,text,text,text,numeric,numeric) from public,anon;
grant execute on function public.save_my_default_delivery_address(uuid,text,text,text,numeric,numeric) to authenticated;

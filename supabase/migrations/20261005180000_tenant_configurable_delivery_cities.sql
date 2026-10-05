-- Tenant-configurable delivery coverage: city + barangay.
alter table public.restaurant_delivery_zones add column if not exists city text;
update public.restaurant_delivery_zones set city='Valenzuela City' where nullif(trim(city),'') is null;
alter table public.restaurant_delivery_zones alter column city set not null;
alter table public.restaurant_delivery_zones drop constraint if exists restaurant_delivery_zones_unique_barangay;
alter table public.restaurant_delivery_zones add constraint restaurant_delivery_zones_unique_city_barangay unique (restaurant_id, city, barangay);
create index if not exists restaurant_delivery_zones_restaurant_city_idx on public.restaurant_delivery_zones (restaurant_id, city, barangay);
alter table public.orders add column if not exists delivery_city text;
alter table public.pending_online_payments add column if not exists delivery_city text;

drop function if exists public.create_order(uuid,text,text,text,text,text,text,text,text,jsonb,boolean);
drop function if exists public.create_order(uuid,text,text,text,text,text,text,boolean,jsonb);
CREATE OR REPLACE FUNCTION public.create_order(p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_order_type text, p_delivery_city text, p_delivery_barangay text, p_delivery_address text, p_notes text, p_payment_method text, p_is_third_party_courier boolean, p_items jsonb)
 RETURNS TABLE(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_order_id uuid;v_order_number text;v_subtotal numeric(12,2):=0;v_delivery_fee numeric(12,2):=0;v_item jsonb;v_product_id uuid;v_quantity integer;v_product_name text;v_unit_price numeric(12,2);v_delivery_zone public.restaurant_delivery_zones%rowtype;v_pickup_method text;v_cash_on_delivery_enabled boolean;
begin
 if p_restaurant_id is null then raise exception 'Restaurant is required';end if;
 if length(trim(coalesce(p_customer_name,'')))=0 then raise exception 'Customer name is required';end if;
 if p_order_type not in ('delivery','pickup','dine_in') then raise exception 'Invalid order type';end if;
 if p_order_type<>'dine_in' and length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required';end if;
 if p_payment_method not in ('cash','gcash') then raise exception 'Invalid payment method';end if;
 select cash_on_delivery_enabled into v_cash_on_delivery_enabled from public.restaurants where id=p_restaurant_id and is_active=true;
 if not found then raise exception 'Restaurant is not available';end if;
 if p_order_type='delivery' and p_payment_method='cash' and not coalesce(v_cash_on_delivery_enabled,false) then raise exception 'Cash on Delivery is currently unavailable. Please choose Online Payment.';end if;
 if coalesce(p_is_third_party_courier,false) and p_order_type<>'pickup' then raise exception 'Third-party courier orders must use pickup order type';end if;
 v_pickup_method:=case when p_order_type='pickup' and coalesce(p_is_third_party_courier,false) then 'third_party_courier' when p_order_type='pickup' then 'customer' else null end;
 if p_order_type='delivery' then
  if length(trim(coalesce(p_delivery_city,'')))=0 then raise exception 'Delivery city is required';end if;
  if length(trim(coalesce(p_delivery_barangay,'')))=0 then raise exception 'Delivery barangay is required';end if;
  if length(trim(coalesce(p_delivery_address,'')))=0 then raise exception 'Delivery address is required';end if;
  select * into v_delivery_zone from public.restaurant_delivery_zones where restaurant_id=p_restaurant_id and lower(trim(city))=lower(trim(p_delivery_city)) and lower(trim(barangay))=lower(trim(p_delivery_barangay));
  if not found then raise exception 'Please select a barangay within the restaurant''s delivery areas';end if;
  if not v_delivery_zone.is_supported then raise exception '%',coalesce(nullif(trim(v_delivery_zone.out_of_scope_message),''),'This area is outside our delivery coverage.');end if;
  v_delivery_fee:=round(v_delivery_zone.shipping_fee,2);
 end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one item is required';end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_product_id:=(v_item->>'product_id')::uuid;v_quantity:=(v_item->>'quantity')::integer;
  if v_quantity is null or v_quantity<1 or v_quantity>99 then raise exception 'Invalid item quantity';end if;
  select name,price into v_product_name,v_unit_price from public.products where id=v_product_id and restaurant_id=p_restaurant_id and is_available=true;
  if not found then raise exception 'One or more selected products are no longer available';end if;
  v_subtotal:=v_subtotal+round(v_unit_price*v_quantity,2);
 end loop;
 v_order_number:='ORD-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 insert into public.orders(restaurant_id,order_number,customer_name,mobile_number,order_type,delivery_city,delivery_barangay,delivery_address,notes,payment_method,payment_status,status,subtotal,delivery_fee,total,pickup_method)
 values(p_restaurant_id,v_order_number,trim(p_customer_name),trim(coalesce(p_mobile_number,'')),p_order_type,nullif(trim(coalesce(p_delivery_city,'')),''),nullif(trim(coalesce(p_delivery_barangay,'')),''),nullif(trim(coalesce(p_delivery_address,'')),''),trim(coalesce(p_notes,'')),p_payment_method,'pending','pending',v_subtotal,v_delivery_fee,v_subtotal+v_delivery_fee,v_pickup_method) returning id into v_order_id;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_product_id:=(v_item->>'product_id')::uuid;v_quantity:=(v_item->>'quantity')::integer;
  select name,price into v_product_name,v_unit_price from public.products where id=v_product_id and restaurant_id=p_restaurant_id and is_available=true;
  insert into public.order_items(order_id,product_id,product_name,unit_price,quantity,line_total) values(v_order_id,v_product_id,v_product_name,v_unit_price,v_quantity,round(v_unit_price*v_quantity,2));
 end loop;
 return query select v_order_id,v_order_number,v_subtotal,v_delivery_fee,v_subtotal+v_delivery_fee;
end;$function$
;
grant execute on function public.create_order(uuid,text,text,text,text,text,text,text,text,boolean,jsonb) to anon, authenticated;

drop function if exists public.create_pending_online_payment(uuid,text,text,text,text,text,text,boolean,jsonb,boolean);
CREATE OR REPLACE FUNCTION public.create_pending_online_payment(p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_order_type text, p_delivery_city text, p_delivery_barangay text, p_delivery_address text, p_notes text, p_is_third_party_courier boolean, p_items jsonb, p_redeem_loyalty boolean DEFAULT false)
 RETURNS TABLE(payment_id uuid, reference_number text, subtotal numeric, delivery_fee numeric, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_payment_id uuid;v_reference_number text;v_subtotal numeric(12,2):=0;v_delivery_fee numeric(12,2):=0;v_item jsonb;v_product_id uuid;v_quantity integer;v_product_name text;v_unit_price numeric(12,2);v_delivery_zone public.restaurant_delivery_zones%rowtype;v_pickup_point text;v_items jsonb:='[]'::jsonb;v_customer public.customer_profiles%rowtype;v_restaurant public.restaurants%rowtype;v_account public.customer_loyalty_accounts%rowtype;v_discount numeric(12,2):=0;
begin
 if p_restaurant_id is null then raise exception 'Restaurant is required';end if;
 if length(trim(coalesce(p_customer_name,'')))=0 then raise exception 'Customer name is required';end if;
 if p_order_type not in ('delivery','pickup','dine_in') then raise exception 'Invalid order type';end if;
 if p_order_type<>'dine_in' and length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required';end if;
 if p_is_third_party_courier and p_order_type<>'delivery' then raise exception 'Third-party courier delivery requires delivery order type';end if;
 if p_order_type='delivery' then
  if p_is_third_party_courier then
   select trim(coalesce(location_text,'')) into v_pickup_point from public.restaurants where id=p_restaurant_id and is_active=true;
   if length(coalesce(v_pickup_point,''))=0 then raise exception 'The restaurant pickup address is not configured yet';end if;
   p_delivery_address:=v_pickup_point;p_delivery_city:=null;p_delivery_barangay:=null;
  else
   if length(trim(coalesce(p_delivery_city,'')))=0 then raise exception 'Delivery city is required';end if;
   if length(trim(coalesce(p_delivery_barangay,'')))=0 then raise exception 'Delivery barangay is required';end if;
   if length(trim(coalesce(p_delivery_address,'')))=0 then raise exception 'Delivery address is required';end if;
   select * into v_delivery_zone from public.restaurant_delivery_zones where restaurant_id=p_restaurant_id and lower(trim(city))=lower(trim(p_delivery_city)) and lower(trim(barangay))=lower(trim(p_delivery_barangay));
   if not found then raise exception 'Please select a barangay within the restaurant''s delivery areas';end if;
   if not v_delivery_zone.is_supported then raise exception '%',coalesce(nullif(trim(v_delivery_zone.out_of_scope_message),''),'This area is outside our delivery coverage.');end if;
   v_delivery_fee:=round(v_delivery_zone.shipping_fee,2);
  end if;
 end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one item is required';end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_product_id:=(v_item->>'product_id')::uuid;v_quantity:=(v_item->>'quantity')::integer;
  if v_quantity is null or v_quantity<1 or v_quantity>99 then raise exception 'Invalid item quantity';end if;
  select name,price into v_product_name,v_unit_price from public.products where id=v_product_id and restaurant_id=p_restaurant_id and is_available=true;
  if not found then raise exception 'One or more selected products are no longer available';end if;
  v_subtotal:=v_subtotal+round(v_unit_price*v_quantity,2);
  v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',v_product_id,'product_name',v_product_name,'unit_price',v_unit_price,'quantity',v_quantity,'line_total',round(v_unit_price*v_quantity,2)));
 end loop;
 if p_redeem_loyalty then
  if auth.uid() is null then raise exception 'You must be signed in to redeem loyalty points';end if;
  select * into v_restaurant from public.restaurants where id=p_restaurant_id and is_active=true;
  if not found or not v_restaurant.loyalty_redemption_enabled then raise exception 'Loyalty redemption is disabled';end if;
  select * into v_customer from public.customer_profiles where restaurant_id=p_restaurant_id and auth_user_id=auth.uid() limit 1;
  if not found then raise exception 'Customer account not found for this restaurant';end if;
  select * into v_account from public.customer_loyalty_accounts where customer_id=v_customer.id for update;
  if not found then raise exception 'Customer loyalty account not found';end if;
  if v_account.points_balance<v_restaurant.loyalty_redemption_points then raise exception 'Customer does not have enough loyalty points';end if;
  v_discount:=least(round(v_restaurant.loyalty_redemption_amount,2),greatest(round(v_subtotal,2),0));
  if v_discount<=0 then raise exception 'This order has no amount available for redemption';end if;
 end if;
 v_reference_number:='PAY-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
 insert into public.pending_online_payments(restaurant_id,reference_number,customer_name,mobile_number,order_type,delivery_city,delivery_barangay,delivery_address,notes,is_third_party_courier,items,subtotal,delivery_fee,total,customer_id,loyalty_points_redeemed,loyalty_discount_amount)
 values(p_restaurant_id,v_reference_number,trim(p_customer_name),trim(coalesce(p_mobile_number,'')),p_order_type,nullif(trim(coalesce(p_delivery_city,'')),''),nullif(trim(coalesce(p_delivery_barangay,'')),''),nullif(trim(coalesce(p_delivery_address,'')),''),trim(coalesce(p_notes,'')),coalesce(p_is_third_party_courier,false),v_items,v_subtotal,v_delivery_fee,greatest(round(v_subtotal+v_delivery_fee-v_discount,2),0),case when p_redeem_loyalty then v_customer.id else null end,case when p_redeem_loyalty then v_restaurant.loyalty_redemption_points else 0 end,v_discount) returning id into v_payment_id;
 return query select v_payment_id,v_reference_number,v_subtotal,v_delivery_fee,greatest(round(v_subtotal+v_delivery_fee-v_discount,2),0);
end;$function$
;
grant execute on function public.create_pending_online_payment(uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean) to anon, authenticated;

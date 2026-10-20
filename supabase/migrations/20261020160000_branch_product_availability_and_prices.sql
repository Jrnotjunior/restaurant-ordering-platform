-- Per-branch catalog availability and pricing. Missing branch overrides inherit the
-- existing restaurant catalog, keeping all current branches backward compatible.

CREATE UNIQUE INDEX IF NOT EXISTS products_id_restaurant_id_unique_idx
  ON public.products(id, restaurant_id);

CREATE TABLE IF NOT EXISTS public.restaurant_branch_product_settings (
  restaurant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  price_override numeric(12,2) NULL CHECK (price_override IS NULL OR price_override >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, product_id),
  CONSTRAINT restaurant_branch_product_settings_branch_fk
    FOREIGN KEY (branch_id, restaurant_id)
    REFERENCES public.restaurant_branches(id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT restaurant_branch_product_settings_product_fk
    FOREIGN KEY (product_id, restaurant_id)
    REFERENCES public.products(id, restaurant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS restaurant_branch_product_settings_restaurant_branch_idx
  ON public.restaurant_branch_product_settings(restaurant_id, branch_id);

ALTER TABLE public.restaurant_branch_product_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS restaurant_branch_product_settings_public_read
  ON public.restaurant_branch_product_settings;
CREATE POLICY restaurant_branch_product_settings_public_read
  ON public.restaurant_branch_product_settings
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.restaurant_branches b
      JOIN public.restaurants r ON r.id = b.restaurant_id
      WHERE b.id = restaurant_branch_product_settings.branch_id
        AND b.restaurant_id = restaurant_branch_product_settings.restaurant_id
        AND b.is_active = true AND r.is_active = true
    )
  );
REVOKE ALL ON public.restaurant_branch_product_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.restaurant_branch_product_settings TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_effective_restaurant_branch_id(p_restaurant_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_configured text;
  v_branch_id uuid;
BEGIN
  IF p_restaurant_id IS NULL THEN RAISE EXCEPTION 'Restaurant is required'; END IF;
  v_configured := nullif(current_setting('web2table.branch_id', true), '');
  IF v_configured IS NOT NULL THEN
    BEGIN
      v_branch_id := v_configured::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid branch context';
    END;
    IF NOT EXISTS (
      SELECT 1 FROM public.restaurant_branches b
      JOIN public.restaurants r ON r.id = b.restaurant_id
      WHERE b.id = v_branch_id AND b.restaurant_id = p_restaurant_id
        AND b.is_active = true AND r.is_active = true
    ) THEN
      RAISE EXCEPTION 'Selected branch does not belong to this active restaurant';
    END IF;
    RETURN v_branch_id;
  END IF;
  SELECT b.id INTO v_branch_id
  FROM public.restaurant_branches b
  JOIN public.restaurants r ON r.id = b.restaurant_id
  WHERE b.restaurant_id = p_restaurant_id AND b.is_default = true
    AND b.is_active = true AND r.is_active = true
  LIMIT 1;
  IF v_branch_id IS NULL THEN RAISE EXCEPTION 'The restaurant has no active default branch configured'; END IF;
  RETURN v_branch_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_effective_restaurant_branch_id(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_restaurant_branch_product_settings(
  p_restaurant_id uuid, p_branch_id uuid, p_product_id uuid,
  p_is_available boolean, p_price_override numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.privileged_restaurant_mfa_verified() THEN
    RAISE EXCEPTION 'A verified restaurant owner session is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = p_restaurant_id AND r.owner_id = auth.uid() AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'You do not have permission to manage this restaurant catalog';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_branches b
    WHERE b.id = p_branch_id AND b.restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Selected branch does not belong to this restaurant';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_product_id AND p.restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Selected product does not belong to this restaurant';
  END IF;
  IF p_price_override IS NOT NULL AND p_price_override < 0 THEN
    RAISE EXCEPTION 'Branch price cannot be negative';
  END IF;
  INSERT INTO public.restaurant_branch_product_settings (
    restaurant_id, branch_id, product_id, is_available, price_override, updated_at
  ) VALUES (
    p_restaurant_id, p_branch_id, p_product_id, coalesce(p_is_available, true), p_price_override, now()
  )
  ON CONFLICT (branch_id, product_id) DO UPDATE
  SET restaurant_id = EXCLUDED.restaurant_id, is_available = EXCLUDED.is_available,
      price_override = EXCLUDED.price_override, updated_at = now();
END;
$function$;
REVOKE ALL ON FUNCTION public.set_restaurant_branch_product_settings(uuid, uuid, uuid, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_restaurant_branch_product_settings(uuid, uuid, uuid, boolean, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_order(p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_order_type text, p_delivery_city text, p_delivery_barangay text, p_delivery_address text, p_notes text, p_payment_method text, p_is_third_party_courier boolean, p_items jsonb)
 RETURNS TABLE(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_order_id uuid;
 v_order_number text;
 v_subtotal numeric(12,2):=0;
 v_delivery_fee numeric(12,2):=0;
 v_item jsonb;
 v_product_id uuid;
 v_quantity integer;
 v_product_name text;
 v_unit_price numeric(12,2);
 v_pickup_method text;
 v_cash_on_delivery_enabled boolean;
 v_pickup_point text;
 v_branch_id uuid;
begin
 v_branch_id := public.get_effective_restaurant_branch_id(p_restaurant_id);
 if p_restaurant_id is null then raise exception 'Restaurant is required'; end if;
 if length(trim(coalesce(p_customer_name,'')))=0 then raise exception 'Customer name is required'; end if;
 if p_order_type is null or p_order_type not in ('delivery','take_out','pickup','dine_in') then raise exception 'Invalid order type'; end if;
 if p_order_type not in ('dine_in','take_out') and length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required'; end if;
 if p_payment_method is null or p_payment_method not in ('cash','gcash') then raise exception 'Invalid payment method'; end if;

 select cash_on_delivery_enabled into v_cash_on_delivery_enabled
 from public.restaurants
 where id=p_restaurant_id and is_active=true;

 if not found then raise exception 'Restaurant is not available'; end if;

 if p_order_type='delivery' and p_payment_method='cash'
    and not coalesce(v_cash_on_delivery_enabled,false) then
   raise exception 'Cash on Delivery is currently unavailable. Please choose Online Payment.';
 end if;

 if coalesce(p_is_third_party_courier,false) and p_order_type<>'pickup' then
   raise exception 'Third-party courier orders must use pickup order type';
 end if;

 v_pickup_method:=case
   when p_order_type='pickup' and coalesce(p_is_third_party_courier,false) then 'third_party_courier'
   when p_order_type='pickup' then 'customer'
   else null
 end;

 if p_order_type='pickup' then
   select trim(coalesce(store_address,'')) into v_pickup_point
   from public.restaurants
   where id=p_restaurant_id and is_active=true;

   if length(coalesce(v_pickup_point,''))=0 then
     raise exception 'The restaurant pickup address is not configured yet';
   end if;
 end if;

 if p_order_type='delivery' then
   if length(trim(coalesce(p_delivery_city,'')))=0 then raise exception 'Delivery city is required'; end if;
   if length(trim(coalesce(p_delivery_barangay,'')))=0 then raise exception 'Delivery barangay is required'; end if;
   if length(trim(coalesce(p_delivery_address,'')))=0 then raise exception 'Delivery address is required'; end if;
 end if;

 if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
   raise exception 'At least one item is required';
 end if;

 for v_item in select value from jsonb_array_elements(p_items) loop
   v_product_id:=(v_item->>'product_id')::uuid;
   v_quantity:=(v_item->>'quantity')::integer;

   if v_quantity is null or v_quantity<1 or v_quantity>99 then
     raise exception 'Invalid item quantity';
   end if;

   select p.name, coalesce(s.price_override, p.price)
      into v_product_name, v_unit_price
    from public.products p
    left join public.restaurant_branch_product_settings s
      on s.restaurant_id = p.restaurant_id
     and s.product_id = p.id
     and s.branch_id = v_branch_id
    where p.id = v_product_id
      and p.restaurant_id = p_restaurant_id
      and p.is_available = true
      and coalesce(s.is_available, true) = true;

   if not found then
     raise exception 'One or more selected products are no longer available';
   end if;

   v_subtotal:=v_subtotal+round(v_unit_price*v_quantity,2);
 end loop;

 v_order_number:=public.next_restaurant_order_number(p_restaurant_id);

 insert into public.orders(
   restaurant_id,order_number,customer_name,mobile_number,order_type,
   delivery_city,delivery_barangay,delivery_address,notes,payment_method,
   payment_status,status,subtotal,delivery_fee,total,pickup_method
 )
 values(
   p_restaurant_id,v_order_number,trim(p_customer_name),
   trim(coalesce(p_mobile_number,'')),p_order_type,
   nullif(trim(coalesce(p_delivery_city,'')), ''),
   nullif(trim(coalesce(p_delivery_barangay,'')), ''),
   case when p_order_type='pickup' then v_pickup_point
        else nullif(trim(coalesce(p_delivery_address,'')),'') end,
   trim(coalesce(p_notes,'')),p_payment_method,'pending','pending',
   v_subtotal,v_delivery_fee,v_subtotal+v_delivery_fee,v_pickup_method
 )
 returning id into v_order_id;

 for v_item in select value from jsonb_array_elements(p_items) loop
   v_product_id:=(v_item->>'product_id')::uuid;
   v_quantity:=(v_item->>'quantity')::integer;

   select p.name, coalesce(s.price_override, p.price)
      into v_product_name, v_unit_price
    from public.products p
    left join public.restaurant_branch_product_settings s
      on s.restaurant_id = p.restaurant_id
     and s.product_id = p.id
     and s.branch_id = v_branch_id
    where p.id = v_product_id
      and p.restaurant_id = p_restaurant_id
      and p.is_available = true
      and coalesce(s.is_available, true) = true;

   insert into public.order_items(
     order_id,product_id,product_name,unit_price,quantity,line_total
   )
   values(
     v_order_id,v_product_id,v_product_name,v_unit_price,
     v_quantity,round(v_unit_price*v_quantity,2)
   );
 end loop;

 return query
 select v_order_id,v_order_number,v_subtotal,v_delivery_fee,v_subtotal+v_delivery_fee;
end;
$function$

CREATE OR REPLACE FUNCTION public.create_order_from_delivery_quote(p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_delivery_city text, p_delivery_barangay text, p_delivery_address text, p_notes text, p_payment_method text, p_items jsonb, p_customer_delivery_address text, p_customer_delivery_city text, p_customer_delivery_barangay text, p_customer_delivery_latitude double precision, p_customer_delivery_longitude double precision, p_customer_delivery_place_id text, p_delivery_quote_id uuid)
 RETURNS TABLE(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(12,2) := 0;
  v_delivery_fee numeric(12,2);
  v_distance integer;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_product_name text;
  v_unit_price numeric(12,2);
  v_quote public.delivery_quotes%rowtype;
  v_cash_on_delivery_enabled boolean;
 v_branch_id uuid;
begin
 v_branch_id := public.get_effective_restaurant_branch_id(p_restaurant_id);
  if p_restaurant_id is null then raise exception 'Restaurant is required'; end if;
  if length(trim(coalesce(p_customer_name,'')))=0 then raise exception 'Customer name is required'; end if;
  if length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required'; end if;
  if p_payment_method is null or p_payment_method not in ('cash','gcash') then raise exception 'Invalid payment method'; end if;
  if length(trim(coalesce(p_delivery_city,'')))=0 or length(trim(coalesce(p_delivery_barangay,'')))=0 or length(trim(coalesce(p_delivery_address,'')))=0 then raise exception 'Complete delivery address is required'; end if;
  if p_customer_delivery_latitude is null or p_customer_delivery_longitude is null then raise exception 'A confirmed delivery map location is required'; end if;

  select cash_on_delivery_enabled into v_cash_on_delivery_enabled from public.restaurants where id=p_restaurant_id and is_active=true;
  if not found then raise exception 'Restaurant is not available'; end if;
  if p_payment_method='cash' and not coalesce(v_cash_on_delivery_enabled,false) then raise exception 'Cash on Delivery is currently unavailable. Please choose Online Payment.'; end if;

  select * into v_quote from public.delivery_quotes where id=p_delivery_quote_id and restaurant_id=p_restaurant_id for update;
  if not found or v_quote.consumed_at is not null or v_quote.expires_at <= now() then raise exception 'Delivery location confirmation expired. Please confirm your location again.'; end if;
  if v_quote.branch_id is distinct from v_branch_id then raise exception 'Delivery quote belongs to a different branch'; end if;
  if abs(v_quote.customer_latitude-p_customer_delivery_latitude)>0.00001 or abs(v_quote.customer_longitude-p_customer_delivery_longitude)>0.00001 then raise exception 'The delivery location changed. Please confirm the location again.'; end if;
  v_distance := v_quote.distance_meters;
  v_delivery_fee := v_quote.delivery_fee;
  update public.delivery_quotes set consumed_at=now() where id=v_quote.id;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one item is required'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity<1 or v_quantity>99 then raise exception 'Invalid item quantity'; end if;
    select p.name, coalesce(s.price_override, p.price)
      into v_product_name, v_unit_price
    from public.products p
    left join public.restaurant_branch_product_settings s
      on s.restaurant_id = p.restaurant_id
     and s.product_id = p.id
     and s.branch_id = v_branch_id
    where p.id = v_product_id
      and p.restaurant_id = p_restaurant_id
      and p.is_available = true
      and coalesce(s.is_available, true) = true;
    if not found then raise exception 'One or more selected products are no longer available'; end if;
    v_subtotal := v_subtotal + round(v_unit_price*v_quantity,2);
  end loop;

  v_order_number := public.next_restaurant_order_number(p_restaurant_id);

  insert into public.orders(
    restaurant_id,order_number,customer_name,mobile_number,order_type,delivery_city,delivery_barangay,delivery_address,
    customer_delivery_address,customer_delivery_city,customer_delivery_barangay,customer_delivery_latitude,customer_delivery_longitude,customer_delivery_place_id,
    delivery_distance_meters,delivery_quote_id,notes,payment_method,payment_status,status,subtotal,delivery_fee,total,pickup_method
  )
  values(
    p_restaurant_id,v_order_number,trim(p_customer_name),trim(p_mobile_number),'delivery',
    nullif(trim(p_delivery_city),''),nullif(trim(p_delivery_barangay),''),nullif(trim(p_delivery_address),''),
    nullif(trim(p_customer_delivery_address),''),nullif(trim(p_customer_delivery_city),''),nullif(trim(p_customer_delivery_barangay),''),
    p_customer_delivery_latitude,p_customer_delivery_longitude,nullif(trim(p_customer_delivery_place_id),''),
    v_distance,v_quote.id,trim(coalesce(p_notes,'')) ,p_payment_method,'pending','pending',v_subtotal,v_delivery_fee,v_subtotal+v_delivery_fee,null
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    select p.name, coalesce(s.price_override, p.price)
      into v_product_name, v_unit_price
    from public.products p
    left join public.restaurant_branch_product_settings s
      on s.restaurant_id = p.restaurant_id
     and s.product_id = p.id
     and s.branch_id = v_branch_id
    where p.id = v_product_id
      and p.restaurant_id = p_restaurant_id
      and p.is_available = true
      and coalesce(s.is_available, true) = true;
    insert into public.order_items(order_id,product_id,product_name,unit_price,quantity,line_total)
    values(v_order_id,v_product_id,v_product_name,v_unit_price, v_quantity, round(v_unit_price*v_quantity,2));
  end loop;

  return query select v_order_id,v_order_number,v_subtotal,v_delivery_fee,v_subtotal+v_delivery_fee;
end;
$function$

CREATE OR REPLACE FUNCTION public.create_pending_online_payment(p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_order_type text, p_delivery_city text, p_delivery_barangay text, p_delivery_address text, p_notes text, p_is_third_party_courier boolean, p_items jsonb, p_redeem_loyalty boolean DEFAULT false)
 RETURNS TABLE(payment_id uuid, reference_number text, subtotal numeric, delivery_fee numeric, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_payment_id uuid; v_reference_number text; v_subtotal numeric(12,2):=0; v_discount numeric(12,2):=0;
 v_item jsonb; v_product_id uuid; v_quantity integer; v_product_name text; v_unit_price numeric(12,2);
 v_items jsonb:='[]'::jsonb; v_customer public.customer_profiles%rowtype;
 v_restaurant public.restaurants%rowtype; v_account public.customer_loyalty_accounts%rowtype; v_pickup_point text;
 v_branch_id uuid;
begin
 v_branch_id := public.get_effective_restaurant_branch_id(p_restaurant_id);
 if p_restaurant_id is null then raise exception 'Restaurant is required'; end if;
 if length(trim(coalesce(p_customer_name,'')))=0 then raise exception 'Customer name is required'; end if;
 if p_order_type is null or p_order_type not in ('take_out','pickup','dine_in') then raise exception 'Delivery payments must use the delivery quote payment flow'; end if;
 -- Take-out and dine-in intentionally do not require a mobile number.
 if p_order_type not in ('dine_in','take_out') and length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required'; end if;
 if p_is_third_party_courier and p_order_type<>'pickup' then raise exception 'Third-party courier orders must use pickup order type'; end if;

 if p_order_type='pickup' then
   select trim(coalesce(store_address,'')) into v_pickup_point from public.restaurants where id=p_restaurant_id and is_active=true;
   if length(coalesce(v_pickup_point,''))=0 then raise exception 'The restaurant pickup address is not configured yet'; end if;
 end if;

 if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one item is required'; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
   v_product_id:=(v_item->>'product_id')::uuid; v_quantity:=(v_item->>'quantity')::integer;
   if v_quantity is null or v_quantity<1 or v_quantity>99 then raise exception 'Invalid item quantity'; end if;
   select p.name, coalesce(s.price_override, p.price)
      into v_product_name, v_unit_price
    from public.products p
    left join public.restaurant_branch_product_settings s
      on s.restaurant_id = p.restaurant_id
     and s.product_id = p.id
     and s.branch_id = v_branch_id
    where p.id = v_product_id
      and p.restaurant_id = p_restaurant_id
      and p.is_available = true
      and coalesce(s.is_available, true) = true;
   if not found then raise exception 'One or more selected products are no longer available'; end if;
   v_subtotal:=v_subtotal+round(v_unit_price*v_quantity,2);
   v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',v_product_id,'product_name',v_product_name,'unit_price',v_unit_price,'quantity',v_quantity,'line_total',round(v_unit_price*v_quantity,2)));
 end loop;

 if p_redeem_loyalty then
   if auth.uid() is null then raise exception 'You must be signed in to redeem loyalty points'; end if;
   select * into v_restaurant from public.restaurants where id=p_restaurant_id and is_active=true;
   if not found or not v_restaurant.loyalty_redemption_enabled then raise exception 'Loyalty redemption is disabled'; end if;
   select * into v_customer from public.customer_profiles where restaurant_id=p_restaurant_id and auth_user_id=auth.uid() limit 1;
   if not found then raise exception 'Customer account not found for this restaurant'; end if;
   select * into v_account from public.customer_loyalty_accounts where customer_id=v_customer.id for update;
   if not found then raise exception 'Customer loyalty account not found'; end if;
   if v_account.points_balance<v_restaurant.loyalty_redemption_points then raise exception 'Customer does not have enough loyalty points'; end if;
   v_discount:=least(round(v_restaurant.loyalty_redemption_amount,2),v_subtotal);
 end if;

 v_reference_number:='PAY-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,32));
 insert into public.pending_online_payments(
   restaurant_id,reference_number,customer_name,mobile_number,order_type,delivery_city,delivery_barangay,delivery_address,notes,is_third_party_courier,items,subtotal,delivery_fee,total,customer_id,loyalty_points_redeemed,loyalty_discount_amount,
   customer_delivery_address,customer_delivery_city,customer_delivery_barangay,customer_delivery_latitude,customer_delivery_longitude,customer_delivery_place_id
 ) values(
   p_restaurant_id,v_reference_number,trim(p_customer_name),trim(coalesce(p_mobile_number,'')),p_order_type,
   null,null,case when p_order_type='pickup' then v_pickup_point else null end,trim(coalesce(p_notes,'')),coalesce(p_is_third_party_courier,false),v_items,v_subtotal,0,greatest(round(v_subtotal-v_discount,2),0),
   case when p_redeem_loyalty then v_customer.id else null end,case when p_redeem_loyalty then v_restaurant.loyalty_redemption_points else 0 end,v_discount,null,null,null,null,null,null
 ) returning id into v_payment_id;

 return query select v_payment_id,v_reference_number,v_subtotal,0::numeric,greatest(round(v_subtotal-v_discount,2),0);
end;
$function$

CREATE OR REPLACE FUNCTION public.create_pending_online_payment(p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_order_type text, p_delivery_city text, p_delivery_barangay text, p_delivery_address text, p_notes text, p_is_third_party_courier boolean, p_items jsonb, p_redeem_loyalty boolean, p_customer_delivery_address text, p_customer_delivery_city text, p_customer_delivery_barangay text, p_customer_delivery_latitude double precision, p_customer_delivery_longitude double precision, p_customer_delivery_place_id text)
 RETURNS TABLE(payment_id uuid, reference_number text, subtotal numeric, delivery_fee numeric, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_payment_id uuid;v_reference_number text;v_subtotal numeric(12,2):=0;v_delivery_fee numeric(12,2):=0;v_total numeric(12,2):=0;
 v_item jsonb;v_product_id uuid;v_quantity integer;v_product_name text;v_unit_price numeric(12,2);v_items jsonb:='[]'::jsonb;
 v_customer public.customer_profiles%rowtype;v_restaurant public.restaurants%rowtype;v_account public.customer_loyalty_accounts%rowtype;v_discount numeric(12,2):=0;v_pickup_point text;
 v_branch_id uuid;
begin
 v_branch_id := public.get_effective_restaurant_branch_id(p_restaurant_id);
 if p_order_type='delivery' then
   if p_customer_delivery_latitude is null or p_customer_delivery_longitude is null then raise exception 'A delivery map location is required'; end if;
   if p_customer_delivery_latitude not between -90 and 90 or p_customer_delivery_longitude not between -180 and 180 then raise exception 'Invalid delivery map coordinates'; end if;
   if length(trim(coalesce(p_customer_delivery_address,'')))=0 or length(trim(coalesce(p_customer_delivery_city,'')))=0 or length(trim(coalesce(p_customer_delivery_barangay,'')))=0 then raise exception 'Complete customer delivery address is required'; end if;
 end if;

 if p_order_type='pickup' and coalesce(p_is_third_party_courier,false) then
   select trim(coalesce(store_address,'')) into v_pickup_point from public.restaurants where id=p_restaurant_id and is_active=true;
   if length(coalesce(v_pickup_point,''))=0 then raise exception 'The restaurant pickup address is not configured yet'; end if;
   if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one item is required'; end if;
   for v_item in select value from jsonb_array_elements(p_items) loop
     v_product_id:=(v_item->>'product_id')::uuid;v_quantity:=(v_item->>'quantity')::integer;
     if v_quantity is null or v_quantity<1 or v_quantity>99 then raise exception 'Invalid item quantity'; end if;
     select p.name, coalesce(s.price_override, p.price)
      into v_product_name, v_unit_price
    from public.products p
    left join public.restaurant_branch_product_settings s
      on s.restaurant_id = p.restaurant_id
     and s.product_id = p.id
     and s.branch_id = v_branch_id
    where p.id = v_product_id
      and p.restaurant_id = p_restaurant_id
      and p.is_available = true
      and coalesce(s.is_available, true) = true;
     if not found then raise exception 'One or more selected products are no longer available'; end if;
     v_subtotal:=v_subtotal+round(v_unit_price*v_quantity,2);
     v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',v_product_id,'product_name',v_product_name,'unit_price',v_unit_price,'quantity',v_quantity,'line_total',round(v_unit_price*v_quantity,2)));
   end loop;
   if p_redeem_loyalty then
     if auth.uid() is null then raise exception 'You must be signed in to redeem loyalty points'; end if;
     select * into v_restaurant from public.restaurants where id=p_restaurant_id and is_active=true;
     if not found or not v_restaurant.loyalty_redemption_enabled then raise exception 'Loyalty redemption is disabled'; end if;
     select * into v_customer from public.customer_profiles where restaurant_id=p_restaurant_id and auth_user_id=auth.uid() limit 1;
     if not found then raise exception 'Customer account not found for this restaurant'; end if;
     select * into v_account from public.customer_loyalty_accounts where customer_id=v_customer.id for update;
     if not found then raise exception 'Customer loyalty account not found'; end if;
     if v_account.points_balance<v_restaurant.loyalty_redemption_points then raise exception 'Customer does not have enough loyalty points'; end if;
     v_discount:=least(round(v_restaurant.loyalty_redemption_amount,2),v_subtotal);
   end if;
   v_reference_number:='PAY-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,32));
   v_total:=greatest(round(v_subtotal-v_discount,2),0);
   insert into public.pending_online_payments(restaurant_id,reference_number,customer_name,mobile_number,order_type,delivery_city,delivery_barangay,delivery_address,notes,is_third_party_courier,items,subtotal,delivery_fee,total,customer_id,loyalty_points_redeemed,loyalty_discount_amount,customer_delivery_address,customer_delivery_city,customer_delivery_barangay,customer_delivery_latitude,customer_delivery_longitude,customer_delivery_place_id)
   values(p_restaurant_id,v_reference_number,trim(p_customer_name),trim(coalesce(p_mobile_number,'')),'pickup',null,null,v_pickup_point,trim(coalesce(p_notes,'')),true,v_items,v_subtotal,0,v_total,case when p_redeem_loyalty then v_customer.id else null end,case when p_redeem_loyalty then v_restaurant.loyalty_redemption_points else 0 end,v_discount,null,null,null,null,null,null)
   returning id into v_payment_id;
   return query select v_payment_id,v_reference_number,v_subtotal,0::numeric,v_total;
 end if;

 select r.payment_id,r.reference_number,r.subtotal,r.delivery_fee,r.total
 into v_payment_id,v_reference_number,v_subtotal,v_delivery_fee,v_total
 from public.create_pending_online_payment(p_restaurant_id,p_customer_name,p_mobile_number,p_order_type,p_delivery_city,p_delivery_barangay,p_delivery_address,p_notes,p_is_third_party_courier,p_items,p_redeem_loyalty) as r;
 update public.pending_online_payments
 set customer_delivery_address=case when p_order_type='delivery' then nullif(trim(p_customer_delivery_address),'') else null end,
 customer_delivery_city=case when p_order_type='delivery' then nullif(trim(p_customer_delivery_city),'') else null end,
 customer_delivery_barangay=case when p_order_type='delivery' then nullif(trim(p_customer_delivery_barangay),'') else null end,
 customer_delivery_latitude=case when p_order_type='delivery' then p_customer_delivery_latitude else null end,
 customer_delivery_longitude=case when p_order_type='delivery' then p_customer_delivery_longitude else null end,
 customer_delivery_place_id=case when p_order_type='delivery' then nullif(trim(p_customer_delivery_place_id),'') else null end,
 updated_at=now() where id=v_payment_id;
 return query select v_payment_id,v_reference_number,v_subtotal,v_delivery_fee,v_total;
end; $function$

CREATE OR REPLACE FUNCTION public.create_pending_online_payment_from_delivery_quote(p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_delivery_city text, p_delivery_barangay text, p_delivery_address text, p_notes text, p_items jsonb, p_redeem_loyalty boolean, p_customer_delivery_address text, p_customer_delivery_city text, p_customer_delivery_barangay text, p_customer_delivery_latitude double precision, p_customer_delivery_longitude double precision, p_customer_delivery_place_id text, p_delivery_quote_id uuid)
 RETURNS TABLE(payment_id uuid, reference_number text, subtotal numeric, delivery_fee numeric, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_payment_id uuid; v_reference_number text; v_subtotal numeric(12,2):=0; v_delivery_fee numeric(12,2); v_distance integer;
  v_item jsonb; v_product_id uuid; v_quantity integer; v_product_name text; v_unit_price numeric; v_items jsonb:='[]'::jsonb;
  v_customer public.customer_profiles%rowtype; v_restaurant public.restaurants%rowtype; v_account public.customer_loyalty_accounts%rowtype;
  v_discount numeric(12,2):=0; v_quote public.delivery_quotes%rowtype;
 v_branch_id uuid;
begin
 v_branch_id := public.get_effective_restaurant_branch_id(p_restaurant_id);
  if p_restaurant_id is null then raise exception 'Restaurant is required'; end if;
  if length(trim(coalesce(p_customer_name,'')))=0 then raise exception 'Customer name is required'; end if;
  if length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required'; end if;
  if length(trim(coalesce(p_delivery_city,'')))=0 or length(trim(coalesce(p_delivery_barangay,'')))=0 or length(trim(coalesce(p_delivery_address,'')))=0 then raise exception 'Complete delivery address is required'; end if;
  if p_customer_delivery_latitude is null or p_customer_delivery_longitude is null then raise exception 'A confirmed delivery map location is required'; end if;
  select * into v_restaurant from public.restaurants where id=p_restaurant_id and is_active=true;
  if not found then raise exception 'Restaurant is not available'; end if;
  select * into v_quote from public.delivery_quotes where id=p_delivery_quote_id and restaurant_id=p_restaurant_id for update;
  if not found or v_quote.consumed_at is not null or v_quote.expires_at <= now() then raise exception 'Delivery location confirmation expired or already used. Please confirm your location again.'; end if;
  if v_quote.branch_id is distinct from v_branch_id then raise exception 'Delivery quote belongs to a different branch'; end if;
  if abs(v_quote.customer_latitude-p_customer_delivery_latitude)>0.00001 or abs(v_quote.customer_longitude-p_customer_delivery_longitude)>0.00001 then raise exception 'The delivery location changed. Please confirm the location again.'; end if;
  update public.delivery_quotes set consumed_at=now() where id=v_quote.id; v_distance:=v_quote.distance_meters; v_delivery_fee:=v_quote.delivery_fee;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one item is required'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id:=(v_item->>'product_id')::uuid; v_quantity:=(v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity<1 or v_quantity>99 then raise exception 'Invalid item quantity'; end if;
    select p.name, coalesce(s.price_override, p.price)
      into v_product_name, v_unit_price
    from public.products p
    left join public.restaurant_branch_product_settings s
      on s.restaurant_id = p.restaurant_id
     and s.product_id = p.id
     and s.branch_id = v_branch_id
    where p.id = v_product_id
      and p.restaurant_id = p_restaurant_id
      and p.is_available = true
      and coalesce(s.is_available, true) = true;
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

  v_reference_number:='PAY-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,32));
  insert into public.pending_online_payments(
    restaurant_id,reference_number,customer_name,mobile_number,order_type,delivery_city,delivery_barangay,delivery_address,
    customer_delivery_address,customer_delivery_city,customer_delivery_barangay,customer_delivery_latitude,customer_delivery_longitude,customer_delivery_place_id,
    delivery_distance_meters,delivery_quote_id,notes,is_third_party_courier,items,subtotal,delivery_fee,total,customer_id,loyalty_points_redeemed,loyalty_discount_amount
  )
  values(
    p_restaurant_id,v_reference_number,trim(p_customer_name),trim(p_mobile_number),'delivery',
    nullif(trim(p_delivery_city),''),nullif(trim(p_delivery_barangay),''),nullif(trim(p_delivery_address),''),
    nullif(trim(p_customer_delivery_address),''),nullif(trim(p_customer_delivery_city),''),nullif(trim(p_customer_delivery_barangay),''),
    p_customer_delivery_latitude,p_customer_delivery_longitude,nullif(trim(p_customer_delivery_place_id),''),
    v_distance,v_quote.id,trim(coalesce(p_notes,'')),false,v_items,v_subtotal,v_delivery_fee,
    greatest(round(v_subtotal+v_delivery_fee-v_discount,2),0),
    case when p_redeem_loyalty then v_customer.id else null end,
    case when p_redeem_loyalty then v_restaurant.loyalty_redemption_points else 0 end,v_discount
  ) returning id into v_payment_id;
  return query select v_payment_id,v_reference_number,v_subtotal,v_delivery_fee,greatest(round(v_subtotal+v_delivery_fee-v_discount,2),0);
end; $function$

NOTIFY pgrst, 'reload schema';

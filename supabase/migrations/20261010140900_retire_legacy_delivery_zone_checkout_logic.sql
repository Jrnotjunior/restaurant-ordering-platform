-- Retire the legacy barangay-zone checkout dependency before later migrations
-- recompile older RPC bodies. Current public delivery checkout must use a
-- server-verified delivery quote; the non-quote RPCs remain only for pickup,
-- take-out and dine-in. This migration is intentionally guarded so it is safe
-- when an earlier migration has already installed the corrected definitions.

DO $migration$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_updated text;
  v_old_block text;
  v_new_block text;
BEGIN
  -- Base cash/guest order creation: never calculate standard delivery from the
  -- retired restaurant_delivery_zones table.
  v_signature := to_regprocedure(
    'public.create_order(uuid,text,text,text,text,text,text,text,text,boolean,jsonb)'
  );

  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'Expected base create_order function is missing';
  END IF;

  v_definition := pg_get_functiondef(v_signature);

  IF position('public.restaurant_delivery_zones' in v_definition) > 0 THEN
    v_updated := replace(
      v_definition,
      'v_delivery_zone public.restaurant_delivery_zones%rowtype;',
      ''
    );

    v_old_block := $old_order$
 if p_order_type='delivery' then
  if length(trim(coalesce(p_delivery_city,'')))=0 then raise exception 'Delivery city is required';end if;
  if length(trim(coalesce(p_delivery_barangay,'')))=0 then raise exception 'Delivery barangay is required';end if;
  if length(trim(coalesce(p_delivery_address,'')))=0 then raise exception 'Delivery address is required';end if;
  select * into v_delivery_zone from public.restaurant_delivery_zones where restaurant_id=p_restaurant_id and lower(trim(city))=lower(trim(p_delivery_city)) and lower(trim(barangay))=lower(trim(p_delivery_barangay));
  if not found then raise exception 'Please select a barangay within the restaurant''s delivery areas';end if;
  if not v_delivery_zone.is_supported then raise exception '%',coalesce(nullif(trim(v_delivery_zone.out_of_scope_message),''),'This area is outside our delivery coverage.');end if;
  v_delivery_fee:=round(v_delivery_zone.shipping_fee,2);
 end if;
$old_order$;

    v_new_block := $new_order$
 if p_order_type='delivery' then
  raise exception 'Standard delivery must use the confirmed delivery quote flow';
 end if;
$new_order$;

    IF position(v_old_block in v_updated) = 0 THEN
      RAISE EXCEPTION 'Could not locate expected legacy delivery-zone block in create_order';
    END IF;

    v_updated := replace(v_updated, v_old_block, v_new_block);

    IF v_updated = v_definition
       OR position('restaurant_delivery_zones' in v_updated) > 0 THEN
      RAISE EXCEPTION 'create_order migration did not fully remove legacy zone references';
    END IF;

    EXECUTE v_updated;
  END IF;

  -- Base online-payment staging: standard delivery is delegated to the
  -- quote-bound RPC. Pickup/courier, take-out and dine-in remain supported.
  v_signature := to_regprocedure(
    'public.create_pending_online_payment(uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean)'
  );

  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'Expected base create_pending_online_payment function is missing';
  END IF;

  v_definition := pg_get_functiondef(v_signature);

  IF position('public.restaurant_delivery_zones' in v_definition) > 0 THEN
    v_updated := replace(
      v_definition,
      'v_delivery_zone public.restaurant_delivery_zones%rowtype;',
      ''
    );

    -- The retired implementation required delivery in the base RPC. Route
    -- delivery elsewhere and preserve only the non-quote order types here.
    v_updated := replace(
      v_updated,
      $old_type_guard$if p_order_type not in ('delivery','pickup','dine_in') then raise exception 'Invalid order type';end if;$old_type_guard$,
      $new_type_guard$if p_order_type is null or p_order_type not in ('take_out','pickup','dine_in') then raise exception 'Delivery payments must use the delivery quote payment flow';end if;$new_type_guard$
    );

    v_updated := replace(
      v_updated,
      $old_courier_guard$if p_is_third_party_courier and p_order_type<>'delivery' then raise exception 'Third-party courier delivery requires delivery order type';end if;$old_courier_guard$,
      $new_courier_guard$if coalesce(p_is_third_party_courier,false) and p_order_type<>'pickup' then raise exception 'Third-party courier orders must use pickup order type';end if;$new_courier_guard$
    );

    v_old_block := $old_payment$
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
$old_payment$;

    v_new_block := $new_payment$
 if p_order_type='delivery' then
  raise exception 'Delivery payments must use the delivery quote payment flow';
 end if;
 if p_order_type='pickup' then
  select trim(coalesce(location_text,'')) into v_pickup_point
  from public.restaurants
  where id=p_restaurant_id and is_active=true;
  if length(coalesce(v_pickup_point,''))=0 then
   raise exception 'The restaurant pickup address is not configured yet';
  end if;
  if coalesce(p_is_third_party_courier,false) then
   p_delivery_address:=v_pickup_point;
   p_delivery_city:=null;
   p_delivery_barangay:=null;
  end if;
 end if;
$new_payment$;

    IF position(v_old_block in v_updated) = 0 THEN
      RAISE EXCEPTION 'Could not locate expected legacy delivery-zone block in create_pending_online_payment';
    END IF;

    v_updated := replace(v_updated, v_old_block, v_new_block);

    IF position('if p_order_type not in (''delivery'',''pickup'',''dine_in'')' in v_updated) > 0
       OR position('restaurant_delivery_zones' in v_updated) > 0 THEN
      RAISE EXCEPTION 'create_pending_online_payment migration did not fully remove legacy zone references';
    END IF;

    EXECUTE v_updated;
  END IF;
END;
$migration$;

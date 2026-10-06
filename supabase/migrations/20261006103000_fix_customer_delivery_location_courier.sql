create or replace function public.create_order(
  p_restaurant_id uuid,p_customer_name text,p_mobile_number text,p_order_type text,p_delivery_city text,p_delivery_barangay text,p_delivery_address text,p_notes text,p_payment_method text,p_is_third_party_courier boolean,p_items jsonb,
  p_customer_delivery_address text,p_customer_delivery_city text,p_customer_delivery_barangay text,p_customer_delivery_latitude double precision,p_customer_delivery_longitude double precision,p_customer_delivery_place_id text
)
returns table(order_id uuid,order_number text,subtotal numeric,delivery_fee numeric,total numeric)
language plpgsql security definer set search_path=public
as $$
declare v_order_id uuid; v_order_number text; v_subtotal numeric; v_delivery_fee numeric; v_total numeric;
begin
 if p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then
  if p_customer_delivery_latitude is null or p_customer_delivery_longitude is null then raise exception 'A delivery map location is required'; end if;
  if p_customer_delivery_latitude not between -90 and 90 or p_customer_delivery_longitude not between -180 and 180 then raise exception 'Invalid delivery map coordinates'; end if;
  if length(trim(coalesce(p_customer_delivery_address,'')))=0 or length(trim(coalesce(p_customer_delivery_city,'')))=0 or length(trim(coalesce(p_customer_delivery_barangay,'')))=0 then raise exception 'Complete customer delivery address is required'; end if;
 end if;
 select order_id,order_number,subtotal,delivery_fee,total into v_order_id,v_order_number,v_subtotal,v_delivery_fee,v_total
 from public.create_order(p_restaurant_id,p_customer_name,p_mobile_number,p_order_type,p_delivery_city,p_delivery_barangay,p_delivery_address,p_notes,p_payment_method,p_is_third_party_courier,p_items);
 update public.orders
 set customer_delivery_address=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then nullif(trim(p_customer_delivery_address),'') else null end,
     customer_delivery_city=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then nullif(trim(p_customer_delivery_city),'') else null end,
     customer_delivery_barangay=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then nullif(trim(p_customer_delivery_barangay),'') else null end,
     customer_delivery_latitude=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then p_customer_delivery_latitude else null end,
     customer_delivery_longitude=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then p_customer_delivery_longitude else null end,
     customer_delivery_place_id=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then nullif(trim(p_customer_delivery_place_id),'') else null end,
     updated_at=now()
 where id=v_order_id;
 return query select v_order_id,v_order_number,v_subtotal,v_delivery_fee,v_total;
end; $$;

create or replace function public.create_pending_online_payment(
  p_restaurant_id uuid,p_customer_name text,p_mobile_number text,p_order_type text,p_delivery_city text,p_delivery_barangay text,p_delivery_address text,p_notes text,p_is_third_party_courier boolean,p_items jsonb,p_redeem_loyalty boolean,
  p_customer_delivery_address text,p_customer_delivery_city text,p_customer_delivery_barangay text,p_customer_delivery_latitude double precision,p_customer_delivery_longitude double precision,p_customer_delivery_place_id text
)
returns table(payment_id uuid,reference_number text,subtotal numeric,delivery_fee numeric,total numeric)
language plpgsql security definer set search_path=public
as $$
declare v_payment_id uuid; v_reference_number text; v_subtotal numeric; v_delivery_fee numeric; v_total numeric;
begin
 if p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then
  if p_customer_delivery_latitude is null or p_customer_delivery_longitude is null then raise exception 'A delivery map location is required'; end if;
  if p_customer_delivery_latitude not between -90 and 90 or p_customer_delivery_longitude not between -180 and 180 then raise exception 'Invalid delivery map coordinates'; end if;
  if length(trim(coalesce(p_customer_delivery_address,'')))=0 or length(trim(coalesce(p_customer_delivery_city,'')))=0 or length(trim(coalesce(p_customer_delivery_barangay,'')))=0 then raise exception 'Complete customer delivery address is required'; end if;
 end if;
 select payment_id,reference_number,subtotal,delivery_fee,total into v_payment_id,v_reference_number,v_subtotal,v_delivery_fee,v_total
 from public.create_pending_online_payment(p_restaurant_id,p_customer_name,p_mobile_number,p_order_type,p_delivery_city,p_delivery_barangay,p_delivery_address,p_notes,p_is_third_party_courier,p_items,p_redeem_loyalty);
 update public.pending_online_payments
 set customer_delivery_address=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then nullif(trim(p_customer_delivery_address),'') else null end,
     customer_delivery_city=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then nullif(trim(p_customer_delivery_city),'') else null end,
     customer_delivery_barangay=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then nullif(trim(p_customer_delivery_barangay),'') else null end,
     customer_delivery_latitude=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then p_customer_delivery_latitude else null end,
     customer_delivery_longitude=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then p_customer_delivery_longitude else null end,
     customer_delivery_place_id=case when p_order_type='delivery' or coalesce(p_is_third_party_courier,false) then nullif(trim(p_customer_delivery_place_id),'') else null end,
     updated_at=now()
 where id=v_payment_id;
 return query select v_payment_id,v_reference_number,v_subtotal,v_delivery_fee,v_total;
end; $$;
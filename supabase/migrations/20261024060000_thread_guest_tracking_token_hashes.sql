-- Thread a dedicated guest tracking hash through existing guest-token checkout wrappers.
-- Existing signatures remain available; these overloads add one explicit hash argument.
-- Raw tracking tokens never enter SQL. Existing cancellation capability remains independent.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_order_with_guest_tracking_token(
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
  p_guest_cancel_token_hash text,
  p_guest_tracking_token_hash text
)
RETURNS TABLE(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_created record;
BEGIN
  IF p_guest_tracking_token_hash IS NULL OR p_guest_tracking_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A valid guest tracking token hash is required';
  END IF;

  SELECT * INTO v_created
  FROM public.create_order_with_guest_cancel_token(
    p_restaurant_id, p_customer_name, p_mobile_number, p_order_type,
    p_delivery_city, p_delivery_barangay, p_delivery_address, p_notes,
    p_payment_method, p_is_third_party_courier, p_items,
    p_customer_delivery_address, p_customer_delivery_city,
    p_customer_delivery_barangay, p_customer_delivery_latitude,
    p_customer_delivery_longitude, p_customer_delivery_place_id,
    p_guest_cancel_token_hash
  );

  UPDATE public.orders
     SET guest_tracking_token_hash = p_guest_tracking_token_hash
   WHERE id = v_created.order_id AND customer_id IS NULL;

  RETURN QUERY SELECT v_created.order_id, v_created.order_number,
                       v_created.subtotal, v_created.delivery_fee, v_created.total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_order_from_delivery_quote_with_guest_tracking_token(
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
  p_guest_cancel_token_hash text,
  p_guest_tracking_token_hash text
)
RETURNS TABLE(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_created record;
BEGIN
  IF p_guest_tracking_token_hash IS NULL OR p_guest_tracking_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A valid guest tracking token hash is required';
  END IF;

  SELECT * INTO v_created
  FROM public.create_order_from_delivery_quote_with_guest_cancel_token(
    p_restaurant_id, p_customer_name, p_mobile_number, p_delivery_city,
    p_delivery_barangay, p_delivery_address, p_notes, p_payment_method,
    p_items, p_customer_delivery_address, p_customer_delivery_city,
    p_customer_delivery_barangay, p_customer_delivery_latitude,
    p_customer_delivery_longitude, p_customer_delivery_place_id,
    p_delivery_quote_id, p_guest_cancel_token_hash
  );

  UPDATE public.orders
     SET guest_tracking_token_hash = p_guest_tracking_token_hash
   WHERE id = v_created.order_id AND customer_id IS NULL;

  RETURN QUERY SELECT v_created.order_id, v_created.order_number,
                       v_created.subtotal, v_created.delivery_fee, v_created.total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_pending_online_payment_with_guest_tracking_token(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_order_type text,
  p_delivery_city text,
  p_delivery_barangay text,
  p_delivery_address text,
  p_notes text,
  p_is_third_party_courier boolean,
  p_items jsonb,
  p_redeem_loyalty boolean,
  p_customer_delivery_address text,
  p_customer_delivery_city text,
  p_customer_delivery_barangay text,
  p_customer_delivery_latitude double precision,
  p_customer_delivery_longitude double precision,
  p_customer_delivery_place_id text,
  p_guest_cancel_token_hash text,
  p_guest_tracking_token_hash text
)
RETURNS TABLE(payment_id uuid, reference_number text, subtotal numeric, delivery_fee numeric, total numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_created record;
BEGIN
  IF p_guest_tracking_token_hash IS NULL OR p_guest_tracking_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A valid guest tracking token hash is required';
  END IF;

  SELECT * INTO v_created
  FROM public.create_pending_online_payment_with_guest_cancel_token(
    p_restaurant_id, p_customer_name, p_mobile_number, p_order_type,
    p_delivery_city, p_delivery_barangay, p_delivery_address, p_notes,
    p_is_third_party_courier, p_items, p_redeem_loyalty,
    p_customer_delivery_address, p_customer_delivery_city,
    p_customer_delivery_barangay, p_customer_delivery_latitude,
    p_customer_delivery_longitude, p_customer_delivery_place_id,
    p_guest_cancel_token_hash
  );

  UPDATE public.pending_online_payments
     SET guest_tracking_token_hash = p_guest_tracking_token_hash
   WHERE id = v_created.payment_id AND customer_id IS NULL;

  RETURN QUERY SELECT v_created.payment_id, v_created.reference_number,
                       v_created.subtotal, v_created.delivery_fee, v_created.total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_pending_online_payment_from_delivery_quote_with_guest_tracking_token(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_delivery_city text,
  p_delivery_barangay text,
  p_delivery_address text,
  p_notes text,
  p_items jsonb,
  p_redeem_loyalty boolean,
  p_customer_delivery_address text,
  p_customer_delivery_city text,
  p_customer_delivery_barangay text,
  p_customer_delivery_latitude double precision,
  p_customer_delivery_longitude double precision,
  p_customer_delivery_place_id text,
  p_delivery_quote_id uuid,
  p_guest_cancel_token_hash text,
  p_guest_tracking_token_hash text
)
RETURNS TABLE(payment_id uuid, reference_number text, subtotal numeric, delivery_fee numeric, total numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_created record;
BEGIN
  IF p_guest_tracking_token_hash IS NULL OR p_guest_tracking_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A valid guest tracking token hash is required';
  END IF;

  SELECT * INTO v_created
  FROM public.create_pending_online_payment_from_delivery_quote_with_guest_cancel_token(
    p_restaurant_id, p_customer_name, p_mobile_number, p_delivery_city,
    p_delivery_barangay, p_delivery_address, p_notes, p_items,
    p_redeem_loyalty, p_customer_delivery_address, p_customer_delivery_city,
    p_customer_delivery_barangay, p_customer_delivery_latitude,
    p_customer_delivery_longitude, p_customer_delivery_place_id,
    p_delivery_quote_id, p_guest_cancel_token_hash
  );

  UPDATE public.pending_online_payments
     SET guest_tracking_token_hash = p_guest_tracking_token_hash
   WHERE id = v_created.payment_id AND customer_id IS NULL;

  RETURN QUERY SELECT v_created.payment_id, v_created.reference_number,
                       v_created.subtotal, v_created.delivery_fee, v_created.total;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_order_with_guest_tracking_token(
  uuid,text,text,text,text,text,text,text,text,boolean,jsonb,text,text,text,double precision,double precision,text,text,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_with_guest_tracking_token(
  uuid,text,text,text,text,text,text,text,text,boolean,jsonb,text,text,text,double precision,double precision,text,text,text
) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.create_order_from_delivery_quote_with_guest_tracking_token(
  uuid,text,text,text,text,text,text,text,jsonb,text,text,text,double precision,double precision,text,uuid,text,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_from_delivery_quote_with_guest_tracking_token(
  uuid,text,text,text,text,text,text,text,jsonb,text,text,text,double precision,double precision,text,uuid,text,text
) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.create_pending_online_payment_with_guest_tracking_token(
  uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean,text,text,text,double precision,double precision,text,text,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_online_payment_with_guest_tracking_token(
  uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean,text,text,text,double precision,double precision,text,text,text
) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.create_pending_online_payment_from_delivery_quote_with_guest_tracking_token(
  uuid,text,text,text,text,text,text,jsonb,boolean,text,text,text,double precision,double precision,text,uuid,text,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_online_payment_from_delivery_quote_with_guest_tracking_token(
  uuid,text,text,text,text,text,text,jsonb,boolean,text,text,text,double precision,double precision,text,uuid,text,text
) TO anon, authenticated;

-- Preserve the existing cancellation-hash transfer and add the tracking-hash transfer.
CREATE OR REPLACE FUNCTION public.sync_guest_cancel_token_to_finalized_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status = 'paid'
     AND NEW.order_id IS NOT NULL
     AND NEW.customer_id IS NULL THEN
    UPDATE public.orders
       SET guest_cancel_token_hash = COALESCE(NEW.guest_cancel_token_hash, guest_cancel_token_hash),
           guest_tracking_token_hash = COALESCE(NEW.guest_tracking_token_hash, guest_tracking_token_hash)
     WHERE id = NEW.order_id
       AND customer_id IS NULL
       AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_guest_cancel_token_to_finalized_order() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
COMMIT;

CREATE OR REPLACE FUNCTION public.send_order_to_kitchen(p_order_id uuid)
 RETURNS TABLE(order_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_restaurant_id uuid;
  v_owner_id uuid;
  v_role text;
  v_status text;
  v_payment_status text;
  v_cancellation_refund_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT o.restaurant_id, r.owner_id, o.status, o.payment_status, o.cancellation_refund_status
    INTO v_restaurant_id, v_owner_id, v_status, v_payment_status, v_cancellation_refund_status
  FROM public.orders o
  JOIN public.restaurants r ON r.id = o.restaurant_id
  WHERE o.id = p_order_id AND r.is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Order not found or restaurant is inactive' USING ERRCODE = '42501';
  END IF;

  IF v_owner_id = auth.uid() THEN
    v_role := 'owner';
  ELSE
    SELECT s.role INTO v_role
    FROM public.restaurant_staff s
    WHERE s.restaurant_id = v_restaurant_id
      AND s.auth_user_id = auth.uid()
      AND s.is_active = true
      AND s.role IN ('cashier', 'kitchen')
    LIMIT 1;
  END IF;

  IF v_role NOT IN ('owner', 'cashier') OR v_role IS NULL THEN
    RAISE EXCEPTION 'Only an authorized cashier or restaurant owner can send this order to the kitchen' USING ERRCODE = '42501';
  END IF;

  IF v_cancellation_refund_status = 'processing' THEN
    RAISE EXCEPTION 'A payment refund is in progress; this order cannot be sent to the kitchen yet' USING ERRCODE = '42501';
  END IF;

  IF v_payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Payment must be completed before sending this order to the kitchen' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('pending', 'confirmed', 'preparing') THEN
    RAISE EXCEPTION 'This order cannot be sent to the kitchen from its current status' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.orders o
  SET status = 'preparing', updated_at = now()
  WHERE o.id = p_order_id AND o.restaurant_id = v_restaurant_id
  RETURNING o.id, o.status;
END;
$function$


CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id uuid, p_status text)
 RETURNS TABLE(order_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_restaurant_id uuid;
  v_owner_id uuid;
  v_role text;
  v_current_status text;
  v_order_type text;
  v_payment_status text;
  v_cancellation_refund_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid order status';
  END IF;

  SELECT o.restaurant_id, r.owner_id, o.status, o.order_type, o.payment_status, o.cancellation_refund_status
    INTO v_restaurant_id, v_owner_id, v_current_status, v_order_type, v_payment_status, v_cancellation_refund_status
  FROM public.orders o
  JOIN public.restaurants r ON r.id = o.restaurant_id
  WHERE o.id = p_order_id
    AND r.is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Order not found or restaurant is inactive' USING ERRCODE = '42501';
  END IF;

  IF v_owner_id = auth.uid() THEN
    v_role := 'owner';
  ELSE
    SELECT s.role INTO v_role
    FROM public.restaurant_staff s
    WHERE s.restaurant_id = v_restaurant_id
      AND s.auth_user_id = auth.uid()
      AND s.is_active = true
      AND s.role IN ('cashier', 'kitchen')
    LIMIT 1;
  END IF;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You are not authorized to update this order' USING ERRCODE = '42501';
  END IF;

  IF v_cancellation_refund_status = 'processing' THEN
    RAISE EXCEPTION 'A payment refund is in progress; this order status cannot be changed yet' USING ERRCODE = '42501';
  END IF;

  -- Cashier may hand off only a paid order that has not progressed beyond confirmation.
  IF p_status = 'preparing' AND v_role = 'cashier' THEN
    IF v_current_status NOT IN ('pending', 'confirmed') OR v_payment_status <> 'paid' THEN
      RAISE EXCEPTION 'Cashiers can only send paid pending or confirmed orders to the kitchen' USING ERRCODE = '42501';
    END IF;
  ELSIF p_status IN ('preparing', 'ready') AND v_role NOT IN ('owner', 'kitchen') THEN
    RAISE EXCEPTION 'Only kitchen staff or the restaurant owner can set this order status' USING ERRCODE = '42501';
  END IF;

  IF p_status IN ('confirmed', 'cancelled', 'pending')
     AND v_role NOT IN ('owner', 'cashier') THEN
    RAISE EXCEPTION 'Only cashier staff or the restaurant owner can set this order status' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'completed' AND v_role NOT IN ('owner', 'cashier') THEN
    IF NOT (v_role = 'kitchen' AND v_current_status = 'ready' AND v_order_type = 'dine_in') THEN
      RAISE EXCEPTION 'Only authorized staff can complete this order' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  UPDATE public.orders o
  SET status = p_status,
      updated_at = now()
  WHERE o.id = p_order_id
    AND o.restaurant_id = v_restaurant_id
  RETURNING o.id, o.status;
END;
$function$


CREATE OR REPLACE FUNCTION public.cancel_my_pending_order(p_order_id uuid)
 RETURNS TABLE(order_id uuid, order_status text, payment_status text, refund_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id uuid;
  v_order public.orders%rowtype;
  v_refund_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to cancel this order' USING ERRCODE = '42501';
  END IF;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501'; END IF;
  IF v_order.cancellation_refund_status = 'processing' THEN
    RAISE EXCEPTION 'A payment refund is in progress; this order cannot be cancelled again yet' USING ERRCODE = '23514';
  END IF;
  SELECT cp.id INTO v_customer_id FROM public.customer_profiles cp
    WHERE cp.auth_user_id = auth.uid() AND cp.restaurant_id = v_order.restaurant_id LIMIT 1;
  IF v_customer_id IS NULL OR v_order.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'Order not found or does not belong to your account' USING ERRCODE = '42501';
  END IF;
  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Orders can only be cancelled before the restaurant confirms them' USING ERRCODE = '23514';
  END IF;
  IF v_order.payment_status = 'paid' AND NULLIF(trim(v_order.paymongo_payment_id), '') IS NULL THEN
    RAISE EXCEPTION 'The online payment reference is missing. Please contact the restaurant for a refund.' USING ERRCODE = '23514';
  END IF;
  IF v_order.payment_status NOT IN ('pending', 'paid') THEN
    RAISE EXCEPTION 'This order payment is not eligible for cancellation' USING ERRCODE = '23514';
  END IF;
  v_refund_status := CASE WHEN v_order.payment_status = 'paid' THEN 'pending' ELSE 'not_required' END;
  UPDATE public.orders SET status = 'cancelled', cancellation_refund_status = v_refund_status,
    cancellation_refund_error = NULL, updated_at = now()
    WHERE id = v_order.id AND status = 'pending';
  RETURN QUERY SELECT v_order.id, 'cancelled'::text, v_order.payment_status, v_refund_status;
END;
$function$


DROP FUNCTION IF EXISTS public.get_restaurant_failed_refunds(uuid, uuid);
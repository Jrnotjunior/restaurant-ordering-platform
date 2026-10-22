-- Replace direct browser-side order updates with narrow authenticated RPCs.
-- Dispatchers must pass tenant, role, MFA and current-order-state checks server-side.

CREATE OR REPLACE FUNCTION public.assign_delivery_order(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_rider_id uuid
)
RETURNS TABLE(order_id uuid, rider_id uuid, delivery_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_rider public.restaurant_staff%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.privileged_restaurant_mfa_verified() THEN
    RAISE EXCEPTION 'Multi-factor authentication is required' USING ERRCODE = '42501';
  END IF;

  IF p_restaurant_id IS NULL OR p_order_id IS NULL OR p_rider_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant, order and rider are required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurant_staff s
    JOIN public.restaurants r ON r.id = s.restaurant_id
    WHERE s.restaurant_id = p_restaurant_id
      AND s.auth_user_id = auth.uid()
      AND s.role = 'dispatcher'
      AND s.is_active = true
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Active dispatcher access to this restaurant is required'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize assignment attempts for this order.
  SELECT o.* INTO v_order
  FROM public.orders o
  JOIN public.restaurants r ON r.id = o.restaurant_id
  WHERE o.id = p_order_id
    AND o.restaurant_id = p_restaurant_id
    AND r.is_active = true
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found for this restaurant' USING ERRCODE = '42501';
  END IF;

  IF v_order.order_type <> 'delivery'
     OR v_order.status <> 'ready'
     OR v_order.rider_id IS NOT NULL
     OR COALESCE(v_order.delivery_status, 'unassigned') <> 'unassigned' THEN
    RAISE EXCEPTION 'Only ready, unassigned delivery orders can receive a rider'
      USING ERRCODE = '23514';
  END IF;

  SELECT s.* INTO v_rider
  FROM public.restaurant_staff s
  WHERE s.id = p_rider_id
    AND s.restaurant_id = p_restaurant_id
    AND s.role = 'rider'
    AND s.is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected rider is not active in this restaurant'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.delivery_assignments da
    WHERE da.order_id = p_order_id
      AND da.restaurant_id = p_restaurant_id
      AND da.status IN ('assigned', 'delivering', 'arrived')
  ) THEN
    RAISE EXCEPTION 'This order already has an active delivery assignment'
      USING ERRCODE = '23514';
  END IF;

  -- Insert and order update commit or roll back as one transaction.
  INSERT INTO public.delivery_assignments (order_id, rider_id, restaurant_id, status)
  VALUES (p_order_id, p_rider_id, p_restaurant_id, 'assigned');

  UPDATE public.orders o
  SET rider_id = p_rider_id,
      delivery_status = 'assigned',
      rider_assigned_at = now()
  WHERE o.id = p_order_id
    AND o.restaurant_id = p_restaurant_id
    AND o.status = 'ready'
    AND o.order_type = 'delivery'
    AND o.rider_id IS NULL
    AND COALESCE(o.delivery_status, 'unassigned') = 'unassigned';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order state changed during rider assignment; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT p_order_id, p_rider_id, 'assigned'::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_dispatch_handoff(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_order_type text
)
RETURNS TABLE(order_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.privileged_restaurant_mfa_verified() THEN
    RAISE EXCEPTION 'Multi-factor authentication is required' USING ERRCODE = '42501';
  END IF;

  IF p_restaurant_id IS NULL OR p_order_id IS NULL
     OR p_order_type IS NULL
     OR p_order_type NOT IN ('pickup', 'take_out', 'dine_in') THEN
    RAISE EXCEPTION 'A valid restaurant, order and handoff type are required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurant_staff s
    JOIN public.restaurants r ON r.id = s.restaurant_id
    WHERE s.restaurant_id = p_restaurant_id
      AND s.auth_user_id = auth.uid()
      AND s.role = 'dispatcher'
      AND s.is_active = true
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Active dispatcher access to this restaurant is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT o.* INTO v_order
  FROM public.orders o
  JOIN public.restaurants r ON r.id = o.restaurant_id
  WHERE o.id = p_order_id
    AND o.restaurant_id = p_restaurant_id
    AND r.is_active = true
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found for this restaurant' USING ERRCODE = '42501';
  END IF;

  IF v_order.order_type <> p_order_type OR v_order.status <> 'ready' THEN
    RAISE EXCEPTION 'Only a ready pickup, take-out or dine-in order can be handed off'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.orders o
  SET status = 'completed',
      updated_at = now()
  WHERE o.id = p_order_id
    AND o.restaurant_id = p_restaurant_id
    AND o.order_type = p_order_type
    AND o.status = 'ready';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order state changed during handoff; refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  -- Keep existing order-completion triggers as the source of side effects.
  RETURN QUERY SELECT p_order_id, 'completed'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_delivery_order(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_delivery_order(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_dispatch_handoff(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_dispatch_handoff(uuid, uuid, text) TO authenticated;

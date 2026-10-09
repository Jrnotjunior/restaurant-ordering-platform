-- Keep the order-status authorization aligned with the kitchen board:
-- kitchen staff can complete a ready dine-in order; delivery/pickup orders leave
-- this board when ready and are completed through dispatch/cashier workflows.

CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id uuid, p_status text)
RETURNS TABLE(order_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_restaurant_id uuid;
  v_owner_id uuid;
  v_role text;
  v_current_status text;
  v_order_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid order status';
  END IF;

  SELECT o.restaurant_id, r.owner_id, o.status, o.order_type
    INTO v_restaurant_id, v_owner_id, v_current_status, v_order_type
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

  IF p_status IN ('preparing', 'ready') AND v_role NOT IN ('owner', 'kitchen') THEN
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
$function$;

REVOKE ALL ON FUNCTION public.update_order_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_status(uuid, text) TO authenticated;

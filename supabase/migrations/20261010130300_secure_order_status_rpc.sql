-- Prevent anonymous and cross-tenant order status changes through SECURITY DEFINER.
-- Cashier/owner workflows confirm or cancel orders; kitchen workflows prepare
-- orders and mark them ready. The order must belong to the caller's active tenant.

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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid order status';
  END IF;

  SELECT o.restaurant_id, r.owner_id
    INTO v_restaurant_id, v_owner_id
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

  IF p_status IN ('confirmed', 'cancelled', 'completed', 'pending')
     AND v_role NOT IN ('owner', 'cashier') THEN
    RAISE EXCEPTION 'Only cashier staff or the restaurant owner can set this order status' USING ERRCODE = '42501';
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

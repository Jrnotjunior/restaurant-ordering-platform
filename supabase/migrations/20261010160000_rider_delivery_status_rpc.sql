-- Replace broad direct rider UPDATE access with one atomic, narrowly authorized RPC.
-- Riders may advance only their own delivery through the supported state machine.
-- Order financial fields and assignment identity are never writable by the rider client.

CREATE OR REPLACE FUNCTION public.rider_update_delivery_status(
  p_order_id uuid,
  p_next_status text,
  p_failure_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rider_id uuid;
  v_order public.orders%rowtype;
  v_assignment public.delivery_assignments%rowtype;
  v_failure_reason text := nullif(btrim(coalesce(p_failure_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_next_status NOT IN ('delivering', 'arrived', 'delivered', 'failed') THEN
    RAISE EXCEPTION 'Invalid delivery status' USING ERRCODE = '22023';
  END IF;

  IF p_next_status = 'failed' AND v_failure_reason IS NULL THEN
    RAISE EXCEPTION 'A failure reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT s.id
    INTO v_rider_id
  FROM public.restaurant_staff s
  JOIN public.restaurants r ON r.id = s.restaurant_id
  WHERE s.auth_user_id = auth.uid()
    AND s.role = 'rider'
    AND s.is_active = true
    AND r.is_active = true
    AND r.id = s.restaurant_id
  LIMIT 1;

  IF v_rider_id IS NULL THEN
    RAISE EXCEPTION 'Active rider account required' USING ERRCODE = '42501';
  END IF;

  SELECT o.*
    INTO v_order
  FROM public.orders o
  JOIN public.restaurants r ON r.id = o.restaurant_id AND r.is_active = true
  WHERE o.id = p_order_id
    AND o.rider_id = v_rider_id
    AND o.order_type = 'delivery'
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery not found or not assigned to this rider' USING ERRCODE = '42501';
  END IF;

  SELECT da.*
    INTO v_assignment
  FROM public.delivery_assignments da
  WHERE da.order_id = v_order.id
    AND da.restaurant_id = v_order.restaurant_id
    AND da.rider_id = v_rider_id
  ORDER BY da.assigned_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active delivery assignment not found' USING ERRCODE = '42501';
  END IF;

  IF p_next_status = 'delivering'
     AND coalesce(v_order.delivery_status, 'assigned') = 'assigned'
     AND v_assignment.status = 'assigned' THEN
    UPDATE public.delivery_assignments
    SET status = 'delivering'
    WHERE order_id = v_order.id
      AND restaurant_id = v_order.restaurant_id
      AND rider_id = v_rider_id
      AND status = 'assigned';
  ELSIF p_next_status = 'arrived'
     AND v_order.delivery_status = 'delivering'
     AND v_assignment.status = 'delivering' THEN
    UPDATE public.delivery_assignments
    SET status = 'arrived'
    WHERE order_id = v_order.id
      AND restaurant_id = v_order.restaurant_id
      AND rider_id = v_rider_id
      AND status = 'delivering';
  ELSIF p_next_status IN ('delivered', 'failed')
     AND v_order.delivery_status = 'arrived'
     AND v_assignment.status = 'arrived' THEN
    UPDATE public.delivery_assignments
    SET status = p_next_status,
        delivered_at = CASE WHEN p_next_status = 'delivered' THEN now() ELSE delivered_at END
    WHERE order_id = v_order.id
      AND restaurant_id = v_order.restaurant_id
      AND rider_id = v_rider_id
      AND status = 'arrived';
  ELSE
    RAISE EXCEPTION 'Invalid delivery status transition' USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
  SET delivery_status = p_next_status,
      status = CASE
        WHEN p_next_status = 'delivered' THEN 'completed'
        WHEN p_next_status = 'failed' THEN 'cancelled'
        ELSE status
      END,
      payment_status = CASE
        WHEN p_next_status = 'delivered' AND payment_method = 'cash' THEN 'paid'
        ELSE payment_status
      END,
      delivery_failure_reason = CASE
        WHEN p_next_status = 'failed' THEN v_failure_reason
        ELSE delivery_failure_reason
      END,
      delivered_at = CASE WHEN p_next_status = 'delivered' THEN now() ELSE delivered_at END,
      delivery_failed_at = CASE WHEN p_next_status = 'failed' THEN now() ELSE delivery_failed_at END,
      updated_at = now()
  WHERE id = v_order.id
    AND rider_id = v_rider_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rider_update_delivery_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_update_delivery_status(uuid, text, text) TO authenticated;

-- RLS remains enabled for reads. Mutations go through the validated RPC above.
DROP POLICY IF EXISTS "Riders can update their orders" ON public.orders;
DROP POLICY IF EXISTS "Riders can update their assignments" ON public.delivery_assignments;

-- Customers may cancel only their own unpaid orders before kitchen work begins.
-- Guest cancellation is intentionally not exposed until a separate high-entropy
-- cancellation credential can be issued and validated securely.

CREATE OR REPLACE FUNCTION public.cancel_my_pending_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_customer_id uuid;
  v_order public.orders%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to cancel this order' USING ERRCODE = '42501';
  END IF;

  SELECT cp.id
    INTO v_customer_id
  FROM public.customer_profiles cp
  WHERE cp.auth_user_id = auth.uid()
  ORDER BY cp.created_at ASC
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer account not found' USING ERRCODE = '42501';
  END IF;

  SELECT o.*
    INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.customer_id = v_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or does not belong to your account' USING ERRCODE = '42501';
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Orders can only be cancelled before the restaurant confirms them'
      USING ERRCODE = '23514';
  END IF;

  -- Avoid cancelling a paid order without a coordinated refund workflow.
  IF v_order.payment_status <> 'pending' OR v_order.payment_method <> 'cash' THEN
    RAISE EXCEPTION 'This order cannot be cancelled here because its payment is not an unpaid cash payment'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.orders
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = v_order.id
    AND status = 'pending'
    AND payment_status = 'pending'
    AND payment_method = 'cash';
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_my_pending_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_pending_order(uuid) TO authenticated;

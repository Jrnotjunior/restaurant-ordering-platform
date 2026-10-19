-- Customer cancellation is allowed only while an order remains pending.
-- Online-paid orders are cancelled first, then refunded by cancel-customer-order.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancellation_refund_status text,
  ADD COLUMN IF NOT EXISTS paymongo_refund_id text,
  ADD COLUMN IF NOT EXISTS cancellation_refund_error text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_cancellation_refund_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_cancellation_refund_status_check
  CHECK (cancellation_refund_status IS NULL OR cancellation_refund_status IN
    ('not_required', 'pending', 'processing', 'succeeded', 'failed', 'manual_review'));

DROP FUNCTION IF EXISTS public.cancel_my_pending_order(uuid);
CREATE FUNCTION public.cancel_my_pending_order(p_order_id uuid)
RETURNS TABLE(order_id uuid, order_status text, payment_status text, refund_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_customer_id uuid;
  v_order public.orders%rowtype;
  v_refund_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to cancel this order' USING ERRCODE = '42501';
  END IF;

  SELECT o.* INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501';
  END IF;

  SELECT cp.id INTO v_customer_id
  FROM public.customer_profiles cp
  WHERE cp.auth_user_id = auth.uid()
    AND cp.restaurant_id = v_order.restaurant_id
  LIMIT 1;

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

  IF v_order.payment_status = 'paid' AND NULLIF(trim(v_order.paymongo_payment_id), '') IS NULL THEN
    RAISE EXCEPTION 'The online payment reference is missing. Please contact the restaurant for a refund.' USING ERRCODE = '23514';
  END IF;

  v_refund_status := CASE WHEN v_order.payment_status = 'paid' THEN 'pending' ELSE 'not_required' END;

  UPDATE public.orders
  SET status = 'cancelled',
      cancellation_refund_status = v_refund_status,
      cancellation_refund_error = NULL,
      updated_at = now()
  WHERE id = v_order.id AND status = 'pending';

  RETURN QUERY SELECT v_order.id, 'cancelled'::text, v_order.payment_status, v_refund_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_my_pending_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_pending_order(uuid) TO authenticated;

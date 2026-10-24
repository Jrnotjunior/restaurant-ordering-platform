-- Reject non-finite numeric tender values explicitly before any payment/order update.
-- This changes only the function definition; it does not rewrite existing order rows.
CREATE OR REPLACE FUNCTION public.confirm_pos_cash_payment_with_tender(
  p_order_id uuid,
  p_cash_received_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_change numeric(12,2);
BEGIN
  SELECT o.*
    INTO v_order
  FROM public.orders o
  JOIN public.restaurants r ON r.id = o.restaurant_id
  WHERE o.id = p_order_id
    AND r.is_active = true
    AND (
      r.owner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.restaurant_staff s
        WHERE s.restaurant_id = o.restaurant_id
          AND s.auth_user_id = auth.uid()
          AND s.role = 'cashier'
          AND s.is_active = true
      )
    )
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or you are not authorized to confirm POS cash payment.' USING errcode = '42501';
  END IF;

  IF v_order.order_type NOT IN ('dine_in','take_out','pickup','delivery')
     OR v_order.payment_method <> 'cash'
     OR v_order.payment_status <> 'pending'
     OR v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Only unpaid pending POS cash orders can be confirmed.';
  END IF;

  IF p_cash_received_amount IS NULL
     OR p_cash_received_amount < 0
     OR p_cash_received_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Cash received must be a finite, non-negative amount.';
  END IF;

  IF round(p_cash_received_amount, 2) < round(v_order.total, 2) THEN
    RAISE EXCEPTION 'Cash received must cover the persisted order total.';
  END IF;

  v_change := round(round(p_cash_received_amount, 2) - round(v_order.total, 2), 2);

  UPDATE public.orders
     SET payment_status = 'paid',
         status = 'preparing',
         cash_received_amount = round(p_cash_received_amount, 2),
         cash_change_amount = v_change,
         updated_at = now()
   WHERE id = p_order_id
     AND restaurant_id = v_order.restaurant_id;

  BEGIN
    PERFORM public.calculate_supported_online_order_tax_snapshot(p_order_id);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.orders
       SET tax_snapshot_status = 'requires_review',
           tax_snapshot_version = NULL,
           updated_at = now()
     WHERE id = p_order_id
       AND restaurant_id = v_order.restaurant_id
       AND tax_snapshot_status <> 'calculated';
  END;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'payment_status', 'paid',
    'order_status', 'preparing',
    'cash_received_amount', round(p_cash_received_amount, 2),
    'cash_change_amount', v_change
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_pos_cash_payment_with_tender(uuid,numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.confirm_pos_cash_payment_with_tender(uuid,numeric) TO authenticated;

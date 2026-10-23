-- Cash/POS confirmation is the stable point after order items have been created.
-- Run the guarded calculator there; unsupported cases remain under review.
-- A tax-calculation error must never roll back a cashier's payment confirmation.
CREATE OR REPLACE FUNCTION public.confirm_dine_in_payment(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_restaurant_id uuid;
BEGIN
  SELECT o.restaurant_id
    INTO v_restaurant_id
    FROM public.orders o
    JOIN public.restaurants r ON r.id = o.restaurant_id
   WHERE o.id = p_order_id
     AND r.is_active = true
     AND (
       r.owner_id = auth.uid()
       OR EXISTS (
         SELECT 1
           FROM public.restaurant_staff s
          WHERE s.restaurant_id = o.restaurant_id
            AND s.auth_user_id = auth.uid()
            AND s.role = 'cashier'
            AND s.is_active = true
       )
     );

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Order not found or you are not authorized to update it';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.id = p_order_id
       AND o.order_type IN ('dine_in', 'take_out', 'pickup', 'delivery')
       AND o.payment_method = 'cash'
       AND o.payment_status = 'pending'
       AND o.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Only unpaid pending POS cash orders can be confirmed';
  END IF;

  UPDATE public.orders
     SET payment_status = 'paid',
         status = 'preparing',
         updated_at = now()
   WHERE id = p_order_id
     AND restaurant_id = v_restaurant_id;

  -- Tax status is secondary to recording an already-collected cash payment.
  -- The helper never changes the customer total and only calculates a narrow,
  -- reviewed case; all other cases become requires_review.
  BEGIN
    PERFORM public.calculate_supported_online_order_tax_snapshot(p_order_id);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.orders
       SET tax_snapshot_status = 'requires_review',
           tax_snapshot_version = NULL,
           updated_at = now()
     WHERE id = p_order_id
       AND restaurant_id = v_restaurant_id
       AND tax_snapshot_status <> 'calculated';
  END;
END;
$function$;

COMMENT ON FUNCTION public.confirm_dine_in_payment(uuid) IS
  'Confirms authorized POS cash payment and kitchen handoff. Attempts the guarded tax snapshot after confirmation; tax-calculation errors cannot roll back payment confirmation and leave tax marked requires_review.';

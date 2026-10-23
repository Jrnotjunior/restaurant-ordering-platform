-- Serialize POS cash-payment confirmation and make its execution boundary explicit.
-- A row lock ensures two simultaneous confirmations cannot both observe a pending
-- cash order and report success.
CREATE OR REPLACE FUNCTION public.confirm_dine_in_payment(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_owner_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT o.*
    INTO v_order
  FROM public.orders o
  JOIN public.restaurants r ON r.id = o.restaurant_id
  WHERE o.id = p_order_id
    AND r.is_active = true
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or restaurant is inactive' USING ERRCODE = '42501';
  END IF;

  SELECT r.owner_id
    INTO v_owner_id
  FROM public.restaurants r
  WHERE r.id = v_order.restaurant_id
    AND r.is_active = true;

  IF v_owner_id IS DISTINCT FROM auth.uid()
     AND NOT EXISTS (
       SELECT 1
       FROM public.restaurant_staff s
       WHERE s.restaurant_id = v_order.restaurant_id
         AND s.auth_user_id = auth.uid()
         AND s.role = 'cashier'
         AND s.is_active = true
     ) THEN
    RAISE EXCEPTION 'Order not found or you are not authorized to update it' USING ERRCODE = '42501';
  END IF;

  IF v_order.order_type NOT IN ('dine_in', 'take_out', 'pickup', 'delivery')
     OR v_order.payment_method IS DISTINCT FROM 'cash'
     OR v_order.payment_status IS DISTINCT FROM 'pending'
     OR v_order.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Only unpaid pending POS cash orders can be confirmed' USING ERRCODE = '23514';
  END IF;

  UPDATE public.orders
  SET payment_status = 'paid',
      status = 'confirmed',
      updated_at = now()
  WHERE id = v_order.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_dine_in_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_dine_in_payment(uuid) TO authenticated;

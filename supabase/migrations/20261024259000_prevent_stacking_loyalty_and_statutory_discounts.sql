-- Statutory SC/PWD benefits may not be combined with loyalty or other
-- promotional discount programs on the same transaction. Enforce this in the
-- database even if a client bypasses the POS controls.
CREATE OR REPLACE FUNCTION public.redeem_loyalty_reward(
  p_order_id uuid,
  p_customer_id uuid
)
RETURNS TABLE (
  order_id uuid,
  customer_id uuid,
  points_redeemed integer,
  discount_amount numeric,
  remaining_points bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_restaurant public.restaurants%ROWTYPE;
  v_account public.customer_loyalty_accounts%ROWTYPE;
  v_discount numeric(12,2);
  v_staff_authorized boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;

  SELECT o.*
    INTO v_order
    FROM public.orders AS o
   WHERE o.id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT r.*
    INTO v_restaurant
    FROM public.restaurants AS r
   WHERE r.id = v_order.restaurant_id;

  IF NOT FOUND OR NOT v_restaurant.loyalty_redemption_enabled THEN
    RAISE EXCEPTION 'Loyalty redemption is disabled';
  END IF;

  v_staff_authorized := EXISTS (
    SELECT 1
      FROM public.restaurants AS r
     WHERE r.id = v_order.restaurant_id
       AND (
         r.owner_id = auth.uid()
         OR EXISTS (
           SELECT 1
             FROM public.restaurant_staff AS s
            WHERE s.restaurant_id = r.id
              AND s.auth_user_id = auth.uid()
              AND s.role = 'cashier'
              AND s.is_active = true
         )
       )
  );

  IF NOT v_staff_authorized
     AND NOT EXISTS (
       SELECT 1
         FROM public.customer_profiles AS cp
        WHERE cp.id = p_customer_id
          AND cp.restaurant_id = v_order.restaurant_id
          AND cp.auth_user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'You are not authorized to redeem loyalty points for this order';
  END IF;

  IF v_order.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'This order is not linked to the selected customer';
  END IF;

  -- Check both the stored count and beneficiary rows. This protects against
  -- stale/malformed count fields and prevents SC/PWD plus loyalty stacking.
  IF coalesce(v_order.discount_beneficiary_count, 0) > 0
     OR EXISTS (
       SELECT 1
         FROM public.order_discount_beneficiaries AS b
        WHERE b.order_id = p_order_id
     ) THEN
    RAISE EXCEPTION 'Loyalty rewards cannot be combined with senior citizen or PWD statutory discounts on the same order';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.loyalty_transactions AS lt
     WHERE lt.order_id = p_order_id
       AND lt.transaction_type = 'redeem'
  ) THEN
    RAISE EXCEPTION 'Loyalty points have already been redeemed for this order';
  END IF;

  IF v_order.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'This order can no longer be changed';
  END IF;

  SELECT cla.*
    INTO v_account
    FROM public.customer_loyalty_accounts AS cla
   WHERE cla.customer_id = p_customer_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer loyalty account not found';
  END IF;

  IF v_account.points_balance < v_restaurant.loyalty_redemption_points THEN
    RAISE EXCEPTION 'Customer does not have enough loyalty points';
  END IF;

  v_discount := least(
    round(v_restaurant.loyalty_redemption_amount, 2),
    greatest(round(v_order.subtotal, 2), 0)
  );

  IF v_discount <= 0 THEN
    RAISE EXCEPTION 'This order has no amount available for redemption';
  END IF;

  UPDATE public.orders AS o
     SET discount_amount = coalesce(o.discount_amount, 0) + v_discount,
         total = greatest(round(o.total - v_discount, 2), 0),
         updated_at = now()
   WHERE o.id = p_order_id;

  UPDATE public.customer_loyalty_accounts AS cla
     SET points_balance = cla.points_balance - v_restaurant.loyalty_redemption_points,
         updated_at = now()
   WHERE cla.customer_id = p_customer_id;

  INSERT INTO public.loyalty_transactions (
    restaurant_id,
    customer_id,
    order_id,
    transaction_type,
    points,
    eligible_amount,
    rule_amount_threshold,
    rule_points_awarded,
    description
  )
  VALUES (
    v_order.restaurant_id,
    p_customer_id,
    p_order_id,
    'redeem',
    -v_restaurant.loyalty_redemption_points,
    v_discount,
    v_restaurant.loyalty_redemption_points,
    v_restaurant.loyalty_redemption_amount::integer,
    'Redeemed loyalty reward on order ' || v_order.order_number
  );

  RETURN QUERY
  SELECT
    p_order_id,
    p_customer_id,
    v_restaurant.loyalty_redemption_points,
    v_discount,
    (v_account.points_balance - v_restaurant.loyalty_redemption_points)::bigint;
END;
$function$;

COMMENT ON FUNCTION public.redeem_loyalty_reward(uuid, uuid) IS
  'Redeems loyalty points for an authorized customer/order; rejects redemption when SC/PWD statutory-beneficiary records are present to prevent stacking statutory and loyalty discounts.';

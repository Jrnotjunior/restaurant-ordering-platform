-- The current group-discount formula allocates a group share from the order
-- subtotal rather than reviewed eligible item lines. It may continue to apply
-- the existing operational discount, but must never certify its tax snapshot.
-- Preserve all existing validation, beneficiary capture, discount amount and
-- order-total behavior. Tax fields remain available for internal reconciliation
-- but the report gate suppresses them while status is requires_review.
CREATE OR REPLACE FUNCTION public.apply_pos_group_discounts(
  p_order_id uuid,
  p_group_size integer,
  p_beneficiaries jsonb
)
RETURNS TABLE (
  order_id uuid,
  group_size integer,
  beneficiary_count integer,
  discount_amount numeric,
  gross_sales numeric,
  vatable_sales numeric,
  vat_amount numeric,
  vat_exempt_sales numeric,
  net_sales numeric,
  total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_restaurant public.restaurants%ROWTYPE;
  v_beneficiary jsonb;
  v_type text;
  v_id_type text;
  v_id_number text;
  v_base_net numeric(12,2);
  v_eligible_net_share numeric(12,2);
  v_discount numeric(12,2);
  v_total_discount numeric(12,2) := 0;
  v_vatable_sales numeric(12,2);
  v_vat_amount numeric(12,2);
  v_vat_exempt_sales numeric(12,2);
  v_net_sales numeric(12,2);
  v_total numeric(12,2);
  v_count integer;
  v_tax_ready boolean := false;
BEGIN
  IF p_group_size IS NULL OR p_group_size < 1 THEN
    RAISE EXCEPTION 'Group size must be at least 1';
  END IF;

  IF jsonb_typeof(p_beneficiaries) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Discount beneficiaries must be an array';
  END IF;

  v_count := jsonb_array_length(p_beneficiaries);

  IF v_count > p_group_size THEN
    RAISE EXCEPTION 'Discount beneficiaries cannot exceed the group size';
  END IF;

  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT * INTO v_restaurant
    FROM public.restaurants r
   WHERE r.id = v_order.restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  IF NOT (
    v_restaurant.owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
        FROM public.restaurant_staff s
       WHERE s.restaurant_id = v_order.restaurant_id
         AND s.auth_user_id = auth.uid()
         AND s.role = 'cashier'
         AND s.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'You are not authorized to finalize POS financials for this order';
  END IF;

  IF coalesce(v_order.discount_beneficiary_count, 0) > 0
     OR coalesce(v_order.discount_amount, 0) > 0
     OR v_order.discount_type IS NOT NULL
     OR coalesce(v_order.tax_net_sales, 0) > 0
     OR v_order.tax_snapshot_status IN ('calculated', 'requires_review') THEN
    RAISE EXCEPTION 'POS financials have already been finalized for this order';
  END IF;

  IF v_count > 0 THEN
    FOR v_beneficiary IN SELECT value FROM jsonb_array_elements(p_beneficiaries) LOOP
      v_type := lower(trim(coalesce(v_beneficiary->>'discount_type', '')));
      v_id_type := trim(coalesce(v_beneficiary->>'discount_id_type', ''));
      v_id_number := trim(coalesce(v_beneficiary->>'discount_id_number', ''));

      IF v_type NOT IN ('senior', 'pwd') THEN
        RAISE EXCEPTION 'Invalid discount type';
      END IF;

      IF length(v_id_type) = 0 THEN
        RAISE EXCEPTION 'ID type is required for every discount beneficiary';
      END IF;

      IF length(v_id_number) = 0 THEN
        RAISE EXCEPTION 'ID number is required for every discount beneficiary';
      END IF;

      IF EXISTS (
        SELECT 1
          FROM public.order_discount_beneficiaries b
         WHERE b.order_id = p_order_id
           AND b.discount_id_number = v_id_number
      ) THEN
        RAISE EXCEPTION 'The same ID number cannot be used twice on one order';
      END IF;
    END LOOP;
  END IF;

  -- Preserve the current operational discount calculation unchanged. This is
  -- not treated as a certified statutory tax calculation when beneficiaries exist.
  v_base_net := CASE
    WHEN v_restaurant.tax_vat_registered AND v_restaurant.tax_prices_vat_inclusive
      THEN round(v_order.subtotal / (1 + (v_restaurant.tax_vat_rate / 100)), 2)
    ELSE round(v_order.subtotal, 2)
  END;

  v_eligible_net_share := CASE
    WHEN v_count > 0 THEN round(v_base_net / p_group_size, 2)
    ELSE 0
  END;

  IF v_count > 0 THEN
    FOR v_beneficiary IN SELECT value FROM jsonb_array_elements(p_beneficiaries) LOOP
      v_discount := round(v_eligible_net_share * 0.20, 2);
      v_total_discount := v_total_discount + v_discount;

      INSERT INTO public.order_discount_beneficiaries (
        order_id, discount_type, discount_id_type, discount_id_number,
        beneficiary_name, beneficiary_tin, beneficiary_address,
        eligible_amount, discount_amount
      ) VALUES (
        p_order_id,
        lower(trim(v_beneficiary->>'discount_type')),
        trim(v_beneficiary->>'discount_id_type'),
        trim(v_beneficiary->>'discount_id_number'),
        nullif(trim(coalesce(v_beneficiary->>'beneficiary_name', '')), ''),
        nullif(trim(coalesce(v_beneficiary->>'beneficiary_tin', '')), ''),
        nullif(trim(coalesce(v_beneficiary->>'beneficiary_address', '')), ''),
        v_eligible_net_share,
        v_discount
      );
    END LOOP;
  END IF;

  v_vatable_sales := greatest(
    round(v_base_net - (v_eligible_net_share * v_count), 2),
    0
  );

  v_vat_amount := CASE
    WHEN v_restaurant.tax_vat_registered
      THEN round(v_vatable_sales * (v_restaurant.tax_vat_rate / 100), 2)
    ELSE 0
  END;

  v_vat_exempt_sales := CASE
    WHEN v_count > 0
      THEN greatest(round((v_eligible_net_share * v_count) - v_total_discount, 2), 0)
    ELSE 0
  END;

  v_net_sales := round(v_vatable_sales + v_vat_exempt_sales, 2);
  v_total := greatest(round(v_net_sales + v_vat_amount + v_order.delivery_fee, 2), 0);

  SELECT count(*) > 0
         AND count(*) FILTER (WHERE oi.tax_category_snapshot = 'standard_rate') = count(*)
    INTO v_tax_ready
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id;

  -- Critical safeguard: even complete beneficiary identity and standard-rated
  -- product categories do not certify the current group-share discount formula.
  v_tax_ready := v_tax_ready
    AND v_count = 0
    AND v_restaurant.tax_vat_registered
    AND (
      v_count = 0
      OR NOT EXISTS (
        SELECT 1
          FROM public.order_discount_beneficiaries b
         WHERE b.order_id = p_order_id
           AND (
             nullif(trim(b.beneficiary_name), '') IS NULL
             OR nullif(trim(b.beneficiary_address), '') IS NULL
           )
      )
    );

  UPDATE public.orders
     SET tax_vat_registered = v_restaurant.tax_vat_registered,
         tax_prices_vat_inclusive = v_restaurant.tax_prices_vat_inclusive,
         tax_vat_rate = CASE WHEN v_restaurant.tax_vat_registered THEN v_restaurant.tax_vat_rate ELSE 0 END,
         tax_gross_sales = round(v_order.subtotal, 2),
         tax_vatable_sales = v_vatable_sales,
         tax_vat_amount = v_vat_amount,
         tax_vat_exempt_sales = v_vat_exempt_sales,
         tax_net_sales = v_net_sales,
         tax_zero_rated_sales = CASE WHEN v_tax_ready THEN 0 ELSE NULL END,
         tax_snapshot_status = CASE WHEN v_tax_ready THEN 'calculated' ELSE 'requires_review' END,
         tax_snapshot_version = CASE WHEN v_tax_ready THEN 1 ELSE NULL END,
         discount_type = CASE WHEN v_count = 1 THEN lower(trim(p_beneficiaries->0->>'discount_type')) ELSE NULL END,
         discount_id_number = CASE WHEN v_count = 1 THEN trim(p_beneficiaries->0->>'discount_id_number') ELSE NULL END,
         discount_amount = v_total_discount,
         discount_group_size = p_group_size,
         discount_beneficiary_count = v_count,
         total = v_total,
         updated_at = now()
   WHERE id = p_order_id;

  RETURN QUERY
  SELECT
    p_order_id, p_group_size, v_count, v_total_discount,
    round(v_order.subtotal, 2), v_vatable_sales, v_vat_amount,
    v_vat_exempt_sales, v_net_sales, v_total;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_pos_group_discounts(uuid, integer, jsonb) TO authenticated;

COMMENT ON FUNCTION public.apply_pos_group_discounts(uuid, integer, jsonb) IS
  'Applies the current operational SC/PWD group discount and records beneficiaries. Any order with statutory beneficiaries remains tax_snapshot_status=requires_review until line-level eligibility and statutory tax allocation are implemented and approved.';

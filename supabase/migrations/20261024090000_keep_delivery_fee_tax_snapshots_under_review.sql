-- The approved tax test matrix has not yet validated delivery-fee tax treatment.
-- Keep both VAT and non-VAT orders with delivery fees in requires_review; do not
-- emit a completed tax snapshot or print its VAT breakdown until route-specific
-- treatment and regression fixtures have been signed off.
CREATE OR REPLACE FUNCTION public.calculate_supported_online_order_tax_snapshot(p_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_restaurant public.restaurants%ROWTYPE;
  v_item_count integer := 0;
  v_classified_count integer := 0;
  v_standard_count integer := 0;
  v_invalid_item_count integer := 0;
  v_item_total numeric(12,2) := 0;
  v_standard_gross numeric(12,2) := 0;
  v_vat_exempt_sales numeric(12,2) := 0;
  v_zero_rated_sales numeric(12,2) := 0;
  v_vatable_sales numeric(12,2);
  v_vat_amount numeric(12,2);
  v_net_sales numeric(12,2);
  v_non_vat_tax_basis text;
  v_non_vat_tax_basis_reference text;
  v_non_vat_tax_basis_verified_at timestamptz;
  v_non_vat_classified_count integer := 0;
  v_non_vat_percentage_sales numeric(12,2) := 0;
  v_non_vat_exempt_sales numeric(12,2) := 0;
  v_vat_invalid_category_count integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'order_not_found'; END IF;
  IF v_order.tax_snapshot_status = 'calculated' THEN RETURN 'already_calculated'; END IF;

  SELECT * INTO v_restaurant FROM public.restaurants r WHERE r.id = v_order.restaurant_id;
  IF NOT FOUND THEN RETURN 'restaurant_not_found'; END IF;

  UPDATE public.orders
     SET tax_vat_registered = v_restaurant.tax_vat_registered,
         tax_prices_vat_inclusive = v_restaurant.tax_prices_vat_inclusive,
         tax_vat_rate = CASE WHEN v_restaurant.tax_vat_registered THEN v_restaurant.tax_vat_rate ELSE 0 END,
         tax_snapshot_status = 'requires_review',
         tax_snapshot_version = NULL,
         updated_at = now()
   WHERE id = v_order.id;

  IF NOT coalesce(v_restaurant.tax_vat_registered, false) THEN
    SELECT p.non_vat_tax_basis, p.non_vat_tax_basis_reference, p.non_vat_tax_basis_verified_at
      INTO v_non_vat_tax_basis, v_non_vat_tax_basis_reference, v_non_vat_tax_basis_verified_at
    FROM public.restaurant_taxpayer_profiles p
    WHERE p.restaurant_id = v_order.restaurant_id;

    -- A non-VAT profile must be verified against the tenant's registration/tax advice
    -- before the system may summarize percentage-taxable versus exempt sales.
    IF v_non_vat_tax_basis NOT IN ('subject_to_percentage_tax','not_subject_to_percentage_tax')
       OR v_non_vat_tax_basis_verified_at IS NULL
       OR nullif(trim(v_non_vat_tax_basis_reference), '') IS NULL
       OR coalesce(v_order.discount_amount, 0) <> 0
       OR coalesce(v_order.discount_beneficiary_count, 0) <> 0
       OR coalesce(v_order.subtotal, 0) <= 0
       OR coalesce(v_order.delivery_fee, 0) <> 0
       OR abs(round(v_order.total - v_order.subtotal, 2)) > 0.01
    THEN
      RETURN 'requires_review';
    END IF;

    SELECT
      count(*),
      count(*) FILTER (WHERE oi.tax_category_snapshot IN ('percentage_taxable','non_vat_exempt')),
      count(*) FILTER (
        WHERE oi.quantity < 1 OR oi.unit_price < 0 OR oi.line_total < 0
           OR oi.line_total IS DISTINCT FROM round(oi.unit_price * oi.quantity, 2)
      ),
      coalesce(round(sum(oi.line_total), 2), 0),
      coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'percentage_taxable'), 2), 0),
      coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'non_vat_exempt'), 2), 0)
    INTO v_item_count, v_non_vat_classified_count, v_invalid_item_count,
         v_item_total, v_non_vat_percentage_sales, v_non_vat_exempt_sales
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id;

    IF v_item_count = 0
       OR v_non_vat_classified_count <> v_item_count
       OR v_invalid_item_count <> 0
       OR abs(v_item_total - v_order.subtotal) > 0.01
       OR (
         v_non_vat_tax_basis = 'not_subject_to_percentage_tax'
         AND v_non_vat_percentage_sales <> 0
       )
    THEN
      RETURN 'requires_review';
    END IF;

    UPDATE public.orders
       SET tax_vat_registered = false,
           tax_prices_vat_inclusive = false,
           tax_vat_rate = 0,
           tax_gross_sales = round(v_order.subtotal, 2),
           tax_vatable_sales = 0,
           tax_vat_amount = 0,
           tax_vat_exempt_sales = 0,
           tax_net_sales = round(v_order.subtotal, 2),
           tax_zero_rated_sales = 0,
           tax_percentage_taxable_sales = v_non_vat_percentage_sales,
           tax_non_vat_exempt_sales = v_non_vat_exempt_sales,
           tax_snapshot_status = 'calculated',
           tax_snapshot_version = 4,
           updated_at = now()
     WHERE id = v_order.id;

    RETURN 'calculated';
  END IF;

  IF NOT coalesce(v_restaurant.tax_prices_vat_inclusive, false)
     OR v_restaurant.tax_vat_rate IS NULL
     OR v_restaurant.tax_vat_rate <= 0
     OR v_restaurant.tax_vat_rate > 100
     OR coalesce(v_order.discount_amount, 0) <> 0
     OR coalesce(v_order.discount_beneficiary_count, 0) <> 0
     OR coalesce(v_order.delivery_fee, 0) <> 0
     OR coalesce(v_order.subtotal, 0) <= 0
     OR abs(round(v_order.total - (v_order.subtotal + v_order.delivery_fee), 2)) > 0.01
  THEN RETURN 'requires_review'; END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE oi.tax_category_snapshot IS NOT NULL),
    count(*) FILTER (WHERE oi.tax_category_snapshot = 'standard_rate'),
    count(*) FILTER (WHERE oi.tax_category_snapshot NOT IN ('standard_rate','vat_exempt','zero_rated')),
    count(*) FILTER (
      WHERE oi.quantity < 1 OR oi.unit_price < 0 OR oi.line_total < 0
         OR oi.line_total IS DISTINCT FROM round(oi.unit_price * oi.quantity, 2)
    ),
    coalesce(round(sum(oi.line_total), 2), 0),
    coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'standard_rate'), 2), 0),
    coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'vat_exempt'), 2), 0),
    coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'zero_rated'), 2), 0)
  INTO v_item_count, v_classified_count, v_standard_count, v_vat_invalid_category_count, v_invalid_item_count,
       v_item_total, v_standard_gross, v_vat_exempt_sales, v_zero_rated_sales
  FROM public.order_items oi WHERE oi.order_id = v_order.id;

  IF v_item_count = 0 OR v_classified_count <> v_item_count
     OR v_vat_invalid_category_count <> 0
     OR v_invalid_item_count <> 0
     OR abs(v_item_total - v_order.subtotal) > 0.01
  THEN RETURN 'requires_review'; END IF;

  v_vatable_sales := CASE WHEN v_standard_count = 0 THEN 0
    ELSE round(v_standard_gross / (1 + (v_restaurant.tax_vat_rate / 100)), 2) END;
  v_vat_amount := round(v_standard_gross - v_vatable_sales, 2);
  v_net_sales := round(v_vatable_sales + v_vat_exempt_sales + v_zero_rated_sales, 2);

  UPDATE public.orders
     SET tax_vat_registered = true,
         tax_prices_vat_inclusive = true,
         tax_vat_rate = v_restaurant.tax_vat_rate,
         tax_gross_sales = round(v_order.subtotal, 2),
         tax_vatable_sales = v_vatable_sales,
         tax_vat_amount = v_vat_amount,
         tax_vat_exempt_sales = v_vat_exempt_sales,
         tax_net_sales = v_net_sales,
         tax_zero_rated_sales = v_zero_rated_sales,
         tax_percentage_taxable_sales = 0,
         tax_non_vat_exempt_sales = 0,
         tax_snapshot_status = 'calculated',
         tax_snapshot_version = 3,
         updated_at = now()
   WHERE id = v_order.id;

  RETURN 'calculated';
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_supported_online_order_tax_snapshot(uuid) FROM public, anon;

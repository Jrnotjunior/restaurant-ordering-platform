-- Calculate a deliberately narrow, supported online-order tax case after the
-- payment finalizer has inserted all order lines. Unsupported cases stay in
-- requires_review. This never changes the customer-paid order total.
CREATE OR REPLACE FUNCTION public.calculate_supported_online_order_tax_snapshot(
  p_order_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_restaurant public.restaurants%ROWTYPE;
  v_item_count integer := 0;
  v_standard_count integer := 0;
  v_item_total numeric(12,2) := 0;
  v_vatable_sales numeric(12,2);
  v_vat_amount numeric(12,2);
BEGIN
  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'order_not_found';
  END IF;

  IF v_order.paymongo_payment_id IS NULL
     AND v_order.paymongo_checkout_session_id IS NULL THEN
    RETURN 'not_online_order';
  END IF;

  IF v_order.tax_snapshot_status = 'calculated' THEN
    RETURN 'already_calculated';
  END IF;

  SELECT * INTO v_restaurant
    FROM public.restaurants r
   WHERE r.id = v_order.restaurant_id;

  IF NOT FOUND THEN
    RETURN 'restaurant_not_found';
  END IF;

  -- Snapshot the configured tax settings for reconciliation even when the
  -- transaction is too ambiguous to calculate automatically.
  UPDATE public.orders
     SET tax_vat_registered = v_restaurant.tax_vat_registered,
         tax_prices_vat_inclusive = v_restaurant.tax_prices_vat_inclusive,
         tax_vat_rate = CASE
           WHEN v_restaurant.tax_vat_registered THEN v_restaurant.tax_vat_rate
           ELSE 0
         END,
         tax_snapshot_status = 'requires_review',
         tax_snapshot_version = NULL,
         updated_at = now()
   WHERE id = v_order.id;

  -- Current shared calculator intentionally supports only VAT-registered,
  -- VAT-inclusive orders with no discounts and a single reviewed standard-rate
  -- category across every line. Other cases remain explicitly uncalculated.
  IF NOT coalesce(v_restaurant.tax_vat_registered, false)
     OR NOT coalesce(v_restaurant.tax_prices_vat_inclusive, false)
     OR v_restaurant.tax_vat_rate IS NULL
     OR v_restaurant.tax_vat_rate <= 0
     OR v_restaurant.tax_vat_rate > 100
     OR coalesce(v_order.discount_amount, 0) <> 0
     OR coalesce(v_order.discount_beneficiary_count, 0) <> 0
     OR coalesce(v_order.subtotal, 0) <= 0
     OR abs(round(v_order.total - (v_order.subtotal + v_order.delivery_fee), 2)) > 0.01
  THEN
    RETURN 'requires_review';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE oi.tax_category_snapshot = 'standard_rate'),
         coalesce(round(sum(oi.line_total), 2), 0)
    INTO v_item_count, v_standard_count, v_item_total
    FROM public.order_items oi
   WHERE oi.order_id = v_order.id;

  IF v_item_count = 0
     OR v_standard_count <> v_item_count
     OR abs(v_item_total - v_order.subtotal) > 0.01
  THEN
    RETURN 'requires_review';
  END IF;

  -- The order subtotal is configured as VAT-inclusive for this supported path.
  -- Delivery fee and the customer-paid total are deliberately not altered here.
  v_vatable_sales := round(
    v_order.subtotal / (1 + (v_restaurant.tax_vat_rate / 100)),
    2
  );
  v_vat_amount := round(v_order.subtotal - v_vatable_sales, 2);

  UPDATE public.orders
     SET tax_vat_registered = true,
         tax_prices_vat_inclusive = true,
         tax_vat_rate = v_restaurant.tax_vat_rate,
         tax_gross_sales = round(v_order.subtotal, 2),
         tax_vatable_sales = v_vatable_sales,
         tax_vat_amount = v_vat_amount,
         tax_vat_exempt_sales = 0,
         tax_net_sales = v_vatable_sales,
         tax_zero_rated_sales = 0,
         tax_snapshot_status = 'calculated',
         tax_snapshot_version = 2,
         updated_at = now()
   WHERE id = v_order.id;

  RETURN 'calculated';
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_supported_online_order_tax_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_online_order_tax_snapshot_from_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status = 'paid'
     AND NEW.order_id IS NOT NULL
     AND (
       OLD.status IS DISTINCT FROM NEW.status
       OR OLD.order_id IS DISTINCT FROM NEW.order_id
     ) THEN
    PERFORM public.calculate_supported_online_order_tax_snapshot(NEW.order_id);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_online_order_tax_snapshot_from_payment()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS finalize_online_order_tax_snapshot_from_payment
  ON public.pending_online_payments;
CREATE TRIGGER finalize_online_order_tax_snapshot_from_payment
AFTER UPDATE OF status, order_id ON public.pending_online_payments
FOR EACH ROW
EXECUTE FUNCTION public.finalize_online_order_tax_snapshot_from_payment();

COMMENT ON FUNCTION public.calculate_supported_online_order_tax_snapshot(uuid) IS
  'Calculates only the simple VAT-registered, VAT-inclusive, no-discount, all-standard-rate online-order case. All other cases remain requires_review; never changes total.';

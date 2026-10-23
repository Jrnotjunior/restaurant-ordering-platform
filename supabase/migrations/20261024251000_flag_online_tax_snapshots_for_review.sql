-- Successful online payment is not tax verification. Keep online orders
-- with no calculated tax snapshot out of the "calculated" reporting state.
-- The existing UPDATE trigger still invalidates calculated snapshots when
-- the order's financial totals change without recalculating the tax fields.
CREATE OR REPLACE FUNCTION public.flag_order_tax_snapshot_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (
      NEW.paymongo_payment_id IS NOT NULL
      OR NEW.paymongo_checkout_session_id IS NOT NULL
    ) AND NEW.tax_snapshot_status IS DISTINCT FROM 'calculated' THEN
      NEW.tax_snapshot_status := 'requires_review';
      NEW.tax_snapshot_version := NULL;
    END IF;

    RETURN NEW;
  END IF;

  IF OLD.tax_snapshot_status = 'calculated'
    AND (
      NEW.subtotal IS DISTINCT FROM OLD.subtotal
      OR NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
      OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
      OR NEW.total IS DISTINCT FROM OLD.total
    )
    AND NEW.tax_vat_registered IS NOT DISTINCT FROM OLD.tax_vat_registered
    AND NEW.tax_prices_vat_inclusive IS NOT DISTINCT FROM OLD.tax_prices_vat_inclusive
    AND NEW.tax_vat_rate IS NOT DISTINCT FROM OLD.tax_vat_rate
    AND NEW.tax_gross_sales IS NOT DISTINCT FROM OLD.tax_gross_sales
    AND NEW.tax_vatable_sales IS NOT DISTINCT FROM OLD.tax_vatable_sales
    AND NEW.tax_vat_amount IS NOT DISTINCT FROM OLD.tax_vat_amount
    AND NEW.tax_vat_exempt_sales IS NOT DISTINCT FROM OLD.tax_vat_exempt_sales
    AND NEW.tax_net_sales IS NOT DISTINCT FROM OLD.tax_net_sales
  THEN
    NEW.tax_snapshot_status := 'requires_review';
    NEW.tax_snapshot_version := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS flag_order_tax_snapshot_review_on_insert ON public.orders;
CREATE TRIGGER flag_order_tax_snapshot_review_on_insert
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.flag_order_tax_snapshot_review();

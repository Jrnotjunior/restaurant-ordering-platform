-- Never trust a caller-supplied line tax category. Derive the snapshot from
-- the product catalog and matching restaurant at line insertion time.
-- Custom/manual lines without a product remain unclassified (NULL).
-- This changes only new line snapshots; historical records are not backfilled.
CREATE OR REPLACE FUNCTION public.snapshot_order_item_tax_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_product_category text;
BEGIN
  IF NEW.product_id IS NULL THEN
    NEW.tax_category_snapshot := NULL;
    RETURN NEW;
  END IF;

  SELECT p.tax_category
    INTO v_product_category
    FROM public.products p
    JOIN public.orders o
      ON o.id = NEW.order_id
     AND o.restaurant_id = p.restaurant_id
   WHERE p.id = NEW.product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The order line product does not belong to the same restaurant as the order.';
  END IF;

  -- Always overwrite any caller-supplied snapshot, including NULL and forged
  -- values. NULL product tax_category deliberately stays NULL/unclassified.
  NEW.tax_category_snapshot := v_product_category;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.snapshot_order_item_tax_category() FROM PUBLIC, anon, authenticated, service_role;

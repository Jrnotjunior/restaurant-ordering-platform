-- Branch-aware operational order reader. Existing business-wide order logic is
-- reused; this overload adds branch metadata and an optional branch filter.
CREATE OR REPLACE FUNCTION public.get_restaurant_orders_with_branch(
  p_restaurant_id uuid,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  customer_name text,
  notes text,
  order_type text,
  payment_method text,
  payment_status text,
  pickup_method text,
  status text,
  total numeric,
  shipping_fee numeric,
  tax_vat_registered boolean,
  tax_prices_vat_inclusive boolean,
  tax_vat_rate numeric,
  tax_gross_sales numeric,
  tax_vatable_sales numeric,
  tax_vat_amount numeric,
  tax_vat_exempt_sales numeric,
  tax_net_sales numeric,
  discount_amount numeric,
  loyalty_discount_amount numeric,
  discount_beneficiary_count integer,
  discount_group_size integer,
  discount_beneficiaries jsonb,
  created_at timestamptz,
  items jsonb,
  branch_id uuid,
  branch_name text,
  branch_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    existing.order_id,
    existing.order_number,
    existing.customer_name,
    existing.notes,
    existing.order_type,
    existing.payment_method,
    existing.payment_status,
    existing.pickup_method,
    existing.status,
    existing.total,
    existing.shipping_fee,
    existing.tax_vat_registered,
    existing.tax_prices_vat_inclusive,
    existing.tax_vat_rate,
    existing.tax_gross_sales,
    existing.tax_vatable_sales,
    existing.tax_vat_amount,
    existing.tax_vat_exempt_sales,
    existing.tax_net_sales,
    existing.discount_amount,
    existing.loyalty_discount_amount,
    existing.discount_beneficiary_count,
    existing.discount_group_size,
    existing.discount_beneficiaries,
    existing.created_at,
    existing.items,
    actual.branch_id,
    branch.name,
    branch.branch_code
  FROM public.get_restaurant_orders(p_restaurant_id) AS existing
  JOIN public.orders AS actual
    ON actual.id = existing.order_id
   AND actual.restaurant_id = p_restaurant_id
  JOIN public.restaurant_branches AS branch
    ON branch.id = actual.branch_id
   AND branch.restaurant_id = actual.restaurant_id
  WHERE p_branch_id IS NULL OR actual.branch_id = p_branch_id;
$function$;

REVOKE ALL ON FUNCTION public.get_restaurant_orders_with_branch(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_orders_with_branch(uuid, uuid) TO anon, authenticated;

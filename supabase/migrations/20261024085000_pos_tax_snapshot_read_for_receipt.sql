-- One-order, tenant-scoped financial snapshot read for POS print consistency.
-- The RPC deliberately returns no buyer/beneficiary identity fields.
CREATE OR REPLACE FUNCTION public.get_pos_order_tax_snapshot(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
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
        SELECT 1
        FROM public.restaurant_staff s
        WHERE s.restaurant_id = o.restaurant_id
          AND s.auth_user_id = auth.uid()
          AND s.role = 'cashier'
          AND s.is_active = true
      )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or you are not authorized to view its tax snapshot.' USING errcode = '42501';
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'tax_snapshot_status', v_order.tax_snapshot_status,
    'tax_snapshot_version', v_order.tax_snapshot_version,
    'tax_vat_registered', v_order.tax_vat_registered,
    'tax_prices_vat_inclusive', v_order.tax_prices_vat_inclusive,
    'tax_vat_rate', v_order.tax_vat_rate,
    'tax_gross_sales', v_order.tax_gross_sales,
    'tax_vatable_sales', v_order.tax_vatable_sales,
    'tax_vat_amount', v_order.tax_vat_amount,
    'tax_vat_exempt_sales', v_order.tax_vat_exempt_sales,
    'tax_zero_rated_sales', v_order.tax_zero_rated_sales,
    'tax_net_sales', v_order.tax_net_sales,
    'tax_percentage_taxable_sales', v_order.tax_percentage_taxable_sales,
    'tax_non_vat_exempt_sales', v_order.tax_non_vat_exempt_sales,
    'discount_amount', v_order.discount_amount,
    'loyalty_discount_amount', v_order.loyalty_discount_amount,
    'discount_beneficiary_count', v_order.discount_beneficiary_count,
    'delivery_fee', v_order.delivery_fee,
    'total', v_order.total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_order_tax_snapshot(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_order_tax_snapshot(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_pos_order_tax_snapshot(uuid) IS
  'Returns only tax/financial snapshot fields for an order owned by the current restaurant or accessible to its active cashier. Used to keep POS print output aligned with the server-finalized snapshot.';

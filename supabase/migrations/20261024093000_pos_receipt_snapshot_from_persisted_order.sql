-- Owner/cashier-only persisted receipt snapshot for exact receipt parity.
-- This returns stored order/line/discount/tax values, never client preview amounts.
-- Kitchen and dispatcher sessions cannot call this RPC and must not receive buyer PII.
CREATE OR REPLACE FUNCTION public.get_pos_order_receipt_snapshot(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_cashier_name text;
  v_loyalty_discount_amount numeric(12,2) := 0;
  v_items jsonb := '[]'::jsonb;
  v_beneficiaries jsonb := '[]'::jsonb;
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
    RAISE EXCEPTION 'Order not found or you are not authorized to view its receipt.' USING errcode = '42501';
  END IF;

  SELECT coalesce(sum(abs(lt.eligible_amount)), 0)::numeric(12,2)
    INTO v_loyalty_discount_amount
  FROM public.loyalty_transactions lt
  WHERE lt.order_id = v_order.id
    AND lt.transaction_type = 'redeem';

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'name', oi.product_name,
        'quantity', oi.quantity,
        'unitPrice', oi.unit_price,
        'lineTotal', oi.line_total,
        'taxCategory', oi.tax_category_snapshot
      )
      ORDER BY oi.created_at, oi.id
    ),
    '[]'::jsonb
  )
    INTO v_items
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'discountType', b.discount_type,
        'idType', b.discount_id_type,
        'idNumber', b.discount_id_number,
        'beneficiaryName', b.beneficiary_name,
        'beneficiaryTin', b.beneficiary_tin,
        'beneficiaryAddress', b.beneficiary_address,
        'eligibleAmount', b.eligible_amount,
        'eligibleGrossAmount', (
          SELECT round(sum(a.eligible_gross_amount), 2)
          FROM public.order_discount_beneficiary_line_allocations a
          WHERE a.beneficiary_id = b.id
        ),
        'groupSize', v_order.discount_group_size,
        'discountAmount', b.discount_amount
      )
      ORDER BY b.created_at, b.id
    ),
    '[]'::jsonb
  )
    INTO v_beneficiaries
  FROM public.order_discount_beneficiaries b
  WHERE b.order_id = v_order.id;

  SELECT coalesce(
    (
      SELECT coalesce(nullif(trim(st.preferred_name), ''), nullif(trim(st.name), ''))
      FROM public.pos_sales_journal j
      JOIN public.restaurant_staff st
        ON st.restaurant_id = j.restaurant_id
       AND st.auth_user_id = j.actor_user_id
       AND st.role = 'cashier'
      WHERE j.order_id = v_order.id
        AND j.event_type = 'SALE_CREATED'
        AND j.actor_role = 'cashier'
      ORDER BY j.occurred_at, j.journal_id
      LIMIT 1
    ),
    (
      SELECT coalesce(nullif(trim(st.preferred_name), ''), nullif(trim(st.name), ''))
      FROM public.restaurant_staff st
      WHERE st.restaurant_id = v_order.restaurant_id
        AND st.auth_user_id = auth.uid()
        AND st.role = 'cashier'
        AND st.is_active = true
      LIMIT 1
    ),
    'Cashier'
  )
    INTO v_cashier_name;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'created_at', v_order.created_at,
    'order_type', v_order.order_type,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'status', v_order.status,
    'customer_name', v_order.customer_name,
    'mobile_number', v_order.mobile_number,
    'delivery_address', CASE
      WHEN v_order.order_type = 'delivery'
        THEN coalesce(nullif(trim(v_order.customer_delivery_address), ''), nullif(trim(v_order.delivery_address), ''))
      ELSE NULL
    END,
    'notes', v_order.notes,
    'cashier_name', v_cashier_name,
    'subtotal', v_order.subtotal,
    'delivery_fee', v_order.delivery_fee,
    'total', v_order.total,
    'discount_amount', v_order.discount_amount,
    'loyalty_discount_amount', v_loyalty_discount_amount,
    'discount_group_size', v_order.discount_group_size,
    'discount_beneficiary_count', v_order.discount_beneficiary_count,
    'items', v_items,
    'beneficiaries', v_beneficiaries,
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
    'tax_snapshot_status', v_order.tax_snapshot_status,
    'tax_snapshot_version', v_order.tax_snapshot_version
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_order_receipt_snapshot(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_order_receipt_snapshot(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_pos_order_receipt_snapshot(uuid) IS
  'Returns one persisted operational receipt snapshot to the tenant owner or active cashier only. Kitchen/dispatcher roles are not authorized. It does not return an official BIR invoice payload.';

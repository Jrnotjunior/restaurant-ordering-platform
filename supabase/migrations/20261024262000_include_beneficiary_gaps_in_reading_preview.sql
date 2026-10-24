-- Keep internal X/Z-style preview tax completeness aligned with paid-sale review gates.
-- Missing statutory discount beneficiary details must prevent the preview from claiming
-- a complete tax summary. Existing immutable previews are not rewritten.
-- Separate payment-recognized sales from kitchen/workflow completion.
-- X/Z-style rows remain internal previews, never official BIR readings.
-- Existing immutable snapshots are not rewritten or backfilled.

COMMENT ON COLUMN public.pos_sales_reading_previews.completed_sales_total IS
  'Order totals whose operational workflow status was completed at preview time. This is not the paid-sales amount and must not be used as the sales basis.';
COMMENT ON COLUMN public.pos_sales_reading_previews.cumulative_completed_sales_total IS
  'Cumulative operationally completed order totals through the business date. Not a BIR grand-total counter and not the paid-sales amount.';

CREATE OR REPLACE FUNCTION public.generate_pos_sales_reading_preview(
  p_restaurant_id uuid,
  p_business_date date,
  p_reading_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_order_count integer := 0;
  v_completed_count integer := 0;
  v_cancelled_count integer := 0;
  v_paid_count integer := 0;
  v_pending_count integer := 0;
  v_refunded_count integer := 0;
  v_completed_discounts numeric(14,2) := 0;
  v_completed_delivery_fee numeric(14,2) := 0;
  v_completed_total numeric(14,2) := 0;
  v_cumulative_completed_total numeric(16,2) := 0;
  v_paid_sales_count integer := 0;
  v_paid_sales numeric(14,2) := 0;
  v_cumulative_paid_sales numeric(16,2) := 0;
  v_paid_discounts numeric(14,2) := 0;
  v_paid_delivery_fee numeric(14,2) := 0;
  v_tax_review_count integer := 0;
  v_unclassified_line_count integer := 0;
  v_tax_complete boolean := false;
  v_vatable numeric(14,2);
  v_vat numeric(14,2);
  v_exempt numeric(14,2);
  v_zero_rated numeric(14,2);
  v_reading_id uuid;
  v_snapshot jsonb;
BEGIN
  IF NOT (
    public.is_system_admin_manager()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = p_restaurant_id AND r.owner_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'You are not authorized to generate a sales reading preview for this restaurant.';
  END IF;

  IF p_business_date IS NULL
     OR p_business_date > timezone('Asia/Manila', now())::date THEN
    RAISE EXCEPTION 'Choose a business date that is not in the future.';
  END IF;

  IF p_reading_type IS NULL OR p_reading_type NOT IN ('x_preview','z_preview') THEN
    RAISE EXCEPTION 'Reading type must be x_preview or z_preview.';
  END IF;

  v_from := p_business_date::timestamp AT TIME ZONE 'Asia/Manila';
  v_to := (p_business_date + 1)::timestamp AT TIME ZONE 'Asia/Manila';

  -- Serialize preview creation per tenant/day; each snapshot is immutable.
  PERFORM pg_advisory_xact_lock(hashtext(p_restaurant_id::text || ':' || p_business_date::text));

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE o.status = 'completed')::integer,
    count(*) FILTER (WHERE o.status = 'cancelled')::integer,
    count(*) FILTER (WHERE o.payment_status = 'paid')::integer,
    count(*) FILTER (WHERE o.payment_status = 'pending')::integer,
    count(*) FILTER (WHERE o.payment_status = 'refunded')::integer,
    coalesce(sum(o.discount_amount) FILTER (WHERE o.status = 'completed'), 0)::numeric(14,2),
    coalesce(sum(o.delivery_fee) FILTER (WHERE o.status = 'completed'), 0)::numeric(14,2),
    coalesce(sum(o.total) FILTER (WHERE o.status = 'completed'), 0)::numeric(14,2),
    count(*) FILTER (
      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled','refunded')
    )::integer,
    coalesce(sum(o.discount_amount) FILTER (
      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled','refunded')
    ), 0)::numeric(14,2),
    coalesce(sum(o.delivery_fee) FILTER (
      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled','refunded')
    ), 0)::numeric(14,2),
    coalesce(sum(o.total) FILTER (
      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled','refunded')
    ), 0)::numeric(14,2)
  INTO
    v_order_count, v_completed_count, v_cancelled_count, v_paid_count,
    v_pending_count, v_refunded_count,
    v_completed_discounts, v_completed_delivery_fee, v_completed_total,
    v_paid_sales_count, v_paid_discounts, v_paid_delivery_fee, v_paid_sales
  FROM public.orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.created_at >= v_from AND o.created_at < v_to;

  SELECT coalesce(sum(o.total), 0)::numeric(16,2)
    INTO v_cumulative_completed_total
  FROM public.orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status = 'completed'
    AND o.created_at < v_to;

  SELECT coalesce(sum(o.total), 0)::numeric(16,2)
    INTO v_cumulative_paid_sales
  FROM public.orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.payment_status = 'paid'
    AND o.status NOT IN ('cancelled','refunded')
    AND o.created_at < v_to;

  -- Tax completeness follows the same paid-sales population, not kitchen status.
  SELECT count(*)::integer
    INTO v_tax_review_count
  FROM public.orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.created_at >= v_from AND o.created_at < v_to
    AND o.payment_status = 'paid'
    AND o.status NOT IN ('cancelled','refunded')
    AND o.total > 0
    AND (
      o.tax_snapshot_status IS DISTINCT FROM 'calculated'
      OR o.tax_zero_rated_sales IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id)
      OR EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = o.id AND oi.tax_category_snapshot IS NULL
      )
      OR (
        o.discount_beneficiary_count > 0
        AND EXISTS (
          SELECT 1 FROM public.order_discount_beneficiaries b
          WHERE b.order_id = o.id
            AND (
              NULLIF(trim(b.beneficiary_name), '') IS NULL
              OR NULLIF(trim(b.beneficiary_address), '') IS NULL
            )
        )
      )
    );

  SELECT count(*)::integer
    INTO v_unclassified_line_count
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.restaurant_id = p_restaurant_id
    AND o.created_at >= v_from AND o.created_at < v_to
    AND o.payment_status = 'paid'
    AND o.status NOT IN ('cancelled','refunded')
    AND oi.tax_category_snapshot IS NULL;

  v_tax_complete := v_paid_sales_count > 0
    AND v_tax_review_count = 0
    AND v_unclassified_line_count = 0;

  IF v_tax_complete THEN
    SELECT
      coalesce(sum(o.tax_vatable_sales), 0)::numeric(14,2),
      coalesce(sum(o.tax_vat_amount), 0)::numeric(14,2),
      coalesce(sum(o.tax_vat_exempt_sales), 0)::numeric(14,2),
      coalesce(sum(o.tax_zero_rated_sales), 0)::numeric(14,2)
    INTO v_vatable, v_vat, v_exempt, v_zero_rated
    FROM public.orders o
    WHERE o.restaurant_id = p_restaurant_id
      AND o.created_at >= v_from AND o.created_at < v_to
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled','refunded');
  END IF;

  v_snapshot := jsonb_build_object(
    'is_official', false,
    'notice', 'Internal sales reading preview only. Not a BIR X-Reading, Z-Reading, invoice, tax return, or approval artifact.',
    'reading_type', p_reading_type,
    'business_date', p_business_date,
    'timezone', 'Asia/Manila',
    'generated_at', clock_timestamp(),
    'sales_basis', 'Payment status paid; excludes orders whose workflow status is cancelled or refunded. This is a platform preview basis, not an approved fiscal definition.',
    'order_counts', jsonb_build_object(
      'all_orders', v_order_count,
      'completed', v_completed_count,
      'cancelled', v_cancelled_count,
      'paid', v_paid_count,
      'pending_payment', v_pending_count,
      'refunded', v_refunded_count
    ),
    'platform_totals_php', jsonb_build_object(
      'paid_sales_order_count', v_paid_sales_count,
      'paid_sales_total', v_paid_sales,
      'cumulative_paid_sales_total', v_cumulative_paid_sales,
      'paid_order_discounts', v_paid_discounts,
      'paid_order_delivery_fees', v_paid_delivery_fee,
      'completed_order_totals', v_completed_total,
      'completed_order_discounts', v_completed_discounts,
      'completed_order_delivery_fees', v_completed_delivery_fee,
      'cumulative_completed_order_totals_through_date', v_cumulative_completed_total
    ),
    'tax_summary', jsonb_build_object(
      'complete', v_tax_complete,
      'orders_needing_review', v_tax_review_count,
      'unclassified_order_lines', v_unclassified_line_count,
      'vatable_sales_php', v_vatable,
      'vat_amount_php', v_vat,
      'vat_exempt_sales_php', v_exempt,
      'zero_rated_sales_php', v_zero_rated
    )
  );

  INSERT INTO public.pos_sales_reading_previews (
    restaurant_id, business_date, reading_type, generated_by,
    order_count, completed_order_count, cancelled_order_count, paid_order_count,
    pending_payment_count, refunded_order_count, discounts_total, delivery_fee_total,
    completed_sales_total, cumulative_completed_sales_total, tax_review_order_count,
    unclassified_line_count, tax_summary_complete, vatable_sales, vat_amount,
    vat_exempt_sales, zero_rated_sales, snapshot
  ) VALUES (
    p_restaurant_id, p_business_date, p_reading_type, auth.uid(),
    v_order_count, v_completed_count, v_cancelled_count, v_paid_count,
    v_pending_count, v_refunded_count,
    v_completed_discounts, v_completed_delivery_fee,
    v_completed_total, v_cumulative_completed_total, v_tax_review_count,
    v_unclassified_line_count, v_tax_complete, v_vatable, v_vat,
    v_exempt, v_zero_rated, v_snapshot
  ) RETURNING reading_id INTO v_reading_id;

  RETURN v_snapshot || jsonb_build_object(
    'reading_id', v_reading_id,
    'generated_by', auth.uid()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_pos_sales_reading_preview(uuid,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_pos_sales_reading_preview(uuid,date,text) TO authenticated;

COMMENT ON FUNCTION public.generate_pos_sales_reading_preview(uuid,date,text) IS
  'Generates immutable internal X/Z-style previews. Separates payment-recognized sales from kitchen completion state. Not an official BIR reading; approved fiscal rules and formal authorization remain prerequisites.';

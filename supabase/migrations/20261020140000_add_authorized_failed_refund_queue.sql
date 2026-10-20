-- Expose only cancelled paid orders whose automatic PayMongo refund failed,
-- scoped to the current restaurant branch and authorized owner/cashier.
CREATE OR REPLACE FUNCTION public.get_restaurant_failed_refunds(
  p_restaurant_id uuid,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  total numeric,
  branch_id uuid,
  branch_name text,
  refund_error text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to view failed refunds.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurants r
    WHERE r.id = p_restaurant_id
      AND (
        r.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_staff rs
          WHERE rs.restaurant_id = r.id
            AND rs.auth_user_id = auth.uid()
            AND rs.is_active = true
            AND rs.role = 'cashier'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Only the restaurant owner or an active cashier can view failed refunds.';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.total,
    o.branch_id,
    b.name,
    o.cancellation_refund_error,
    o.updated_at
  FROM public.orders o
  JOIN public.restaurant_branches b
    ON b.id = o.branch_id
   AND b.restaurant_id = o.restaurant_id
  WHERE o.restaurant_id = p_restaurant_id
    AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
    AND o.status = 'cancelled'
    AND o.payment_status = 'paid'
    AND o.cancellation_refund_status = 'failed'
    AND o.paymongo_refund_id IS NULL
    AND NULLIF(BTRIM(o.paymongo_payment_id), '') IS NOT NULL
  ORDER BY o.updated_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_restaurant_failed_refunds(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_restaurant_failed_refunds(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_failed_refunds(uuid, uuid) TO authenticated;

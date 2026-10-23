-- Require order ownership or the guest tracking capability for auxiliary tracking reads.
-- Keep authenticated access through verified customer-profile ownership; guest callers
-- must present the SHA-256 hash of the high-entropy tracking token.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_customer_order_created_at(
  p_order_id uuid,
  p_guest_tracking_token_hash text
)
RETURNS TABLE(created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT o.created_at
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND (
      EXISTS (
        SELECT 1
        FROM public.customer_profiles AS cp
        WHERE cp.id = o.customer_id
          AND cp.restaurant_id = o.restaurant_id
          AND cp.auth_user_id = auth.uid()
      )
      OR (
        auth.uid() IS NULL
        AND o.customer_id IS NULL
        AND p_guest_tracking_token_hash ~ '^[0-9a-f]{64}$'
        AND o.guest_tracking_token_hash = p_guest_tracking_token_hash
      )
    )
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_order_cancellation_refund_status(
  p_order_id uuid,
  p_guest_tracking_token_hash text
)
RETURNS TABLE(cancellation_refund_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT o.cancellation_refund_status::text
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND (
      EXISTS (
        SELECT 1
        FROM public.customer_profiles AS cp
        WHERE cp.id = o.customer_id
          AND cp.restaurant_id = o.restaurant_id
          AND cp.auth_user_id = auth.uid()
      )
      OR (
        auth.uid() IS NULL
        AND o.customer_id IS NULL
        AND p_guest_tracking_token_hash ~ '^[0-9a-f]{64}$'
        AND o.guest_tracking_token_hash = p_guest_tracking_token_hash
      )
    )
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_customer_order_created_at(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_order_created_at(uuid, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_order_cancellation_refund_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_cancellation_refund_status(uuid, text) TO anon, authenticated;

-- Remove anonymous access to the older UUID-only helper signatures. Authenticated
-- callers retain access, and the client uses the token-aware overloads for guests.
REVOKE EXECUTE ON FUNCTION public.get_customer_order_created_at(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_order_cancellation_refund_status(uuid) FROM anon;

NOTIFY pgrst, 'reload schema';
COMMIT;

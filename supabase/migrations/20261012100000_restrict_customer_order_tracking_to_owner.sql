-- Prevent signed-in customers from opening another customer's order tracking
-- page by guessing, copying, or receiving an unrelated order UUID.
-- Guest tracking remains available to signed-out visitors who possess the
-- opaque order UUID; authenticated sessions must own the linked customer order.

DO $migration$
DECLARE
  v_definition text;
  v_replaced text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_order_status_by_id'
    AND pg_get_function_identity_arguments(p.oid) = 'p_order_id uuid';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Expected get_order_status_by_id(uuid) function was not found';
  END IF;

  v_replaced := replace(
    v_definition,
    'where o.id = p_order_id',
    'where o.id = p_order_id
      and (
        auth.uid() is null
        or exists (
          select 1
          from public.customer_profiles cp
          where cp.id = o.customer_id
            and cp.restaurant_id = o.restaurant_id
            and cp.auth_user_id = auth.uid()
        )
      )'
  );

  v_replaced := replace(
    v_replaced,
    'WHERE o.id = p_order_id',
    'WHERE o.id = p_order_id
      AND (
        auth.uid() IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.customer_profiles cp
          WHERE cp.id = o.customer_id
            AND cp.restaurant_id = o.restaurant_id
            AND cp.auth_user_id = auth.uid()
        )
      )'
  );

  IF v_replaced = v_definition THEN
    RAISE EXCEPTION 'Could not safely add customer ownership check to order tracking';
  END IF;

  EXECUTE v_replaced;
END;
$migration$;

REVOKE ALL ON FUNCTION public.get_order_status_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_status_by_id(uuid) TO anon, authenticated;

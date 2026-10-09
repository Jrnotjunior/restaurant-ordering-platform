-- Replace guessable order-number tracking with an opaque order UUID.
-- The order number remains a display/reference value, never an authorization token.
DO $migration$
DECLARE
  v_definition text;
  v_replaced text;
  v_signature text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_order_status'
    AND pg_get_function_identity_arguments(p.oid) = 'p_order_number text';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Expected get_order_status(text) function was not found';
  END IF;

  v_replaced := replace(
    v_definition,
    'public.get_order_status(p_order_number text)',
    'public.get_order_status_by_id(p_order_id uuid)'
  );
  v_replaced := replace(
    v_replaced,
    'where o.order_number = p_order_number',
    'where o.id = p_order_id'
  );
  v_replaced := replace(
    v_replaced,
    'WHERE o.order_number = p_order_number',
    'WHERE o.id = p_order_id'
  );

  IF v_replaced = v_definition OR position('where o.id = p_order_id' in lower(v_replaced)) = 0 THEN
    RAISE EXCEPTION 'Could not safely derive UUID-based customer tracking function';
  END IF;

  EXECUTE v_replaced;
END;
$migration$;

REVOKE ALL ON FUNCTION public.get_order_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_status_by_id(uuid) TO anon, authenticated;

-- A payment reference is a bearer credential used by guest checkout's return URL.
-- Expand new references from 32 to 128 bits of random UUID material.
DO $migration$
DECLARE
  v_function record;
  v_definition text;
  v_replaced text;
BEGIN
  FOR v_function IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_pending_online_payment',
        'create_pending_online_payment_from_delivery_quote'
      )
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_replaced := replace(
      v_definition,
      'substr(replace(gen_random_uuid()::text,''-'',''''),1,8)',
      'substr(replace(gen_random_uuid()::text,''-'',''''),1,32)'
    );
    v_replaced := replace(
      v_replaced,
      'substr(replace(gen_random_uuid()::text, ''-'', ''''), 1, 8)',
      'substr(replace(gen_random_uuid()::text, ''-'', ''''), 1, 32)'
    );

    IF v_replaced = v_definition THEN
      RAISE EXCEPTION 'Could not lengthen payment reference generator for % (%)',
        v_function.proname, v_function.identity_args;
    END IF;

    EXECUTE v_replaced;
  END LOOP;
END;
$migration$;

-- Include the order UUID in the payment status response so the customer can
-- transition from the high-entropy payment reference to UUID-based tracking.
DROP FUNCTION IF EXISTS public.get_online_payment_status(text);

CREATE FUNCTION public.get_online_payment_status(p_reference_number text)
RETURNS TABLE (
  status text,
  order_number text,
  order_id uuid,
  total numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    p.status,
    o.order_number,
    o.id,
    p.total
  FROM public.pending_online_payments p
  LEFT JOIN public.orders o ON o.id = p.order_id
  WHERE p.reference_number = trim(p_reference_number);
$function$;

REVOKE ALL ON FUNCTION public.get_online_payment_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_online_payment_status(text) TO anon, authenticated;

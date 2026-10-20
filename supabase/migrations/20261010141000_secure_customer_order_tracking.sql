-- Replace guessable order-number tracking with an opaque order UUID.
-- The order number remains a display/reference value, never an authorization token.
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
REVOKE ALL ON FUNCTION public.get_order_status_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_status_by_id(uuid) TO anon, authenticated;

-- A payment reference is a bearer credential used by guest checkout's return URL.
-- Expand new references from 32 to 128 bits of random UUID material.
DO $migration$
DECLARE
  v_function record;
  v_definition text;
  v_replaced text;
  v_generators_updated integer := 0;
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
      -- Some compatibility overloads delegate to the base RPC and do not
      -- generate their own reference. Skip those safely.
      IF position('from public.create_pending_online_payment(' in lower(v_definition)) > 0 THEN
        CONTINUE;
      END IF;

      -- Also allow a migration replay where this function already uses 32
      -- hexadecimal UUID characters. An unrecognized short generator is an
      -- error, because it would otherwise leave a weak bearer reference.
      IF position('pay-' in lower(v_definition)) > 0
         AND position('substr(replace(gen_random_uuid()::text' in lower(v_definition)) > 0
         AND (
           position(',1,32)' in lower(v_definition)) > 0
           OR position(', 1, 32)' in lower(v_definition)) > 0
         ) THEN
        CONTINUE;
      END IF;

      IF position('pay-' in lower(v_definition)) > 0 THEN
        RAISE EXCEPTION 'Unrecognized payment reference generator for % (%)',
          v_function.proname, v_function.identity_args;
      END IF;

      CONTINUE;
    END IF;

    EXECUTE v_replaced;
    v_generators_updated := v_generators_updated + 1;
  END LOOP;

  IF v_generators_updated = 0 THEN
    RAISE EXCEPTION 'No payment reference generators were hardened; migration rolled back';
  END IF;
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
